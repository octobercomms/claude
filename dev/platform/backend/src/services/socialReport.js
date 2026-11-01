// The downloadable social report.
//
// Four items in the 31 October review were one product: "I'd love to build a
// social media report I can download and send to clients", "Claude analyses
// all posts that month, what worked, what didn't, what to do more of", and
// two more saying Measure, Learn and Improve are the same report. The call
// was **downloadable first, covering OMI and connected accounts**, with
// scheduling to follow once the content is right.
//
// "And connected accounts" is the part that makes it a report rather than a
// read-out of our own work. OMI stores engagement for the posts OMI
// published; a client's account also carries posts the client, an intern or a
// previous agency put up. A monthly report that silently omits those is not a
// report on the account, and the client will notice before we do. So the
// account's own feed is read where Meta is connected, each post marked
// according to whether it came through OMI, and the report says which half of
// the picture each number is from.
//
// What it does NOT claim. Where no account is connected, it reports OMI's own
// posts and says on the page that is all it covers, rather than presenting a
// partial month as a whole one. TikTok has no reachable organic API without
// the client's own login, so TikTok posts are OMI's record only, and the page
// says so. An honest gap beats a number nobody can defend.

const pool = require('../db');
const socialOverviewReport = require('./socialOverviewReport');
const claudeService = require('./claude');
const meta = require('../connectors/meta');
const { decrypt } = require('../utils/encryption');

const WINDOW_DEFAULT = 30;

async function metaCreds(clientId) {
  const { rows } = await pool.query(
    `SELECT credentials FROM connectors
      WHERE client_id = $1
        AND connector_type IN ('meta_ads', 'instagram_insights')
        AND credentials IS NOT NULL AND credentials != '{}'
      ORDER BY connector_type LIMIT 1`,
    [clientId]
  );
  if (!rows.length) return null;
  try { return decrypt(rows[0].credentials); } catch { return null; }
}

// The posts OMI published in the window, with the permalink it recorded. The
// permalink is what ties our record to a row in the account's feed.
async function omiPosts(clientId, days) {
  const { rows } = await pool.query(
    `SELECT p.id, p.platform, p.kind, p.hook, p.caption, p.framework,
            p.published_at, p.published_url,
            e.reach, e.impressions, e.likes, e.comments, e.shares, e.saves
       FROM social_posts p
       LEFT JOIN LATERAL (
         SELECT * FROM social_post_engagement
          WHERE post_id = p.id ORDER BY fetched_at DESC LIMIT 1
       ) e ON TRUE
      WHERE p.client_id = $1
        AND p.published_at IS NOT NULL
        AND p.published_at >= NOW() - make_interval(days => $2)
      ORDER BY p.published_at DESC`,
    [clientId, days]
  );
  return rows;
}

// Two records of the same post. A permalink match is the only reliable tie:
// ids are each system's own, and a caption can be edited on either side.
function permalinkKey(url) {
  const s = String(url || '').trim().toLowerCase();
  if (!s) return null;
  // Trailing slash and query string differ between what Meta returns and what
  // was pasted in, and neither changes which post it is.
  return s.replace(/[?#].*$/, '').replace(/\/+$/, '');
}

function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }

// Fold the account's feed and OMI's record into one list of posts, each
// saying where it came from.
//
// Numbers come from the account where the account has them, because that is
// the client's own source of truth and the one they will check. OMI's stored
// engagement fills in for a post the feed did not carry, which is every post
// on a platform that has no API we can read.
function mergePosts({ feed, mine }) {
  const byLink = new Map();
  for (const p of mine) {
    const key = permalinkKey(p.published_url);
    if (key) byLink.set(key, p);
  }

  const posts = [];
  const matched = new Set();

  for (const m of feed) {
    const key = permalinkKey(m.permalink);
    const ours = key ? byLink.get(key) : null;
    if (ours) matched.add(ours.id);
    posts.push({
      source: 'account',
      via_omi: !!ours,
      platform: 'instagram',
      kind: m.media_type || null,
      hook: ours?.hook || null,
      framework: ours?.framework || null,
      caption: m.caption || ours?.caption || null,
      url: m.permalink,
      posted_at: m.posted_at,
      reach: m.insights?.reach ?? null,
      interactions: m.insights?.total_interactions
        ?? ((num(m.likes) + num(m.comments) + num(m.insights?.saved) + num(m.insights?.shares)) || null),
      likes: m.likes ?? null,
      comments: m.comments ?? null,
      saves: m.insights?.saved ?? null,
      shares: m.insights?.shares ?? null,
    });
  }

  // Ours that the feed did not carry: another platform, or a post the account
  // read could not see.
  for (const p of mine) {
    if (matched.has(p.id)) continue;
    posts.push({
      source: 'omi',
      via_omi: true,
      platform: p.platform,
      kind: p.kind || null,
      hook: p.hook || null,
      framework: p.framework || null,
      caption: p.caption || null,
      url: p.published_url || null,
      posted_at: p.published_at,
      reach: p.reach ?? null,
      interactions: p.impressions != null || p.likes != null
        ? (num(p.likes) + num(p.comments) + num(p.shares) + num(p.saves)) || null
        : null,
      likes: p.likes ?? null,
      comments: p.comments ?? null,
      saves: p.saves ?? null,
      shares: p.shares ?? null,
    });
  }

  posts.sort((a, b) => new Date(b.posted_at || 0) - new Date(a.posted_at || 0));
  return posts;
}

// `Number(null)` is 0 and 0 is finite, so a null check comes first. Without
// it a post whose reach the API would not give counts as a post that reached
// nobody, which both inflates the denominator and reads as a bad month.
function hasReach(p) {
  return p.reach != null && Number.isFinite(Number(p.reach));
}

function totals(posts) {
  const withReach = posts.filter(hasReach);
  const reach = withReach.reduce((n, p) => n + Number(p.reach), 0);
  const interactions = posts.reduce((n, p) => n + num(p.interactions), 0);
  return {
    posts: posts.length,
    via_omi: posts.filter(p => p.via_omi).length,
    not_via_omi: posts.filter(p => !p.via_omi).length,
    reach,
    interactions,
    // A rate over the posts that actually reported reach, not over all of
    // them: dividing by posts whose reach is unknown understates it silently.
    engagement_rate: reach ? Number(((interactions / reach) * 100).toFixed(2)) : null,
    posts_with_reach: withReach.length,
  };
}

// What the report covers, said plainly, because a client reading a number
// deserves to know which account it came from.
function coverageNotes({ connected, feedCount, platforms }) {
  const notes = [];
  if (connected) {
    notes.push(`Instagram is connected, so this covers every post on the account in the window (${feedCount}), whoever published it.`);
  } else {
    notes.push('No Instagram account is connected to OMI, so this covers only the posts published through OMI. Connect Instagram to include the rest of the account.');
  }
  if (platforms.includes('tiktok')) {
    notes.push('TikTok has no organic API OMI can read without the client\'s own login, so TikTok posts here are OMI\'s own record.');
  }
  if (platforms.includes('linkedin')) {
    notes.push('LinkedIn figures are OMI\'s own record of what it published.');
  }
  return notes;
}

async function reportData(clientId, { days = WINDOW_DEFAULT } = {}) {
  const { rows: clientRows } = await pool.query('SELECT id, name FROM clients WHERE id = $1', [clientId]);
  if (!clientRows.length) { const e = new Error('Client not found'); e.status = 404; throw e; }
  const client = clientRows[0];

  const mine = await omiPosts(clientId, days);

  // The account's own feed, where it is reachable. A connector failure
  // degrades to OMI's own posts and is reported, never swallowed: a report
  // that quietly drops half the account is worse than one that says it could
  // not reach it.
  let feed = [];
  let connected = false;
  let connectorError = null;
  const creds = await metaCreds(clientId);
  if (creds) {
    try {
      const targets = await meta.pickPublishingTargets(creds);
      if (targets.igBusinessId) {
        const since = new Date(Date.now() - days * 86400000);
        feed = await meta.fetchInstagramMedia(creds, { igId: targets.igBusinessId, since, until: new Date() });
        connected = true;
      } else {
        connectorError = 'The Meta connection has no Instagram business account attached.';
      }
    } catch (err) {
      connectorError = err.message;
    }
  }

  const posts = mergePosts({ feed, mine });
  const platforms = [...new Set(posts.map(p => p.platform).filter(Boolean))];

  // Best and worst by engagement rate, over posts whose reach is known, so
  // "what worked" is not decided by a post with no data.
  const rated = posts
    .filter(p => hasReach(p) && Number(p.reach) > 0)
    .map(p => ({ ...p, rate: Number((((num(p.interactions)) / Number(p.reach)) * 100).toFixed(2)) }))
    .sort((a, b) => b.rate - a.rate);

  const overview = await socialOverviewReport.reportData(clientId, { days }).catch(() => null);

  return {
    client,
    days,
    generated_at: new Date().toISOString(),
    connected,
    connector_error: connectorError,
    platforms,
    totals: totals(posts),
    posts,
    best: rated.slice(0, 5),
    worst: rated.slice(-3).reverse().filter(p => !rated.slice(0, 5).includes(p)),
    frameworks: overview?.frameworks || [],
    coverage: coverageNotes({ connected, feedCount: feed.length, platforms }),
  };
}

// Claude's read on the month. One call, over the numbers rather than over
// raw rows, and the prompt asks for what to do next rather than a restatement
// of the table above it.
function buildSummaryPrompt(data) {
  const line = (p) => `- ${p.posted_at ? String(p.posted_at).slice(0, 10) : '?'} · ${p.platform}${p.kind ? `/${p.kind}` : ''}`
    + ` · reach ${p.reach ?? 'unknown'} · interactions ${p.interactions ?? 'unknown'}`
    + `${p.framework ? ` · ${p.framework}` : ''}${p.via_omi ? '' : ' · not published through OMI'}`
    + `\n  ${String(p.hook || p.caption || '').replace(/\s+/g, ' ').slice(0, 160)}`;
  return `Client: ${data.client.name}
Window: the last ${data.days} days
Posts: ${data.totals.posts} (${data.totals.via_omi} through OMI, ${data.totals.not_via_omi} published elsewhere on the account)
Total reach: ${data.totals.reach}
Total interactions: ${data.totals.interactions}
Engagement rate: ${data.totals.engagement_rate == null ? 'not calculable' : `${data.totals.engagement_rate}%`}
${data.coverage.map(c => `Coverage: ${c}`).join('\n')}

Best by engagement rate:
${data.best.map(line).join('\n') || '(none with reach data)'}

Weakest by engagement rate:
${data.worst.map(line).join('\n') || '(none with reach data)'}

Framework breakdown: ${data.frameworks.map(f => `${f.framework}: ${f.posts} posts`).join(', ') || '(none recorded)'}`;
}

const SUMMARY_SYSTEM = `You write the analysis section of a monthly social report an agency sends its client. British English. No hype, no filler, no em dashes.

Rules:
 - Say what worked and what did not, each with the number that shows it. Never a claim without its figure.
 - Where the data cannot answer something, say so in one clause rather than guessing. A post with unknown reach is not a failed post.
 - Where posts not published through OMI outperformed the ones that were, say that plainly. The client is paying for honesty, not for the agency to look good.
 - Three recommendations at most, each one a thing to do next month, each tied to something in the data above.
 - No preamble and no summary of the summary.

Return ONE JSON object and nothing else:
{"worked":"...","did_not":"...","recommendations":["...","...","..."]}`;

async function summarise(clientId, data) {
  const raw = await claudeService.callClaude({
    max_tokens: 1200,
    system: SUMMARY_SYSTEM,
    user: `${buildSummaryPrompt(data)}\n\nReturn the JSON object only.`,
    feature: 'social_report_summary',
    clientId,
  });
  const cleaned = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const p = JSON.parse(cleaned);
    return {
      worked: typeof p.worked === 'string' ? p.worked : null,
      did_not: typeof p.did_not === 'string' ? p.did_not : null,
      recommendations: Array.isArray(p.recommendations) ? p.recommendations.map(String).slice(0, 3) : [],
    };
  } catch {
    // The report is still worth sending without the analysis section, so a
    // malformed reply loses that section rather than the report.
    return null;
  }
}

module.exports = {
  reportData, summarise, buildSummaryPrompt,
  _mergePosts: mergePosts, _totals: totals, _permalinkKey: permalinkKey, _coverageNotes: coverageNotes,
};

// ─── the document ───────────────────────────────────────────────────────────
//
// Same shape and house style as the AI Visibility PDF, which routes render
// through pdfService.generatePDFBuffer. Reusing that look matters more than
// it sounds: a client who has had one October report recognises the next one.

const { buildFontCSS, getLogoDataUri } = require('./pdfService');

const ACCENT = '#e7cd41';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(v));
}
function fmtDay(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
  catch { return '—'; }
}
function metricBox(label, value, sub) {
  return `<div class="metric">
    <div class="metric-value">${esc(value)}</div>
    <div class="metric-label">${esc(label)}</div>
    ${sub ? `<div class="metric-sub">${esc(sub)}</div>` : ''}
  </div>`;
}

function postRow(p) {
  const rate = Number.isFinite(Number(p.reach)) && Number(p.reach) > 0
    ? `${(((Number(p.interactions) || 0) / Number(p.reach)) * 100).toFixed(1)}%`
    : '—';
  return `<tr>
    <td>${fmtDay(p.posted_at)}</td>
    <td>${esc(p.platform)}${p.kind ? ` <span class="dim">/ ${esc(p.kind)}</span>` : ''}</td>
    <td>${esc(String(p.hook || p.caption || '').replace(/\s+/g, ' ').slice(0, 90))}</td>
    <td class="num">${fmtNum(p.reach)}</td>
    <td class="num">${fmtNum(p.interactions)}</td>
    <td class="num">${rate}</td>
    <td>${p.via_omi ? 'OMI' : '<span class="dim">elsewhere</span>'}</td>
  </tr>`;
}

function buildHtml({ data, summary = null }) {
  const t = data.totals;
  const logo = getLogoDataUri();
  const period = `Last ${data.days} days · to ${fmtDay(data.generated_at)}`;

  const analysis = summary ? `
    <div class="summary">
      <span class="lbl">What worked</span>${esc(summary.worked || '—')}
    </div>
    <div class="summary">
      <span class="lbl">What did not</span>${esc(summary.did_not || '—')}
    </div>
    ${summary.recommendations?.length ? `
      <h2 class="sec">Next month</h2>
      <ol class="recs">${summary.recommendations.map(r => `<li>${esc(r)}</li>`).join('')}</ol>` : ''}` : '';

  // The posts not published through OMI, called out rather than blended in.
  // If somebody else's post beat ours, the client should see that from us.
  const theirs = data.posts.filter(p => !p.via_omi);
  const elsewhere = theirs.length ? `
    <h2 class="sec">Posted outside OMI <span class="src">${theirs.length} of ${t.posts}</span></h2>
    <div class="note">Posts on the account that did not come through OMI. They count towards the account's figures above, and they are listed so the comparison is like for like.</div>
    <table><thead><tr><th>Date</th><th>Where</th><th>Opening</th><th class="num">Reach</th><th class="num">Interactions</th><th class="num">Rate</th><th>Source</th></tr></thead>
    <tbody>${theirs.slice(0, 20).map(postRow).join('')}</tbody></table>` : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    ${buildFontCSS()}
    * { box-sizing: border-box; }
    body { font-family: 'Brockmann', Arial, sans-serif; color: #111; margin: 0; padding: 0; font-size: 10.5pt; line-height: 1.45; }
    .page { padding: 18mm 15mm; }
    .masthead { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 22px; }
    .masthead .wordmark { font-size: 11pt; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; }
    h1 { font-size: 26pt; font-weight: 700; margin: 0 0 2px; letter-spacing: -0.5px; }
    .sub { color: #555; font-size: 11pt; margin-bottom: 22px; }
    .metrics { display: flex; gap: 10px; margin-bottom: 8px; }
    .metric { flex: 1; border: 1.5px solid #e5e5e5; border-radius: 10px; padding: 14px 12px; text-align: center; }
    .metric-value { font-size: 24pt; font-weight: 700; letter-spacing: -1px; }
    .metric-label { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.6px; color: #777; margin-top: 4px; }
    .metric-sub { font-size: 8pt; color: #999; margin-top: 2px; }
    .note { color: #555; font-size: 10pt; margin: 14px 0 20px; }
    .coverage { border: 1.5px solid #e5e5e5; border-radius: 10px; padding: 12px 14px; margin: 18px 0 6px; font-size: 9.5pt; color: #555; }
    .coverage .lbl { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.6px; color: #999; font-weight: 700; display: block; margin-bottom: 5px; }
    .coverage p { margin: 0 0 5px; }
    .summary { background: #faf6df; border-left: 4px solid ${ACCENT}; border-radius: 8px; padding: 14px 16px; margin: 14px 0 6px; font-size: 11pt; line-height: 1.5; }
    .summary .lbl { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.6px; color: #9a8a2a; font-weight: 700; display: block; margin-bottom: 5px; }
    h2.sec { font-size: 13pt; font-weight: 700; margin: 26px 0 10px; }
    h2.sec .src { font-size: 8.5pt; font-weight: 400; color: #999; letter-spacing: 0; margin-left: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
    th { text-align: left; text-transform: uppercase; letter-spacing: 0.5px; font-size: 7.5pt; color: #888; border-bottom: 1.5px solid #e5e5e5; padding: 5px 8px; }
    td { border-bottom: 1px solid #f0f0f0; padding: 6px 8px; vertical-align: top; }
    td.num, th.num { text-align: right; }
    .dim { color: #999; }
    ol.recs { margin: 0 0 8px; padding-left: 20px; font-size: 10.5pt; }
    ol.recs li { margin-bottom: 6px; }
  </style></head><body><div class="page">
    <div class="masthead">
      <div>
        ${logo ? `<img src="${logo}" height="34" alt="October" />` : '<div class="wordmark">October</div>'}
      </div>
      <div class="dim" style="font-size:9pt">${esc(period)}</div>
    </div>

    <h1>Social report</h1>
    <div class="sub">${esc(data.client.name)}</div>

    <div class="metrics">
      ${metricBox('Posts', t.posts, `${t.via_omi} through OMI`)}
      ${metricBox('Reach', fmtNum(t.reach), t.posts_with_reach < t.posts ? `${t.posts_with_reach} of ${t.posts} reported it` : null)}
      ${metricBox('Interactions', fmtNum(t.interactions))}
      ${metricBox('Engagement rate', t.engagement_rate == null ? '—' : `${t.engagement_rate}%`, 'interactions ÷ reach')}
    </div>

    <div class="coverage">
      <span class="lbl">What this covers</span>
      ${data.coverage.map(c => `<p>${esc(c)}</p>`).join('')}
      ${data.connector_error ? `<p>Instagram could not be read this time: ${esc(data.connector_error)}</p>` : ''}
    </div>

    ${analysis}

    <h2 class="sec">Best performing <span class="src">by engagement rate</span></h2>
    ${data.best.length
      ? `<table><thead><tr><th>Date</th><th>Where</th><th>Opening</th><th class="num">Reach</th><th class="num">Interactions</th><th class="num">Rate</th><th>Source</th></tr></thead>
         <tbody>${data.best.map(postRow).join('')}</tbody></table>`
      : '<div class="note">No post in this window reported its reach, so there is nothing to rank. The figures above are what was recorded.</div>'}

    ${data.worst.length ? `
      <h2 class="sec">Weakest</h2>
      <table><thead><tr><th>Date</th><th>Where</th><th>Opening</th><th class="num">Reach</th><th class="num">Interactions</th><th class="num">Rate</th><th>Source</th></tr></thead>
      <tbody>${data.worst.map(postRow).join('')}</tbody></table>` : ''}

    ${elsewhere}

    <h2 class="sec">Every post <span class="src">${t.posts} in the window</span></h2>
    <table><thead><tr><th>Date</th><th>Where</th><th>Opening</th><th class="num">Reach</th><th class="num">Interactions</th><th class="num">Rate</th><th>Source</th></tr></thead>
    <tbody>${data.posts.map(postRow).join('') || '<tr><td colspan="7" class="dim">Nothing published in this window.</td></tr>'}</tbody></table>
  </div></body></html>`;
}

module.exports.buildHtml = buildHtml;
module.exports._postRow = postRow;
