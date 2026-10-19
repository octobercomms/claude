// Baseline-relative scoring for a client's own published posts.
//
// What this replaces. getRecentWinners ranked by an engagement-rate proxy,
// interactions / reach. That rewards the smallest posts: 3 likes on 10 reach
// scores 30% and tops the list, while a reel that reached 40,000 and took 900
// interactions scores 2.3% and sits at the bottom. It also carried a "heater"
// flag set at 2x the median reach, pooled across every platform and format, so
// a LinkedIn text post and an Instagram reel were held to one bar. On most
// accounts reels out-reach everything, which makes every reel a heater and
// nothing else ever one.
//
// What it does instead. A post is scored against the median of the client's
// OTHER posts of the same platform and format, and the answer is a multiple:
// 3.4x its own baseline. That is the only comparison that survives an account
// with 800 followers sitting next to one with 80,000, and it is what makes a
// winner readable to the client, who knows their own numbers and nobody
// else's.
//
// Three rules keep the multiple honest:
//
//   - Leave-one-out. A post is never part of the baseline it is measured
//     against, or a single viral post raises its own bar and reads as average.
//   - A minimum sample, then a stated fallback. Under five comparable posts a
//     cohort median is one or two numbers wearing a statistic's clothes, so the
//     scope drops to the whole account and says so, and under five there
//     either, there is no multiple at all. `baseline_scope` carries which of
//     the three happened, so a pooled number is never shown as like-for-like.
//   - A reach floor under the engagement rate. Below 100 reach the denominator
//     is too small for the ratio to carry meaning, so the rate is withheld
//     rather than printed as a number someone might quote in a report.

// Posts needed in a cohort (including the one being scored) before its median
// is worth quoting. Four others is thin; it is also the point past which one
// outlier stops deciding the answer.
const MIN_COMPARABLE = 5;

// Reach below which interactions / reach is noise rather than a rate.
const MIN_REACH_FOR_RATE = 100;

// A post at or above this multiple of its own baseline. Kept at 2x, which is
// what the old pooled heater used, so the word means roughly what it did.
const HEATER_MULTIPLE = 2;

// True median: the mean of the two middle values on an even count. The old
// code took the upper middle, which on a two-post account made the better post
// its own baseline and scored it 1.0x.
function median(values) {
  const sorted = values.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// A reel is not a carousel and Instagram is not LinkedIn. Posts are only
// compared inside one of these.
const cohortKey = (post) => `${post.platform || '?'}|${post.kind || '?'}`;

const round1 = (n) => Math.round(n * 10) / 10;

// Reach as the platform happened to report it. Instagram gives reach,
// LinkedIn member posts give impressions, TikTok gives views; they are
// different measures of the same idea and only ever compared within a cohort,
// which is one more reason the cohort matters.
const reachOf = (p) => p.reach || p.impressions || p.views || 0;
const interactionsOf = (p) =>
  (p.likes || 0) + (p.comments || 0) + (p.shares || 0) + (p.saves || 0);

// Median of everyone except `self`, given the whole pool.
function leaveOneOut(pool, self, value) {
  const others = pool.filter((p) => p !== self).map(value);
  return { n: others.length, median: median(others) };
}

// Score every post against the others around it.
//
// Each returned post keeps its original fields and gains:
//   reach_like            the reach figure used
//   interactions          likes + comments + shares + saves
//   engagement_rate       interactions / reach as a percentage, or null under the floor
//   cohort                "platform|kind"
//   baseline_scope        'cohort' | 'account' | 'none'
//   baseline_n            how many other posts the baseline was drawn from
//   reach_baseline        the median it was measured against
//   reach_multiple        reach / baseline, or null when there is no baseline
//   interaction_multiple  the same for interactions, which separates "many saw
//                         it" from "those who saw it acted"
//   is_heater             reach_multiple >= 2, and only when a multiple exists
//   baseline_note         one line saying what is missing, when something is
//   rank_score            what to sort on; see below
function score(posts) {
  const pool = (posts || []).map((p) => ({
    ...p,
    reach_like: reachOf(p),
    interactions: interactionsOf(p),
  }));

  // Cohorts are built once, by key, off the same object identities the
  // leave-one-out filter compares against.
  const cohorts = new Map();
  for (const p of pool) {
    const k = cohortKey(p);
    if (!cohorts.has(k)) cohorts.set(k, []);
    cohorts.get(k).push(p);
  }

  const accountMedianReach = median(pool.map((p) => p.reach_like));

  return pool.map((p) => {
    const cohort = cohorts.get(cohortKey(p));
    const enoughInCohort = cohort.length >= MIN_COMPARABLE;
    const enoughInAccount = pool.length >= MIN_COMPARABLE;
    const basis = enoughInCohort ? cohort : pool;

    const reach = leaveOneOut(basis, p, (q) => q.reach_like);
    const acts = leaveOneOut(basis, p, (q) => q.interactions);

    let scope = 'none';
    if (enoughInCohort) scope = 'cohort';
    else if (enoughInAccount) scope = 'account';

    const haveBaseline = scope !== 'none' && reach.median > 0;
    const reachMultiple = haveBaseline ? round1(p.reach_like / reach.median) : null;
    const actMultiple = scope !== 'none' && acts.median > 0
      ? round1(p.interactions / acts.median)
      : null;

    const rate = p.reach_like >= MIN_REACH_FOR_RATE
      ? round1((p.interactions / p.reach_like) * 100)
      : null;

    let note = null;
    if (scope === 'none') {
      note = `Needs ${MIN_COMPARABLE - pool.length} more published post${MIN_COMPARABLE - pool.length === 1 ? '' : 's'} before a baseline means anything.`;
    } else if (scope === 'account') {
      note = `Measured against the whole account, not ${p.platform || 'this platform'} ${p.kind || 'posts'} alone: only ${cohort.length} of those published so far.`;
    } else if (!haveBaseline) {
      note = 'Comparable posts have no reach recorded yet.';
    }
    if (rate === null) {
      const reachNote = `Engagement rate withheld under ${MIN_REACH_FOR_RATE} reach — the denominator is too small to read.`;
      note = note ? `${note} ${reachNote}` : reachNote;
    }

    return {
      ...p,
      engagement_rate: rate,
      cohort: cohortKey(p),
      baseline_scope: scope,
      baseline_n: reach.n,
      reach_baseline: haveBaseline ? Math.round(reach.median) : null,
      reach_multiple: reachMultiple,
      interaction_multiple: actMultiple,
      is_heater: reachMultiple !== null && reachMultiple >= HEATER_MULTIPLE,
      baseline_note: note,
      // Sorting. A measured post sorts on its multiple. An unmeasured one
      // sorts on its reach against the account median, which puts it in
      // roughly the right place without claiming a figure the data cannot
      // support. With no account median either, everything is 0 and the
      // caller's tie-break decides.
      rank_score: reachMultiple !== null
        ? reachMultiple
        : (accountMedianReach > 0 ? p.reach_like / accountMedianReach : 0),
    };
  });
}

// Rank best-first. Reach multiple decides; interactions break a tie, because
// two posts that travelled equally far are separated by what the audience did
// when they got there.
function rank(posts) {
  return score(posts).sort((a, b) =>
    (b.rank_score - a.rank_score) || (b.interactions - a.interactions));
}

// One line for the UI footnote and the report, so the definition is written in
// one place rather than retyped under each panel.
function explain() {
  return `A multiple compares a post with the median of this account's other posts `
    + `of the same platform and format, excluding itself. 🔥 Heater = ${HEATER_MULTIPLE}× or better. `
    + `Under ${MIN_COMPARABLE} comparable posts the comparison widens to the whole account and says so; `
    + `under ${MIN_COMPARABLE} posts in total there is no baseline yet.`;
}

module.exports = {
  score, rank, explain, median, cohortKey,
  MIN_COMPARABLE, MIN_REACH_FOR_RATE, HEATER_MULTIPLE,
};
