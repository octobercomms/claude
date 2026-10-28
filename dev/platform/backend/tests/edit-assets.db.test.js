/**
 * An edit that finishes rendering lands in the client's asset library.
 *
 * Not in CI: the runner has no Postgres, and a test that SKIPs is a test that
 * is not running. Run it locally per docs/omi/agent-guide.md §3:
 *
 *   DB_HOST=localhost DB_NAME=omi DB_USER=omi DB_PASSWORD=omi \
 *     node tests/edit-assets.db.test.js
 *
 * What only a database can prove: that completing a job writes exactly one
 * library row, that a retry replaces it rather than giving one edit two rows,
 * that the row survives a library write that could not happen, and that the
 * backfill in migration 214 reached the edits that were already finished.
 */
const assert = require('assert');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret_testsecret_testsecret_1234';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64);

const pool = require('../src/db');
const editJobs = require('../src/services/editJobs');
const assets = require('../src/services/assets');

let pass = 0; const fails = [];
async function ok(label, fn) {
  try { await fn(); pass += 1; console.log(`  ok   ${label}`); }
  catch (e) { fails.push([label, e.message]); console.log(`  FAIL ${label}\n       ${e.message}`); }
}

const tag = `e${Date.now().toString(36)}`;

async function client(name) {
  const { rows } = await pool.query(
    'INSERT INTO clients (name, slug) VALUES ($1,$2) RETURNING id',
    [`${name} ${tag}`, `${name.toLowerCase()}-${tag}`]);
  return rows[0].id;
}

async function job(clientId, { name = null, ops = {} } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO edit_jobs (client_id, source_name, source_url, ops, status, name)
     VALUES ($1, 'camera-roll.mov', '/api/edit/file/x.mov', $2, 'queued', $3) RETURNING id`,
    [clientId, JSON.stringify(ops), name]);
  return rows[0].id;
}

const libraryRow = async (jobId) => (await pool.query(
  "SELECT * FROM client_assets WHERE source = 'edit_job' AND source_id = $1", [jobId])).rows[0] || null;

(async () => {
  // Two clients, never one: a missing client filter answers correctly against
  // a single client by luck.
  const a = await client('Alpha');
  const b = await client('Beta');

  console.log('\nA finished edit becomes a library row');
  {
    const id = await job(a, { name: 'Founder intro', ops: { aspect: '9:16', captions: true,
      caption_template: 'institution', clean_audio: true } });
    await editJobs.complete(id, { outputUrl: '/api/edit/file/out.mp4', srtUrl: '/api/edit/file/out.srt',
      costUsd: 0.02, durationS: 31.4, width: 1080, height: 1920, bytes: 4_200_000 });

    const row = await libraryRow(id);
    await ok('the row exists, against the right client', () => {
      assert.ok(row, 'no library row was written');
      assert.strictEqual(row.client_id, a);
      assert.strictEqual(row.kind, 'video');
    });
    await ok('it carries the operator’s own name, not "Edit"', () =>
      assert.strictEqual(row.title, 'Founder intro'));
    await ok('and the numbers an operator scans for', () => {
      assert.strictEqual(Number(row.duration_s), 31.4);
      assert.strictEqual(row.width, 1080);
      assert.strictEqual(row.height, 1920);
      assert.strictEqual(Number(row.bytes), 4200000);
    });
    await ok('with what the edit actually did, for filtering later', () => {
      assert.strictEqual(row.metadata.caption_template, 'institution');
      assert.strictEqual(row.metadata.aspect, '9:16');
      assert.strictEqual(row.metadata.captions, true);
      assert.strictEqual(row.metadata.srt_url, '/api/edit/file/out.srt');
    });
    await ok('and the job itself is marked done', async () => {
      const { rows } = await pool.query('SELECT status, output_url FROM edit_jobs WHERE id = $1', [id]);
      assert.strictEqual(rows[0].status, 'done');
      assert.strictEqual(rows[0].output_url, '/api/edit/file/out.mp4');
    });
  }

  console.log('\nA retry does not give one edit two rows');
  {
    const id = await job(a, { name: 'Retried' });
    await editJobs.complete(id, { outputUrl: '/api/edit/file/first.mp4', durationS: 10 });
    await editJobs.complete(id, { outputUrl: '/api/edit/file/second.mp4', durationS: 20 });
    await ok('the second render replaces the first row', async () => {
      const { rows } = await pool.query(
        "SELECT * FROM client_assets WHERE source = 'edit_job' AND source_id = $1", [id]);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].url, '/api/edit/file/second.mp4');
      assert.strictEqual(Number(rows[0].duration_s), 20);
    });
  }

  console.log('\nThe title falls back the way an operator would expect');
  {
    const id = await job(a);                       // no name given
    await editJobs.complete(id, { outputUrl: '/api/edit/file/noname.mp4' });
    await ok('an unnamed job is titled by the file it came from', async () =>
      assert.strictEqual((await libraryRow(id)).title, 'camera-roll.mov'));
  }

  console.log('\nNothing is claimed that does not exist');
  {
    const id = await job(a, { name: 'No output' });
    await editJobs.complete(id, { outputUrl: null });
    // Absent for two reasons, and both are wanted: complete() returns early,
    // and assets.record refuses an asset with neither a url nor a storage key.
    // The early return only saves a pointless log line; the behaviour asserted
    // here holds either way.
    await ok('a completion with no file writes no library row', async () =>
      assert.strictEqual(await libraryRow(id), null));
    await ok('and still marks the job done rather than throwing', async () => {
      const { rows } = await pool.query('SELECT status FROM edit_jobs WHERE id = $1', [id]);
      assert.strictEqual(rows[0].status, 'done');
    });
  }

  console.log('\nThe library write can never cost the render');
  {
    const id = await job(b, { name: 'Library down' });
    const real = assets.record;
    assets.record = async () => { throw new Error('library unreachable'); };
    try {
      await ok('a failing library write does not throw at the renderer', async () => {
        await editJobs.complete(id, { outputUrl: '/api/edit/file/survived.mp4', durationS: 5 });
      });
    } finally { assets.record = real; }
    await ok('and the job is still done, with its output recorded', async () => {
      const { rows } = await pool.query(
        'SELECT status, output_url FROM edit_jobs WHERE id = $1', [id]);
      assert.strictEqual(rows[0].status, 'done');
      assert.strictEqual(rows[0].output_url, '/api/edit/file/survived.mp4');
    });
  }

  console.log('\nOne client’s edits never land in another’s library');
  {
    const { rows } = await pool.query(
      "SELECT client_id, COUNT(*)::int n FROM client_assets WHERE source = 'edit_job'"
      + ' AND client_id = ANY($1) GROUP BY client_id', [[a, b]]);
    const by = Object.fromEntries(rows.map((r) => [r.client_id, r.n]));
    await ok('Alpha has its three, Beta has none it did not make', () => {
      assert.strictEqual(by[a], 3);
      assert.strictEqual(by[b] || 0, 0);   // Beta's one job had a failing library write
    });
  }

  console.log('\nThe backfill reached the edits already finished');
  {
    // A job written the way the migration finds them: done, with an output,
    // and no library row, exactly as every edit before migration 214 looked.
    const id = await job(b, { name: 'Already rendered',
      ops: { aspect: '1:1', captions: false, clean_audio: true } });
    await pool.query(
      `UPDATE edit_jobs SET status = 'done', output_url = '/api/edit/file/old.mp4',
              srt_url = NULL WHERE id = $1`, [id]);
    await ok('it starts with no library row, as the old jobs did', async () =>
      assert.strictEqual(await libraryRow(id), null));

    const sql = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'migrations', '214_edit_job_assets.sql'), 'utf8');
    await pool.query(sql);

    const row = await libraryRow(id);
    await ok('the backfill indexes it', () => {
      assert.ok(row, 'the backfill missed it');
      assert.strictEqual(row.title, 'Already rendered');
      assert.strictEqual(row.url, '/api/edit/file/old.mp4');
      assert.strictEqual(row.metadata.backfilled, true);
      assert.strictEqual(row.metadata.aspect, '1:1');
    });
    await ok('and running it twice changes nothing', async () => {
      await pool.query(sql);
      const { rows } = await pool.query(
        "SELECT COUNT(*)::int n FROM client_assets WHERE source = 'edit_job' AND source_id = $1", [id]);
      assert.strictEqual(rows[0].n, 1);
    });
  }

  console.log('\nAn unfinished edit is not an asset');
  {
    const queued = await job(b, { name: 'Still queued' });
    const failed = await job(b, { name: 'Failed' });
    // Given a file on purpose, which no current code path produces: retry()
    // clears output_url when it requeues. The fixture is hand-built because
    // the status filter and the output filter overlap on every job the app
    // writes today, and without it the migration would pass this test while
    // indexing on the file alone. The day something requeues a job without
    // clearing its old output, the library would start offering a stale render
    // as the current one.
    await pool.query(
      `UPDATE edit_jobs SET status = 'failed', error = 'nope',
              output_url = '/api/edit/file/stale.mp4' WHERE id = $1`, [failed]);
    await pool.query(
      `UPDATE edit_jobs SET output_url = '/api/edit/file/stale-queued.mp4' WHERE id = $1`, [queued]);
    const sql = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'migrations', '214_edit_job_assets.sql'), 'utf8');
    await pool.query(sql);
    await ok('a queued job is left alone', async () =>
      assert.strictEqual(await libraryRow(queued), null));
    await ok('and so is a failed one', async () =>
      assert.strictEqual(await libraryRow(failed), null));
  }

  await pool.query('DELETE FROM clients WHERE id = ANY($1)', [[a, b]]);
  console.log(fails.length ? `\n${fails.length} failed, ${pass} passed` : '\nall passed');
  await pool.end();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('THREW:', e.message); process.exit(1); });
