// Content quality audit — Organic → Performance → Content audit.
//
// Fetches one URL, extracts its visible text, asks Claude to grade it
// against a structured rubric (thin-content score, readability,
// keyword usage, missing sub-topics, suggested additions, overall
// recommendation, priority). Output is stored on content_audits and
// the AM can send the page into Pipeline → Draft for a refresh
// without re-fetching anything.
//
// Costs one Claude call per audit (~$0.02 with Sonnet 4.6). Not run
// automatically — AM triggers per page.

const axios = require('axios');
const cheerio = require('cheerio');
const pool = require('../db');
const claudeService = require('./claude');

const MODEL = 'claude-sonnet-4-6';
const USER_AGENT = 'Mozilla/5.0 (compatible; OctoberMarketingIntelligence/1.0; +https://platform.octobercomms.com/audit)';

// Pull a clean text snapshot from the URL. Drops script/style/nav/footer
// boilerplate so Claude grades the main content, not the chrome.
async function fetchAndExtract(url) {
  const res = await axios.get(url, {
    timeout: 20000, maxRedirects: 5, validateStatus: () => true,
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml' },
  });
  if (res.status >= 400) throw new Error(`Fetch returned HTTP ${res.status}`);
  if (typeof res.data !== 'string' || !/html/i.test(res.headers['content-type'] || '')) {
    throw new Error('URL did not return HTML');
  }
  const $ = cheerio.load(res.data);
  const title = ($('head > title').first().text() || '').trim();
  const metaDesc = ($('head meta[name="description"]').attr('content') || '').trim();
  // Strip the obvious non-content chrome before extracting body text.
  $('script, style, noscript, nav, header, footer, aside, [role="navigation"]').remove();
  // Prefer <main> / <article> if present — gives Claude the post body
  // rather than including sidebar/CTA copy that distorts the assessment.
  const main = $('main').first().length ? $('main').first()
            : $('article').first().length ? $('article').first()
            : $('body');
  const text = main.text().replace(/\s+/g, ' ').trim();
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
  return { title, metaDesc, text, wordCount };
}

async function loadBrandContext(clientId) {
  const { rows: clientRows } = await pool.query(
    'SELECT name, briefing_field, domain FROM clients WHERE id = $1', [clientId]
  );
  if (!clientRows.length) throw new Error('Client not found');
  return clientRows[0];
}

const SYSTEM = `You are a senior SEO content analyst auditing an existing webpage. You work for an agency that produces commercial briefs the AM uses to refresh underperforming content. British English. Opinionated, tight, no filler. Never use "delve into", "leverage", "robust", "moreover", "in conclusion", "comprehensive" — those are AI tells.

You return ONE JSON object with the schema below. No prose outside the JSON.

Schema:
{
  "thin_content_score": 1-5,          // 1 = barely content; 5 = thorough and well-developed
  "readability_grade": "A"|"B"|"C"|"D"|"F",  // A = clear, varied, on-target reading level; F = unreadable or wall-of-jargon
  "detected_primary_keyword": "...",  // your best guess at what this page is targeting
  "keyword_usage": "good"|"under"|"over"|"absent",
  "missing_subtopics": [              // sub-topics a reader would expect; 3–8 strings, terse
    "..."
  ],
  "suggested_additions": [            // 3–6 concrete sections to add
    { "heading": "...", "rationale": "one sentence why this section makes the page rank/convert better" }
  ],
  "overall_recommendation": "...",    // 3–6 sentence markdown narrative — what the AM should do this week to lift this page
  "priority": "low"|"medium"|"high"   // high = clear underperformer + clear lift; medium = needs work; low = already strong
}`;

async function runAudit({ clientId, url, targetKeyword }) {
  const cleanUrl = String(url || '').trim();
  if (!cleanUrl) throw new Error('url required');
  if (!/^https?:\/\//i.test(cleanUrl)) throw new Error('url must be a full http(s) URL');

  const client = await loadBrandContext(clientId);

  // Create the running row up front so the UI can show progress.
  const { rows: auditRows } = await pool.query(
    `INSERT INTO content_audits (client_id, url, target_keyword, status, claude_model)
     VALUES ($1, $2, $3, 'running', $4) RETURNING *`,
    [clientId, cleanUrl, targetKeyword || null, MODEL]
  );
  const audit = auditRows[0];

  try {
    const { title, metaDesc, text, wordCount } = await fetchAndExtract(cleanUrl);

    // Cap the body text Claude sees — long pages cost tokens without
    // adding signal. 12k chars ≈ 2,200 words, well above most posts.
    const cappedText = text.slice(0, 12000);

    const userPrompt = `Client: ${client.name}
Domain: ${client.domain || '(not set)'}
Brand briefing / what this site is about:
${client.briefing_field || '(no briefing — infer from the page content)'}

Page URL: ${cleanUrl}
Title: ${title || '(no <title>)'}
Meta description: ${metaDesc || '(none)'}
Word count: ${wordCount}
${targetKeyword ? `Target keyword the AM thinks this should rank for: "${targetKeyword}"` : ''}

Page content (extracted main body):
"""
${cappedText}
"""

Audit this page. Return the JSON object only.`;

    const raw = await claudeService.callClaude({
      model: MODEL,
      max_tokens: 2500,
      system: SYSTEM,
      user: userPrompt,
    });
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    let findings;
    try { findings = JSON.parse(cleaned); }
    catch { throw new Error('Claude returned malformed JSON: ' + cleaned.slice(0, 240)); }

    const { rows: updated } = await pool.query(
      `UPDATE content_audits SET
         status = 'complete',
         title = $1, meta_description = $2, word_count = $3,
         thin_content_score = $4, readability_grade = $5,
         detected_primary_keyword = $6, keyword_usage = $7,
         missing_subtopics_json = $8, suggested_additions_json = $9,
         overall_recommendation = $10, priority = $11,
         completed_at = NOW()
       WHERE id = $12 RETURNING *`,
      [
        title, metaDesc, wordCount,
        Math.max(1, Math.min(5, Number(findings.thin_content_score) || 3)),
        String(findings.readability_grade || 'C').toUpperCase().slice(0, 2),
        findings.detected_primary_keyword || null,
        ['good','under','over','absent'].includes(findings.keyword_usage) ? findings.keyword_usage : null,
        JSON.stringify(Array.isArray(findings.missing_subtopics) ? findings.missing_subtopics : []),
        JSON.stringify(Array.isArray(findings.suggested_additions) ? findings.suggested_additions : []),
        findings.overall_recommendation || null,
        ['low','medium','high'].includes(findings.priority) ? findings.priority : 'medium',
        audit.id,
      ]
    );
    return updated[0];
  } catch (err) {
    await pool.query(
      `UPDATE content_audits SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2`,
      [err.message, audit.id]
    );
    throw err;
  }
}

module.exports = { runAudit };
