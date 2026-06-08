// URL-level keyword gap simulator. Pipeline → Find step 1.
//
// Workflow: AM finds a competitor blog post ranking #1 for the target
// query, pastes the URL, system returns every keyword that page ranks
// for (top 100) cross-referenced against the client's own ranks. Output:
// precise list of sub-topics to cover to outrank that specific page.
//
// Differs from Content Gaps (DFS Domain Intersection) which is
// domain-wide — this is page-specific. Cleaner workflow when the AM has
// already identified one good competitor article to beat.

const pool = require('../db');
const claudeService = require('./claude');
const dataForSEO = require('../connectors/dataforseo');

const SUMMARY_PROMPT = (competitorUrl, clientName, rows) => {
  const gaps = rows.filter(r => r.is_gap).slice(0, 25);
  return `You're advising ${clientName} on how to outrank a specific competitor page.

Competitor URL: ${competitorUrl}
That page ranks in Google's top 100 for ${rows.length} keywords. Of those, ${gaps.length} are gaps where ${clientName} either doesn't rank or ranks below position 10.

Top gap keywords (competitor position → client position):
${gaps.map(r => `- "${r.keyword}" (vol ${r.search_volume || '?'}) — competitor #${r.competitor_position}, client ${r.client_position ? '#' + r.client_position : 'not ranking'}`).join('\n')}

Write a tight briefing in British English:
1. One opening line summarising the gap.
2. Group the missing keywords into 3-5 sub-intent themes (how-to, definition, comparison, troubleshooting, etc) — call out what each theme covers.
3. Recommend 2-3 concrete content angles that would let ${clientName} outrank the competitor page on these themes. Each as a short bullet.

No filler, no preamble, no headings. Plain markdown only.`;
};

async function runUrlGap({ clientId, competitorUrl, locationCode = 2826 }) {
  const url = String(competitorUrl || '').trim();
  if (!url) throw new Error('competitorUrl required');
  if (!/^https?:\/\//i.test(url)) throw new Error('competitorUrl must be a full http(s) URL');

  const { rows: clientRows } = await pool.query(
    'SELECT name, domain FROM clients WHERE id = $1', [clientId]
  );
  if (!clientRows.length) throw new Error('Client not found');
  const client = clientRows[0];
  if (!client.domain) throw new Error('Client domain not set — add it on the client detail page first');

  // 1. Pull every keyword the competitor URL ranks for.
  const competitorKeywords = await dataForSEO.fetchKeywordsForUrl(url, locationCode, 200);
  if (!competitorKeywords.length) {
    throw new Error('DataForSEO returned no ranked keywords for that URL — page may be new, blocked from indexing, or outside the top 100 for any query');
  }

  // 2. Cross-reference: for each keyword, check where the client ranks.
  // checkRank is one DFS call per keyword (~$0.001 each). Cap at 50 to
  // keep cost predictable; bias toward higher-volume queries.
  const sorted = competitorKeywords
    .sort((a, b) => (b.search_volume || 0) - (a.search_volume || 0))
    .slice(0, 50);
  const clientDomain = client.domain;
  const targetUrl = /^https?:\/\//.test(clientDomain) ? clientDomain : `https://${clientDomain}`;
  const enriched = await Promise.all(sorted.map(async (kw) => {
    try {
      const clientRank = await dataForSEO.checkRank({
        keyword: kw.keyword,
        target_url: targetUrl,
        location_code: locationCode,
      });
      const clientPosition = clientRank.position || null;
      const isGap = !!(kw.position && kw.position <= 10) &&
                    (!clientPosition || clientPosition > 10);
      return {
        keyword: kw.keyword,
        search_volume: kw.search_volume,
        competitor_position: kw.position,
        client_position: clientPosition,
        is_gap: isGap,
      };
    } catch (err) {
      return {
        keyword: kw.keyword,
        search_volume: kw.search_volume,
        competitor_position: kw.position,
        client_position: null,
        is_gap: false,
        error: err.message,
      };
    }
  }));

  const gapCount = enriched.filter(r => r.is_gap).length;
  const summary = await claudeService.callClaude({
    max_tokens: 700,
    system: 'You are a performance marketing analyst writing AM briefings on SEO data. British English. Tight, commercial, no filler.',
    user: SUMMARY_PROMPT(url, client.name, enriched),
  });

  // Persist run + child rows in a transaction.
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows: runRow } = await db.query(
      `INSERT INTO url_gap_runs
       (client_id, competitor_url, location_code, page_keyword_count, gap_count, summary_md)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [clientId, url, locationCode, competitorKeywords.length, gapCount, summary]
    );
    const run = runRow[0];
    for (let i = 0; i < enriched.length; i++) {
      const r = enriched[i];
      await db.query(
        `INSERT INTO url_gap_keywords
         (run_id, keyword, search_volume, competitor_position, client_position, is_gap, position_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [run.id, r.keyword, r.search_volume, r.competitor_position, r.client_position, r.is_gap, i]
      );
    }
    await db.query('COMMIT');
    return { run, keywords: enriched };
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    db.release();
  }
}

module.exports = { runUrlGap };
