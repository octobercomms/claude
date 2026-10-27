/**
 * The library only claims what still exists.
 *
 * A row in client_assets is a claim that a file is there. A claim it cannot
 * keep is worse than no claim: the row looks usable, offers itself to the
 * scheduler, and answers "that clip could not be found on disk" the moment a
 * tool beside it is used.
 *
 * Files go missing through paths that have nothing to do with the library:
 * the Video Studio's seven-day retention deletes masters, and deleting an edit
 * unlinks its output. client_assets has no foreign key to any producing table
 * (source_id is text, because they disagree about key types), so nothing
 * cascades and every one of those paths has to say so itself.
 *
 * Not in CI: needs Postgres and a real filesystem.
 *   DB_HOST=localhost DB_NAME=omi DB_USER=omi DB_PASSWORD=omi \
 *     node tests/asset-truth.db.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret_testsecret_testsecret_1234';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64);

const pool = require('../src/db');
const assets = require('../src/services/assets');
const editJobs = require('../src/services/editJobs');

let pass = 0; const fails = [];
async function ok(label, fn) {
  try { await fn(); pass += 1; console.log(`  ok   ${label}`); }
  catch (e) { fails.push([label, e.message]); console.log(`  FAIL ${label}\n       ${e.message}`); }
}

const tag = `t${Date.now().toString(36)}`;
const live = async (id) => (await pool.query(
  'SELECT archived_at FROM client_assets WHERE id = $1', [id])).rows[0];

(async () => {
  const { rows: c } = await pool.query(
    'INSERT INTO clients (name, slug) VALUES ($1,$2) RETURNING id',
    [`Truth ${tag}`, `truth-${tag}`]);
  const cid = c[0].id;

  // Two files that really exist, in the two directories the pipelines use.
  const editDir = editJobs.clientDir(cid);
  const brandDir = path.join(__dirname, '..', 'uploads', cid);
  fs.mkdirSync(brandDir, { recursive: true });
  const editFile = path.join(editDir, 'present.mp4');
  const brandFile = path.join(brandDir, 'present.mp4');
  fs.writeFileSync(editFile, 'x');
  fs.writeFileSync(brandFile, 'x');

  const made = async (source, sourceId, url) => (await assets.record({
    client_id: cid, kind: 'video', source, source_id: sourceId, title: sourceId, url })).id;

  console.log('\nThe sweep leaves alone what it can see');
  {
    const here = await made('edit_job', `${tag}-here`, `/api/edit/file/${cid}/present.mp4`);
    const brand = await made('caption_render', `${tag}-brand`, `/api/brand/file/${cid}/present.mp4`);
    // An external url belongs to a provider's CDN. This process cannot see it,
    // and archiving it on that basis would remove assets that are fine.
    const remote = await made('ad_creative', `${tag}-remote`, 'https://cdn.example.com/a.mp4');

    const r = await assets.sweepMissingFiles({ dryRun: true });
    await ok('a dry run reports without changing anything', async () => {
      assert.strictEqual(r.dryRun, true);
      assert.strictEqual((await live(here)).archived_at, null);
    });
    await assets.sweepMissingFiles();
    await ok('an edit whose file is there survives', async () =>
      assert.strictEqual((await live(here)).archived_at, null));
    await ok('so does a brand-uploads render', async () =>
      assert.strictEqual((await live(brand)).archived_at, null));
    await ok('and an external url is never judged from here', async () =>
      assert.strictEqual((await live(remote)).archived_at, null));
    await ok('because localPath reads a provider url as present, not missing', () => {
      // The guarantee lives here rather than in the sweep's query: localPath
      // hands an http(s) url straight back to ffmpeg, which reads it directly.
      // If that ever changed to return null, every CDN-hosted asset in the
      // library would be archived overnight by a sweep that looked correct.
      const scr = require('../src/services/socialCaptionRender');
      assert.strictEqual(scr.localPath(cid, { url: 'https://cdn.example.com/a.mp4' }),
        'https://cdn.example.com/a.mp4');
    });
  }

  console.log('\nAnd archives what it cannot');
  {
    const gone = await made('edit_job', `${tag}-gone`, `/api/edit/file/${cid}/never-existed.mp4`);
    const r = await assets.sweepMissingFiles();
    await ok('a row whose file is missing is archived', async () =>
      assert.ok((await live(gone)).archived_at, 'still live'));
    await ok('and it is counted, by source', () => {
      assert.ok(r.missing >= 1);
      assert.ok(r.bySource.edit_job >= 1);
    });
    await ok('a second sweep does not re-archive it', async () => {
      const before = (await live(gone)).archived_at;
      await assets.sweepMissingFiles();
      assert.deepStrictEqual((await live(gone)).archived_at, before);
    });
  }

  console.log('\nDeleting an edit takes its library row with it');
  {
    const name = 'to-delete.mp4';
    fs.writeFileSync(path.join(editDir, name), 'x');
    const { rows } = await pool.query(
      `INSERT INTO edit_jobs (client_id, source_name, source_url, ops, status, output_url)
       VALUES ($1,'src.mov','/api/edit/file/x.mov','{}','done',$2) RETURNING id`,
      [cid, editJobs.servedUrl(cid, name)]);
    const jobId = rows[0].id;
    const assetId = await made('edit_job', jobId, editJobs.servedUrl(cid, name));

    await editJobs.remove(cid, jobId);
    await ok('the file is unlinked', () =>
      assert.ok(!fs.existsSync(path.join(editDir, name))));
    await ok('and the library row is archived at the same moment', async () =>
      assert.ok((await live(assetId)).archived_at,
        'the library still offers a file that was just deleted'));
  }

  console.log('\nThe retention sweep takes the Video Studio’s rows too');
  {
    const outputs = path.join(__dirname, '..', 'video-outputs');
    fs.mkdirSync(outputs, { recursive: true });
    const { rows } = await pool.query(
      `INSERT INTO video_projects (client_id, name, status, output_url)
       VALUES ($1,'Old master','done','/x.mp4') RETURNING id`, [cid]);
    const projectId = rows[0].id;
    const master = path.join(outputs, `${projectId}-master.mp4`);
    fs.writeFileSync(master, 'x');
    // Older than the retention window, which is what the sweep selects on.
    const old = new Date(Date.now() - 30 * 86400 * 1000);
    fs.utimesSync(master, old, old);
    const assetId = await made('video_project', String(projectId), '/api/brand/file/old.mp4');

    await require('../src/services/videoCleanup').runCleanup();
    await ok('the master is deleted', () => assert.ok(!fs.existsSync(master)));
    await ok('output_url is cleared, as it always was', async () => {
      const { rows: p } = await pool.query(
        'SELECT output_url FROM video_projects WHERE id = $1', [projectId]);
      assert.strictEqual(p[0].output_url, null);
    });
    await ok('and now the library row is archived as well', async () =>
      assert.ok((await live(assetId)).archived_at,
        'clearing output_url never told the library anything'));
  }

  console.log('\nArchiving by source is exact');
  {
    const a1 = await made('edit_job', `${tag}-keep-1`, `/api/edit/file/${cid}/present.mp4`);
    const a2 = await made('edit_job', `${tag}-keep-2`, `/api/edit/file/${cid}/present.mp4`);
    await assets.archiveBySource('edit_job', `${tag}-keep-1`);
    await ok('the named row is archived', async () => assert.ok((await live(a1)).archived_at));
    await ok('and its neighbour is not', async () =>
      assert.strictEqual((await live(a2)).archived_at, null));
    await ok('a source that does not exist is a no-op, not an error', async () =>
      assert.strictEqual(await assets.archiveBySource('edit_job', 'no-such-id'), null));
  }

  fs.rmSync(path.join(__dirname, '..', 'uploads', cid), { recursive: true, force: true });
  await pool.query('DELETE FROM clients WHERE id = $1', [cid]);
  console.log(fails.length ? `\n${fails.length} failed, ${pass} passed` : '\nall passed');
  await pool.end();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('THREW:', e.message); process.exit(1); });
