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
const playbooks = require('./playbooks');
const { scoreContent } = require('./contentQualityScore');

const MODEL = 'claude-sonnet-4-6';
const USER_AGENT = 'Mozilla/5.0 (compatible; OctoberMarketingIntelligence/1.0; +https://platform.octobercomms.com/audit)';

// Objective E‑E‑A‑T + CITE signals we can detect deterministically from the
// page. Handed to Claude as evidence for its per-factor grades and shown to the
// AM as a checklist — they inform the grades rather than scoring separately.
// `$` is the full (un-stripped) document; `main` is the post body element.
function deriveSignals($, url, main) {
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();

  // Parse any JSON-LD blocks once — used for author / date / schema-type.
  const ld = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text());
      (Array.isArray(parsed) ? parsed : [parsed]).forEach(o => o && ld.push(o));
    } catch { /* malformed JSON-LD — ignore */ }
  });
  const ldTypes = new Set(ld.flatMap(o => [].concat(o['@type'] || []).map(t => String(t).toLowerCase())));
  const ldHas = (...types) => types.some(t => ldTypes.has(t.toLowerCase()));

  const author = !!(
    $('[rel="author"], [itemprop="author"], .author, .byline, [class*="author"]').length ||
    $('head meta[name="author"]').attr('content') ||
    ld.some(o => o.author) || ldHas('person')
  );
  const date = !!(
    $('time[datetime], [itemprop="datePublished"], [itemprop="dateModified"]').length ||
    $('head meta[property="article:published_time"]').attr('content') ||
    ld.some(o => o.datePublished || o.dateModified)
  );
  const contactOrAbout = $('a[href]').toArray().some(a => /\/(contact|about)/i.test($(a).attr('href') || ''));
  const articleSchema = ldHas('article', 'blogposting', 'newsarticle', 'organization', 'webpage', 'faqpage');

  // Main-body-scoped signals: external citations, question headings, images.
  const externalCitations = (main.find ? main.find('a[href]') : $('a[href]')).toArray().filter(a => {
    const href = $(a).attr('href') || '';
    if (!/^https?:\/\//i.test(href)) return false;
    try {
      const h = new URL(href).hostname.replace(/^www\./, '');
      if (h === host) return false;                                   // internal
      return !/(facebook|twitter|x|instagram|linkedin|youtube|pinterest|t)\.(com|co)$/i.test(h); // skip social
    } catch { return false; }
  }).length;

  const QUESTION = /^(who|what|why|how|when|where|which|can|does|do|is|are|should|will)\b|\?/i;
  const questionHeadings = (main.find ? main.find('h2, h3') : $('h2, h3')).toArray()
    .filter(h => QUESTION.test($(h).text().trim())).length;
  const imageCount = (main.find ? main.find('img') : $('img')).length;

  return {
    https: /^https:\/\//i.test(url),
    author, date, contact_or_about: contactOrAbout, article_schema: articleSchema,
    external_citations: externalCitations, question_headings: questionHeadings,
    original_image_count: imageCount,
  };
}

// Pull a clean text snapshot from the URL. Drops script/style/nav/footer
// boilerplate so Claude grades the main content, not the chrome. Also derives
// the objective E‑E‑A‑T/CITE signals from the full document first.
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
  // Locate the post body BEFORE stripping chrome (signals like author/date/
  // contact often live in header/footer).
  const mainEl = $('main').first().length ? $('main').first()
              : $('article').first().length ? $('article').first()
              : $('body');
  const signals = deriveSignals($, url, mainEl);
  // Now strip the obvious non-content chrome before extracting body text.
  $('script, style, noscript, nav, header, footer, aside, [role="navigation"]').remove();
  const main = $('main').first().length ? $('main').first()
            : $('article').first().length ? $('article').first()
            : $('body');
  const text = main.text().replace(/\s+/g, ' ').trim();
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
  signals.word_count = wordCount;
  return { title, metaDesc, text, wordCount, signals };
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
  "priority": "low"|"medium"|"high",  // high = clear underperformer + clear lift; medium = needs work; low = already strong
  "eeat": {                           // grade each factor A–F against the rubric + the objective signals provided
    "experience":        { "grade": "A"|"B+"|"B"|"C+"|"C"|"F", "note": "one specific sentence naming the evidence or the gap" },
    "expertise":         { "grade": "...", "note": "..." },
    "authoritativeness": { "grade": "...", "note": "..." },
    "trust":             { "grade": "...", "note": "..." },   // weighted heaviest — be strict; missing author/date/contact caps this
    "cite":              { "grade": "...", "note": "..." }    // AI citation-readiness: liftable passages, question headings, attributed stats
  }
}

Grade to the rubric provided in the methodology. Ground each factor's grade in the objective page signals you're given (HTTPS, author byline, publish date, contact/about, schema, external citations, question headings, images) — never award a high Trust grade to a page with no author and no date. Do NOT compute an overall grade; the platform derives that from your factor grades.`;

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
    const { title, metaDesc, text, wordCount, signals } = await fetchAndExtract(cleanUrl);

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

Objective page signals (detected automatically — use these to ground the E‑E‑A‑T grades):
- HTTPS: ${signals.https ? 'yes' : 'NO'}
- Author byline / author schema: ${signals.author ? 'present' : 'NONE'}
- Publish/updated date: ${signals.date ? 'present' : 'NONE'}
- Contact/about link: ${signals.contact_or_about ? 'present' : 'NONE'}
- Article/Org schema: ${signals.article_schema ? 'present' : 'NONE'}
- External citations (outbound, non-social): ${signals.external_citations}
- Question-shaped headings: ${signals.question_headings}
- Images in body: ${signals.original_image_count}

Page content (extracted main body):
"""
${cappedText}
"""

Audit this page. Return the JSON object only.`;

    const raw = await claudeService.callClaude({
      model: MODEL,
      max_tokens: 2500,
      system: SYSTEM + playbooks.systemSuffix(['seo-audit', 'content-strategy', 'eeat', 'trust-brokering']),
      user: userPrompt,
    });
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    let findings;
    try { findings = JSON.parse(cleaned); }
    catch { throw new Error('Claude returned malformed JSON: ' + cleaned.slice(0, 240)); }

    // Deterministic rubric-weighted overall grade + publish verdict from
    // Claude's per-factor E‑E‑A‑T grades. Persist the factors + the objective
    // signals together as evidence.
    const eeat = findings.eeat && typeof findings.eeat === 'object' ? findings.eeat : {};
    const scored = scoreContent({
      experience: eeat.experience, expertise: eeat.expertise,
      authoritativeness: eeat.authoritativeness, trust: eeat.trust, cite: eeat.cite,
    });
    const eeatPayload = { factors: eeat, signals, score: scored.score, categories: scored.categories };

    const { rows: updated } = await pool.query(
      `UPDATE content_audits SET
         status = 'complete',
         title = $1, meta_description = $2, word_count = $3,
         thin_content_score = $4, readability_grade = $5,
         detected_primary_keyword = $6, keyword_usage = $7,
         missing_subtopics_json = $8, suggested_additions_json = $9,
         overall_recommendation = $10, priority = $11,
         eeat_json = $12, content_grade = $13, publish_verdict = $14,
         completed_at = NOW()
       WHERE id = $15 RETURNING *`,
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
        JSON.stringify(eeatPayload), scored.grade, scored.verdict,
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
