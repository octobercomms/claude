// Auto-sourcing — Claude researches the open web for companies that match a
// campaign's ICP and proposes them as prospects. Everything it finds lands in
// the approval queue as `source = auto` with the page it was found on
// (provenance always visible) — a human still approves every one. The search
// runs at Anthropic's end (the web_search tool), so it sidesteps our server's
// egress limits, exactly like the tender agent's sourcing.
//
// Model routing: research reads only PUBLIC company data, so it can run on the
// cheaper model via Settings → AI models (feature `outreach_research`). We call
// the Anthropic SDK directly here (not callClaude) because we need the
// web_search tool; DeepSeek has no equivalent, so if the feature is routed to
// DeepSeek we simply stay on Claude for this one call and note it.

const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../../db');
const aiModels = require('../aiModels');
const { recordClaudeCost } = require('../costLog');
const score = require('./score');
const suppression = require('./suppression');

const FALLBACK_MODEL = 'claude-sonnet-4-6';

function buildPrompt(campaign, maxResults) {
  return `You are a B2B prospect researcher for a selective, trust-first outbound programme. Find real companies that fit this ideal-customer profile, using web search to identify them and read their sites.

IDEAL CUSTOMER (only propose genuine fits):
${campaign.icp || '(no ICP set — be conservative and propose only obvious fits)'}

HARD DISQUALIFIERS (never propose a company matching any of these):
${campaign.disqualifiers || '(none set)'}

Rules:
- Only REAL companies you can find on the open web. Never invent a company, person, or email.
- Prefer a named contact and a role, but only if you can actually find them. If you can't find a real email, leave it null — do NOT guess an address.
- For each, capture ONE specific, true, recent fact (a launch, an award, an expansion, a new site) that an opener could genuinely reference.
- Provenance is required: "source_url" must be a real page you actually read.

Return up to ${maxResults} companies. Output ONLY a JSON array (in a \`\`\`json code block):
[
  {
    "company": "company name",
    "website": "https://…",
    "contact_name": "a real named contact or null",
    "role": "their role or null",
    "email": "a real, found email or null (never guessed)",
    "one_fact": "one specific true recent fact to reference",
    "source_url": "the page you actually read to find this"
  }
]
No commentary outside the JSON block. If you genuinely find nothing suitable, return [].`;
}

function extractArray(text) {
  if (!text) return [];
  const fence = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*(\[[\s\S]*?\])\s*```/);
  const tryParse = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : null; } catch { return null; } };
  if (fence) { const v = tryParse(fence[1].trim()); if (v) return v; }
  const start = text.lastIndexOf('['); const end = text.lastIndexOf(']');
  if (start !== -1 && end > start) { const v = tryParse(text.slice(start, end + 1)); if (v) return v; }
  return [];
}

function normEmail(e) { return String(e || '').toLowerCase().trim() || null; }

// Ask Claude for prospect candidates for a campaign. Returns the raw normalised
// candidate objects (no DB writes).
async function findCandidates(campaign, { maxResults = 15, maxSearches = 8, log = () => {} } = {}) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) { log('research: CLAUDE_API_KEY not set'); return []; }
  // Respect the routing where possible; web_search needs Claude, so fall back
  // to Sonnet when the feature is pointed at a non-Anthropic model.
  let model = FALLBACK_MODEL;
  try {
    const chosen = await aiModels.resolveModel('outreach_research');
    if (aiModels.MODELS[chosen]?.provider === 'anthropic') model = chosen;
  } catch { /* use fallback */ }

  const client = new Anthropic({ apiKey: key });
  let message;
  try {
    message = await client.messages.create({
      model,
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches }],
      messages: [{ role: 'user', content: buildPrompt(campaign, maxResults) }],
    });
  } catch (e) { log(`research failed: ${e.message}`); return []; }
  try { recordClaudeCost({ model, response: message, feature: 'outreach_research', clientId: campaign.client_id }); } catch { /* non-fatal */ }

  const text = (message.content || []).filter(b => b.type === 'text' && b.text).map(b => b.text).join('\n');
  const items = extractArray(text);
  log(`research: ${items.length} candidate(s) found`);
  return items.map(it => ({
    company: (it.company || '').trim() || null,
    website: (it.website || '').trim() || null,
    contact_name: (it.contact_name || '').trim() || null,
    role: (it.role || '').trim() || null,
    email: normEmail(it.email),
    one_fact: (it.one_fact || '').trim() || null,
    source_url: (it.source_url || '').trim() || null,
  })).filter(c => c.company);
}

// Full auto-source pass for a campaign: find candidates, drop duplicates and
// suppressed ones, fit-score each, and insert as `new` prospects in the queue.
// Returns { found, added }.
async function sourceCampaign(campaignId, { maxResults = 15, log = () => {} } = {}) {
  const { rows: crows } = await pool.query('SELECT * FROM prospecting_campaigns WHERE id = $1', [campaignId]);
  const campaign = crows[0];
  if (!campaign) throw new Error('Campaign not found');

  const candidates = await findCandidates(campaign, { maxResults, log });
  let added = 0;
  for (const c of candidates) {
    // Dedupe within the campaign by email (if present) else by company name.
    const dupe = await pool.query(
      `SELECT 1 FROM prospecting_prospects
        WHERE campaign_id = $1 AND (
          ($2::text IS NOT NULL AND lower(email) = $2) OR
          ($2::text IS NULL AND lower(company) = lower($3))
        ) LIMIT 1`,
      [campaignId, c.email, c.company]
    );
    if (dupe.rows.length) continue;
    if (c.email && await suppression.isSuppressed(campaign.client_id, c.email)) continue;

    let scored = { score: null, verdict: null, reasoning: null, one_fact: c.one_fact };
    try { scored = await score.scoreProspect(c, campaign, { clientId: campaign.client_id }); }
    catch (e) { log(`score failed for ${c.company}: ${e.message}`); }

    await pool.query(
      `INSERT INTO prospecting_prospects
         (campaign_id, company, contact_name, email, role, website, source, source_url,
          fit_score, fit_verdict, fit_reasoning, one_fact, state)
       VALUES ($1,$2,$3,$4,$5,$6,'auto',$7,$8,$9,$10,$11,'new')`,
      [campaignId, c.company, c.contact_name, c.email, c.role, c.website, c.source_url,
       scored.score, scored.verdict, scored.reasoning, scored.one_fact || c.one_fact]
    );
    added++;
  }
  try {
    await pool.query(
      `INSERT INTO prospecting_audit (client_id, actor, action, entity, entity_id, detail)
       VALUES ($1, 'system', 'source', 'campaign', $2, $3)`,
      [campaign.client_id, campaignId, JSON.stringify({ found: candidates.length, added })]
    );
  } catch { /* non-fatal */ }
  log(`research: campaign ${campaignId} — ${candidates.length} found, ${added} added to queue`);
  return { found: candidates.length, added };
}

// Cron entry — auto-source every active campaign (weekly; kept low-frequency
// because it's the paid web-search step, mirroring the tender agent's cadence).
async function sourceAllActive({ log = () => {} } = {}) {
  const { rows } = await pool.query(`SELECT id FROM prospecting_campaigns WHERE status = 'active'`);
  let total = 0;
  for (const r of rows) {
    try { const out = await sourceCampaign(r.id, { log }); total += out.added; }
    catch (e) { log(`sourceCampaign ${r.id} failed: ${e.message}`); }
  }
  return { campaigns: rows.length, added: total };
}

module.exports = { findCandidates, sourceCampaign, sourceAllActive, extractArray };
