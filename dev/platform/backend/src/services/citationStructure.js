// Citation structure — does this page carry the shapes that get it quoted by
// an answer engine?
//
// Separate from agentReadiness.js on purpose. That one scans the client's
// homepage and asks whether an agent can navigate the site. This asks a
// different question about a different page: given an article, is it shaped so
// a model can lift an answer out of it. A homepage with no FAQ and no tables
// is fine; an article without them is harder to quote.
//
// The four features come from AirOps' "Complete AI Search Playbook" (March
// 2026), which reports, from ~12,000 pages it analysed:
//
//   FAQs on the page            40% higher likelihood of being cited
//   three or more schema types  13% more likely
//   clean H1 > H2 > H3          2.8x citation odds
//   lists and tables            in ~80% of ChatGPT citations, 29% of Google's
//
// Those are the vendor's own figures, self-published, with no methodology
// given and measured on a corpus of SaaS, finance and fintech brands. They are
// the reason to look, not evidence. Which is why this records the raw features
// per page as well as a score: `citation_structure_scans` joined against
// `ai_visibility_runs.citations` is the only way to find out whether any of it
// holds for architecture and design sites, where nobody has measured.
//
// So treat `score` as a working hypothesis with weights that were chosen, not
// derived. WEIGHTS below says as much, and the guard pins it.
//
// Deterministic and offline: scorePage() takes HTML and returns a report. No
// Claude call, no API, nothing to bill. analyze() is the thin fetching wrapper.

const cheerio = require('cheerio');
const pool = require('../db');
const { fetchRenderedHtml } = require('../utils/fetchHtml');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Chosen, not measured. Equal thirds across the three features a writer can
// act on, and half that for schema, which is a template-level decision the
// writer usually cannot change. Revisit once there is enough of our own data
// to fit them; until then an honest flat-ish split beats false precision
// borrowed from somebody else's effect sizes.
const WEIGHTS = { faq: 0.30, headings: 0.30, lists_tables: 0.28, schema: 0.12 };

// The playbook's own threshold.
const SCHEMA_TYPES_TARGET = 3;

// A heading that reads as a question. An FAQ does not need FAQPage markup to
// be quotable, and most WordPress articles do not have it.
const QUESTION_RE = /\?\s*$|^\s*(what|how|why|when|where|who|which|can|could|should|do|does|did|is|are|was|will|would)\b/i;

// Lists inside these are navigation, not content. Counting a nav menu as a
// list would make every site look well structured, which is the easiest way
// to build a scorer that always says yes.
const CHROME = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], .nav, .navbar, .menu, .breadcrumb, .breadcrumbs, .pagination, .site-header, .site-footer';

function textOf($, el) {
  return $(el).text().replace(/\s+/g, ' ').trim();
}

// The article, where we can find it. Falls back to <body> so a page with no
// semantic wrapper still gets scored rather than silently scoring zero.
function contentRoot($) {
  for (const sel of ['article', 'main', '[role="main"]', '.entry-content', '.post-content', '#content']) {
    const found = $(sel).first();
    if (found.length && textOf($, found).length > 200) return found;
  }
  return $('body');
}

// ── 1. FAQ ───────────────────────────────────────────────────────────────────
// Three ways a page can carry questions and answers, reported separately so a
// fix can be specific rather than "add an FAQ".
function checkFaq($, $root, schemaTypes) {
  const viaSchema = schemaTypes.includes('FAQPage') || schemaTypes.includes('QAPage');

  // <details><summary> accordions, the usual no-markup FAQ.
  const details = $root.find('details:has(summary)').length;

  // Headings that read as questions.
  const questionHeadings = [];
  $root.find('h2, h3, h4').each((_, el) => {
    const t = textOf($, el);
    if (t && t.length <= 160 && QUESTION_RE.test(t)) questionHeadings.push(t);
  });

  const viaDetails = details >= 2;
  const viaHeadings = questionHeadings.length >= 2;
  const present = viaSchema || viaDetails || viaHeadings;

  // Marked-up questions are worth more than inferred ones: the schema is what
  // a model can parse without guessing.
  const score = viaSchema ? 1 : viaDetails || viaHeadings ? 0.6 : 0;

  const sources = [];
  if (viaSchema) sources.push('FAQPage schema');
  if (viaDetails) sources.push(`${details} details/summary blocks`);
  if (viaHeadings) sources.push(`${questionHeadings.length} question headings`);

  return {
    id: 'faq', label: 'Questions and answers', weight: WEIGHTS.faq, score,
    status: viaSchema ? 'pass' : present ? 'warn' : 'fail',
    summary: viaSchema
      ? `Questions are marked up as FAQPage schema, so an engine can lift a question and its answer without parsing prose.`
      : present
        ? `Questions are on the page (${sources.join(', ')}) but carry no FAQPage schema, so an engine has to infer the pairing.`
        : 'No question-and-answer section. There is nothing on this page shaped like the question somebody would ask an assistant.',
    fix: present
      ? 'Wrap the existing questions in FAQPage JSON-LD so each question is explicitly paired with its answer.'
      : 'Add a short FAQ answering the questions a buyer actually asks, each as its own H2 or H3, and mark it up as FAQPage JSON-LD.',
    detail: {
      present, via_schema: viaSchema, details_blocks: details,
      question_headings: questionHeadings.length,
      question_heading_examples: questionHeadings.slice(0, 5),
    },
  };
}

// ── 2. Schema types ──────────────────────────────────────────────────────────
// Every @type across every JSON-LD block, including @graph and arrays, which
// is how most WordPress SEO plugins emit it.
function collectSchemaTypes($) {
  const types = new Set();
  const invalid = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const t = node['@type'];
    if (typeof t === 'string') types.add(t);
    else if (Array.isArray(t)) t.forEach(x => typeof x === 'string' && types.add(x));
    if (Array.isArray(node['@graph'])) node['@graph'].forEach(visit);
    // Nested entities (mainEntity, author, publisher) carry their own @type
    // and are part of what the page declares.
    for (const [k, v] of Object.entries(node)) {
      if (k === '@graph' || k === '@type') continue;
      if (v && typeof v === 'object') visit(v);
    }
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try { visit(JSON.parse(raw)); }
    catch { invalid.push(raw.slice(0, 80)); }
  });
  return { types: [...types].sort(), invalid };
}

function checkSchema(schemaTypes, invalid) {
  const n = schemaTypes.length;
  const score = Math.min(1, n / SCHEMA_TYPES_TARGET);
  return {
    id: 'schema', label: 'Structured data types', weight: WEIGHTS.schema, score,
    status: n >= SCHEMA_TYPES_TARGET ? 'pass' : n > 0 ? 'warn' : 'fail',
    summary: n === 0
      ? (invalid.length
        ? `No usable structured data: ${invalid.length} JSON-LD block(s) on the page failed to parse.`
        : 'No JSON-LD structured data on this page.')
      : `${n} schema type${n === 1 ? '' : 's'} declared: ${schemaTypes.join(', ')}.`,
    fix: `Declare at least ${SCHEMA_TYPES_TARGET} relevant types. For an article that usually means Article or BlogPosting, BreadcrumbList, Organization, and FAQPage where there are questions.`,
    detail: { count: n, types: schemaTypes, invalid_blocks: invalid.length },
  };
}

// ── 3. Heading hierarchy ─────────────────────────────────────────────────────
// One H1, and no level skipped on the way down. A jump from H1 to H3 leaves a
// model guessing which section a passage belongs to.
function checkHeadings($, $root) {
  const levels = [];
  $root.find('h1, h2, h3, h4, h5, h6').each((_, el) => {
    levels.push({ level: Number((el.tagName || el.name).slice(1)), text: textOf($, el) });
  });
  // The H1 is usually outside the content root (a site header template), so
  // count it across the page rather than only inside the article.
  const h1Count = $('h1').length;

  const skips = [];
  let prev = null;
  for (const h of levels) {
    if (prev !== null && h.level > prev + 1) {
      skips.push({ from: `h${prev}`, to: `h${h.level}`, text: h.text.slice(0, 80) });
    }
    prev = h.level;
  }

  const counts = {};
  for (const h of levels) counts[`h${h.level}`] = (counts[`h${h.level}`] || 0) + 1;
  const depth = levels.length ? Math.max(...levels.map(h => h.level)) : 0;
  const reachesH3 = depth >= 3;

  // Three things, each worth a third: exactly one H1, no skipped levels, and
  // enough depth that there is a hierarchy at all.
  const score = ((h1Count === 1 ? 1 : 0) + (skips.length === 0 ? 1 : 0) + (reachesH3 ? 1 : 0)) / 3;

  const faults = [];
  if (h1Count === 0) faults.push('no H1');
  else if (h1Count > 1) faults.push(`${h1Count} H1s`);
  if (skips.length) faults.push(`${skips.length} skipped level${skips.length === 1 ? '' : 's'}`);
  if (!reachesH3) faults.push('no H3s, so the page is flat');

  return {
    id: 'headings', label: 'Heading hierarchy', weight: WEIGHTS.headings, score,
    status: score === 1 ? 'pass' : score >= 0.5 ? 'warn' : 'fail',
    summary: score === 1
      ? `Clean hierarchy: one H1 down to H${depth}, no skipped levels.`
      : `Hierarchy problems: ${faults.join(', ')}.`,
    fix: 'Use one H1 for the page title, H2 for each section and H3 for points within a section. Never skip a level to get a particular size; set the size in CSS.',
    detail: { h1_count: h1Count, counts, depth, skips: skips.slice(0, 8), skip_count: skips.length },
  };
}

// ── 4. Lists and tables ──────────────────────────────────────────────────────
// Measured against how much prose there is, so a long article does not pass on
// one stray list. Navigation is excluded; see CHROME.
function checkListsTables($, $root) {
  const $content = $root.clone();
  $content.find(CHROME).remove();

  const lists = $content.find('ul, ol').length;
  const listItems = $content.find('li').length;
  const tables = $content.find('table').length;
  const tableRows = $content.find('table tr').length;

  const words = $content.text().split(/\s+/).filter(Boolean).length;
  // Structured rows per 100 words. 1.0 is roughly one bullet every two
  // sentences, which reads as a well-broken-up article rather than a wall.
  const density = words ? ((listItems + tableRows) / words) * 100 : 0;

  const present = lists + tables > 0;
  const score = !present ? 0 : Math.min(1, density / 1.0);

  return {
    id: 'lists_tables', label: 'Lists and tables', weight: WEIGHTS.lists_tables, score,
    status: score >= 0.7 ? 'pass' : present ? 'warn' : 'fail',
    summary: !present
      ? `No lists or tables in ${words} words of content. Everything here is prose an engine has to summarise rather than quote.`
      : `${lists} list${lists === 1 ? '' : 's'} and ${tables} table${tables === 1 ? '' : 's'} across ${words} words (${density.toFixed(1)} structured rows per 100 words).`,
    fix: 'Turn the parts that are really enumerations into lists, and the parts that compare things into tables. A model lifts a table wholesale; it has to paraphrase a paragraph.',
    detail: { lists, list_items: listItems, tables, table_rows: tableRows, words, density: Number(density.toFixed(2)) },
  };
}

/**
 * Score one page's HTML. Pure: no network, no database, no model call.
 * Returns { score, grade, checks, features }.
 */
function scorePage(html, url = null) {
  const $ = cheerio.load(html || '');
  const $root = contentRoot($);
  const { types, invalid } = collectSchemaTypes($);

  const checks = [
    checkFaq($, $root, types),
    checkHeadings($, $root),
    checkListsTables($, $root),
    checkSchema(types, invalid),
  ];

  const totalWeight = checks.reduce((s, c) => s + c.weight, 0) || 1;
  const score = Math.round(100 * checks.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight);
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 50 ? 'C' : score >= 25 ? 'D' : 'F';

  // The raw features, flat, so they can be joined against citation outcomes
  // later without reparsing a report blob.
  const byId = Object.fromEntries(checks.map(c => [c.id, c.detail]));
  const features = {
    faq_present: byId.faq.present,
    faq_via_schema: byId.faq.via_schema,
    schema_type_count: byId.schema.count,
    schema_types: byId.schema.types,
    h1_count: byId.headings.h1_count,
    heading_depth: byId.headings.depth,
    heading_skips: byId.headings.skip_count,
    lists: byId.lists_tables.lists,
    tables: byId.lists_tables.tables,
    list_items: byId.lists_tables.list_items,
    table_rows: byId.lists_tables.table_rows,
    words: byId.lists_tables.words,
    structure_density: byId.lists_tables.density,
  };

  return { url, score, grade, checks, features, scored_at: new Date().toISOString() };
}

/** Fetch a URL and score it. */
async function analyze(url, { clientId = null } = {}) {
  let target = String(url || '').trim();
  if (!target) { const e = new Error('A page URL is required.'); e.status = 400; throw e; }
  if (!/^https?:\/\//i.test(target)) target = 'https://' + target;
  try { target = new URL(target).toString(); }
  catch { const e = new Error(`"${url}" is not a URL.`); e.status = 400; throw e; }

  let page;
  try { page = await fetchRenderedHtml(target, { userAgent: USER_AGENT }); }
  catch (err) { const e = new Error(`Couldn't reach ${target}: ${err.message}`); e.status = 502; throw e; }
  if (!page.html || (page.status >= 400 && page.via !== 'flaresolverr')) {
    const e = new Error(`Couldn't read ${target} (HTTP ${page.status || 'no response'}). If the site is behind bot protection it may be blocking automated checks.`);
    e.status = 502; throw e;
  }

  const report = { ...scorePage(page.html, target), via: page.via };

  try {
    await pool.query(
      `INSERT INTO citation_structure_scans (client_id, url, score, grade, features, report)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [clientId, target, report.score, report.grade, JSON.stringify(report.features), JSON.stringify(report)]
    );
  } catch (err) { console.error('[citation-structure] persist failed:', err.message); }

  return report;
}

/**
 * Score a client's published pages. One at a time rather than in parallel: a
 * client's own site should not be hit with twenty simultaneous requests to
 * save a few seconds, and bot protection reads that as an attack.
 */
async function analyzeClientPages(clientId, { limit = 25 } = {}) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (p.external_url) p.external_url
       FROM content_publications p
       JOIN content_drafts d ON d.id = p.draft_id
      WHERE d.client_id = $1
        AND p.status = 'published'
        AND p.external_url IS NOT NULL
        AND p.external_url <> ''
      ORDER BY p.external_url, p.published_at DESC NULLS LAST
      LIMIT $2`,
    [clientId, limit]
  );

  const results = [];
  for (const row of rows) {
    try { results.push(await analyze(row.external_url, { clientId })); }
    catch (err) { results.push({ url: row.external_url, error: err.message }); }
  }

  const scored = results.filter(r => typeof r.score === 'number');
  return {
    checked: results.length,
    scored: scored.length,
    failed: results.length - scored.length,
    average: scored.length
      ? Math.round(scored.reduce((s, r) => s + r.score, 0) / scored.length)
      : null,
    results,
  };
}

/** Most recent scan per URL for a client. */
async function getLatest(clientId, { limit = 50 } = {}) {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (url) url, score, grade, features, created_at
         FROM citation_structure_scans
        WHERE client_id = $1
        ORDER BY url, created_at DESC
        LIMIT $2`,
      [clientId, limit]
    );
    return rows;
  } catch (err) { console.error('[citation-structure] getLatest failed:', err.message); return []; }
}

module.exports = {
  analyze, analyzeClientPages, getLatest, scorePage,
  _internals: { WEIGHTS, SCHEMA_TYPES_TARGET, collectSchemaTypes, contentRoot, QUESTION_RE, CHROME },
};
