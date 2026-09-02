// Journalist Discovery Scout — Claude as the account exec's talent-finder.
// On a schedule (and on demand) it researches the open web for NEW journalists
// who cover a client's sector/beats and aren't in the media DB yet, and drops
// each into a review queue (pr_journalist_suggestions) with provenance. A human
// approves every one before it becomes a real media contact. The web_search
// runs at Anthropic's end, so it sidesteps our egress limits — same proven
// pattern as the prospecting scout (services/prospecting/research.js) and the
// media-DB researcher (pressMediaResearch).
//
// Complements pressMediaResearch, which keeps EXISTING journalists current
// (moves / gone-quiet / archive). This one finds people the list is missing.

const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../db');
const aiModels = require('./aiModels');
const { recordClaudeCost } = require('./costLog');
const pr = require('./pr');

const FALLBACK_MODEL = 'claude-sonnet-4-6';

async function model() {
  try {
    const chosen = await aiModels.resolveModel('media_db_research');
    if (aiModels.MODELS[chosen]?.provider === 'anthropic') return chosen;
  } catch { /* fall through */ }
  return FALLBACK_MODEL;
}

// Build the search brief for a client: who they are + what beats already cover
// them, so the scout looks for more of the right kind of journalist.
async function buildContext(clientId) {
  const { rows: crows } = await pool.query(
    'SELECT id, name, briefing_field, monthly_focus FROM clients WHERE id = $1',
    [clientId]
  );
  if (!crows.length) return null;
  const client = crows[0];

  // Beats/tags of the journalists already on this client's list. `beats` is
  // JSONB and `tags` is text[], so pull each with its own accessor and union.
  const { rows: beatRows } = await pool.query(
    `SELECT DISTINCT b AS beat FROM (
        SELECT jsonb_array_elements_text(COALESCE(c.beats, '[]'::jsonb)) AS b
          FROM outreach_contacts c
          JOIN outreach_contact_clients m ON m.contact_id = c.id
         WHERE m.client_id = $1 AND c.kind = 'media'
        UNION
        SELECT unnest(COALESCE(c.tags, ARRAY[]::text[])) AS b
          FROM outreach_contacts c
          JOIN outreach_contact_clients m ON m.contact_id = c.id
         WHERE m.client_id = $1 AND c.kind = 'media'
      ) t
      WHERE b IS NOT NULL AND btrim(b) <> ''
      LIMIT 40`,
    [clientId]
  );
  const beats = beatRows.map(r => (r.beat || '').trim()).filter(Boolean);

  // Recent coverage story titles + the outlets that ran them — real signal for
  // "what gets this client covered".
  const { rows: covRows } = await pool.query(
    `SELECT l.story_title, o.name AS outlet
       FROM pr_editorial_log l
       LEFT JOIN pr_outlets o ON o.id = l.outlet_id
      WHERE l.client_id = $1 AND l.story_title IS NOT NULL AND l.story_title <> ''
      ORDER BY COALESCE(l.issue_date, l.request_date, l.created_at) DESC
      LIMIT 12`,
    [clientId]
  );
  const coverage = covRows.map(r => `${r.story_title}${r.outlet ? ` (${r.outlet})` : ''}`);
  const outlets = [...new Set(covRows.map(r => (r.outlet || '').trim()).filter(Boolean))];

  return { client, beats, coverage, outlets };
}

function buildPrompt(ctx, maxResults) {
  const { client, beats, coverage, outlets } = ctx;
  return `You are a PR account executive building a media list for a client. Using web search, find REAL, currently-active journalists, editors or contributors who would plausibly cover this client — people who are NOT already on the list below.

CLIENT: ${client.name}
WHAT THEY DO: ${client.briefing_field || client.monthly_focus || '(no briefing — infer from the beats/coverage below)'}

BEATS ALREADY COVERED (find MORE journalists on these and adjacent beats): ${beats.length ? beats.join(', ') : '(none recorded)'}
OUTLETS THAT HAVE COVERED THEM: ${outlets.length ? outlets.join(', ') : '(none recorded)'}
RECENT COVERAGE (the kind of story that lands): ${coverage.length ? coverage.slice(0, 8).join('; ') : '(none recorded)'}

Rules:
- Only REAL journalists you can verify on the open web via a recent byline. Never invent a person, outlet, or email.
- Prefer people writing NOW (a byline in roughly the last 12 months). Skip anyone who looks retired or off the beat.
- Do NOT propose generic "editorial@" inboxes as people. If you can't find a real personal email, leave email null — never guess one.
- Each must have ONE specific, true reason they fit: a recent relevant article they wrote (with its outlet).
- Provenance is required: "source_url" must be a real page you actually read (ideally the byline/article).
- Aim for range across outlets and tiers, not five people at one publication.

Return up to ${maxResults} journalists. Output ONLY a JSON array (in a \`\`\`json code block):
[
  {
    "name": "journalist full name",
    "outlet": "the outlet they write for now",
    "beat": "their beat in a few words (e.g. 'interiors & design')",
    "email": "a real, found personal email or null (never guessed)",
    "why": "one specific true reason — a recent relevant article and its outlet",
    "source_url": "the page you actually read"
  }
]
No commentary outside the JSON block. If you genuinely find nobody suitable and new, return [].`;
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

// Ask Claude for journalist candidates. Returns normalised objects (no writes).
async function findCandidates(ctx, { maxResults = 12, maxSearches = 8, log = () => {} } = {}) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) { log('journalistScout: CLAUDE_API_KEY not set'); return []; }
  const m = await model();
  const client = new Anthropic({ apiKey: key });
  let message;
  try {
    message = await client.messages.create({
      model: m,
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches }],
      messages: [{ role: 'user', content: buildPrompt(ctx, maxResults) }],
    });
  } catch (e) { log(`journalistScout research failed: ${e.message}`); return []; }
  try { recordClaudeCost({ model: m, response: message, feature: 'media_db_research', clientId: ctx.client.id }); } catch { /* non-fatal */ }

  const text = (message.content || []).filter(b => b.type === 'text' && b.text).map(b => b.text).join('\n');
  return extractArray(text).map(it => ({
    name: (it.name || '').trim() || null,
    outlet: (it.outlet || '').trim() || null,
    beat: (it.beat || '').trim() || null,
    email: normEmail(it.email),
    why: (it.why || '').trim() || null,
    source_url: (it.source_url || '').trim() || null,
  })).filter(c => c.name);
}

// True if this candidate is already a media contact anywhere in the workspace,
// or already a live suggestion for this client — so we never surface a dupe.
async function isKnown(clientId, c) {
  if (c.email) {
    const { rows } = await pool.query(
      `SELECT 1 FROM outreach_contacts WHERE lower(email) = $1 AND kind IN ('media','industry') LIMIT 1`,
      [c.email]
    );
    if (rows.length) return true;
  }
  // Name + outlet match against the media DB.
  const { rows: byName } = await pool.query(
    `SELECT 1 FROM outreach_contacts c
       LEFT JOIN pr_outlets o ON o.id = c.outlet_id
      WHERE c.kind IN ('media','industry')
        AND lower(c.name) = lower($1)
        AND ($2 = '' OR lower(COALESCE(o.name, c.company, '')) = lower($2))
      LIMIT 1`,
    [c.name, c.outlet || '']
  );
  if (byName.length) return true;
  // Already suggested (new or added) for this client.
  const { rows: sugg } = await pool.query(
    `SELECT 1 FROM pr_journalist_suggestions
      WHERE client_id = $1 AND status IN ('new','added')
        AND ( ($2::text IS NOT NULL AND lower(email) = $2)
              OR (lower(name) = lower($3) AND lower(COALESCE(outlet,'')) = lower($4)) )
      LIMIT 1`,
    [clientId, c.email, c.name, c.outlet || '']
  );
  return sugg.length > 0;
}

// Full discovery pass for one client: find candidates, drop known/dupes, queue
// the rest as 'new' for review. Returns { found, added }.
async function scoutClient(clientId, { maxResults = 12, log = () => {} } = {}) {
  const ctx = await buildContext(clientId);
  if (!ctx) throw new Error('Client not found');

  const candidates = await findCandidates(ctx, { maxResults, log });
  let added = 0;
  for (const c of candidates) {
    if (await isKnown(clientId, c)) continue;
    await pool.query(
      `INSERT INTO pr_journalist_suggestions
         (client_id, name, outlet, beat, email, why, source_url, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'new')`,
      [clientId, c.name, c.outlet, c.beat, c.email, c.why, c.source_url]
    );
    added++;
  }
  log(`journalistScout: client ${clientId} — ${candidates.length} found, ${added} queued`);
  return { found: candidates.length, added };
}

// Cron entry — scout every press-active client (has at least one press release).
// Low-frequency (weekly) because it's the paid web-search step.
async function scoutAllActive({ log = () => {} } = {}) {
  const { rows } = await pool.query(
    `SELECT DISTINCT client_id FROM outreach_press_releases WHERE client_id IS NOT NULL`
  );
  let total = 0;
  for (const r of rows) {
    try { const out = await scoutClient(r.client_id, { log }); total += out.added; }
    catch (e) { log(`scoutClient ${r.client_id} failed: ${e.message}`); }
  }
  return { clients: rows.length, added: total };
}

module.exports = { buildContext, findCandidates, scoutClient, scoutAllActive, extractArray };
