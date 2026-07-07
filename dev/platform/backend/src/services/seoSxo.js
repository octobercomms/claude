// SXO (Search Experience Optimisation) analyser — Integration F.
//
// "Read the SERP backwards": fetch the top organic results for a query, infer
// the page-type Google is rewarding, score the intent from a few personas, note
// whether the client is present, and recommend the winning page-type wireframe.
// The wireframe feeds straight into the Build → Brief step. Ephemeral — one
// Claude call + one DFS SERP call per run, no persistence. Methodology grounded
// in the sxo playbook (mined MIT from claude-seo + seranking/seo-skills).

const pool = require('../db');
const claudeService = require('./claude');
const dataForSEO = require('../connectors/dataforseo');
const playbooks = require('./playbooks');

function hostOf(u) {
  try { return new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return null; }
}

const SYSTEM = `You are a Search Experience Optimisation (SXO) analyst at a UK marketing agency. You read a SERP backwards: the page-types ranking now reveal what Google thinks searchers want. British English. Specific, commercial, no filler, no AI tells. Return ONE JSON object and nothing else.

Schema:
{
  "dominant_page_type": "listicle" | "how-to guide" | "in-depth guide" | "product page" | "category / collection" | "comparison" | "free tool / calculator" | "landing page" | "forum / UGC" | "video" | "news" | "mixed",
  "confidence": "low" | "medium" | "high",
  "page_type_evidence": "one sentence citing what in the SERP tells you this",
  "personas": [                        // 3 realistic searchers for this query
    { "name": "short label", "wants": "what this searcher wants", "served_by_serp": "yes" | "partial" | "no" }
  ],
  "recommended_page_type": "the format the client should build to win this SERP",
  "recommended_wireframe": [           // 4–8 sections IN ORDER for that page-type
    { "section": "heading", "purpose": "one sentence on what it does for the searcher" }
  ],
  "summary": "2–4 sentence markdown: the format gap and what to build"
}`;

function buildPrompt({ seedQuery, clientName, clientDomain, serp, clientPresent }) {
  return `Query: "${seedQuery}"
Client: ${clientName}${clientDomain ? ` (${clientDomain})` : ''}
Client currently ranking in this top-${serp.length}: ${clientPresent ? 'YES' : 'no'}

Top organic results (rank · title · url):
${serp.map((r, i) => `${i + 1}. ${r.title || '(no title)'} — ${r.url}${r.description ? `\n   ${r.description.slice(0, 160)}` : ''}`).join('\n')}

Analyse the search experience. Infer the page-type Google rewards, score the intent from 3 personas, and give a recommended wireframe the client should build to win this SERP. Return the JSON object only.`;
}

async function runSxo({ clientId, seedQuery, locationCode = 2826 }) {
  const seed = String(seedQuery || '').trim();
  if (!seed) throw new Error('seedQuery required');
  if (seed.length > 200) throw new Error('seedQuery too long');

  const { rows } = await pool.query('SELECT name, domain FROM clients WHERE id = $1', [clientId]);
  if (!rows.length) throw new Error('Client not found');
  const client = rows[0];

  const serp = await dataForSEO.fetchTopSerpResults(seed, { locationCode, limit: 10 });
  if (!serp.length) throw new Error('No organic SERP results returned for that query.');

  const clientHost = hostOf(client.domain);
  const clientPresent = !!clientHost && serp.some(r => hostOf(r.url) === clientHost);

  const raw = await claudeService.callClaude({
    max_tokens: 2000,
    system: SYSTEM + playbooks.systemSuffix(['sxo', 'seo-audit']),
    user: buildPrompt({ seedQuery: seed, clientName: client.name, clientDomain: client.domain, serp, clientPresent }),
  });
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let analysis;
  try { analysis = JSON.parse(cleaned); }
  catch { throw new Error('Claude returned malformed SXO JSON: ' + cleaned.slice(0, 200)); }

  return {
    seed_query: seed,
    location_code: locationCode,
    client_present: clientPresent,
    dominant_page_type: analysis.dominant_page_type || null,
    confidence: analysis.confidence || null,
    page_type_evidence: analysis.page_type_evidence || null,
    personas: Array.isArray(analysis.personas) ? analysis.personas.slice(0, 4) : [],
    recommended_page_type: analysis.recommended_page_type || null,
    recommended_wireframe: Array.isArray(analysis.recommended_wireframe) ? analysis.recommended_wireframe.slice(0, 10) : [],
    summary: analysis.summary || null,
    serp: serp.map((r, i) => ({ rank: i + 1, url: r.url, title: r.title, is_client: hostOf(r.url) === clientHost })),
  };
}

module.exports = { runSxo };
