// Publication website resolver. The feed pipeline can only find an RSS feed for
// an outlet whose website address we know — and most imported publications have
// no url/domain on file (that's why "find all feeds" comes back near-empty). This
// uses Claude web_search to find each publication's official homepage, stores it,
// and immediately tries to discover its feed. It's the unlock that turns a few
// dozen feeds into hundreds, and the first piece of the "research + update the
// database" brain.
//
// Cost: one cheap web_search per outlet, and only for outlets we haven't resolved
// yet — a one-time backlog, then only new publications. Haiku by default.

const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../db');
let costLog; try { costLog = require('./costLog'); } catch { costLog = null; }
let rssDiscover; try { rssDiscover = require('./rssDiscover'); } catch { rssDiscover = null; }

const MODEL = 'claude-haiku-4-5';

function extractJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : {}; } catch { return {}; }
}

// Basic sanity: a real, public http(s) homepage — not a social profile or a
// search page (those aren't the outlet's own site and won't carry its feed).
function cleanUrl(raw) {
  let u = String(raw || '').trim();
  if (!u || !/^https?:\/\//i.test(u)) return null;
  let host;
  try { host = new URL(u).hostname.toLowerCase(); } catch { return null; }
  const bad = ['facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com', 'youtube.com', 'google.com', 'wikipedia.org', 'medium.com'];
  if (bad.some((b) => host === b || host.endsWith(`.${b}`))) return null;
  try { return new URL(u).origin; } catch { return null; }
}

// Find one outlet's official website via web_search. Returns { url } | null.
async function resolveOne(outlet, { log = () => {} } = {}) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) { log('outletResolve: CLAUDE_API_KEY not set'); return null; }
  const client = new Anthropic({ apiKey: key });
  const name = String(outlet.name || '').trim();
  if (!name) return null;

  let message;
  try {
    message = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }],
      messages: [{
        role: 'user',
        content: `Find the official website homepage for the media outlet / publication / magazine / blog called "${name}". Use web search. It must be the publication's OWN website (not a social profile, Wikipedia, or a directory).

Return ONLY JSON, nothing else:
{"url":"https://the-official-site.com","confidence":0.0-1.0}
If you cannot find it with reasonable confidence, return {"url":null,"confidence":0}.`,
      }],
    });
  } catch (e) { log(`outletResolve: "${name}" search failed — ${e.message}`); return null; }

  if (costLog?.recordClaudeCost) {
    try {
      costLog.recordClaudeCost({ model: MODEL, response: message, feature: 'press_outlet_resolve' });
      // Tell the budget cache immediately. It refreshes every 30s and this
      // sweep bills faster than that, so without this the cap is only noticed
      // long after the run has finished — which is how a $10 budget became
      // $20.75 of spend.
      require('./budget').noteTaskSpend('media_research', costLog.claudeCostFromUsage(MODEL, message.usage));
    } catch { /* best effort */ }
  }
  const text = (message.content || []).filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('\n');
  const d = extractJson(text);
  const url = cleanUrl(d.url);
  if (!url || (typeof d.confidence === 'number' && d.confidence < 0.4)) return null;
  return { url };
}

// Resolve one outlet's website and, if found, discover its feed in the same pass.
async function resolveAndFind(outletId, { log = () => {} } = {}) {
  const { rows } = await pool.query('SELECT id, name, url, domain FROM pr_outlets WHERE id = $1', [outletId]);
  const outlet = rows[0];
  if (!outlet) return { status: 'not-found' };

  let url = outlet.url || (outlet.domain ? `https://${String(outlet.domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '')}` : null);
  if (!url) {
    const found = await resolveOne(outlet, { log });
    if (!found) {
      // Mark it checked so we don't hammer the same un-findable name nightly.
      await pool.query(`UPDATE pr_outlets SET rss_status = 'none', rss_checked_at = NOW() WHERE id = $1 AND rss_status = 'unknown'`, [outletId]);
      return { status: 'no-website' };
    }
    url = found.url;
    await pool.query('UPDATE pr_outlets SET url = COALESCE(url, $2) WHERE id = $1', [outletId, url]);
  }
  // Now that we have a URL, try to find the feed.
  if (rssDiscover?.findForOutlet) {
    try { const r = await rssDiscover.findForOutlet(outletId); return { status: r.rss_status, url, rss_url: r.rss_url }; }
    catch (e) { log(`outletResolve: feed find failed for ${outletId} — ${e.message}`); }
  }
  return { status: 'website-only', url };
}

// Nightly / on-demand: resolve websites for outlets that have none, then find
// their feeds. Bounded per run so the 2000-outlet backlog clears over several
// nights without one giant job, and cost stays predictable.
async function sweepMissing({ limit = 120, log = () => {} } = {}) {
  const { rows } = await pool.query(
    `SELECT o.id FROM pr_outlets o
      WHERE o.merged_into IS NULL
        AND o.rss_status = 'unknown'
        AND (o.url IS NULL OR o.url = '')
        AND (o.domain IS NULL OR o.domain = '')
      ORDER BY (SELECT COUNT(*) FROM pr_editorial_log l WHERE l.outlet_id = o.id) DESC,
               o.rss_checked_at NULLS FIRST
      LIMIT $1`,
    [limit]
  );
  const budget = require('./budget');
  let websites = 0, feeds = 0, checked = 0, budgetStopped = false;
  for (const r of rows) {
    // Budget gate, per outlet. This path calls the Anthropic SDK directly (it
    // needs web_search, which callClaude does not expose), so neither the
    // global cap nor the Pause switch sees it. Without this check the task
    // budget counted the spend but never stopped it: 150 outlets a night at
    // roughly 2.3c each ran a $10 monthly budget to $20.75 and kept going.
    if (await budget.taskCapReached('media_research')) { budgetStopped = true; break; }
    try {
      const out = await resolveAndFind(r.id, { log });
      checked++;
      if (out.url) websites++;
      if (out.status === 'found') feeds++;
    } catch (e) { log(`outletResolve.sweepMissing: ${r.id} failed: ${e.message}`); }
  }
  log(`outletResolve.sweepMissing: ${checked} checked, ${websites} websites found, ${feeds} feeds found` +
      (budgetStopped ? ' — stopped early, monthly budget for media research reached' : ''));
  return { checked, scanned: rows.length, websites, feeds, budget_stopped: budgetStopped };
}

module.exports = { resolveOne, resolveAndFind, sweepMissing, cleanUrl };
