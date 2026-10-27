/**
 * The outcomes loop end to end, against a real database.
 *
 * Not in CI: the runner has no Postgres, and a test that SKIPs is a test that
 * is not running. Run it locally per docs/omi/agent-guide.md §3:
 *
 *   DB_HOST=localhost DB_NAME=omi DB_USER=omi DB_PASSWORD=omi \
 *     node tests/reel-outcomes.db.test.js
 *
 * What only a database can prove: that the upsert gives one reel one vote,
 * that a judgement survives with no asset row behind it, that one client's
 * reels never reach another client's medians, and that the join through
 * social_post_engagement and socialBaseline produces the arms it should.
 */
const assert = require('assert');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret_testsecret_testsecret_1234';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64);

const pool = require('../src/db');
const reel = require('../src/services/reelOutcomes');

let pass = 0; const fails = [];
async function ok(label, fn) {
  try { await fn(); pass += 1; console.log(`  ok   ${label}`); }
  catch (e) { fails.push([label, e.message]); console.log(`  FAIL ${label}\n       ${e.message}`); }
}

const tag = `t${Date.now().toString(36)}`;

/** A reel's worth of word timings, at a chosen rate, opening on a fact. */
const words = (n, wps = 3, startAt = 0.4) => Array.from({ length: n }, (_, i) => ({
  word: ['Two', 'hundred', 'years'][i] || `w${i}`,
  start: startAt + i / wps, end: startAt + (i + 0.8) / wps,
}));

async function client(name) {
  const { rows } = await pool.query(
    'INSERT INTO clients (name, slug) VALUES ($1,$2) RETURNING id',
    [`${name} ${tag}`, `${name.toLowerCase()}-${tag}`]);
  return rows[0].id;
}

async function publishedReel(clientId, batchId, { reach }) {
  const { rows } = await pool.query(
    `INSERT INTO social_posts (batch_id, client_id, platform, kind, hook, caption, published_at)
     VALUES ($1,$2,'instagram','reel','Two hundred years','x', NOW()) RETURNING id`,
    [batchId, clientId]);
  const id = rows[0].id;
  await pool.query(
    `INSERT INTO social_post_engagement (post_id, reach, impressions, likes, comments)
     VALUES ($1,$2,$2,10,2)`, [id, reach]);
  return id;
}

(async () => {
  // Two clients, never one. A missing client filter answers correctly against a
  // single client by luck; it cannot against two.
  const a = await client('Alpha');
  const b = await client('Beta');
  const batches = {};
  for (const [k, id] of Object.entries({ a, b })) {
    const { rows } = await pool.query(
      "INSERT INTO social_batches (client_id, brief) VALUES ($1,'fixture') RETURNING id", [id]);
    batches[k] = rows[0].id;
  }

  console.log('\nOne reel, one vote');
  {
    const post = await publishedReel(a, batches.a, { reach: 1000 });
    const { rows } = await pool.query(
      `INSERT INTO client_assets (client_id, kind, source, source_id, url)
       VALUES ($1,'video','caption_render',$2,'/a.mp4') RETURNING id`, [a, `${tag}-1`]);
    const asset = rows[0].id;

    const first = await reel.record({ clientId: a, assetId: asset, postId: post,
      words: words(90), template: 'institution', durationS: 30 });
    await ok('a judgement is recorded with the rules that made it', () => {
      assert.ok(first, 'nothing came back');
      // Read off the checker rather than pinned: a number here records how
      // many checks existed the day it was written, and says nothing about
      // whether the judgement was stored whole.
      assert.strictEqual(first.total, first.checks.length);
      assert.ok(first.total >= 7, `only ${first.total} checks recorded`);
      assert.match(first.rules_fingerprint, /^[0-9a-f]{8}$/);
    });

    const second = await reel.record({ clientId: a, assetId: asset, postId: post,
      words: words(300, 10), template: 'institution', durationS: 25 });
    await ok('re-rendering the same asset replaces its judgement rather than adding one', async () => {
      const { rows: n } = await pool.query(
        'SELECT COUNT(*)::int c FROM reel_check_results WHERE asset_id = $1', [asset]);
      assert.strictEqual(n[0].c, 1);
      // Ten words a second fails "one fact, carried to a payoff", so the
      // replacement is visibly the second judgement and not the first.
      assert.ok(second.passed < first.passed, `${second.passed} !< ${first.passed}`);
    });
  }

  console.log('\nA judgement survives a library write that did not');
  {
    // assets.record never throws at its caller and returns null on failure, so
    // the production path can reach this with no asset id at all. The row must
    // still land: it is a record of what was produced.
    const row = await reel.record({ clientId: a, assetId: null, postId: null,
      words: words(60), template: null, durationS: 40 });
    await ok('a judgement with no asset and no post is still written', () =>
      assert.ok(row && row.id));
    const row2 = await reel.record({ clientId: a, assetId: null, postId: null,
      words: words(60), template: null, durationS: 40 });
    await ok('and two of them do not collide on the partial unique index', () =>
      assert.ok(row2 && row2.id !== row.id));
  }

  console.log('\nThe arms come out of the real join');
  {
    // Five reels at 30s (passing "length"), five at 8s (failing it), with reach
    // on the passing side an order of magnitude higher. Five a side is enough
    // for socialBaseline to quote a multiple at all.
    for (let i = 0; i < 5; i += 1) {
      const post = await publishedReel(b, batches.b, { reach: 5000 });
      await reel.record({ clientId: b, postId: post, words: words(90),
        template: 'institution', durationS: 30 });
    }
    for (let i = 0; i < 5; i += 1) {
      const post = await publishedReel(b, batches.b, { reach: 500 });
      await reel.record({ clientId: b, postId: post, words: words(24),
        template: 'institution', durationS: 8 });
    }

    const out = await reel.learn(b);
    const length = out.checks.find((c) => c.key === 'length');
    await ok('ten judged reels join ten published posts', () => {
      assert.strictEqual(out.judged, 10);
      assert.strictEqual(out.reels, 10);
      assert.strictEqual(out.excluded.awaiting_numbers, 0);
    });
    await ok('the length check splits five against five', () => {
      assert.strictEqual(length.n_pass, 5);
      assert.strictEqual(length.n_fail, 5);
    });
    await ok('and the longer reels show the higher median multiple', () => {
      assert.ok(length.median_pass > length.median_fail,
        `${length.median_pass} !> ${length.median_fail}`);
      // Ten reels is provisional, not a finding, and the direction is
      // reported with that label and the counts beside it rather than withheld.
      assert.strictEqual(length.strength, 'provisional');
      assert.strictEqual(length.predicts, 'better');
    });
    await ok('a check every reel passed reports no variation, not a lift', () => {
      const captions = out.checks.find((c) => c.key === 'captions');
      assert.strictEqual(captions.strength, 'no_variation');
      assert.strictEqual(captions.lift, null);
    });
  }

  console.log('\nOne client’s reels never reach another’s medians');
  {
    const out = await reel.learn(a);
    await ok('Alpha sees only its own judgements', () => {
      // Three recorded against Alpha: one upserted asset, two assetless.
      assert.strictEqual(out.judged, 3);
    });
    await ok('the two with no post are awaiting numbers, not failing', () => {
      assert.strictEqual(out.excluded.awaiting_numbers, 2);
    });
    await ok('and its one published post is held back for want of a baseline', () => {
      // socialBaseline refuses a multiple under five comparable posts, so a
      // client with a single post gets no arms at all. This is the behaviour
      // that stops the first reel of an account becoming its own evidence.
      assert.strictEqual(out.excluded.no_baseline, 1);
      assert.strictEqual(out.reels, 0);
      assert.deepStrictEqual(out.checks, []);
    });
    const outB = await reel.learn(b);
    await ok('Beta’s count is untouched by Alpha’s reels', () =>
      assert.strictEqual(outB.judged, 10));
  }

  console.log('\nThe window is honoured');
  {
    await pool.query(
      `UPDATE reel_check_results SET created_at = NOW() - INTERVAL '400 days'
        WHERE client_id = $1`, [b]);
    const out = await reel.learn(b, { days: 365 });
    await ok('judgements older than the window are not counted', () =>
      assert.strictEqual(out.judged, 0));
    const wide = await reel.learn(b, { days: 500 });
    await ok('and a wider window finds them again', () =>
      assert.strictEqual(wide.judged, 10));
  }

  // Leave the database as it was found.
  await pool.query('DELETE FROM clients WHERE id = ANY($1)', [[a, b]]);
  console.log(fails.length ? `\n${fails.length} failed, ${pass} passed` : '\nall passed');
  await pool.end();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('THREW:', e.message); process.exit(1); });
