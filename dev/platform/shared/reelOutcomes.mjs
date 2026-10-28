/**
 * What the reel checks are worth, measured against what the reels did.
 *
 * The checks in reelChecks.mjs are rules from October's growth plan, and the
 * panel says on screen that they are reasoned assumptions rather than
 * measurements. This is the half that turns one into the other: it takes the
 * check results recorded when a reel was produced, puts them beside how that
 * reel performed against the client's own baseline, and reports per check
 * whether passing it went with a better result.
 *
 * Pure, like the cut planner, and for the same reason: the arithmetic is where
 * this goes wrong, and a median taken over the wrong arm is invisible in a
 * screenshot.
 *
 * Three things it refuses to do, because each one would produce a number that
 * reads as knowledge and is not:
 *
 *   - Pool reels judged under different rules. Change one word in the hype list
 *     and "passed" means something it did not mean last month. Snapshots carry
 *     the fingerprint of the rule set that judged them, and only one
 *     fingerprint is ever pooled.
 *   - Compare an arm against nothing. If every reel passed a check, there is no
 *     comparison to make, and reporting the passing arm's median as a lift
 *     would credit the check for the account's ordinary performance.
 *   - Call a difference a finding before there is enough of it. Under five
 *     reels an arm is anecdote; the panel's own promise was thirty, so thirty
 *     is where the word finding is allowed.
 *
 * And one thing it cannot do, which the output states rather than hides: these
 * reels were chosen, not assigned. A check that goes with better reach may be
 * standing in for the kind of subject that gets made with it. Nothing here is
 * causal.
 */

/** An arm smaller than this is anecdote, not a median. */
export const MIN_ARM = 5;

/** Both arms at least this, and this many in total, before "finding". */
export const FINDING_ARM = 10;
export const FINDING_TOTAL = 30;

function median(values) {
  const sorted = values.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

/**
 * @param {object} input
 *   snapshots   [{ post_id, checks: [{key, pass}], rules_fingerprint }]
 *   posts       scored posts from socialBaseline.score: [{ id, reach_multiple,
 *               interaction_multiple, baseline_scope }]
 *   fingerprint the rule set in force now; snapshots judged by any other are
 *               excluded and counted
 *   measure     'reach_multiple' (default) or 'interaction_multiple'
 */
export function learn({ snapshots, posts, fingerprint, measure = 'reach_multiple' } = {}) {
  const snaps = Array.isArray(snapshots) ? snapshots : [];
  const byId = new Map();
  for (const p of (Array.isArray(posts) ? posts : [])) {
    if (p && p.id != null) byId.set(String(p.id), p);
  }

  let staleRules = 0;
  let noBaseline = 0;
  let awaiting = 0;
  const joined = [];

  for (const s of snaps) {
    if (!s || !Array.isArray(s.checks)) continue;
    // A rule change splits the population. Pooling across it would answer a
    // question nobody asked: how reels did under a mixture of two rule sets.
    if (fingerprint && s.rules_fingerprint !== fingerprint) { staleRules += 1; continue; }
    const post = s.post_id == null ? null : byId.get(String(s.post_id));
    // Either the reel's post has not gone out, or it has and no numbers have
    // come back for it yet. Both are "ask again later" rather than a result,
    // and the panel says so rather than counting them as nothing.
    if (!post) { awaiting += 1; continue; }
    // No baseline means no comparable posts yet, which is socialBaseline's own
    // refusal to quote a multiple. Treating a missing multiple as a number
    // would fill both arms with the account's unmeasured posts.
    //
    // The raw value is tested before any coercion, because Number(null) is 0
    // and Number('') is 0: a withheld baseline would pass a Number.isFinite
    // check and enter the sample as a reel that reached nothing, dragging its
    // arm's median down. Which arm it dragged would depend on which reels
    // happened to lack a baseline.
    const raw = post[measure];
    if (raw === null || raw === undefined || raw === '') { noBaseline += 1; continue; }
    const value = Number(raw);
    if (!Number.isFinite(value)) { noBaseline += 1; continue; }
    joined.push({ checks: s.checks, value });
  }

  // Every key seen in the pooled snapshots, in the order the checks run, so a
  // key retired from the rule set stops appearing on its own.
  const keys = [];
  for (const row of joined) {
    for (const c of row.checks) {
      if (c && c.key && !keys.includes(c.key)) keys.push(c.key);
    }
  }

  const checks = keys.map((key) => {
    const pass = [];
    const fail = [];
    for (const row of joined) {
      const c = row.checks.find((x) => x && x.key === key);
      // Only a decided check joins an arm. `null` is the checker saying it
      // could not judge this reel, which is not the same as failing it, and
      // putting those in the failing arm would blame the rule for silence.
      if (!c) continue;
      if (c.pass === true) pass.push(row.value);
      else if (c.pass === false) fail.push(row.value);
    }

    const mp = median(pass);
    const mf = median(fail);
    const both = Math.min(pass.length, fail.length);

    let strength = 'too_early';
    let note = null;
    if (!pass.length || !fail.length) {
      strength = 'no_variation';
      note = pass.length
        ? `Every one of these ${pass.length} reels passed this, so there is nothing to compare it against.`
        : `None of these ${fail.length} reels passed this, so there is nothing to compare it against.`;
    } else if (both < MIN_ARM) {
      note = `${pass.length} passed, ${fail.length} did not. An arm under ${MIN_ARM} reels is `
        + 'one or two reels wearing a median’s clothes.';
    } else if (both >= FINDING_ARM && pass.length + fail.length >= FINDING_TOTAL) {
      strength = 'finding';
    } else {
      strength = 'provisional';
      note = `${pass.length} passed, ${fail.length} did not. Becomes a finding at `
        + `${FINDING_ARM} in each arm and ${FINDING_TOTAL} in total.`;
    }

    // Expressed as a difference of medians, never as a lift against a zero
    // baseline: a failing arm that reached nothing makes the ratio infinite and
    // the sentence meaningless.
    const lift = strength === 'no_variation' || !Number.isFinite(mp) || !Number.isFinite(mf) || mf <= 0
      ? null
      : round2(mp / mf);

    return {
      key,
      n_pass: pass.length,
      n_fail: fail.length,
      median_pass: round2(mp),
      median_fail: round2(mf),
      lift,
      // A check with a real sample and no difference is a result, not a gap:
      // the rule does not predict anything for this client, which is worth
      // knowing before anyone optimises for it.
      predicts: (strength === 'finding' || strength === 'provisional') && lift !== null
        ? (lift >= 1.15 ? 'better' : lift <= 0.87 ? 'worse' : 'no_difference')
        : null,
      strength,
      note,
    };
  });

  return {
    checks,
    reels: joined.length,
    excluded: {
      stale_rules: staleRules,
      no_baseline: noBaseline,
      awaiting_numbers: awaiting,
    },
    measure,
    // The limit, carried with the numbers rather than written under the panel,
    // so it travels into a report that quotes this.
    caveat: 'These reels were chosen, not assigned. A check that goes with better reach '
      + 'may be standing in for the kind of subject it tends to get made with. '
      + 'Nothing here is causal.',
  };
}
