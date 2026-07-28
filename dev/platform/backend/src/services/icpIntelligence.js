// AI Sniper funnel — Phase 1: the ICP Intelligence Pack.
//
// The real IP the method sells: LLM-compressed customer research that later
// feeds resonant creative. Follows the clientKickstart / strategyTemplates
// pattern — data-first, snapshot per client, the AM's raw inputs persisted so a
// re-tailor never wipes them, and a hard guardrail: if the inputs are thin the
// pack SAYS SO (status 'insufficient') rather than inventing a customer.
//
// Outputs one snapshot per client:
//   • awareness_map        — which of Schwartz's 5 stages the cold audience sits
//                            in → dictates how direct the ads can be.
//   • sophistication_level — 1–5 → dictates claim vs mechanism vs identity.
//   • voc                  — pains / desires / worldview in the prospect's own
//                            words, EXTRACTED from the inputs (never invented).
//   • competitor_angle     — the positioning gap to aim at.

const pool = require('../db');
const claudeService = require('./claude');

const AWARENESS_STAGES = ['unaware', 'problem-aware', 'solution-aware', 'product-aware', 'most-aware'];

function parseJson(raw) {
  if (!raw) throw new Error('Empty response');
  let s = String(raw).trim();
  // Strip accidental code fences.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // Fall back to the outermost braces if the model added stray prose.
  if (!s.startsWith('{')) { const a = s.indexOf('{'), b = s.lastIndexOf('}'); if (a >= 0 && b > a) s = s.slice(a, b + 1); }
  return JSON.parse(s);
}

function clamp15(n) { const v = parseInt(n, 10); return Number.isFinite(v) ? Math.min(5, Math.max(1, v)) : null; }
function strArr(a) { return Array.isArray(a) ? a.map(x => String(x).trim()).filter(Boolean).slice(0, 12) : []; }

async function getPack(clientId) {
  const { rows } = await pool.query('SELECT * FROM client_icp_intelligence WHERE client_id = $1', [clientId]);
  return rows[0] || null;
}

// Persist the AM's raw inputs without regenerating — cheap, no AI spend. Creates
// the row (status 'draft') if it doesn't exist yet.
async function saveInputs(clientId, { transcripts = '', notes = '', service_description = '' } = {}) {
  const inputs = {
    transcripts: String(transcripts || '').slice(0, 40000),
    notes: String(notes || '').slice(0, 20000),
    service_description: String(service_description || '').slice(0, 8000),
  };
  const { rows } = await pool.query(
    `INSERT INTO client_icp_intelligence (client_id, inputs, status, updated_at)
       VALUES ($1, $2, 'draft', NOW())
     ON CONFLICT (client_id) DO UPDATE SET inputs = $2, updated_at = NOW()
     RETURNING *`,
    [clientId, JSON.stringify(inputs)]
  );
  return rows[0];
}

// Build (or rebuild) the pack from the client profile + stored inputs.
async function tailor(clientId) {
  const { rows: cr } = await pool.query(
    'SELECT name, briefing_field, monthly_focus, domain, competitor_domains FROM clients WHERE id = $1', [clientId]
  );
  const c = cr[0];
  if (!c) { const e = new Error('Client not found.'); e.status = 404; throw e; }

  const existing = await getPack(clientId);
  const inputs = existing?.inputs || {};
  const transcripts = (inputs.transcripts || '').trim();
  const notes = (inputs.notes || '').trim();
  const serviceDesc = (inputs.service_description || '').trim();
  const competitors = Array.isArray(c.competitor_domains) ? c.competitor_domains : [];

  const system = `You are a direct-response strategist compressing raw customer research into an ICP Intelligence Pack for a marketing agency. Your job is EXTRACTION, not invention. Everything in "voc" must come from the supplied transcripts/notes in the customer's own language — if that material is thin or absent, say so via "sufficiency" and DO NOT fabricate pains or desires.

Frame two things precisely:
 - awareness stage (Eugene Schwartz's 5): one of ${AWARENESS_STAGES.join(', ')} — where the COLD audience sits, which dictates how direct the ads can be.
 - market sophistication (1–5): 1 = first to market (lead with the claim), 2 = bigger claim, 3 = new mechanism, 4 = better mechanism, 5 = identity/experience. This dictates the creative approach.

British English. JSON only — no prose, no code fences.`;

  const user = `Client: ${c.name}${c.domain ? ` (${c.domain})` : ''}
About the business: ${c.briefing_field || '(no brief set)'}
This month's focus: ${c.monthly_focus || '(none)'}
Known competitor domains: ${competitors.length ? competitors.join(', ') : '(none on record)'}

Service description (from the account manager):
${serviceDesc || '(none provided)'}

Call transcripts / customer quotes:
${transcripts || '(none provided)'}

Win-loss notes / other research:
${notes || '(none provided)'}

Produce the ICP Intelligence Pack. Extract VoC from the transcripts/notes only — quote the customer's language where you can. If the input is too thin to be confident, set sufficiency.sufficient=false and list exactly what's missing (e.g. "call transcripts", "a clear service description"), and give only what the material genuinely supports. Return ONLY:
{"awareness_map":{"stage":"one of the 5 stages","rationale":"why the cold audience sits here","directness":"how direct the ads should be as a result"},"sophistication_level":1,"sophistication_note":"why this level and what it means for creative","voc":{"pains":["in the prospect's own words"],"desires":["desired end state, their words"],"worldview":["beliefs/identity that shape how they buy"]},"competitor_angle":"the positioning gap to aim at vs the named competitors","sources":[{"kind":"transcript|notes|service_description|brief|competitors","label":"what was used"}],"sufficiency":{"sufficient":true,"missing":[]}}`;

  const raw = await claudeService.callClaude({
    max_tokens: 3000, system, user, feature: 'icp_intelligence', clientId,
  });
  const out = parseJson(raw);

  const awareness = out.awareness_map && typeof out.awareness_map === 'object' ? {
    stage: AWARENESS_STAGES.includes(out.awareness_map.stage) ? out.awareness_map.stage : null,
    rationale: out.awareness_map.rationale ? String(out.awareness_map.rationale) : null,
    directness: out.awareness_map.directness ? String(out.awareness_map.directness) : null,
  } : null;
  const voc = out.voc && typeof out.voc === 'object' ? {
    pains: strArr(out.voc.pains), desires: strArr(out.voc.desires), worldview: strArr(out.voc.worldview),
  } : { pains: [], desires: [], worldview: [] };
  const sufficiency = out.sufficiency && typeof out.sufficiency === 'object'
    ? { sufficient: !!out.sufficiency.sufficient, missing: strArr(out.sufficiency.missing) }
    : { sufficient: true, missing: [] };
  const status = sufficiency.sufficient ? 'ready' : 'insufficient';

  const { rows } = await pool.query(
    `INSERT INTO client_icp_intelligence
       (client_id, awareness_map, sophistication_level, sophistication_note, voc, competitor_angle, sources, sufficiency, status, generated_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
     ON CONFLICT (client_id) DO UPDATE SET
       awareness_map = $2, sophistication_level = $3, sophistication_note = $4, voc = $5,
       competitor_angle = $6, sources = $7, sufficiency = $8, status = $9, generated_at = NOW(), updated_at = NOW()
     RETURNING *`,
    [
      clientId, awareness ? JSON.stringify(awareness) : null,
      clamp15(out.sophistication_level), out.sophistication_note ? String(out.sophistication_note) : null,
      JSON.stringify(voc), out.competitor_angle ? String(out.competitor_angle) : null,
      JSON.stringify(Array.isArray(out.sources) ? out.sources.slice(0, 8) : []),
      JSON.stringify(sufficiency), status,
    ]
  );
  return rows[0];
}

module.exports = { getPack, saveInputs, tailor, AWARENESS_STAGES };
