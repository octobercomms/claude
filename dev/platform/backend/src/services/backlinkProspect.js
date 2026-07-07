// Backlink prospecting → Outreach hand-off. Pipeline → Promote step 5.
//
// "Automated backlinks" reframed for safety: scrape sites linking to
// competitors via DataForSEO Backlinks, score by relevance + DA, then
// push the best as a campaign in the existing Outreach engine. Each
// link is EARNED through a real pitch — no purchased / network links,
// no comment spam, no PBNs. That's the only version Google doesn't
// punish ("scaled link spam" policy).
//
// AVAILABILITY: DFS Backlinks endpoint is on a $100/mo commitment we
// don't hold pre-1-July-2026. dfsAvailability.isUnlocked() gates the
// API call. Pre-cutover the route returns a 503 with a friendly
// message; the UI shows "Available 1 July 2026 — feature ready".

const pool = require('../db');
const dataForSEO = require('../connectors/dataforseo');
const { isUnlocked } = require('./dfsAvailability');

// Composite relevance score 0-100. Domain rank is the strongest signal
// we have without crawling the page; we cap its influence so a high-DA
// site irrelevant to the niche doesn't outrank a perfectly relevant
// medium-DA blog. Future versions could add a niche-similarity score
// from page topic embeddings.
function score(prospect) {
  const dr = Math.min(prospect.domain_rank || 0, 100);
  let s = Math.round(dr * 0.7);
  if (prospect.competitor_domain) s += 15;       // we know who they link to
  if (prospect.source_page_title) s += 5;         // page is real content, not a redirect
  return Math.min(100, Math.max(0, s));
}

// Pull competitors' backlinks via DFS, dedupe, score, persist as
// prospects. The actual outreach happens in the existing Outreach
// suite — this just feeds it.
async function prospectFromCompetitors({ clientId, limitPerCompetitor = 50 }) {
  if (!isUnlocked()) {
    const err = new Error('DataForSEO Backlinks is gated until 1 July 2026 — the feature is built and ready, but the API costs are locked until then.');
    err.status = 503;
    throw err;
  }
  const { rows: clientRows } = await pool.query(
    'SELECT name, domain, competitor_domains FROM clients WHERE id = $1', [clientId]
  );
  if (!clientRows.length) throw new Error('Client not found');
  const client = clientRows[0];
  if (!client.competitor_domains?.length) {
    throw new Error('No competitor domains set — add them on the Content Gaps tab first');
  }

  const inserted = [];
  for (const competitor of client.competitor_domains.slice(0, 5)) {
    try {
      // DFS endpoint: /backlinks/backlinks/live — returns links pointing
      // to the target domain. We sort by domain rank descending and cap
      // at limitPerCompetitor.
      const dfsClient = await dataForSEO._getClient?.() || null;
      // Use the generic fetch by reusing fetchBacklinkData's shape — but
      // we need the full list, not just summary. Add a thin wrapper:
      const list = await fetchBacklinksList(competitor, limitPerCompetitor);
      for (const link of list) {
        const prospect = {
          client_id: clientId,
          source_domain: link.source_domain,
          source_url: link.source_url || null,
          source_page_title: link.page_title || null,
          competitor_domain: competitor,
          domain_rank: link.domain_rank || null,
          tactic: 'competitor_link',
        };
        prospect.relevance_score = score(prospect);
        try {
          const { rows } = await pool.query(
            `INSERT INTO backlink_prospects
             (client_id, source_domain, source_url, source_page_title, competitor_domain, domain_rank, relevance_score, tactic)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (client_id, source_domain, COALESCE(source_url, '')) DO NOTHING
             RETURNING *`,
            [prospect.client_id, prospect.source_domain, prospect.source_url, prospect.source_page_title,
             prospect.competitor_domain, prospect.domain_rank, prospect.relevance_score, prospect.tactic]
          );
          if (rows.length) inserted.push(rows[0]);
        } catch (insertErr) {
          console.error('[backlinkProspect] insert failed:', insertErr.message);
        }
      }
    } catch (err) {
      console.error(`[backlinkProspect] ${competitor} fetch failed:`, err.message);
    }
  }
  return inserted;
}

// Thin wrapper around the DFS Backlinks list endpoint. Lives here
// rather than the connector because it's only used by this service —
// keeps the connector exports tight.
async function fetchBacklinksList(domain, limit) {
  // Build the request through the existing connector's client so we
  // pick up auth + the unlock gate.
  const axios = require('axios');
  const { getSetting } = require('../utils/settings');
  const { resolveCreds } = require('../connectors/dataforseo');
  const login = await getSetting('DATAFORSEO_LOGIN');
  const password = await getSetting('DATAFORSEO_PASSWORD');
  if (!login || !password) throw new Error('DataForSEO not configured');
  const creds = resolveCreds(login, password);
  const cleanDomain = String(domain).trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase();
  const { data } = await axios.post(
    'https://api.dataforseo.com/v3/backlinks/backlinks/live',
    [{
      target: cleanDomain,
      limit,
      mode: 'as_is',
      order_by: ['rank,desc'],
      filters: [['dofollow', '=', true]],
    }],
    { auth: { username: creds.username, password: creds.password } }
  );
  const items = data.tasks?.[0]?.result?.[0]?.items || [];
  return items.map(i => ({
    source_domain: i.domain_from || null,
    source_url: i.url_from || null,
    page_title: i.page_from_title || null,
    domain_rank: i.rank || null,
  })).filter(x => x.source_domain);
}

module.exports = { prospectFromCompetitors, score };
