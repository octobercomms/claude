/**
 * Contact + publication enrichment (overnight, cheap, grounded).
 *
 * Grounding rule: we only enrich from real evidence — the story titles we've
 * actually logged for a contact — never "tell me about X" from nothing (that
 * hallucinates for the long tail). Contacts with no coverage are skipped by the
 * batch and only enriched on demand (when someone opens their profile), where a
 * caller can supply fetched bylines.
 *
 * Cost discipline: Haiku, chunked, run from the overnight scheduler. Re-enriches
 * only stale/never-enriched rows.
 */
const db = require('../db');
let claude; try { claude = require('./claude'); } catch (e) { claude = null; }
let dataforseo; try { dataforseo = require('../connectors/dataforseo'); } catch (e) { dataforseo = null; }

const HAIKU = 'claude-haiku-4-5-20251001';
const STALE_DAYS = 180; // re-enrich at most twice a year unless new coverage lands

function parseJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : {}; } catch { return {}; }
}

/**
 * Enrich one contact from their logged coverage (+ optional extra context, e.g.
 * fetched bylines for the on-demand long-tail path). Writes beats/topics/note.
 */
async function enrichContact(contactId, { extraContext = '' } = {}) {
  if (!claude || !claude.callClaude) return { error: 'Claude not configured.' };
  const c = (await db.query(
    `SELECT c.id, TRIM(CONCAT(c.first_name,' ',c.last_name)) AS name, o.name AS outlet
     FROM outreach_contacts c LEFT JOIN pr_outlets o ON o.id = c.outlet_id WHERE c.id = $1`, [contactId]
  )).rows[0];
  if (!c) return { error: 'Contact not found.' };
  const titles = (await db.query(
    "SELECT story_title FROM pr_editorial_log WHERE contact_id = $1 AND story_title <> '' ORDER BY COALESCE(issue_date, request_date) DESC NULLS LAST LIMIT 40",
    [contactId]
  )).rows.map((r) => r.story_title);

  if (!titles.length && !extraContext) return { skipped: 'no-evidence' };

  const system = 'You profile journalists from the headlines they have written. British English. Only infer from the evidence given — do not invent. Return JSON only.';
  let prompt = `Journalist: ${c.name || 'unknown'}${c.outlet ? ` (${c.outlet})` : ''}\n`;
  if (titles.length) { prompt += `\nHeadlines they've written:\n`; titles.forEach((t) => { prompt += `- ${t}\n`; }); }
  if (extraContext) prompt += `\nAdditional context:\n${extraContext}\n`;
  prompt += `\nFrom ONLY this evidence, return JSON:
{"beats":["3-6 short beat tags, lowercase"],"topics":["specific recurring subjects/interests"],"note":"one sentence on what they cover","confidence":0.0-1.0}
Confidence reflects how much evidence you had (few headlines = low). If there's too little to tell, return empty arrays and confidence 0.`;

  try {
    const d = parseJson(await claude.callClaude({ max_tokens: 400, system, user: prompt, model: HAIKU }));
    const beats = Array.isArray(d.beats) ? d.beats.map((s) => String(s).trim().toLowerCase()).filter(Boolean).slice(0, 8) : [];
    const topics = Array.isArray(d.topics) ? d.topics.map((s) => String(s).trim()).filter(Boolean).slice(0, 12) : [];
    const conf = typeof d.confidence === 'number' ? Math.max(0, Math.min(1, d.confidence)) : 0;
    await db.query(
      `UPDATE outreach_contacts
         SET beats = $1, topics = $2, enrichment_note = $3, enrichment_conf = $4, last_enriched_at = NOW()
       WHERE id = $5`,
      [JSON.stringify(beats), JSON.stringify(topics), String(d.note || '').slice(0, 400), conf, contactId]
    );
    return { enriched: true, beats, topics, note: d.note || '', confidence: conf };
  } catch (e) { return { error: e.message }; }
}

/** Overnight: enrich press contacts with coverage that are new or stale. */
async function runEnrichmentBatch({ limit = 150 } = {}) {
  if (!claude || !claude.callClaude) return { enriched: 0, skipped: 'claude-not-configured' };
  const { rows } = await db.query(
    `SELECT c.id
     FROM outreach_contacts c
     WHERE c.kind IN ('media','industry')
       AND EXISTS (SELECT 1 FROM pr_editorial_log l WHERE l.contact_id = c.id AND l.story_title <> '')
       AND (c.last_enriched_at IS NULL OR c.last_enriched_at < NOW() - ($2 || ' days')::interval)
     ORDER BY c.last_enriched_at ASC NULLS FIRST
     LIMIT $1`,
    [limit, String(STALE_DAYS)]
  );
  let enriched = 0;
  for (const r of rows) { const out = await enrichContact(r.id); if (out.enriched) enriched += 1; }
  return { enriched, considered: rows.length };
}

// ── Publication tier auto-proposal (DA prior + Claude content quality) ───────

function tierFromDA(da) {
  if (da == null) return null;
  if (da >= 70) return '1';
  if (da >= 40) return '2';
  return '3';
}

/** Propose a tier for one outlet: DA as a prior, Claude judges from headlines. */
async function proposeOutletTier(outletId) {
  const o = (await db.query('SELECT id, name, domain FROM pr_outlets WHERE id = $1', [outletId])).rows[0];
  if (!o) return { error: 'Outlet not found.' };
  let da = null;
  if (dataforseo && o.domain) { try { da = await dataforseo.fetchDomainAuthority(o.domain); } catch { da = null; } }
  const daPrior = tierFromDA(typeof da === 'object' && da ? da.domain_authority ?? da.rank ?? null : da);

  if (!claude || !claude.callClaude) {
    if (daPrior) { await db.query('UPDATE pr_outlets SET tier = $1 WHERE id = $2 AND (tier IS NULL OR tier = $3)', [daPrior, outletId, '']); return { tier: daPrior, basis: 'da-only' }; }
    return { skipped: 'no-signal' };
  }
  const titles = (await db.query("SELECT story_title FROM pr_editorial_log WHERE outlet_id = $1 AND story_title <> '' LIMIT 25", [outletId])).rows.map((r) => r.story_title);
  const system = 'You tier publications for a PR team. T1 = premium/national/prestige titles; T2 = solid broad/trade/regional titles; T3 = blogs, microbloggers, low-authority sites. British English. Return JSON only.';
  let prompt = `Publication: ${o.name}\n`;
  if (o.domain) prompt += `Domain: ${o.domain}\n`;
  if (daPrior) prompt += `Domain-authority prior suggests tier ${daPrior} (a hint, not the answer — content quality matters more).\n`;
  if (titles.length) { prompt += `\nSample headlines:\n`; titles.forEach((t) => { prompt += `- ${t}\n`; }); }
  prompt += `\nReturn JSON: {"tier":"1|2|3","reason":"short"}`;
  try {
    const d = parseJson(await claude.callClaude({ max_tokens: 150, system, user: prompt, model: HAIKU }));
    const tier = ['1', '2', '3'].includes(String(d.tier)) ? String(d.tier) : daPrior;
    if (!tier) return { skipped: 'no-signal' };
    await db.query('UPDATE pr_outlets SET tier = $1 WHERE id = $2 AND (tier IS NULL OR tier = $3)', [tier, outletId, '']);
    return { tier, basis: 'claude+da' };
  } catch (e) { return { error: e.message }; }
}

/** Overnight: propose tiers for untiered outlets that have some coverage. */
async function runTierProposalBatch({ limit = 100 } = {}) {
  const { rows } = await db.query(
    `SELECT o.id FROM pr_outlets o
     WHERE o.merged_into IS NULL AND (o.tier IS NULL OR o.tier = '')
       AND EXISTS (SELECT 1 FROM pr_editorial_log l WHERE l.outlet_id = o.id)
     LIMIT $1`, [limit]
  );
  let set = 0;
  for (const r of rows) { const out = await proposeOutletTier(r.id); if (out.tier) set += 1; }
  return { set, considered: rows.length };
}

module.exports = { enrichContact, runEnrichmentBatch, proposeOutletTier, runTierProposalBatch };
