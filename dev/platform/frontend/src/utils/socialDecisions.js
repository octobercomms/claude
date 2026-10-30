// Measure, turned into decisions.
//
// Daniel on the Measure group: "this is the page im most confused about — i
// cant see how i use it in daily use." The diagnosis is not structure. It held
// four read-only dashboards, none of which ended in an action: you read "this
// post did well", navigated to Create, and started from nothing.
//
// So this derives a short list of decisions from data the page already has,
// each one a sentence you could act on and a brief you can open with it
// already written.
//
// The discipline that makes it worth reading is what it refuses to say. A
// decision is only produced where the numbers support one: a framework needs
// MIN_POSTS behind it before its average means anything, and a winning post
// needs a real baseline (socialBaseline sets baseline_scope to 'none' when
// there are too few comparable posts, and a multiple computed off two posts is
// noise wearing a number). Nothing here invents a recommendation to fill the
// screen — an empty list says what is missing instead.

// A framework's average is read off this many posts or it is not read at all.
export const MIN_POSTS = 3;
// How far from the account average a framework has to sit before it is worth
// changing what you do. Inside this band the difference is not actionable.
export const LIFT = 1.25;
export const DRAG = 0.75;
// At most this many of each, because a list of twelve decisions is a report
// again.
export const MAX_EACH = 3;

// winners: scored posts from socialBaseline.rank()
// frameworks: [{ framework, posts, avg_engagement_rate }]
export function decisionsFrom({ winners = [], frameworks = [] } = {}) {
  const doMore = [];
  const doLess = [];

  // ── posts that genuinely beat this account's own baseline ────────────
  // is_heater is already "reach_multiple >= HEATER_MULTIPLE", and it is null
  // rather than false when there is no baseline, so an account with four
  // published posts produces no winners here rather than a confident one.
  for (const p of winners.filter(w => w.is_heater && w.reach_multiple).slice(0, MAX_EACH)) {
    doMore.push({
      kind: 'post',
      id: p.id,
      title: p.hook ? truncate(p.hook, 90) : `${label(p.platform)} ${p.kind || 'post'}`,
      detail: `${p.reach_multiple}× this account's median ${label(p.platform)} ${p.kind || 'post'}`,
      // Spelt out rather than "scoped to the cohort", because the difference
      // between "against 40 comparable posts" and "against the whole account"
      // changes how much you should believe it.
      caveat: p.baseline_scope === 'account'
        ? 'Measured against the whole account, not this format alone'
        : null,
      brief: p.hook
        ? `Write more posts in the shape of this one, which reached ${p.reach_multiple}× our median ${label(p.platform)} ${p.kind || 'post'}:\n\n"${p.hook}"\n\nKeep what made it work — the opening beat and the angle — and change the subject.`
        : `Write more ${label(p.platform)} ${p.kind || 'post'}s in the shape of our best recent one, which reached ${p.reach_multiple}× the median.`,
    });
  }

  // ── frameworks carrying or dragging ──────────────────────────────────
  const usable = frameworks.filter(f =>
    f.framework && f.framework !== '(unspecified)' && Number(f.posts) >= MIN_POSTS);
  const avg = mean(usable.map(f => Number(f.avg_engagement_rate) || 0));

  if (usable.length >= 2 && avg > 0) {
    for (const f of usable.filter(f => f.avg_engagement_rate >= avg * LIFT).slice(0, MAX_EACH)) {
      doMore.push({
        kind: 'framework',
        id: `fw:${f.framework}`,
        title: f.framework,
        detail: `${f.avg_engagement_rate}% engagement across ${f.posts} posts, against ${round1(avg)}% on average`,
        caveat: null,
        brief: `Write the next batch as ${f.framework} posts. That framework is running at ${f.avg_engagement_rate}% engagement across ${f.posts} posts, against ${round1(avg)}% across everything else we publish.`,
      });
    }
    for (const f of usable.filter(f => f.avg_engagement_rate <= avg * DRAG).slice(0, MAX_EACH)) {
      doLess.push({
        kind: 'framework',
        id: `fw:${f.framework}`,
        title: f.framework,
        detail: `${f.avg_engagement_rate}% engagement across ${f.posts} posts, against ${round1(avg)}% on average`,
      });
    }
  }

  return { doMore, doLess, frameworksRead: usable.length, accountAverage: round1(avg) };
}

// What is missing, when there is nothing to say. Worth being specific: "not
// enough data" sends someone looking for a broken connector.
export function whyNothing({ winners = [], frameworks = [] } = {}) {
  if (!winners.length) return 'No published posts with engagement recorded yet. Publish a few and this fills in.';
  const scoped = winners.some(w => w.baseline_scope && w.baseline_scope !== 'none');
  if (!scoped) return 'Too few published posts to compare against. A multiple off two posts is noise, so nothing is claimed yet.';
  const usable = frameworks.filter(f => Number(f.posts) >= MIN_POSTS).length;
  if (!winners.some(w => w.is_heater) && usable < 2) {
    return `Nothing is running far enough above or below the rest to act on. Frameworks need ${MIN_POSTS} posts each before their averages mean anything, and ${usable} ${usable === 1 ? 'has' : 'have'} that so far.`;
  }
  return 'Nothing is far enough from the average to be worth changing this week.';
}

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function round1(n) { return Math.round(n * 10) / 10; }
function truncate(s, n) { return String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s); }
function label(platform) {
  const P = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok', youtube: 'YouTube' };
  return P[String(platform || '').toLowerCase()] || (platform || 'social');
}
