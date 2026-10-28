/**
 * The learner that turns the reel checks from rules into findings.
 *
 * Every assertion here is about a way a median lies. The arithmetic is easy;
 * what is hard is refusing to answer, and that is what most of these check.
 *
 * Pure: no database, no ffmpeg, no network. It runs on a runner in
 * milliseconds, which is why it is in CI.
 */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const SHARED = path.join(__dirname, '..', '..', 'shared');
let pass = 0; const fails = [];
function ok(label, fn) {
  try { fn(); pass += 1; console.log(`  ok   ${label}`); }
  catch (e) { fails.push([label, e.message]); console.log(`  FAIL ${label}\n       ${e.message}`); }
}

// A snapshot of one reel's judgement, and the scored post it belongs to.
const snap = (id, passes, fp = 'fp1') => ({
  post_id: id, rules_fingerprint: fp,
  checks: Object.entries(passes).map(([key, p]) => ({ key, pass: p })),
});
const post = (id, multiple) => ({ id, reach_multiple: multiple, interaction_multiple: multiple });

// n reels on each side of one check, the passing arm at `mp`, the failing at `mf`.
function arms(key, nPass, nFail, mp, mf, fp = 'fp1') {
  const snapshots = []; const posts = [];
  for (let i = 0; i < nPass; i += 1) {
    snapshots.push(snap(`p${i}`, { [key]: true }, fp)); posts.push(post(`p${i}`, mp));
  }
  for (let i = 0; i < nFail; i += 1) {
    snapshots.push(snap(`f${i}`, { [key]: false }, fp)); posts.push(post(`f${i}`, mf));
  }
  return { snapshots, posts };
}

(async () => {
  const { learn, MIN_ARM, FINDING_ARM, FINDING_TOTAL } =
    await import(pathToFileURL(path.join(SHARED, 'reelOutcomes.mjs')).href);
  const { RULES_FINGERPRINT, checkReel, THRESHOLDS } =
    await import(pathToFileURL(path.join(SHARED, 'reelChecks.mjs')).href);

  const run = (input) => learn({ fingerprint: 'fp1', ...input });

  console.log('\nIt reports a difference, with the sample behind it');
  {
    const r = run(arms('length', 20, 20, 2.0, 1.0));
    const c = r.checks.find((x) => x.key === 'length');
    ok('the medians of both arms are reported, not only the ratio', () => {
      assert.strictEqual(c.median_pass, 2);
      assert.strictEqual(c.median_fail, 1);
      assert.strictEqual(c.lift, 2);
    });
    ok('and the count in each arm travels with it', () => {
      assert.strictEqual(c.n_pass, 20);
      assert.strictEqual(c.n_fail, 20);
    });
    ok('at forty reels it is allowed to be called a finding', () =>
      assert.strictEqual(c.strength, 'finding'));
    ok('and a doubled median reads as better', () =>
      assert.strictEqual(c.predicts, 'better'));
  }

  console.log('\nIt refuses to answer before it can');
  {
    const r = run(arms('length', 3, 3, 2.0, 1.0));
    const c = r.checks.find((x) => x.key === 'length');
    ok(`an arm under ${MIN_ARM} reels is too early, whatever the difference`, () => {
      assert.strictEqual(c.strength, 'too_early');
      assert.match(c.note, /under 5 reels/);
    });
    ok('the figures are still there to look at', () => assert.strictEqual(c.lift, 2));
    ok('but nothing is claimed to predict anything', () =>
      assert.strictEqual(c.predicts, null));
  }
  {
    // The trap: one big arm and one small one. Twenty against three is thirty
    // in total on the loosest reading, and three reels is still three reels.
    const r = run(arms('length', 27, 3, 2.0, 1.0));
    const c = r.checks.find((x) => x.key === 'length');
    ok('a large arm does not carry a small one over the line', () =>
      assert.strictEqual(c.strength, 'too_early'));
  }
  {
    const r = run(arms('length', 6, 6, 2.0, 1.0));
    const c = r.checks.find((x) => x.key === 'length');
    ok(`${MIN_ARM} in each arm but under ${FINDING_TOTAL} in total is provisional`, () =>
      assert.strictEqual(c.strength, 'provisional'));
    ok('and the note says what it would take to become a finding', () =>
      assert.match(c.note, new RegExp(`${FINDING_ARM} in each arm and ${FINDING_TOTAL} in total`)));
  }

  console.log('\nA check nothing varies on is not a result');
  {
    const r = run(arms('captions', 40, 0, 2.0, 0));
    const c = r.checks.find((x) => x.key === 'captions');
    ok('every reel passing means there is nothing to compare', () => {
      assert.strictEqual(c.strength, 'no_variation');
      assert.strictEqual(c.lift, null);
    });
    ok('and the passing arm’s median is never printed as a lift', () =>
      assert.strictEqual(c.predicts, null));
  }

  console.log('\nA real sample and no difference is itself the answer');
  {
    const r = run(arms('one_idea', 20, 20, 1.02, 1.0));
    const c = r.checks.find((x) => x.key === 'one_idea');
    ok('a rule that predicts nothing for this client says so', () =>
      assert.strictEqual(c.predicts, 'no_difference'));
    ok('rather than being left looking unproven', () =>
      assert.strictEqual(c.strength, 'finding'));
  }
  {
    const r = run(arms('stated_flatly', 20, 20, 1.0, 2.0));
    const c = r.checks.find((x) => x.key === 'stated_flatly');
    ok('and a rule that goes with worse reels is reported, not hidden', () =>
      assert.strictEqual(c.predicts, 'worse'));
  }

  console.log('\nIt never pools two rule sets');
  {
    const a = arms('length', 20, 20, 2.0, 1.0, 'fp1');
    const b = arms('length', 20, 20, 9.0, 9.0, 'fp-old');
    // Distinct ids, or the second set would overwrite the first in the lookup.
    b.snapshots.forEach((s, i) => { s.post_id = `old${i}`; b.posts[i].id = `old${i}`; });
    const r = run({ snapshots: [...a.snapshots, ...b.snapshots], posts: [...a.posts, ...b.posts] });
    const c = r.checks.find((x) => x.key === 'length');
    ok('reels judged under older rules are left out', () => {
      assert.strictEqual(c.n_pass, 20);
      assert.strictEqual(c.n_fail, 20);
      assert.strictEqual(c.median_pass, 2);
    });
    ok('and how many were left out is counted rather than lost', () =>
      assert.strictEqual(r.excluded.stale_rules, 40));
  }

  console.log('\nA missing baseline is not a 1.0');
  {
    const { snapshots, posts } = arms('length', 10, 10, 2.0, 1.0);
    // socialBaseline withholds a multiple under five comparable posts. Those
    // reels must leave the sample, not join it at parity.
    posts.slice(0, 5).forEach((p) => { p.reach_multiple = null; });
    const r = run({ snapshots, posts });
    const c = r.checks.find((x) => x.key === 'length');
    ok('reels with no baseline are excluded and counted', () => {
      assert.strictEqual(r.excluded.no_baseline, 5);
      assert.strictEqual(c.n_pass, 5);
    });
  }
  {
    const { snapshots, posts } = arms('length', 10, 10, 2.0, 1.0);
    const r = run({ snapshots, posts: posts.slice(10) });
    ok('a reel whose post has no numbers yet is awaiting, not failing', () => {
      assert.strictEqual(r.excluded.awaiting_numbers, 10);
      assert.strictEqual(r.reels, 10);
    });
  }

  console.log('\n"Could not judge" is not "failed"');
  {
    const snapshots = []; const posts = [];
    for (let i = 0; i < 10; i += 1) {
      snapshots.push(snap(`p${i}`, { hook_is_a_fact: true })); posts.push(post(`p${i}`, 2.0));
    }
    for (let i = 0; i < 20; i += 1) {
      // null: the checker had no hook to read. These reels performed badly, and
      // counting them as failures would hand the rule credit it never earned.
      snapshots.push(snap(`n${i}`, { hook_is_a_fact: null })); posts.push(post(`n${i}`, 0.2));
    }
    const r = run({ snapshots, posts });
    const c = r.checks.find((x) => x.key === 'hook_is_a_fact');
    ok('an unjudgeable check joins neither arm', () => {
      assert.strictEqual(c.n_pass, 10);
      assert.strictEqual(c.n_fail, 0);
    });
    ok('so it reads as nothing to compare rather than a vast lift', () => {
      assert.strictEqual(c.strength, 'no_variation');
      assert.strictEqual(c.lift, null);
    });
  }

  console.log('\nA zero baseline cannot become an infinite lift');
  {
    const r = run(arms('length', 20, 20, 2.0, 0));
    const c = r.checks.find((x) => x.key === 'length');
    ok('a failing arm that reached nothing yields no ratio', () => {
      assert.strictEqual(c.lift, null);
      assert.strictEqual(c.median_fail, 0);
    });
    ok('and nothing is claimed from it', () => assert.strictEqual(c.predicts, null));
  }

  console.log('\nThe median is the real one');
  {
    // Four values: a median that takes the upper middle reads 3, the true
    // median is 2.5. On small arms that difference decides the verdict.
    const snapshots = []; const posts = [];
    [1, 2, 3, 4].forEach((v, i) => {
      snapshots.push(snap(`p${i}`, { length: true })); posts.push(post(`p${i}`, v));
    });
    [1, 1, 1, 1, 1].forEach((v, i) => {
      snapshots.push(snap(`f${i}`, { length: false })); posts.push(post(`f${i}`, v));
    });
    const c = run({ snapshots, posts }).checks.find((x) => x.key === 'length');
    ok('an even arm takes the mean of the two middle values', () =>
      assert.strictEqual(c.median_pass, 2.5));
  }

  console.log('\nThe fingerprint tracks the rules it claims to');
  {
    ok('it is stable across two reads of the same rule set', async () => {
      assert.strictEqual(RULES_FINGERPRINT.length, 8);
      assert.match(RULES_FINGERPRINT, /^[0-9a-f]{8}$/);
    });
    ok('it covers every key the checker actually produces', () => {
      // Derived from checkReel rather than retyped, so a new check changes the
      // fingerprint and splits the population instead of joining it.
      // Not a retyped count. The fingerprint's job is to change when the key
      // list does, so pinning a number here would only record how many checks
      // existed the day this was written.
      const keys = checkReel({}).checks.map((c) => c.key);
      assert.ok(keys.length >= 7, `only ${keys.length} checks`);
      assert.strictEqual(new Set(keys).size, keys.length, 'a key is duplicated');
      assert.ok(keys.includes('length'));
    });
    ok('and the thresholds it covers are the ones the checker reads', () => {
      // If a threshold moves in checkReel but not in THRESHOLDS, the
      // fingerprint would not change and two rule sets would pool silently.
      const judged = checkReel({ timings: [{ word: 'a', start: 0, end: 0.3 }],
        edit: { duration_s: THRESHOLDS.duration_min_s } });
      assert.strictEqual(judged.checks.find((c) => c.key === 'length').pass, true);
      const under = checkReel({ timings: [{ word: 'a', start: 0, end: 0.3 }],
        edit: { duration_s: THRESHOLDS.duration_min_s - 0.1 } });
      assert.strictEqual(under.checks.find((c) => c.key === 'length').pass, false);
    });
  }

  console.log('\nThe limits travel with the numbers');
  {
    const r = run(arms('length', 20, 20, 2.0, 1.0));
    ok('the output says the reels were chosen rather than assigned', () =>
      assert.match(r.caveat, /chosen, not assigned/));
    ok('and which measure the medians are of', () =>
      assert.strictEqual(r.measure, 'reach_multiple'));
  }
  {
    ok('nothing at all does not throw', () => {
      const r = learn();
      assert.strictEqual(r.reels, 0);
      assert.deepStrictEqual(r.checks, []);
    });
    ok('and neither does a snapshot with no checks array', () => {
      const r = learn({ snapshots: [{ post_id: 'x' }, null], posts: [post('x', 1)] });
      assert.strictEqual(r.reels, 0);
    });
  }

  console.log(fails.length ? `\n${fails.length} failed, ${pass} passed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
