// AI Social Audit — runs the "audit my Instagram" analysis over the social
// performance data OMI already ingests (published posts + their engagement,
// plus the weekly competitor scrape), rather than a third-party connector.
// Claude reads content mix, posting cadence/timing, what's actually working
// for THIS account, and the competitor set, and returns a structured audit
// with concrete recommendations. See docs / the Instagram-audit deck.

const pool = require('../db');
const claudeService = require('./claude');

function parseJson(raw) {
  const cleaned = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); }
  catch { throw new Error('Social audit returned malformed JSON.'); }
}

// All published posts in the window with their latest engagement snapshot.
// LEFT JOIN so posts without an engagement pull still count toward content
// mix / cadence (engagement just shows as null).
async function getPosts(clientId, days) {
  const { rows } = await pool.query(
    `WITH latest AS (
       SELECT DISTINCT ON (e.post_id)
         e.post_id, e.reach, e.impressions, e.likes, e.comments, e.shares, e.saves, e.views
       FROM social_post_engagement e
       JOIN social_posts p ON p.id = e.post_id
       WHERE p.client_id = $1 AND p.published_at IS NOT NULL
       ORDER BY e.post_id, e.fetched_at DESC
     )
     SELECT p.id, p.platform, p.kind, p.hook, p.caption, p.published_at,
            l.reach, l.impressions, l.likes, l.comments, l.shares, l.saves, l.views
       FROM social_posts p
       LEFT JOIN latest l ON l.post_id = p.id
      WHERE p.client_id = $1 AND p.published_at IS NOT NULL
        AND p.published_at >= NOW() - ($2::int || ' days')::interval
      ORDER BY p.published_at DESC`,
    [clientId, days]
  );
  return rows;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Compact one post for the prompt: format, platform, when (day + hour),
// engagement rate, hook. Keeps the payload small and the signal high.
function compact(p) {
  const reachLike = p.reach || p.impressions || p.views || 0;
  const interactions = (p.likes || 0) + (p.comments || 0) + (p.shares || 0) + (p.saves || 0);
  const rate = reachLike > 0 ? Math.round((interactions / reachLike) * 1000) / 10 : null;
  const d = p.published_at ? new Date(p.published_at) : null;
  return {
    platform: p.platform, kind: p.kind,
    day: d ? DOW[d.getUTCDay()] : null, hourUTC: d ? d.getUTCHours() : null,
    engagement_rate: rate, reach: reachLike || null,
    likes: p.likes ?? null, comments: p.comments ?? null, saves: p.saves ?? null,
    hook: (p.hook || '').slice(0, 90) || null,
  };
}

const SYSTEM =
  'You are a senior organic-social strategist. From an account\'s own published-post performance you produce a sharp, ' +
  'data-grounded audit: what content mix and formats are working, when the account performs best, what to do more / less of, ' +
  'how it compares to competitors, and concrete next actions. British English. JSON only — no prose, no fences.';

function buildPrompt({ client, posts, competitors }) {
  return `Brand: ${client.name}
About: ${client.briefing_field || '(no brief)'}
This month's focus: ${client.monthly_focus || '(none)'}
Competitor handles: ${(client.social_competitors || []).filter(Boolean).join(', ') || '(none configured)'}

This account's published posts (last ${posts.length ? '' : 'period — '}${posts.length} posts; times are UTC):
"""
${JSON.stringify(posts).slice(0, 13000)}
"""

${competitors.length ? `Top competitor posts scraped recently (for the competitor read):
${competitors.map((c, i) => `${i + 1}. [@${c.handle} · ${c.platform}${c.view_count ? ` · ${Number(c.view_count).toLocaleString()} views` : ''}] "${c.hook || '(no hook)'}"`).join('\n')}` : '(no competitor posts scraped yet)'}

Audit this account. Return ONLY:
{"summary":"2–3 sentence headline read of how the account is performing",
 "content_mix":"which formats/platforms dominate and how each performs — call out the best and worst",
 "best_timing":"the days/times this account performs best, from the data — or 'not enough data yet' if sparse",
 "whats_working":["specific, evidence-backed wins"],
 "whats_not":["specific drags / underperformers"],
 "competitor_read":"what the competitor set is doing that this account isn't (or '—' if no competitor data)",
 "recommendations":["concrete, prioritised next actions"]}

Rules: ground every claim in the data provided; cite formats/days/engagement where relevant; be specific, not generic. 3–6 items per list.`;
}

async function runAudit(clientId, { days = 90 } = {}) {
  const { rows: crows } = await pool.query(
    'SELECT name, briefing_field, monthly_focus, social_competitors FROM clients WHERE id = $1', [clientId]
  );
  if (!crows.length) { const e = new Error('Client not found'); e.status = 404; throw e; }
  const client = crows[0];

  const posts = await getPosts(clientId, days);
  if (!posts.length) {
    const e = new Error('No published posts in this window yet. Publish a few posts and mark them published (engagement auto-pulls daily), then run the audit.');
    e.status = 400; throw e;
  }

  const { rows: competitors } = await pool.query(
    `SELECT handle, platform, hook, view_count, likes_count
       FROM competitor_posts
      WHERE client_id = $1 AND fetched_at >= NOW() - INTERVAL '21 days'
      ORDER BY view_count DESC NULLS LAST LIMIT 10`,
    [clientId]
  );

  const out = parseJson(await claudeService.callClaude({
    max_tokens: 2500,
    system: SYSTEM,
    user: buildPrompt({ client, posts: posts.map(compact), competitors }),
    feature: 'social_audit',
    clientId,
  }));

  const data = {
    summary: out.summary || null,
    content_mix: out.content_mix || null,
    best_timing: out.best_timing || null,
    whats_working: Array.isArray(out.whats_working) ? out.whats_working.slice(0, 8) : [],
    whats_not: Array.isArray(out.whats_not) ? out.whats_not.slice(0, 8) : [],
    competitor_read: out.competitor_read || null,
    recommendations: Array.isArray(out.recommendations) ? out.recommendations.slice(0, 8) : [],
  };
  const { rows } = await pool.query(
    `INSERT INTO social_audits (client_id, period_days, post_count, data)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [clientId, days, posts.length, JSON.stringify(data)]
  );
  return rows[0];
}

async function latestAudit(clientId) {
  const { rows } = await pool.query(
    'SELECT * FROM social_audits WHERE client_id = $1 ORDER BY generated_at DESC LIMIT 1', [clientId]
  );
  return rows[0] || null;
}

module.exports = { runAudit, latestAudit };
