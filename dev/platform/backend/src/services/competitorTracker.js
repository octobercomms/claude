// Weekly competitor scrape. Walks each active client's
// social_competitors handles, asks Apify for their top recent posts,
// and lands the results in competitor_posts. Runs from the Sunday 06:00
// cron in scheduler.js. The same rows feed into the next batch's
// prompt as exemplars alongside the brand's own Winners — so what
// competitors are shipping each Sunday shapes the AM's Monday
// brainstorm.

const pool = require('../db');
const apify = require('../connectors/apify');

// Parse "instagram:foobar" / "tiktok:@bar" / bare "@quux" → { platform, handle }.
// Bare handles default to Instagram which is what 90% of competitors live on.
function parseCompetitor(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(instagram|tiktok)\s*:\s*@?(.+)$/i);
  if (m) return { platform: m[1].toLowerCase(), handle: m[2].trim() };
  return { platform: 'instagram', handle: trimmed.replace(/^@/, '') };
}

// Scrape one (platform, handle) and upsert the results into competitor_posts.
async function scrapeOne(clientId, platform, handle) {
  let posts = [];
  try {
    if (platform === 'instagram') posts = await apify.fetchInstagramUserPosts(handle, { limit: 5 });
    else if (platform === 'tiktok') posts = await apify.fetchTikTokUserPosts(handle, { limit: 5 });
    else return { handle, platform, count: 0, error: `Unsupported platform: ${platform}` };
  } catch (err) {
    return { handle, platform, count: 0, error: err.response?.data?.error?.message || err.message };
  }
  let inserted = 0;
  for (const p of posts) {
    if (!p.external_id) continue;
    await pool.query(
      `INSERT INTO competitor_posts
         (client_id, platform, handle, external_id, post_url, thumbnail_url,
          caption, hook, view_count, likes_count, comments_count, posted_at, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
       ON CONFLICT (client_id, platform, external_id) DO UPDATE
         SET view_count = COALESCE(EXCLUDED.view_count, competitor_posts.view_count),
             likes_count = COALESCE(EXCLUDED.likes_count, competitor_posts.likes_count),
             comments_count = COALESCE(EXCLUDED.comments_count, competitor_posts.comments_count),
             caption = COALESCE(EXCLUDED.caption, competitor_posts.caption),
             hook = COALESCE(EXCLUDED.hook, competitor_posts.hook),
             thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, competitor_posts.thumbnail_url),
             fetched_at = NOW()`,
      [
        clientId, platform, handle, p.external_id, p.post_url, p.thumbnail_url,
        p.caption, p.hook, p.view_count, p.likes_count, p.comments_count, p.posted_at,
      ]
    );
    inserted++;
  }
  return { handle, platform, count: inserted };
}

// Scrape every competitor for one client. Returns per-handle results
// so the AM-facing manual-trigger endpoint can surface what happened.
async function scrapeClient(clientId) {
  const { rows } = await pool.query(
    `SELECT social_competitors FROM clients WHERE id = $1`,
    [clientId]
  );
  const raw = rows[0]?.social_competitors || [];
  const parsed = raw.map(parseCompetitor).filter(Boolean);
  const results = [];
  for (const { platform, handle } of parsed) {
    results.push(await scrapeOne(clientId, platform, handle));
  }
  return results;
}

// Sunday-cron entry point. Walks every active client and runs
// scrapeClient. Serial across clients because Apify usage is metered
// and a parallel burst burns credit without giving us anything we need
// sooner than "before the AM walks in Monday morning."
async function scrapeAllClients() {
  const { rows } = await pool.query(
    `SELECT id, name FROM clients WHERE active = true
       AND social_competitors IS NOT NULL
       AND array_length(social_competitors, 1) > 0`
  );
  const summary = [];
  for (const c of rows) {
    try {
      const results = await scrapeClient(c.id);
      const total = results.reduce((n, r) => n + (r.count || 0), 0);
      const errors = results.filter(r => r.error).length;
      summary.push({ client_id: c.id, client_name: c.name, posts: total, errors });
      console.log(`[competitor] ${c.name}: ${total} posts (${errors} errors)`);
    } catch (err) {
      console.error(`[competitor] ${c.name} failed:`, err.message);
      summary.push({ client_id: c.id, client_name: c.name, posts: 0, errors: 1, fatal: err.message });
    }
  }
  return summary;
}

// Read-side — used by the Social tab's CompetitorTracker panel. Returns
// the most recent scrape per (handle, external_id), ordered by view
// count desc so the "top 5 we saw" surface first.
async function getRecentCompetitorPosts(clientId, { limit = 25 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, platform, handle, post_url, thumbnail_url, caption, hook,
            view_count, likes_count, comments_count, posted_at, fetched_at
       FROM competitor_posts
      WHERE client_id = $1
      ORDER BY view_count DESC NULLS LAST, fetched_at DESC
      LIMIT $2`,
    [clientId, limit]
  );
  return rows;
}

module.exports = { parseCompetitor, scrapeOne, scrapeClient, scrapeAllClients, getRecentCompetitorPosts };
