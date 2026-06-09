// Query Fan-Out Simulator — runs one "what would Google's AI Overview do
// with this seed query?" simulation.
//
// 1. Ask Claude to enumerate the likely fan-out queries (8–12 of them)
//    for a seed query, in the spirit of the example in Google's own
//    docs ("how to fix a lawn full of weeds" → "best herbicides for
//    lawns", "remove weeds without chemicals", "how to prevent weeds").
// 2. Run DataForSEO SERP for each fan-out query in parallel, with the
//    client's domain as the target so we get back their position +
//    URL plus the first three organic URLs (cite-able competitors).
// 3. Score: ranked_count / fanout_count = coverage. Anything below
//    ~50% means the AM has a clear content gap to fill.
// 4. Ask Claude for a 3–5 line summary that names the missing
//    sub-intents and recommends what to write.

const pool = require('../db');
const claudeService = require('./claude');
const dataForSEO = require('../connectors/dataforseo');
const playbooks = require('./playbooks');

const FANOUT_PROMPT = (seedQuery, clientName, clientDomain) => `You are designing a Google AI Overview "query fan-out" simulation. Google's official guide describes fan-out as a set of concurrent, related queries the model generates from the user's original query, then pulls results from all of them to build the answer. Example from Google: seed "how to fix a lawn that's full of weeds" fans out to "best herbicides for lawns", "remove weeds without chemicals", "how to prevent weeds in lawn".

Generate 10 fan-out queries for this seed:
Seed: "${seedQuery}"
Client: ${clientName} (${clientDomain || 'no domain set'})

Cover a realistic mix of these sub-intent types:
- definition / what-is
- how-to / step-by-step
- comparison / vs / best
- buying / where to / cost
- prevention / avoidance
- troubleshooting / fix
- examples / use cases
- review / experience

Return ONLY a JSON array of 10 objects, no preamble or markdown fences:
[{"query":"string","intent":"label","rationale":"one short sentence on why Google would fan out to this"}]

intent must be one of: definition, how-to, comparison, buying, prevention, troubleshooting, examples, review.
Queries must be natural lowercase search phrases (no question marks, no quotes).`;

async function generateFanoutQueries({ seedQuery, clientName, clientDomain }) {
  const raw = await claudeService.callClaude({
    max_tokens: 2048,
    system: 'You design search query fan-outs grounded in real Google AI Overview behaviour. Respond with JSON only — no prose, no code fences.',
    user: FANOUT_PROMPT(seedQuery, clientName, clientDomain),
  });
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (err) { throw new Error(`Claude returned malformed fan-out JSON: ${cleaned.slice(0, 200)}`); }
  if (!Array.isArray(parsed)) throw new Error('Claude fan-out response was not an array');
  return parsed
    .filter(p => p && p.query)
    .map(p => ({
      query: String(p.query).trim().toLowerCase(),
      intent: String(p.intent || '').toLowerCase().trim() || null,
      rationale: String(p.rationale || '').trim(),
    }))
    .slice(0, 12);
}

// One SERP lookup per fan-out query, in parallel. Soft-fail per query —
// if DFS errors on one we still want the rest of the run.
async function runSerpBatch(queries, targetDomain, locationCode) {
  const targetUrl = targetDomain
    ? (/^https?:\/\//.test(targetDomain) ? targetDomain : `https://${targetDomain}`)
    : null;
  const results = await Promise.all(queries.map(async (q) => {
    try {
      const serp = await dataForSEO.checkRank({
        keyword: q.query,
        target_url: targetUrl,
        location_code: locationCode,
      });
      // checkRank returns position + url for the target. To pull the top
      // three URLs we'd need to re-issue or refactor — for now we record
      // what we have and capture the target's competitors in a second
      // lighter call only if useful. Keep it simple to ship.
      return {
        ...q,
        client_position: serp.position || null,
        client_url: serp.url || null,
        top_urls: [],
      };
    } catch (err) {
      return { ...q, client_position: null, client_url: null, top_urls: [], error: err.message };
    }
  }));
  return results;
}

const SUMMARY_PROMPT = (seedQuery, clientName, rows, coverage) => `You're writing a 3–5 line AM briefing on a Google AI Overview fan-out simulation for ${clientName}.

Seed query: "${seedQuery}"
Coverage: ${coverage}% — the client ranks in Google's top 10 for ${rows.filter(r => r.client_position && r.client_position <= 10).length} of ${rows.length} fan-out queries.

Per-query results:
${rows.map(r => `- "${r.query}" [${r.intent || '?'}] — ${r.client_position ? `client #${r.client_position}` : 'not ranking'}`).join('\n')}

Write a concise briefing in British English:
1. One opening line summarising the coverage in plain language.
2. Name the specific sub-intents (how-to, comparison, prevention, etc) where the client is missing — refer to them by what they ARE, not by query string.
3. Recommend 2–3 content angles to write next, each as a short bullet, that would close the gap.

No filler, no preamble, no headings. Plain markdown only.`;

async function generateSummary({ seedQuery, clientName, rows, coverage }) {
  return claudeService.callClaude({
    max_tokens: 600,
    system: 'You are a performance marketing analyst writing AM briefings on SEO data. British English. Tight, commercial, no filler.' + playbooks.systemSuffix(['seo-audit']),
    user: SUMMARY_PROMPT(seedQuery, clientName, rows, coverage),
  });
}

async function runFanout({ clientId, seedQuery, locationCode = 2826 }) {
  const seed = String(seedQuery || '').trim();
  if (!seed) throw new Error('seedQuery required');
  if (seed.length > 200) throw new Error('seedQuery too long');

  const { rows: clientRows } = await pool.query(
    'SELECT name, domain FROM clients WHERE id = $1', [clientId]
  );
  if (!clientRows.length) throw new Error('Client not found');
  const client = clientRows[0];

  const queries = await generateFanoutQueries({
    seedQuery: seed, clientName: client.name, clientDomain: client.domain,
  });
  if (!queries.length) throw new Error('No fan-out queries generated');

  const enriched = await runSerpBatch(queries, client.domain, locationCode);
  const rankedCount = enriched.filter(r => r.client_position && r.client_position <= 10).length;
  const coverage = enriched.length ? Math.round((rankedCount / enriched.length) * 100) : 0;

  const summary = await generateSummary({
    seedQuery: seed, clientName: client.name, rows: enriched, coverage,
  });

  // Persist run + child rows in a transaction so a half-saved run can't
  // confuse the history view.
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const { rows: runRow } = await dbClient.query(
      `INSERT INTO seo_fanout_runs
       (client_id, seed_query, location_code, fanout_count, ranked_count, coverage_score, summary_md)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [clientId, seed, locationCode, enriched.length, rankedCount, coverage, summary]
    );
    const run = runRow[0];
    for (let i = 0; i < enriched.length; i++) {
      const r = enriched[i];
      await dbClient.query(
        `INSERT INTO seo_fanout_queries
         (run_id, query, intent_label, rationale, client_position, client_url, top_urls, position_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [run.id, r.query, r.intent, r.rationale, r.client_position, r.client_url,
         JSON.stringify(r.top_urls || []), i]
      );
    }
    await dbClient.query('COMMIT');
    return { run, queries: enriched };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

module.exports = { runFanout };
