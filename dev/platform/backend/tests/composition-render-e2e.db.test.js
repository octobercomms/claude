/**
 * A template, through the queue, to an mp4 — against a real Postgres.
 *
 * The pixel tests prove the render graph produces the right frames, but they
 * hand the graph file paths directly. Everything between a stored composition
 * and those paths was untested, and all of it was broken:
 *
 *   - `assetFilePath` matched `(\d+)` for the client segment of an asset URL.
 *     A CLIENT ID IS A UUID, so it returned null for every asset in the
 *     system and every render answered `Source "sX" has no file on disk.` The
 *     editor's Export could never have worked. Its unit test passed because
 *     its fixture used `/api/brand/file/7/…`, a shape no real asset has.
 *   - the route resolved sources from the `source_assets` column alone and
 *     ignored each source's own `asset`, so a composition built by a template
 *     could not resolve at all: the binder mints its source ids at bind time
 *     and cannot pre-compute that column's keys.
 *   - the library row was keyed `render-${compId}-${Date.now()}`, and
 *     assets.record upserts on (source, source_id), so two renders of one
 *     composition in the same millisecond collapsed onto a single row.
 *
 * So this one goes the whole way: real asset rows, a real composition row
 * with its assets on the sources, the real queue, the real drainer, and then
 * ffprobe and a pixel on the output.
 *
 *   DB_HOST=/tmp DB_PORT=55434 DB_NAME=omi DB_USER=postgres \
 *     node tests/composition-render-e2e.db.test.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const pool = require('/home/user/claude/dev/platform/backend/src/db');
const queue = require('/home/user/claude/dev/platform/backend/src/services/compositionRenderQueue');
const runner = require('/home/user/claude/dev/platform/backend/src/services/compositionRenderRunner');

const S = '/tmp/claude-0/-home-user-claude/3f341b3a-320b-5781-ae35-9a74a41b078d/scratchpad/e2e';
const UPLOADS = '/home/user/claude/dev/platform/backend/uploads';
const CLIENT = '44444444-4444-4444-8444-444444444444';
const W = 216, H = 384, FPS = 25;

let fails = 0;
const ok = (c, l) => { console.log(c ? '  ok   ' + l : '  FAIL ' + l); if (!c) fails++; };

(async () => {
  fs.rmSync(S, { recursive: true, force: true });
  fs.mkdirSync(S, { recursive: true });

  await pool.query(
    `INSERT INTO clients (id, name, slug) VALUES ($1,'E2E','e2e-render') ON CONFLICT (id) DO NOTHING`, [CLIENT]);

  // Real asset rows pointing at real files under uploads/<client>/, which is
  // the shape assetFilePath resolves.
  const dir = path.join(UPLOADS, CLIENT);
  fs.mkdirSync(dir, { recursive: true });
  const COLS = ['0xff0000','0x00ff00','0x0000ff','0xffff00','0xff00ff','0x00ffff'];
  const assetIds = [];
  for (let i = 0; i < 6; i++) {
    const name = `e2e-still-${i}.png`;
    execFileSync('ffmpeg', ['-y','-loglevel','error','-f','lavfi','-i',`color=c=${COLS[i]}:s=${W}x${H}`,'-frames:v','1', path.join(dir, name)]);
    const { rows } = await pool.query(
      `INSERT INTO client_assets (client_id, kind, source, source_id, title, url, mime, width, height)
       VALUES ($1,'image','upload',$2,$3,$4,'image/png',$5,$6)
       ON CONFLICT (source, source_id) DO UPDATE SET url = EXCLUDED.url RETURNING id`,
      [CLIENT, `e2e-${i}`, name, `/api/brand/file/${CLIENT}/${name}`, W, H]);
    assetIds.push(rows[0].id);
  }
  const bedName = 'e2e-bed.m4a';
  execFileSync('ffmpeg', ['-y','-loglevel','error','-f','lavfi','-i','anullsrc=r=48000:cl=stereo:d=60','-c:a','aac', path.join(dir, bedName)]);
  const { rows: ar } = await pool.query(
    `INSERT INTO client_assets (client_id, kind, source, source_id, title, url, mime)
     VALUES ($1,'audio','upload','e2e-bed',$2,$3,'audio/mp4')
     ON CONFLICT (source, source_id) DO UPDATE SET url = EXCLUDED.url RETURNING id`,
    [CLIENT, bedName, `/api/brand/file/${CLIENT}/${bedName}`]);
  const bedId = ar[0].id;

  const { bindTemplate } = await import('/home/user/claude/dev/platform/shared/compositionTemplate.mjs');
  const tpl = JSON.parse(fs.readFileSync('/home/user/claude/dev/platform/shared/templates/stills-montage.json','utf8'));
  const comp = bindTemplate({ ...tpl, size:{width:W,height:H}, fps:FPS }, {
    stills: assetIds.map(id => ({ kind:'clip', asset:id, duration:10, width:W, height:H, fps:FPS })),
    titles: ['GRADE II LISTED','HACKNEY 2026'],
    music: { kind:'audio', asset:bedId, duration:60 },
  }, { index: 0, seed: 'e2e' });

  // The asset is on the SOURCE, not in source_assets — the exact shape a
  // template produces and the one the old route could not resolve.
  const { rows: cr } = await pool.query(
    `INSERT INTO compositions (client_id, title, data) VALUES ($1,'E2E montage',$2::jsonb) RETURNING id`,
    [CLIENT, JSON.stringify(comp)]);
  const compId = cr[0].id;
  console.log('composition', compId, '- assets on the source, source_assets empty');

  await pool.query('DELETE FROM composition_renders WHERE composition_id = $1', [compId]);

  const job = await queue.enqueue(compId);
  ok(job.status === 'queued', 'enqueued');

  const ran = await runner.drain();
  ok(ran === 1, `the drainer ran it (${ran})`);

  const after = await queue.get(job.id);
  ok(after.status === 'done', `done (status=${after.status}${after.error ? ', error=' + after.error : ''})`);
  ok(after.progress === 100, 'at 100');
  ok(!!after.output_path && fs.existsSync(after.output_path), `the mp4 is on disk (${after.output_path})`);

  if (after.output_path && fs.existsSync(after.output_path)) {
    const dur = Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',after.output_path]).toString().trim());
    const want = Math.max(...comp.tracks.flatMap(t => t.items.map(i => i.at + i.len)));
    ok(Math.abs(dur - want) < 0.3, `duration ${dur.toFixed(2)}s matches the composition's ${want.toFixed(2)}s`);

    const raw = execFileSync('ffmpeg',['-loglevel','error','-ss','1.0','-i',after.output_path,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:64<<20});
    const i = ((H>>1)*W + (W>>1))*3;
    ok(raw[i] > 150 && raw[i+1] < 90, `the first photograph is on screen (rgb(${raw[i]},${raw[i+1]},${raw[i+2]}))`);
  }

  const { rows: lib } = await pool.query(
    `SELECT source_id, url FROM client_assets WHERE client_id=$1 AND source='scene_render'`, [CLIENT]);
  ok(lib.length === 1, `the render is in the library once (${lib.length})`);
  ok(lib[0]?.source_id === `render-${compId}-${job.id}`, `keyed on the job id, not a timestamp (${lib[0]?.source_id})`);

  // A second render of the same composition must be a second library row,
  // not an upsert onto the first.
  const job2 = await queue.enqueue(compId);
  await runner.drain();
  const { rows: lib2 } = await pool.query(
    `SELECT source_id FROM client_assets WHERE client_id=$1 AND source='scene_render' ORDER BY source_id`, [CLIENT]);
  ok(lib2.length === 2, `a re-render adds a row rather than overwriting (${lib2.length})`);
  ok((await queue.get(job.id)).status === 'done' && (await queue.get(job2.id)).status === 'done',
     'and both attempts are readable by their own ids');

  // cleanup
  await pool.query('DELETE FROM compositions WHERE client_id = $1', [CLIENT]);
  await pool.query('DELETE FROM client_assets WHERE client_id = $1', [CLIENT]);
  fs.rmSync(dir, { recursive: true, force: true });

  console.log(fails ? `\n${fails} FAILING` : '\nend to end: a template renders through the queue');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('threw:', e.message); console.error(e.stack); process.exit(1); });
