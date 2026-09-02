// "Find me the best contacts for this press release." Ranks journalists by how
// well what they actually write about (hand-set beats + coverage topics +
// article-learned auto_topics + their recent headlines) matches the release —
// weighted by recency of relevant output and prior coverage of this client.
//
// v1 is keyword/beat + recency: explainable, no new infra, ships now. The one
// model call is a cheap topic-extraction from the release; the ranking itself
// is deterministic SQL + scoring, so it scales to the whole database.

const db = require('../db');
let claude; try { claude = require('./claude'); } catch { claude = null; }

const STOP = new Set('the a an and or of to for in on with from this that these those is are be as it its their they our your you we press release announces announced today new launch launches'.split(' '));

function parseJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : {}; } catch { return {}; }
}

// Pull the topics a release is about. Prefer the model (gets multi-word beats
// and synonyms); fall back to a keyword skim if it's unavailable.
async function extractTerms(text) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  if (claude && claude.callClaude) {
    try {
      const d = parseJson(await claude.callClaude({
        feature: 'press_match', max_tokens: 300,
        system: 'You extract the specific topics a press release is about, so it can be matched to journalists who cover those beats. British English. Return JSON only.',
        user: `Press release / pitch:\n"""\n${clean.slice(0, 6000)}\n"""\n\nReturn JSON: {"topics":["6-12 short lowercase topic phrases a journalist might list as a beat — be specific, e.g. 'hospitality design', 'sustainable materials', not 'business'"]}`,
      }));
      const topics = Array.isArray(d.topics) ? d.topics.map((s) => String(s).trim().toLowerCase()).filter(Boolean) : [];
      if (topics.length) return [...new Set(topics)].slice(0, 14);
    } catch { /* fall through to keyword skim */ }
  }
  const freq = new Map();
  for (const w of clean.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
    if (w.length < 4 || STOP.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => w);
}

// Rank journalists for a release. visibleClientIds scopes to what the caller can
// see (null = admin/all). clientId (optional) boosts journalists who've covered
// that client before. Returns { terms, items:[…ranked] }.
async function matchForText(text, { visibleClientIds = null, clientId = null, limit = 40 } = {}) {
  const terms = await extractTerms(text);
  if (!terms.length) return { terms: [], items: [] };

  const params = [];
  params.push(clientId); const clientIdx = `$${params.length}`;   // may be null
  let visibility = '';
  if (visibleClientIds !== null && visibleClientIds !== undefined) {
    params.push(visibleClientIds);
    visibility = `AND EXISTS (SELECT 1 FROM outreach_contact_clients m
                               WHERE m.contact_id = c.id AND m.client_id = ANY($${params.length}::uuid[]))`;
  }
  params.push(terms.map((t) => `%${t}%`)); const likeIdx = `$${params.length}`;

  const { rows } = await db.query(
    `SELECT c.id, TRIM(CONCAT(c.first_name,' ',c.last_name)) AS name, c.email, c.verification_status,
            o.name AS outlet, o.tier, c.beats, c.topics, c.auto_topics,
            (SELECT string_agg(s.t, ' | ') FROM (
               SELECT title AS t FROM pr_outlet_articles
                WHERE contact_id = c.id AND title IS NOT NULL AND btrim(title) <> ''
                ORDER BY published_at DESC NULLS LAST LIMIT 8) s) AS recent_titles,
            (SELECT MAX(published_at) FROM pr_outlet_articles WHERE contact_id = c.id) AS last_article,
            CASE WHEN ${clientIdx}::uuid IS NULL THEN false
                 ELSE EXISTS (SELECT 1 FROM pr_editorial_log l WHERE l.contact_id = c.id AND l.client_id = ${clientIdx}::uuid)
            END AS covered_client
       FROM outreach_contacts c
       LEFT JOIN pr_outlets o ON o.id = c.outlet_id
      WHERE c.kind IN ('media','industry') AND c.merged_into IS NULL
        AND c.email IS NOT NULL AND c.email <> '' AND c.bounced_at IS NULL
        ${visibility}
        AND lower(coalesce(c.beats::text,'') || ' ' || coalesce(c.topics::text,'') || ' ' || coalesce(c.auto_topics::text,''))
            LIKE ANY(${likeIdx}::text[])
      LIMIT 2000`,
    params
  );

  const now = Date.now();
  const scored = [];
  for (const r of rows) {
    const declared = `${JSON.stringify(r.beats || [])} ${JSON.stringify(r.topics || [])} ${JSON.stringify(r.auto_topics || [])}`.toLowerCase();
    const titles = String(r.recent_titles || '').toLowerCase();
    let score = 0;
    const matched = [];
    for (const t of terms) {
      if (declared.includes(t)) { score += 3; matched.push(t); }
      else if (titles.includes(t)) { score += 1; matched.push(t); }
    }
    if (!matched.length) continue;
    if (r.covered_client) score += 2;
    if (r.last_article && (now - new Date(r.last_article).getTime()) < 120 * 864e5) score += 1;
    if (String(r.tier) === '1') score += 1;
    scored.push({
      id: r.id, name: r.name, email: r.email, verification_status: r.verification_status,
      outlet: r.outlet || '', tier: r.tier || null,
      score, matched: [...new Set(matched)],
      covered_client: !!r.covered_client,
      last_article: r.last_article,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return { terms, items: scored.slice(0, limit) };
}

module.exports = { extractTerms, matchForText };
