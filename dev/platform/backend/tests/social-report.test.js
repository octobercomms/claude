/**
 * The social report's shaping: which posts it counts, whose they are, and
 * what it refuses to claim.
 *
 * The thing that makes this a report rather than a read-out of our own work
 * is that it covers the account, including posts OMI did not publish. The
 * failure mode is silent: drop those and every figure still looks plausible,
 * and the client is the one who notices. So the merge, the tie between the
 * two records, and the totals get checked directly.
 *
 *   node tests/social-report.test.js
 */
const assert = require('assert');
const report = require('../src/services/socialReport');

let failures = 0;
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ok  ', label);
  else { console.log('  FAIL', label, extra); failures += 1; }
};

// --- the tie between the two records -------------------------------------
// A permalink is the only reliable one: ids are each system's own and a
// caption can be edited on either side. The forms it arrives in differ.
const key = report._permalinkKey;
ok(key('https://www.instagram.com/p/ABC123/') === key('https://www.instagram.com/p/abc123'),
  'a trailing slash and the case do not make it a different post');
ok(key('https://www.instagram.com/p/ABC/?utm_source=x') === key('https://www.instagram.com/p/abc/'),
  'and neither does a tracking query somebody pasted');
ok(key('') === null && key(null) === null, 'a post with no link has no key, rather than an empty one');

// --- the merge ------------------------------------------------------------
const feed = [
  { id: 'm1', permalink: 'https://www.instagram.com/p/OURS/', media_type: 'image', posted_at: '2026-10-20T10:00:00Z',
    likes: 20, comments: 4, insights: { reach: 500, total_interactions: 30, saved: 5, shares: 1 } },
  { id: 'm2', permalink: 'https://www.instagram.com/p/THEIRS/', media_type: 'reel', posted_at: '2026-10-22T10:00:00Z',
    likes: 90, comments: 10, insights: { reach: 2000, total_interactions: 140, saved: 30, shares: 10 } },
  // A post the API would not give insights for: too old, or a metric that
  // does not apply. It keeps its row.
  { id: 'm3', permalink: 'https://www.instagram.com/p/NOINSIGHT/', media_type: 'image', posted_at: '2026-10-25T10:00:00Z',
    likes: 3, comments: 0, insights: null },
];
const mine = [
  // The same post as m1, from our side, with the query string ours recorded.
  { id: 'p1', platform: 'instagram', kind: 'post', hook: 'Start with one bed', framework: 'PAS',
    published_url: 'https://www.instagram.com/p/OURS/?img_index=1', published_at: '2026-10-20T10:00:00Z',
    reach: 480, likes: 18, comments: 4, shares: 1, saves: 5 },
  // A TikTok, which no account read can see.
  { id: 'p2', platform: 'tiktok', kind: 'reel', hook: 'Autumn planting', published_url: 'https://tiktok.com/@x/video/1',
    published_at: '2026-10-21T10:00:00Z', reach: 1200, likes: 60, comments: 5, shares: 3, saves: 2 },
];

const posts = report._mergePosts({ feed, mine });
ok(posts.length === 4, 'three from the account plus the TikTok it cannot see, not five', String(posts.length));

const byUrl = (frag) => posts.find(p => String(p.url || '').includes(frag));
ok(byUrl('OURS').via_omi === true, 'the post on both sides is counted once, as ours');
ok(byUrl('OURS').hook === 'Start with one bed',
  'keeping the hook only our record has', String(byUrl('OURS').hook));
ok(byUrl('OURS').reach === 500,
  'and the account\'s reach rather than ours, because that is what the client will check', String(byUrl('OURS').reach));
ok(byUrl('THEIRS').via_omi === false, 'a post we did not publish is marked as not ours');
ok(byUrl('THEIRS').reach === 2000, 'with its own figures');
ok(byUrl('NOINSIGHT').reach === null,
  'a post with no insights keeps its row with an unknown reach, not a zero', String(byUrl('NOINSIGHT').reach));
ok(byUrl('NOINSIGHT').interactions === 3,
  'and its likes and comments still count', String(byUrl('NOINSIGHT').interactions));
ok(byUrl('tiktok').via_omi === true && byUrl('tiktok').source === 'omi',
  'the TikTok comes from our own record');
ok(new Date(posts[0].posted_at) >= new Date(posts[posts.length - 1].posted_at),
  'newest first', JSON.stringify(posts.map(p => p.posted_at)));

// --- the totals -----------------------------------------------------------
const t = report._totals(posts);
ok(t.posts === 4, 'four posts', String(t.posts));
ok(t.via_omi === 2 && t.not_via_omi === 2,
  'two ours and two not', JSON.stringify([t.via_omi, t.not_via_omi]));
// 500 + 2000 + 1200. The post with no reach is not counted as 0, which would
// drag the rate down and look like a bad month.
ok(t.reach === 3700, 'reach sums only the posts that reported it', String(t.reach));
ok(t.posts_with_reach === 3, 'and says how many that was', String(t.posts_with_reach));
ok(t.interactions === 30 + 140 + 3 + 70, 'interactions sum across both records', String(t.interactions));
const expectedRate = Number(((t.interactions / t.reach) * 100).toFixed(2));
ok(t.engagement_rate === expectedRate,
  'the rate is interactions over the reach that is known', `${t.engagement_rate} vs ${expectedRate}`);
ok(report._totals([]).engagement_rate === null,
  'with no reach at all the rate is unknown, not zero');

// --- what it says it covers ----------------------------------------------
let notes = report._coverageNotes({ connected: false, feedCount: 0, platforms: ['instagram'] });
ok(notes.join(' ').includes('only the posts published through OMI'),
  'with nothing connected it says the report is OMI\'s own posts', JSON.stringify(notes));
notes = report._coverageNotes({ connected: true, feedCount: 12, platforms: ['instagram', 'tiktok'] });
ok(notes.join(' ').includes('whoever published it'), 'connected, it says it covers the account');
ok(notes.join(' ').includes('12'), 'and how many posts that was');
ok(notes.join(' ').includes('TikTok'),
  'and that TikTok is our own record, because there is no API to read it');

// --- the document ---------------------------------------------------------
const data = {
  client: { name: 'Hillcroft <Gardens>' }, days: 30, generated_at: '2026-10-31T00:00:00Z',
  connected: true, connector_error: null, platforms: ['instagram'],
  totals: t, posts, best: [posts[0]], worst: [], frameworks: [],
  coverage: ['Instagram is connected.'],
};
const html = report.buildHtml({ data });
ok(html.includes('Hillcroft &lt;Gardens&gt;'), 'the client name is escaped, not injected');
ok(/Posted outside OMI/.test(html), 'the posts we did not publish get their own section');
ok(/2 of 4/.test(html), 'saying how many of the month they were');
ok(!/Next month/.test(html), 'and with no analysis the recommendations section is absent, not empty');

const withSummary = report.buildHtml({
  data,
  summary: { worked: 'Reels outperformed stills.', did_not: 'The carousel went nowhere.', recommendations: ['More reels'] },
});
ok(/Reels outperformed stills/.test(withSummary), 'the analysis lands in the document');
ok(/Next month/.test(withSummary) && /More reels/.test(withSummary), 'and so do the recommendations');

// --- the prompt -----------------------------------------------------------
const prompt = report.buildSummaryPrompt(data);
ok(/not published through OMI/.test(prompt),
  'Claude is told which posts were not ours, so it can say if theirs beat ours');
ok(/Coverage:/.test(prompt), 'and what the data does not cover');
ok(/reach unknown/.test(prompt), 'a post with no reach is described as unknown rather than as zero');

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
