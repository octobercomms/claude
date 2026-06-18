// AI-SEO — two linked tools:
//
//  1. Keyword targets: from the client's name/domain/competitors, Claude builds
//     a ranked list of the keywords/topics competitors win on in AI search
//     (Claude/Gemini/ChatGPT answers) and traditional SERPs — the "top 50
//     keywords" step.
//  2. Article fit scan: fetch one of the client's articles, score it 0–100
//     against those target keywords, and return concrete on-page fixes — the
//     "rate and optimise every article" step.
//
// Both are owned, in-house versions of the third-party tools in the source
// videos (no per-call connector). The single-URL content audit already exists
// (contentAudit.runAudit); this is the keyword-target-driven, batchable layer
// on top, focused on AI-search visibility.

const axios = require('axios');
const cheerio = require('cheerio');
const pool = require('../db');
const claudeService = require('./claude');

const USER_AGENT = 'Mozilla/5.0 (compatible; OctoberMI-AISEO/1.0; +https://platform.octobercomms.com)';

function parseJson(raw) {
  const cleaned = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); }
  catch { throw new Error('AI-SEO returned malformed JSON.'); }
}

async function loadClient(clientId) {
  const { rows } = await pool.query(
    'SELECT name, domain, social_competitors, briefing_field, monthly_focus FROM clients WHERE id = $1',
    [clientId]
  );
  if (!rows.length) { const e = new Error('Client not found'); e.status = 404; throw e; }
  return rows[0];
}

// ── Keyword targets ──────────────────────────────────────────────────────────

const KW_SYSTEM =
  'You are an SEO + AI-search strategist. You identify the keywords and topics a ' +
  'business should target to get found in AI answers (ChatGPT, Claude, Gemini, Google AI Overviews) ' +
  'and classic search, based on what its competitors rank for. British English. JSON only — no prose, no fences.';

function kwPrompt({ name, domain, competitors, context, seed }) {
  return `Business: ${name}${domain ? ` (${domain})` : ''}
${competitors.length ? `Known competitors: ${competitors.join(', ')}` : 'Competitors: infer the likely ones from the business.'}
${context ? `Context: ${context}` : ''}
${seed ? `Focus/seed from the team: ${seed}` : ''}

Produce the highest-value keyword and topic targets this business should rank for — the terms its competitors win on in AI answers and search. Return ONLY:
{"keywords":[{"keyword":"...","intent":"informational|commercial|transactional|navigational","priority":1-5,"rationale":"one short clause on why it matters / who searches it"}]}

Rules:
- 25–40 targets, ordered best-first. priority 1 = highest opportunity/relevance.
- Mix head terms and specific long-tail; favour terms with buying or research intent for this business.
- Be concrete and specific to this business and its sector — no generic filler like "marketing tips".`;
}

async function generateKeywordTargets(clientId, { seed = '' } = {}) {
  const c = await loadClient(clientId);
  const competitors = (c.social_competitors || []).map(s => String(s).trim()).filter(Boolean);
  const context = [c.briefing_field, c.monthly_focus].filter(Boolean).join(' — ');
  const raw = await claudeService.callClaude({
    max_tokens: 4000,
    system: KW_SYSTEM,
    user: kwPrompt({ name: c.name, domain: c.domain, competitors, context, seed }),
    feature: 'ai_seo_keywords',
    clientId,
  });
  const list = Array.isArray(parseJson(raw)?.keywords) ? parseJson(raw).keywords : [];
  const cleaned = list
    .map(k => ({
      keyword: String(k.keyword || '').trim(),
      intent: ['informational', 'commercial', 'transactional', 'navigational'].includes(k.intent) ? k.intent : null,
      priority: Math.max(1, Math.min(5, Number(k.priority) || 3)),
      rationale: k.rationale ? String(k.rationale).trim() : null,
    }))
    .filter(k => k.keyword);
  if (!cleaned.length) throw new Error('No keyword targets were generated — try adding a focus/seed.');

  // Regenerate replaces the set so the list stays a single source of truth.
  await pool.query('DELETE FROM ai_seo_keyword_targets WHERE client_id = $1', [clientId]);
  for (const k of cleaned) {
    await pool.query(
      `INSERT INTO ai_seo_keyword_targets (client_id, keyword, intent, rationale, priority)
       VALUES ($1, $2, $3, $4, $5)`,
      [clientId, k.keyword, k.intent, k.rationale, k.priority]
    );
  }
  return listKeywordTargets(clientId);
}

async function listKeywordTargets(clientId) {
  const { rows } = await pool.query(
    'SELECT * FROM ai_seo_keyword_targets WHERE client_id = $1 ORDER BY priority ASC, id ASC',
    [clientId]
  );
  return rows;
}

async function clearKeywordTargets(clientId) {
  await pool.query('DELETE FROM ai_seo_keyword_targets WHERE client_id = $1', [clientId]);
}

// ── Article fit scan ─────────────────────────────────────────────────────────

async function fetchAndExtract(url) {
  const res = await axios.get(url, {
    timeout: 20000, maxRedirects: 5, validateStatus: () => true,
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
  });
  if (res.status >= 400) throw new Error(`Fetch returned HTTP ${res.status}`);
  if (typeof res.data !== 'string' || !/html/i.test(res.headers['content-type'] || '')) {
    throw new Error('URL did not return HTML');
  }
  const $ = cheerio.load(res.data);
  const title = ($('head > title').first().text() || '').trim();
  const metaDesc = ($('head meta[name="description"]').attr('content') || '').trim();
  $('script, style, noscript, nav, header, footer, aside, [role="navigation"]').remove();
  const main = $('main').first().length ? $('main').first()
            : $('article').first().length ? $('article').first()
            : $('body');
  const text = main.text().replace(/\s+/g, ' ').trim();
  return { title, metaDesc, text: text.slice(0, 12000) };
}

const SCAN_SYSTEM =
  'You are an SEO editor. You score how well an article is optimised for a set of target keywords ' +
  'and for citation in AI answers, then give concrete, minimal on-page fixes. British English. JSON only — no prose, no fences.';

function scanPrompt({ url, page, keywords }) {
  const kwLines = keywords.map(k => `- ${k.keyword}${k.intent ? ` (${k.intent})` : ''}`).join('\n');
  return `Target keywords for this client:
${kwLines}

Article URL: ${url}
Title: ${page.title || '(none)'}
Meta description: ${page.metaDesc || '(none)'}
Body (truncated):
"""
${page.text}
"""

Assess this article against the target keywords and for AI-answer citability. Return ONLY:
{"best_keyword":"the single target this article fits best (or a close variant)","score":0-100,"summary":"one or two sentences on how well-optimised it is","fixes":["concrete on-page action","..."]}

Rules:
- score: 100 = thoroughly optimised and citable for its best keyword; 50 = relevant but under-optimised; 0 = off-topic or thin.
- fixes: 3–6 specific, minimal actions (title/H1/H2 tweaks, missing sub-topics, internal links, schema, a stat/quote to add for AI citation). No generic advice.`;
}

async function scanArticle({ clientId, url }) {
  const clean = String(url || '').trim();
  if (!clean) throw new Error('url required');
  if (!/^https?:\/\//i.test(clean)) throw new Error('url must be a full http(s) URL');
  const keywords = await listKeywordTargets(clientId);
  if (!keywords.length) { const e = new Error('Generate keyword targets first, then scan articles against them.'); e.status = 400; throw e; }

  const page = await fetchAndExtract(clean);
  if (!page.text || page.text.length < 120) throw new Error('That page had no readable article text.');

  const raw = await claudeService.callClaude({
    max_tokens: 1500,
    system: SCAN_SYSTEM,
    user: scanPrompt({ url: clean, page, keywords: keywords.slice(0, 40) }),
    feature: 'ai_seo_article_scan',
    clientId,
  });
  const f = parseJson(raw);
  const score = Math.max(0, Math.min(100, Math.round(Number(f.score))));
  const fixes = Array.isArray(f.fixes) ? f.fixes.map(x => String(x)).filter(Boolean).slice(0, 8) : [];
  const { rows } = await pool.query(
    `INSERT INTO ai_seo_article_scans (client_id, url, title, best_keyword, score, summary, fixes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [clientId, clean, page.title || null, f.best_keyword || null, Number.isFinite(score) ? score : null, f.summary || null, JSON.stringify(fixes)]
  );
  return rows[0];
}

async function listArticleScans(clientId) {
  const { rows } = await pool.query(
    'SELECT * FROM ai_seo_article_scans WHERE client_id = $1 ORDER BY created_at DESC LIMIT 100',
    [clientId]
  );
  return rows;
}

async function deleteArticleScan(clientId, id) {
  await pool.query('DELETE FROM ai_seo_article_scans WHERE id = $1 AND client_id = $2', [id, clientId]);
}

module.exports = {
  generateKeywordTargets, listKeywordTargets, clearKeywordTargets,
  scanArticle, listArticleScans, deleteArticleScan,
};
