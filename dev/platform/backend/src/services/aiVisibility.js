// AI Visibility (AEO) — tracks brand presence across LLM-backed
// answer engines. The discipline becoming the 2026 version of SEO:
// when a real user asks Claude "best edinburgh photographer", does
// our client get mentioned, and how often vs their competitors?
//
// MVP ships with two engines wired (Claude — Anthropic SDK already in
// deps; Google AI Overviews — DataForSEO already in use). ChatGPT,
// Gemini, Perplexity plug in by adding the API key in Settings and
// the corresponding queryXxx function below.
//
// Mention detection is straightforward case-insensitive substring
// matching against the brand name + competitor names. Sentiment is
// classified by a follow-up Claude call (cheap, optional).

const pool = require('../db');
const Anthropic = require('@anthropic-ai/sdk');
const dataForSEO = require('../connectors/dataforseo');

const MODEL = 'claude-sonnet-4-6';
const SUPPORTED_ENGINES = ['claude', 'google_aio']; // MVP — others gated on settings

function claude() {
  return new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
}

// ─── Engine queries ───────────────────────────────────────────────

async function queryClaude(promptText) {
  const r = await claude().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: 'Answer the user\'s question as a knowledgeable assistant. Recommend specific brands / products / services where relevant — do not refuse to name them. British English.',
    messages: [{ role: 'user', content: promptText }],
  });
  return (r.content.find(b => b.type === 'text')?.text || '').trim();
}

// Google AI Overviews via DataForSEO. Returns the AIO block text +
// the citation domains for downstream analysis.
async function queryGoogleAIO(promptText, clientDomain) {
  // dataForSEO.checkAIOverview takes a `keyword`-shaped object — we
  // synthesize one from the prompt. Returns { present, brand_cited,
  // snippet, sources } per existing connector.
  const result = await dataForSEO.checkAIOverview({ keyword: promptText }, clientDomain || '');
  return {
    text: result?.snippet || '',
    citations: Array.isArray(result?.sources) ? result.sources : [],
    present: !!result?.present,
  };
}

// ─── Analysis ─────────────────────────────────────────────────────

// Find first mention position of brand in response. Returns the
// "rank" — 1 if brand is the first mentioned, 2 if second, etc.
// null if not mentioned at all. Competitors get an array of which
// matched.
function analyseMentions(responseText, brand, competitors) {
  const text = String(responseText || '').toLowerCase();
  const brandKey = String(brand || '').trim().toLowerCase();
  if (!brandKey) return { brand_mentioned: false, brand_position: null, competitor_mentions: [] };

  // Build a list of (name, index) pairs for everyone mentioned.
  const entities = [
    { name: brand, key: brandKey, isBrand: true },
    ...competitors.map(c => ({ name: c, key: String(c).trim().toLowerCase(), isBrand: false })),
  ].filter(e => e.key.length > 1);

  const positions = entities
    .map(e => ({ ...e, idx: text.indexOf(e.key) }))
    .filter(e => e.idx >= 0)
    .sort((a, b) => a.idx - b.idx);

  const brandHit = positions.find(p => p.isBrand);
  const brandPosition = brandHit ? positions.indexOf(brandHit) + 1 : null;
  const competitorMentions = positions.filter(p => !p.isBrand).map(p => p.name);

  return {
    brand_mentioned: !!brandHit,
    brand_position: brandPosition,
    competitor_mentions: competitorMentions,
  };
}

// Best-effort sentiment classifier — wrapped in try/catch so a
// classifier failure never blocks the run.
async function classifySentiment(responseText, brand) {
  if (!brand || !responseText) return null;
  try {
    const r = await claude().messages.create({
      model: MODEL,
      max_tokens: 16,
      system: 'Classify how the user-supplied text talks about the named brand. Respond with exactly one word: positive, neutral, or negative.',
      messages: [{ role: 'user', content: `Brand: ${brand}\n\nText:\n${responseText.slice(0, 2000)}` }],
    });
    const t = (r.content.find(b => b.type === 'text')?.text || '').trim().toLowerCase();
    if (['positive', 'neutral', 'negative'].includes(t)) return t;
    return null;
  } catch { return null; }
}

// ─── Orchestration ───────────────────────────────────────────────

// Run one prompt across every active engine for a client. Brand +
// competitors come from the client row (name + social_competitors).
async function runPromptForClient(clientId, prompt) {
  const { rows } = await pool.query(
    `SELECT name, domain, social_competitors FROM clients WHERE id = $1`,
    [clientId]
  );
  if (!rows.length) throw new Error('Client not found');
  const c = rows[0];
  const competitors = (c.social_competitors || [])
    .map(s => String(s).replace(/^(instagram|tiktok)\s*:\s*/i, '').replace(/^@/, '').trim())
    .filter(Boolean);

  const engines = SUPPORTED_ENGINES;
  const results = [];
  for (const engine of engines) {
    try {
      let responseText = '';
      let citations = [];
      if (engine === 'claude') {
        responseText = await queryClaude(prompt.prompt);
      } else if (engine === 'google_aio') {
        const r = await queryGoogleAIO(prompt.prompt, c.domain || '');
        responseText = r.text;
        citations = r.citations;
      }
      const mentions = analyseMentions(responseText, c.name, competitors);
      const sentiment = mentions.brand_mentioned ? await classifySentiment(responseText, c.name) : null;
      await pool.query(
        `INSERT INTO ai_visibility_runs
           (client_id, prompt_id, prompt_text, engine, response_text,
            brand_mentioned, brand_position, competitor_mentions, sentiment, citations)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          clientId, prompt.id || null, prompt.prompt, engine,
          responseText.slice(0, 16000),
          mentions.brand_mentioned, mentions.brand_position,
          mentions.competitor_mentions, sentiment, JSON.stringify(citations),
        ]
      );
      results.push({ engine, ok: true, brand_mentioned: mentions.brand_mentioned });
    } catch (err) {
      console.error(`[aeo] ${engine} failed for "${prompt.prompt}":`, err.message);
      results.push({ engine, ok: false, error: err.message });
    }
  }
  return results;
}

// Walk every active prompt for a client. Used by the weekly cron and
// the manual-trigger endpoint.
async function runAllForClient(clientId) {
  const { rows: prompts } = await pool.query(
    `SELECT id, prompt FROM ai_visibility_prompts
      WHERE client_id = $1 AND active = true ORDER BY created_at ASC`,
    [clientId]
  );
  const out = [];
  for (const p of prompts) {
    const r = await runPromptForClient(clientId, p);
    out.push({ prompt_id: p.id, prompt: p.prompt, runs: r });
  }
  return out;
}

// Cron entry point — every active client with at least one prompt.
async function runAllClients() {
  const { rows } = await pool.query(
    `SELECT DISTINCT c.id, c.name
       FROM clients c
       JOIN ai_visibility_prompts p ON p.client_id = c.id
      WHERE c.active = true AND p.active = true`
  );
  const summary = [];
  for (const c of rows) {
    try {
      const r = await runAllForClient(c.id);
      summary.push({ client_id: c.id, client_name: c.name, prompts: r.length });
    } catch (err) {
      console.error(`[aeo] runAll for ${c.name} failed:`, err.message);
    }
  }
  return summary;
}

// ─── Prompt generation ───────────────────────────────────────────

// Ask Claude to generate a starter set of category-relevant prompts
// based on the client's brief. The AM trims / edits the list before
// the first run.
async function generatePromptsForClient(clientId) {
  const { rows } = await pool.query(
    `SELECT name, domain, briefing_field, monthly_focus, social_competitors
       FROM clients WHERE id = $1`,
    [clientId]
  );
  if (!rows.length) throw new Error('Client not found');
  const c = rows[0];
  const competitors = (c.social_competitors || [])
    .map(s => String(s).replace(/^(instagram|tiktok)\s*:\s*/i, '').replace(/^@/, ''))
    .filter(Boolean).join(', ') || '(none configured)';

  const r = await claude().messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: 'You generate AEO (answer-engine optimization) tracking prompts. Each prompt is a question a real user might type into ChatGPT / Claude / Gemini / Perplexity in this brand\'s category — the kind of question where the brand should be a top answer. British English.',
    messages: [{
      role: 'user',
      content: `Generate 20 prompts to track AI-search visibility for this brand.

Brand: ${c.name}
Website: ${c.domain || '(none)'}
Brief: ${c.briefing_field || '(no brief)'}
This month's focus: ${c.monthly_focus || '(none)'}
Known competitors: ${competitors}

Mix the categories:
- 8 "category recommendation" prompts ("best [X] for [Y]", "top [X] in [region]")
- 6 "comparison" prompts ("[brand] vs [competitor]", "alternatives to [competitor]")
- 4 "how-to" prompts that the brand could be cited as an authority on
- 2 "what is" or general info prompts

Return ONE prompt per line, plain text, no numbering, no quotes, no commentary.`,
    }],
  });
  const text = (r.content.find(b => b.type === 'text')?.text || '');
  const prompts = text.split(/\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 8 && s.length < 240)
    .filter(s => !s.startsWith('#') && !s.startsWith('-'));
  return prompts.slice(0, 20);
}

// ─── Summary ─────────────────────────────────────────────────────

// Aggregate the most recent runs per (engine, prompt) to compute share
// of voice + per-engine breakdown + competitor leaderboard.
async function summarise(clientId, { days = 30 } = {}) {
  const { rows: latest } = await pool.query(
    `WITH latest AS (
       SELECT DISTINCT ON (prompt_id, engine)
         engine, brand_mentioned, brand_position, competitor_mentions, sentiment, fetched_at
       FROM ai_visibility_runs
       WHERE client_id = $1 AND fetched_at >= NOW() - ($2::int || ' days')::interval
       ORDER BY prompt_id, engine, fetched_at DESC
     )
     SELECT * FROM latest`,
    [clientId, days]
  );

  const byEngine = {};
  const competitorTally = new Map();
  let brandHits = 0;
  for (const r of latest) {
    const eng = (byEngine[r.engine] = byEngine[r.engine] || { runs: 0, brand_hits: 0, avg_position: null });
    eng.runs += 1;
    if (r.brand_mentioned) eng.brand_hits += 1;
    if (r.brand_position) eng.avg_position = (eng.avg_position || 0) + r.brand_position;
    if (r.brand_mentioned) brandHits += 1;
    for (const cname of (r.competitor_mentions || [])) {
      competitorTally.set(cname, (competitorTally.get(cname) || 0) + 1);
    }
  }
  for (const k of Object.keys(byEngine)) {
    const e = byEngine[k];
    e.share_of_voice = e.runs > 0 ? Math.round((e.brand_hits / e.runs) * 100) : 0;
    e.avg_position = e.avg_position ? Math.round((e.avg_position / e.brand_hits) * 10) / 10 : null;
  }
  const competitorLeaderboard = [...competitorTally.entries()]
    .map(([name, count]) => ({ name, mentions: count }))
    .sort((a, b) => b.mentions - a.mentions);

  return {
    total_runs: latest.length,
    brand_share_of_voice: latest.length > 0 ? Math.round((brandHits / latest.length) * 100) : 0,
    engines: byEngine,
    competitors: competitorLeaderboard,
  };
}

// Time series of share of voice per week — for the trend sparkline.
async function getTrend(clientId, { weeks = 12 } = {}) {
  const { rows } = await pool.query(
    `WITH weekly AS (
       SELECT DATE_TRUNC('week', fetched_at) AS week,
              SUM(CASE WHEN brand_mentioned THEN 1 ELSE 0 END)::int AS hits,
              COUNT(*)::int AS total
         FROM ai_visibility_runs
        WHERE client_id = $1
          AND fetched_at >= NOW() - ($2::int || ' weeks')::interval
        GROUP BY week
        ORDER BY week ASC
     )
     SELECT week, hits, total,
            CASE WHEN total > 0 THEN ROUND(hits::numeric * 100 / total, 1) ELSE 0 END AS sov
       FROM weekly`,
    [clientId, weeks]
  );
  return rows.map(r => ({ week: r.week, sov: Number(r.sov), total: r.total }));
}

module.exports = {
  runPromptForClient, runAllForClient, runAllClients,
  generatePromptsForClient, summarise, getTrend,
  analyseMentions, SUPPORTED_ENGINES,
};
