// Agent Readiness — a lightweight, in-house take on Google Lighthouse's new
// "Agentic Browsing" category (https://goo.gle/lighthouse-agentic-web). Instead
// of spinning up headless Chrome, we fetch the client's homepage + llms.txt and
// statically check the same signals AI agents rely on to read and navigate a
// site:
//   1. Accessibility tree — links/buttons/images/forms with discernible names
//   2. Layout stability   — a CLS heuristic (media without reserved dimensions)
//   3. llms.txt           — present and well-formed (Markdown with an H1)
//   4. Machine-readable   — title, description, one H1, lang, canonical,
//                           structured data, a <main> landmark
// No paid APIs — just fetches the client's own site. Returns a scored report
// the Owned › Optimise panel renders.

const axios = require('axios');
const cheerio = require('cheerio');
const pool = require('../db');
const { fetchRenderedHtml } = require('../utils/fetchHtml');

// A real browser UA — many sites 403 an obviously-automated agent. The main
// homepage fetch goes through fetchRenderedHtml, which additionally falls back
// to FlareSolverr for Cloudflare-protected sites (same path the site audit uses).
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MAX_EXAMPLES = 12;

function normaliseUrl(domain) {
  let d = String(domain || '').trim();
  if (!d) return null;
  if (!/^https?:\/\//i.test(d)) d = 'https://' + d;
  try { return new URL(d).toString(); } catch { return null; }
}

async function fetchText(url) {
  const res = await axios.get(url, {
    timeout: 15000, maxRedirects: 5, validateStatus: () => true,
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,text/plain,*/*', 'Accept-Language': 'en-GB,en;q=0.9' },
  });
  return { status: res.status, contentType: res.headers['content-type'] || '', body: typeof res.data === 'string' ? res.data : '' };
}

// Accessible name for an element, mirroring what axe-core / the accessibility
// tree cares about: visible text, then ARIA / title / nested image alt.
function accName($, el) {
  const $el = $(el);
  const text = $el.text().replace(/\s+/g, ' ').trim();
  if (text) return text;
  const aria = ($el.attr('aria-label') || '').trim();
  if (aria) return aria;
  if (($el.attr('aria-labelledby') || '').trim()) return 'labelledby';
  const title = ($el.attr('title') || '').trim();
  if (title) return title;
  const val = ($el.attr('value') || '').trim();
  if (val) return val;
  const imgAlt = $el.find('img[alt]').filter((_, i) => ($(i).attr('alt') || '').trim()).length;
  if (imgAlt) return 'image-alt';
  const svgTitle = $el.find('svg title, svg[aria-label]').length;
  if (svgTitle) return 'svg-title';
  return '';
}

function snippet(html, n = 120) {
  return String(html || '').replace(/\s+/g, ' ').trim().slice(0, n);
}

function checkAccessibilityTree($) {
  const issues = [];
  const push = (issue, el) => {
    if (issues.length < MAX_EXAMPLES) {
      issues.push({ issue, selector: elSelector($, el), snippet: snippet($.html(el)) });
    }
  };

  // Links without discernible text — the exact failure Lighthouse flags.
  let linkFails = 0;
  $('a[href]').each((_, el) => {
    if (!accName($, el)) { linkFails++; push('Link has no discernible text', el); }
  });

  // Buttons / submit inputs without an accessible name.
  let btnFails = 0;
  $('button, [role="button"], input[type="submit"], input[type="button"]').each((_, el) => {
    if (!accName($, el)) { btnFails++; push('Button has no accessible name', el); }
  });

  // Images missing an alt attribute (empty alt="" is allowed = decorative).
  let imgFails = 0;
  $('img').each((_, el) => {
    if ($(el).attr('alt') === undefined) { imgFails++; push('Image is missing an alt attribute', el); }
  });

  // Form controls without an associated label.
  let fieldFails = 0;
  $('input, select, textarea').each((_, el) => {
    const type = ($(el).attr('type') || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) return;
    const id = $(el).attr('id');
    const hasLabel = (id && $(`label[for="${cssEscape(id)}"]`).length) ||
      $(el).closest('label').length ||
      ($(el).attr('aria-label') || '').trim() ||
      ($(el).attr('aria-labelledby') || '').trim() ||
      ($(el).attr('title') || '').trim();
    if (!hasLabel) { fieldFails++; push('Form field has no label', el); }
  });

  const total = linkFails + btnFails + imgFails + fieldFails;
  const score = Math.max(0, 1 - total / 20);
  return {
    id: 'accessibility_tree',
    label: 'Accessibility tree',
    weight: 0.45,
    score,
    status: total === 0 ? 'pass' : total <= 6 ? 'warn' : 'fail',
    summary: total === 0
      ? 'Every link, button, image and field exposes a name agents can read.'
      : `${total} element${total === 1 ? '' : 's'} an AI agent can't read — ${linkFails} link(s), ${btnFails} button(s), ${imgFails} image(s), ${fieldFails} field(s).`,
    fix: 'Give every interactive element a readable name: text inside links/buttons (or aria-label on icon-only ones), an alt attribute on images, and a <label> on each form field.',
    counts: { links: linkFails, buttons: btnFails, images: imgFails, fields: fieldFails },
    items: issues,
  };
}

function checkLayoutStability($) {
  const issues = [];
  let missing = 0, media = 0;
  $('img, iframe, video').each((_, el) => {
    media++;
    const $el = $(el);
    const hasDims = ($el.attr('width') && $el.attr('height')) ||
      /(?:^|;)\s*aspect-ratio\s*:/.test($el.attr('style') || '') ||
      $el.attr('loading') === 'lazy' && $el.attr('width'); // width alone + lazy is acceptable
    if (!hasDims) {
      missing++;
      if (issues.length < MAX_EXAMPLES) issues.push({ issue: 'Media has no reserved width/height', selector: elSelector($, el), snippet: snippet($.html(el)) });
    }
  });
  const score = media === 0 ? 1 : Math.max(0, 1 - missing / Math.max(8, media * 0.5));
  return {
    id: 'layout_stability',
    label: 'Layout stability',
    weight: 0.35,
    score,
    status: missing === 0 ? 'pass' : missing <= 5 ? 'warn' : 'fail',
    summary: missing === 0
      ? 'Images and embeds reserve their space — the page won\'t jump as it loads.'
      : `${missing} of ${media} media element(s) don't reserve space, which can shift the layout as the page loads (a CLS risk).`,
    fix: 'Set explicit width and height attributes (or a CSS aspect-ratio) on images, iframes and videos so the browser reserves their space before they load.',
    counts: { media, missing },
    items: issues,
  };
}

async function checkLlmsTxt(baseUrl) {
  let res;
  try { res = await fetchText(new URL('/llms.txt', baseUrl).toString()); }
  catch { res = { status: 0, body: '', contentType: '' }; }
  // A 401/403/429 means the site blocked our request, not that the file is
  // absent — don't claim it's missing in that case.
  const blocked = [401, 403, 429].includes(res.status);
  const present = res.status >= 200 && res.status < 300 && res.body.trim().length > 0 && !/<html/i.test(res.body);
  const hasH1 = present && /^#\s+\S/m.test(res.body);
  const score = present ? (hasH1 ? 1 : 0.5) : 0;
  return {
    id: 'llms_txt',
    label: 'llms.txt',
    weight: 0, // informational, like Lighthouse
    score,
    status: blocked ? 'info' : !present ? 'info' : hasH1 ? 'pass' : 'warn',
    summary: blocked
      ? 'Couldn’t check llms.txt — the site blocked the request. Verify it manually at /llms.txt.'
      : !present
        ? 'No llms.txt found. This optional file tells LLMs how to read and use your site.'
        : hasH1
          ? 'llms.txt is present and well-formed (Markdown with an H1).'
          : 'llms.txt exists but has no H1 heading — LLMs may not parse it as intended.',
    fix: 'Add a Markdown /llms.txt at your domain root with at least one "# H1" heading summarising the site and pointing to your key pages. See llmstxt.org.',
    items: [],
  };
}

function checkMachineReadable($) {
  const checks = [
    { key: 'title', ok: !!$('head > title').first().text().trim(), label: 'Page title' },
    { key: 'description', ok: !!($('head meta[name="description"]').attr('content') || '').trim(), label: 'Meta description' },
    { key: 'h1', ok: $('h1').length === 1, label: 'Exactly one <h1>' },
    { key: 'lang', ok: !!($('html').attr('lang') || '').trim(), label: '<html lang> set' },
    { key: 'canonical', ok: !!$('head link[rel="canonical"]').attr('href'), label: 'Canonical URL' },
    { key: 'structured_data', ok: $('script[type="application/ld+json"]').length > 0, label: 'Structured data (JSON-LD)' },
    { key: 'main', ok: $('main, [role="main"]').length > 0, label: '<main> landmark' },
  ];
  const passed = checks.filter(c => c.ok).length;
  const score = passed / checks.length;
  const missingLabels = checks.filter(c => !c.ok).map(c => c.label);
  return {
    id: 'machine_readable',
    label: 'Machine-readable structure',
    weight: 0.20,
    score,
    status: passed === checks.length ? 'pass' : passed >= checks.length - 2 ? 'warn' : 'fail',
    summary: passed === checks.length
      ? 'Title, description, headings, structured data and landmarks are all in place.'
      : `${passed}/${checks.length} structure signals present. Missing: ${missingLabels.join(', ')}.`,
    fix: 'Give agents the basics they use to understand a page: a title and meta description, a single <h1>, an <html lang>, a canonical URL, JSON-LD structured data, and a <main> landmark.',
    items: checks.map(c => ({ issue: c.label, ok: c.ok })),
  };
}

// A short, stable-ish CSS-y selector for an element (cheerio has no DOM path).
function elSelector($, el) {
  const tag = el.tagName || el.name || 'node';
  const id = $(el).attr('id');
  if (id) return `${tag}#${id}`;
  const cls = ($(el).attr('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
  return cls ? `${tag}.${cls}` : tag;
}
function cssEscape(s) { return String(s).replace(/["\\]/g, '\\$&'); }

async function analyze(clientId) {
  const { rows } = await pool.query('SELECT name, domain FROM clients WHERE id = $1', [clientId]);
  if (!rows.length) { const e = new Error('Client not found'); e.status = 404; throw e; }
  const url = normaliseUrl(rows[0].domain);
  if (!url) { const e = new Error('This client has no website domain set. Add one in Admin › Details first.'); e.status = 400; throw e; }

  // fetchRenderedHtml tries a plain fetch, then escalates to FlareSolverr for
  // Cloudflare-protected sites (when one is configured).
  let page;
  try { page = await fetchRenderedHtml(url, { userAgent: USER_AGENT }); }
  catch (err) { const e = new Error(`Couldn't reach ${url}: ${err.message}`); e.status = 502; throw e; }
  if (!page.html || (page.status >= 400 && page.via !== 'flaresolverr')) {
    const msg = page.status === 429
      ? `${url} rate-limited the check (HTTP 429) even after retries. Wait a minute and run it again; if it persists the site's bot protection is throttling automated requests.`
      : `Couldn't read ${url} (HTTP ${page.status || 'no response'}). If the site is behind Cloudflare or similar bot protection, it may be blocking automated checks.`;
    const e = new Error(msg);
    e.status = 502; throw e;
  }

  const $ = cheerio.load(page.html);
  const checks = [
    checkAccessibilityTree($),
    checkLayoutStability($),
    checkMachineReadable($),
    await checkLlmsTxt(url),
  ];

  // Overall score = weighted mean of the scored checks (llms.txt is
  // informational, weight 0, like Lighthouse's own category).
  const weighted = checks.filter(c => c.weight > 0);
  const totalWeight = weighted.reduce((s, c) => s + c.weight, 0) || 1;
  const overall = Math.round(100 * weighted.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight);
  const grade = overall >= 90 ? 'A' : overall >= 75 ? 'B' : overall >= 50 ? 'C' : overall >= 25 ? 'D' : 'F';

  const report = { url, client: rows[0].name, checked_at: new Date().toISOString(), via: page.via, score: overall, grade, checks };

  // Persist so the panel can show the last result on reload. Best-effort — a
  // failed insert (e.g. migration not yet applied) must not fail the check.
  try {
    await pool.query(
      `INSERT INTO agent_readiness_runs (client_id, url, score, grade, report) VALUES ($1, $2, $3, $4, $5)`,
      [clientId, url, overall, grade, JSON.stringify(report)]
    );
  } catch (err) { console.error('[agent-readiness] persist failed:', err.message); }

  return report;
}

// The most recent stored check for a client (or null), so the tab isn't blank
// on reload. Tolerant of the table not existing yet.
async function getLatest(clientId) {
  try {
    const { rows } = await pool.query(
      `SELECT report FROM agent_readiness_runs WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [clientId]
    );
    return rows.length ? rows[0].report : null;
  } catch (err) { console.error('[agent-readiness] getLatest failed:', err.message); return null; }
}

module.exports = { analyze, getLatest };
