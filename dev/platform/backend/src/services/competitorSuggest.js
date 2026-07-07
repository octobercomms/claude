// Competitor recommendations — a quick-start for the Paid → Competitors panel
// and the Admin Quick Start. Given the client's domain + brief, Claude proposes
// a short list of likely competitors (brand + domain + why), so the AM starts
// from a seeded list instead of a blank input. Shared: called by the
// competitor-ads route and by clientKickstart.
//
// One cheap Claude call, no external API. Deliberately not persisted — the AM
// picks which to actually look up / track.

const pool = require('../db');
const claudeService = require('./claude');

const SYSTEM = `You are a competitive-intelligence analyst at a UK marketing agency. Given a business, name its most relevant direct competitors — brands a customer would realistically compare it against or buy from instead. British English. Be concrete and current; never invent a brand you're not reasonably confident exists. Prefer real, findable companies with a website.

Return ONE JSON object, no prose, no code fences:
{ "competitors": [ { "name": "Brand", "domain": "brand.com", "reason": "one short sentence — why it's a competitor to this business" } ] }

Rules: 5–8 competitors, most relevant first. domain is the bare hostname (no scheme, no path), best-guess if you're not certain but plausible. Skip marketplaces/aggregators (Amazon, Etsy) unless they ARE the direct competitor. Skip the client itself.`;

async function suggestCompetitors(clientId) {
  const { rows } = await pool.query(
    'SELECT name, domain, briefing_field FROM clients WHERE id = $1', [clientId]
  );
  if (!rows.length) throw new Error('Client not found');
  const client = rows[0];

  const user = `Client: ${client.name}
Website: ${client.domain || '(none set)'}
What they do / brief:
${client.briefing_field || '(no brief — infer from the name and domain)'}

List this business's most relevant direct competitors. Return the JSON object only.`;

  const raw = await claudeService.callClaude({
    max_tokens: 1200,
    system: SYSTEM,
    user,
    feature: 'competitor_suggest',
    clientId,
  });
  const cleaned = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch { throw new Error('Claude returned malformed competitor JSON: ' + cleaned.slice(0, 200)); }

  const list = Array.isArray(parsed.competitors) ? parsed.competitors : [];
  const clientHost = normalizeHost(client.domain);
  const seen = new Set();
  return list
    .map(c => ({
      name: String(c.name || '').trim(),
      domain: normalizeHost(c.domain),
      reason: String(c.reason || '').trim(),
    }))
    .filter(c => {
      if (!c.name) return false;
      if (c.domain && c.domain === clientHost) return false;      // never the client itself
      const key = (c.domain || c.name).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function normalizeHost(input) {
  if (!input) return '';
  return String(input).trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

module.exports = { suggestCompetitors };
