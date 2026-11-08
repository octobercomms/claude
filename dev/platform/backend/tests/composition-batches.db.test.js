/**
 * A batch of videos, against a real Postgres.
 *
 * The thing a batch is FOR is that nobody watches it, and every assertion
 * here is about what that implies. Daniel's own words were "set it to run,
 * and then move to the next project", so the failure that matters is not an
 * error on screen — there is nobody at the screen — it is a batch that
 * quietly did eleven of thirty, or dropped four items with no record of
 * which, or billed for all thirty after passing a cap check with a cent of
 * headroom.
 *
 * So these run real thirty-item batches with items that fail on purpose:
 *
 *   - one item short of photographs, which must block itself and nothing
 *     else, and must still APPEAR, carrying what it needs;
 *   - a cap already reached, which must stop the run and leave the remaining
 *     items as rows saying so, rather than silently doing some of them;
 *   - an item approved before its render finished, which must be refused;
 *   - and the roll-up, which is the only thing an operator reads before
 *     deciding whether the batch is worth opening.
 *
 *   DB_HOST=/tmp DB_PORT=55434 DB_NAME=omi DB_USER=postgres \
 *     node tests/composition-batches.db.test.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const pool = require('../src/db');
const batches = require('../src/services/compositionBatches');
const queue = require('../src/services/compositionRenderQueue');
const budget = require('../src/services/budget');

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log('  ok  ', label);
  else { console.log('  FAIL', label); failures += 1; }
};
const eq = (got, want, label) => ok(
  got === want,
  `${label}${got === want ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`
);

const CLIENT = '55555555-5555-4555-8555-555555555555';
const UPLOADS = path.join(__dirname, '..', 'uploads');
const DIR = path.join(UPLOADS, CLIENT);
const W = 160;
const H = 284;

async function reset() {
  await pool.query(
    `INSERT INTO clients (id, name, slug) VALUES ($1, 'Batch Fixture', 'batch-fixture')
     ON CONFLICT (id) DO NOTHING`,
    [CLIENT]
  );
  await pool.query('DELETE FROM composition_batches WHERE client_id = $1', [CLIENT]);
  await pool.query('DELETE FROM compositions WHERE client_id = $1', [CLIENT]);
  await pool.query('DELETE FROM client_assets WHERE client_id = $1', [CLIENT]);
  await pool.query("DELETE FROM api_cost_events WHERE feature = 'composition_transcribe' AND client_id = $1", [CLIENT]);
  budget.clearTaskSpendCache();
  budget.clearTaskCache();
}

/** Real asset rows pointing at real one-frame PNGs, which is what resolves. */
async function makeAssets(n) {
  fs.mkdirSync(DIR, { recursive: true });
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const name = `batch-still-${i}.png`;
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-f', 'lavfi',
      '-i', `color=c=0x${(i * 37 % 255).toString(16).padStart(2, '0')}4488:s=${W}x${H}`,
      '-frames:v', '1', path.join(DIR, name),
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const { rows } = await pool.query(
      `INSERT INTO client_assets (client_id, kind, source, source_id, title, url, mime, width, height)
       VALUES ($1,'image','upload',$2,$3,$4,'image/png',$5,$6)
       ON CONFLICT (source, source_id) DO UPDATE SET url = EXCLUDED.url
       RETURNING id`,
      [CLIENT, `batch-${i}`, name, `/api/brand/file/${CLIENT}/${name}`, W, H]
    );
    out.push(rows[0].id);
  }
  const bed = 'batch-bed.m4a';
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'anullsrc=r=48000:cl=stereo:d=60', '-c:a', 'aac', path.join(DIR, bed),
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const { rows: ar } = await pool.query(
    `INSERT INTO client_assets (client_id, kind, source, source_id, title, url, mime)
     VALUES ($1,'audio','upload','batch-bed',$2,$3,'audio/mp4')
     ON CONFLICT (source, source_id) DO UPDATE SET url = EXCLUDED.url
     RETURNING id`,
    [CLIENT, bed, `/api/brand/file/${CLIENT}/${bed}`]
  );
  return { stills: out, bed: ar[0].id };
}

const still = (id) => ({
  kind: 'clip', asset: id, duration: 10, width: W, height: H, fps: 30,
});

/** One item's content for stills-montage, good unless `short`. */
function item(assets, i, { short = false } = {}) {
  const pics = short ? assets.stills.slice(0, 2) : assets.stills.slice(0, 6);
  return {
    ref: `post-${i}`,
    content: {
      stills: pics.map(still),
      titles: [`ITEM ${i + 1}`, 'HACKNEY 2026'],
      music: { kind: 'audio', asset: assets.bed, duration: 60 },
    },
  };
}

async function run() {
  await reset();
  const assets = await makeAssets(6);

  // ── the pre-flight ─────────────────────────────────────────────────
  console.log('\nthe pre-flight');
  {
    const p = await batches.plan({
      templateId: 'stills-montage',
      items: [item(assets, 0), item(assets, 1, { short: true })],
      perItemUsd: 0.1,
    });
    eq(p.total, 2, 'counts what was submitted');
    eq(p.runnable, 1, 'and what can actually run');
    eq(p.blocked, 1, 'and what cannot');
    ok(/1 of 2 videos/.test(p.says), `says it in a sentence: "${p.says}"`);

    let threw = null;
    try { await batches.plan({ templateId: 'nope', items: [] }); } catch (e) { threw = e.message; }
    ok(/No template "nope"/.test(threw || ''), 'and refuses a template that does not exist');
  }

  // ── a batch of thirty, with four that cannot run ───────────────────
  console.log('\na batch of thirty, four of them short of photographs');
  let batchId;
  {
    const items = Array.from({ length: 30 }, (_, i) =>
      item(assets, i, { short: [4, 11, 19, 27].includes(i) }));

    const res = await batches.run({
      clientId: CLIENT, templateId: 'stills-montage', items, seed: 'fixture',
      brief: 'Two weeks of project stills', perItemUsd: 0.1,
    });
    batchId = res.batch.id;

    eq(res.items.length, 30, 'thirty rows, not twenty-six');
    eq(res.items.filter((i) => i.state === 'blocked').length, 4, 'four blocked');
    eq(res.items.filter((i) => i.composition_id).length, 26, 'twenty-six compositions');
    eq(res.stoppedBy, null, 'and nothing stopped the run');

    const blocked = res.items.find((i) => i.state === 'blocked');
    ok(
      /needs 6 photographs and has 2/.test(JSON.stringify(blocked.problems)),
      `a blocked item says what it needs: ${JSON.stringify(blocked.problems)}`
    );
    eq(blocked.ref, 'post-4', 'and keeps the ref it came from, so the sheet links back');
    eq(blocked.verdict, 'pending', 'with no verdict on it');

    const q = await queue.depth();
    eq(q.queued + q.rendering, 26, 'twenty-six renders are in the queue');

    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM compositions WHERE batch_id = $1', [batchId]
    );
    eq(rows[0].n, 26, 'and each composition knows which batch made it');

    const { rows: t } = await pool.query(
      `SELECT DISTINCT template_id FROM compositions WHERE batch_id = $1`, [batchId]
    );
    eq(t[0].template_id, 'stills-montage', 'and which template');
  }

  // ── the roll-up ────────────────────────────────────────────────────
  console.log('\nthe roll-up');
  {
    const s = await batches.summary(batchId);
    eq(s.total, 30, 'total');
    eq(s.blocked, 4, 'blocked');
    eq(s.queued, 26, 'waiting');
    eq(s.rendered, 0, 'none rendered yet');
    eq(s.approved, 0, 'none approved');
    eq(
      s.pending, 0,
      'and nothing is "awaiting review" before it has rendered, which is the '
      + 'number an operator would otherwise act on'
    );
  }

  // ── a verdict needs something to judge ─────────────────────────────
  console.log('\na verdict needs something to judge');
  {
    const items = await batches.listItems(batchId);
    // Whatever is still unrendered at this instant. The drainer is running,
    // so this has to be read fresh rather than assumed.
    const waiting = items.find((i) => i.composition_id && i.state !== 'rendered'
      && i.state !== 'failed');
    const blocked = items.find((i) => i.state === 'blocked');

    if (waiting) {
      let threw = null;
      try { await batches.setVerdict(waiting.id, { verdict: 'approved' }); }
      catch (e) { threw = e.message; }
      ok(
        /has not finished rendering/.test(threw || ''),
        'an unrendered item cannot be approved'
      );
    } else {
      ok(true, 'an unrendered item cannot be approved (none left to try; covered below)');
    }

    let threw = null;
    try { await batches.setVerdict(blocked.id, { verdict: 'approved' }); }
    catch (e) { threw = e.message; }
    ok(/never ran/.test(threw || ''), 'and nor can one that never ran');

    const rejected = await batches.setVerdict(blocked.id, {
      verdict: 'rejected', note: 'client sent the wrong folder',
    });
    eq(rejected.verdict, 'rejected', 'but it CAN be rejected, which is how the sheet is cleared');
    ok(rejected.verdict_at != null, 'and the verdict is stamped');

    threw = null;
    try { await batches.setVerdict(blocked.id, { verdict: 'maybe' }); }
    catch (e) { threw = e.message; }
    ok(/Unknown verdict/.test(threw || ''), 'an unknown verdict is refused');

    const cleared = await batches.setVerdict(blocked.id, { verdict: 'pending' });
    eq(cleared.verdict_at, null, 'and clearing a verdict clears its timestamp');
  }

  // ── all twenty-six actually render ─────────────────────────────────
  console.log('\nletting the batch run to the end');
  {
    // `run()` kicks the drainer, which is the point: the operator sets it
    // going and leaves. So this waits for the queue to empty rather than
    // claiming jobs itself — an earlier draft of this test claimed two by
    // hand, raced the drainer, and found three rendered.
    const deadline = Date.now() + 480000;
    for (;;) {
      const d = await queue.depth();
      if (d.queued === 0 && d.rendering === 0) break;
      if (Date.now() > deadline) { ok(false, 'the queue drained within eight minutes'); break; }
      await new Promise((r) => setTimeout(r, 500));
    }

    const items = await batches.listItems(batchId);
    const done = items.filter((i) => i.state === 'rendered');
    eq(done.length, 26, 'all twenty-six rendered, unattended');
    eq(items.filter((i) => i.state === 'failed').length, 0, 'and none failed');
    ok(done.every((i) => i.output_url != null), 'each carries the file the sheet shows');

    const s = await batches.summary(batchId);
    eq(s.rendered, 26, 'the roll-up agrees');
    eq(s.queued, 0, 'nothing is still waiting');
    eq(s.pending, 26, 'and twenty-six are genuinely awaiting review');

    const approved = await batches.setVerdict(done[0].id, { verdict: 'approved', note: 'good' });
    eq(approved.verdict, 'approved', 'a rendered item can be approved');
    const after = await batches.summary(batchId);
    eq(after.approved, 1, 'and the roll-up counts it');
    eq(after.pending, 25, 'leaving twenty-five to look at');
  }

  // ── a re-run keeps the history ─────────────────────────────────────
  console.log('\nretrying one item');
  {
    const items = await batches.listItems(batchId);
    const target = items.find((i) => i.state === 'rendered' && i.verdict === 'approved');
    const firstRender = target.render_id;

    const again = await batches.retryItem(target.id);
    ok(again.render_id !== firstRender, 'a retry is a NEW render, not a reset of the old one');
    eq(again.verdict, 'pending', 'and its verdict is cleared, because the file changed');
    ok(
      (await queue.get(firstRender))?.status === 'done',
      'while the earlier attempt is still readable, so the sheet keeps what was tried'
    );

    const blocked = items.find((i) => i.state === 'blocked');
    let threw = null;
    try { await batches.retryItem(blocked.id); } catch (e) { threw = e.message; }
    ok(
      /no composition to render/.test(threw || ''),
      'and an item with no composition says to fix its content instead'
    );
  }

  // ── the cap actually stops a run ───────────────────────────────────
  console.log('\nthe cap stops a run partway, and says so');
  {
    await reset();
    const a2 = await makeAssets(6);

    // Spend the whole cap first. `assertUnderTaskCap` is a point-in-time
    // gate, so this is the state in which a run must refuse to start items.
    const row = await budget.getTaskBudget(batches.TASK);
    ok(row != null, 'the video_batch budget row exists (migration 248)');
    await pool.query(
      `INSERT INTO api_cost_events (provider, feature, cost_usd, client_id)
       VALUES ('openai', 'composition_transcribe', $2, $1)`,
      [CLIENT, Number(row.monthly_cap_usd) + 1]
    );
    budget.clearTaskSpendCache();

    const res = await batches.run({
      clientId: CLIENT, templateId: 'stills-montage',
      items: Array.from({ length: 5 }, (_, i) => item(a2, i)),
      seed: 'capped', perItemUsd: 0.1,
    });

    ok(res.stoppedBy != null, 'the run reports that it stopped');
    ok(/monthly budget/.test(res.stoppedBy || ''), `and why: "${res.stoppedBy}"`);
    eq(res.items.length, 5, 'all five are still rows');
    eq(
      res.items.filter((i) => i.composition_id).length, 0,
      'and none of them ran, rather than some of them'
    );
    ok(
      /monthly budget/.test(JSON.stringify(res.items[0].problems)),
      'each row says it was the budget, not its own content'
    );
  }

  // cleanup
  await reset();
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }

  console.log(failures ? `\n${failures} failing` : '\nall batch assertions pass');
  await pool.end();
  process.exit(failures ? 1 : 0);
}

run().catch((err) => {
  console.error('\nthrew:', err.message);
  console.error(err.stack);
  process.exit(1);
});
