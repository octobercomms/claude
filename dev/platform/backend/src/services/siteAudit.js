// Site audit — Organic → Performance → Site audit.
//
// Crawls the client's domain (sitemap-led when available, BFS from
// homepage otherwise), capped at MAX_PAGES, and scores common on-page
// technical issues. Each finding becomes a row in site_audit_issues so
// the AM can action them individually — and the Pipeline → Find "From
// your own site" mode reads from the same table to surface open issues
// as content opportunities.
//
// Conservative defaults: 30-page cap, 800ms between requests (per-host
// rate limit), 12s per-request timeout. Big enough to be useful, small
// enough that the run completes in under two minutes for almost any
// client. Same-origin only; we ignore subdomains for now.

const axios = require('axios');
const cheerio = require('cheerio');
const pool = require('../db');

const MAX_PAGES = 30;
const REQUEST_DELAY_MS = 800;
const REQUEST_TIMEOUT_MS = 12000;
const USER_AGENT = 'Mozilla/5.0 (compatible; OctoberMarketingIntelligence/1.0; +https://platform.octobercomms.com/audit)';

function normalizeRoot(domain) {
  let d = String(domain || '').trim();
  if (!d) return null;
  if (!/^https?:\/\//i.test(d)) d = 'https://' + d;
  try {
    const u = new URL(d);
    return `${u.protocol}//${u.host}`;
  } catch { return null; }
}

async function fetchSitemapUrls(root) {
  try {
    const { data, status } = await axios.get(`${root}/sitemap.xml`, {
      timeout: REQUEST_TIMEOUT_MS, validateStatus: () => true,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (status !== 200 || typeof data !== 'string') return [];
    const urls = Array.from(data.matchAll(/<loc>([^<]+)<\/loc>/g)).map(m => m[1].trim());
    // If sitemap.xml is an index of sub-sitemaps, recurse one level.
    const sub = urls.filter(u => /\.xml(?:\?|$)/.test(u));
    if (sub.length && sub.length === urls.length) {
      const inner = [];
      for (const s of sub.slice(0, 3)) {
        try {
          const r = await axios.get(s, { timeout: REQUEST_TIMEOUT_MS, validateStatus: () => true, headers: { 'User-Agent': USER_AGENT } });
          if (typeof r.data === 'string') {
            inner.push(...Array.from(r.data.matchAll(/<loc>([^<]+)<\/loc>/g)).map(m => m[1].trim()));
          }
        } catch { /* ignore */ }
      }
      return inner;
    }
    return urls;
  } catch { return []; }
}

async function fetchRobotsTxt(root) {
  try {
    const { data, status } = await axios.get(`${root}/robots.txt`, {
      timeout: REQUEST_TIMEOUT_MS, validateStatus: () => true,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (status !== 200 || typeof data !== 'string') return { disallow: [] };
    const disallow = [];
    let appliesToUs = false;
    for (const line of data.split('\n')) {
      const trimmed = line.trim();
      if (/^user-agent:\s*\*/i.test(trimmed)) appliesToUs = true;
      else if (/^user-agent:/i.test(trimmed)) appliesToUs = false;
      else if (appliesToUs && /^disallow:/i.test(trimmed)) {
        const path = trimmed.replace(/^disallow:\s*/i, '').trim();
        if (path) disallow.push(path);
      }
    }
    return { disallow };
  } catch { return { disallow: [] }; }
}

function isBlockedByRobots(pathname, disallow) {
  for (const rule of disallow) {
    if (pathname === rule || pathname.startsWith(rule)) return true;
  }
  return false;
}

// Fetch one page and parse out the audit-relevant fields. Soft-fail
// on errors — the caller turns "fetch failed" into its own issue type
// so we don't lose visibility of broken pages.
async function fetchPage(url) {
  const start = Date.now();
  try {
    const res = await axios.get(url, {
      timeout: REQUEST_TIMEOUT_MS, maxRedirects: 5,
      validateStatus: () => true,
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml' },
    });
    const responseMs = Date.now() - start;
    return {
      url, status: res.status, responseMs,
      contentType: res.headers['content-type'] || '',
      html: typeof res.data === 'string' ? res.data : '',
      finalUrl: res.request?.res?.responseUrl || url,
    };
  } catch (err) {
    return { url, status: 0, responseMs: Date.now() - start, error: err.message };
  }
}

function parsePage(page) {
  if (!page.html || !/html/i.test(page.contentType)) return null;
  const $ = cheerio.load(page.html);
  const title = ($('head > title').first().text() || '').trim();
  const metaDesc = ($('head meta[name="description"]').attr('content') || '').trim();
  const h1s = $('h1').map((_, el) => $(el).text().trim()).get().filter(Boolean);
  const robotsMeta = ($('head meta[name="robots"]').attr('content') || '').toLowerCase();
  const noindex = robotsMeta.includes('noindex');
  // Images with no meaningful alt. Empty-string alt is intentional for
  // decorative images and is correct; treat null/undefined as missing.
  const images = $('img').get();
  const missingAlt = images.filter(img => {
    const alt = $(img).attr('alt');
    return alt === undefined;
  }).length;
  // Visible text content for thin-content detection. Strip script/style.
  $('script, style, noscript').remove();
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const wordCount = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;
  // Internal anchors for BFS continuation.
  const links = $('a[href]').map((_, el) => $(el).attr('href')).get();
  return {
    title, metaDesc, h1s, noindex, missingAlt, totalImages: images.length, wordCount, links,
  };
}

function classifyPageIssues({ page, parsed }) {
  const issues = [];
  const url = page.url;
  if (page.status === 0) {
    issues.push({ category: 'fetch_failed', severity: 'high', detail: page.error || 'Request failed' });
    return issues;
  }
  if (page.status >= 400) {
    issues.push({ category: 'broken_link', severity: 'high', detail: `HTTP ${page.status}` });
    return issues;
  }
  if (!parsed) {
    // Non-HTML response (PDF, image, etc) — not auditable. Skip.
    return issues;
  }
  // Performance proxy
  if (page.responseMs > 3000) {
    issues.push({ category: 'slow_response', severity: page.responseMs > 6000 ? 'high' : 'medium',
      detail: `Response took ${(page.responseMs / 1000).toFixed(1)}s`, metadata: { responseMs: page.responseMs } });
  }
  // Indexability
  if (parsed.noindex) {
    issues.push({ category: 'noindex_blocked', severity: 'high', detail: 'Page is marked noindex' });
  }
  // Meta title
  if (!parsed.title) {
    issues.push({ category: 'missing_meta_title', severity: 'high', detail: 'No <title> tag found' });
  } else if (parsed.title.length < 30 || parsed.title.length > 60) {
    issues.push({ category: 'meta_title_length', severity: 'low',
      detail: `Title is ${parsed.title.length} chars (recommended 30–60)`,
      metadata: { length: parsed.title.length, title: parsed.title } });
  }
  // Meta description
  if (!parsed.metaDesc) {
    issues.push({ category: 'missing_meta_description', severity: 'medium', detail: 'No meta description' });
  } else if (parsed.metaDesc.length < 70 || parsed.metaDesc.length > 160) {
    issues.push({ category: 'meta_description_length', severity: 'low',
      detail: `Meta description is ${parsed.metaDesc.length} chars (recommended 70–160)`,
      metadata: { length: parsed.metaDesc.length } });
  }
  // H1
  if (parsed.h1s.length === 0) {
    issues.push({ category: 'missing_h1', severity: 'medium', detail: 'No <h1> on the page' });
  } else if (parsed.h1s.length > 1) {
    issues.push({ category: 'multiple_h1', severity: 'low',
      detail: `${parsed.h1s.length} <h1> tags found — should be exactly one`,
      metadata: { count: parsed.h1s.length } });
  }
  // Alt text
  if (parsed.missingAlt > 0) {
    issues.push({ category: 'no_alt_text', severity: parsed.missingAlt > 5 ? 'medium' : 'low',
      detail: `${parsed.missingAlt} of ${parsed.totalImages} images missing alt text`,
      metadata: { missing: parsed.missingAlt, total: parsed.totalImages } });
  }
  // Thin content — heuristic only; AM should sanity check. Skips
  // homepages and obvious utility pages.
  const path = (() => { try { return new URL(url).pathname; } catch { return ''; } })();
  const isLikelyArticlePage = /\/(blog|news|article|post|guide|insight)s?\//i.test(path) || path.split('/').filter(Boolean).length >= 2;
  if (isLikelyArticlePage && parsed.wordCount > 0 && parsed.wordCount < 300) {
    issues.push({ category: 'thin_content', severity: parsed.wordCount < 150 ? 'medium' : 'low',
      detail: `Only ${parsed.wordCount} words of visible content`,
      metadata: { wordCount: parsed.wordCount } });
  }
  return issues;
}

// Weighted overall score 0–100. Each issue has a penalty; we sum across
// the whole crawl and cap at 100 floor of 0.
const SEVERITY_PENALTY = { low: 1, medium: 3, high: 8 };
function computeScore(pagesCrawled, issues) {
  if (!pagesCrawled) return null;
  const totalPenalty = issues.reduce((s, i) => s + (SEVERITY_PENALTY[i.severity] || 1), 0);
  // Normalise per page so a 5-page audit isn't unfairly forgiving.
  const perPage = totalPenalty / pagesCrawled;
  return Math.max(0, Math.min(100, Math.round(100 - perPage * 4)));
}

// Discover URLs to crawl. Prefer sitemap.xml; fall back to BFS from
// homepage. Always include the homepage.
async function discoverUrls(root, robotsDisallow) {
  const out = new Set([root]);
  const sitemap = await fetchSitemapUrls(root);
  for (const u of sitemap) {
    try {
      const parsed = new URL(u);
      if (parsed.origin !== root) continue;
      if (isBlockedByRobots(parsed.pathname, robotsDisallow)) continue;
      out.add(parsed.toString());
      if (out.size >= MAX_PAGES) break;
    } catch { /* skip */ }
  }
  return Array.from(out).slice(0, MAX_PAGES);
}

async function bfsFromHomepage(root, robotsDisallow, alreadyKnown) {
  const visited = new Set(alreadyKnown);
  if (visited.size >= MAX_PAGES) return [];
  const queue = [root];
  const additional = [];
  while (queue.length && (visited.size + additional.length) < MAX_PAGES) {
    const url = queue.shift();
    if (visited.has(url) || additional.includes(url)) continue;
    if (!alreadyKnown.has(url)) additional.push(url);
    visited.add(url);
    // Fetch only enough to extract links — but reuse the proper fetch
    // for consistency with audit timing.
    const page = await fetchPage(url);
    const parsed = parsePage(page);
    if (!parsed) continue;
    for (const href of parsed.links || []) {
      if (!href) continue;
      let abs;
      try { abs = new URL(href, url).toString(); } catch { continue; }
      try {
        const u = new URL(abs);
        if (u.origin !== root) continue;
        if (isBlockedByRobots(u.pathname, robotsDisallow)) continue;
        const clean = `${u.origin}${u.pathname}`; // drop hash + query for crawl set
        if (!visited.has(clean) && !queue.includes(clean) && !additional.includes(clean)) {
          queue.push(clean);
        }
      } catch { /* skip */ }
    }
    await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
  }
  return additional;
}

async function runAudit({ clientId }) {
  const { rows: clientRows } = await pool.query('SELECT domain FROM clients WHERE id = $1', [clientId]);
  if (!clientRows.length) throw new Error('Client not found');
  const root = normalizeRoot(clientRows[0].domain);
  if (!root) throw new Error('Client has no usable domain set');

  // Create the audit row up front so the UI can poll for progress.
  const { rows: auditRows } = await pool.query(
    `INSERT INTO site_audits (client_id, domain, status) VALUES ($1, $2, 'running') RETURNING *`,
    [clientId, root]
  );
  const audit = auditRows[0];

  try {
    const robots = await fetchRobotsTxt(root);

    // Build URL list — sitemap first, then BFS to top up.
    let urls = await discoverUrls(root, robots.disallow);
    if (urls.length < 10) {
      const more = await bfsFromHomepage(root, robots.disallow, new Set(urls));
      urls = Array.from(new Set([...urls, ...more])).slice(0, MAX_PAGES);
    }

    const allIssues = [];
    let pagesCrawled = 0;
    for (const url of urls) {
      const page = await fetchPage(url);
      const parsed = parsePage(page);
      const pageIssues = classifyPageIssues({ page, parsed });
      for (const i of pageIssues) {
        allIssues.push({ ...i, page_url: url });
      }
      if (page.status > 0 && page.status < 400) pagesCrawled++;
      await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
    }

    // Group counts per category for the summary card.
    const summary = {};
    for (const i of allIssues) summary[i.category] = (summary[i.category] || 0) + 1;
    const score = computeScore(pagesCrawled, allIssues);

    // Persist issues.
    for (const i of allIssues) {
      await pool.query(
        `INSERT INTO site_audit_issues (audit_id, client_id, page_url, category, severity, detail, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [audit.id, clientId, i.page_url, i.category, i.severity, i.detail || null, i.metadata ? JSON.stringify(i.metadata) : null]
      );
    }

    const updated = await pool.query(
      `UPDATE site_audits SET status = 'complete', pages_crawled = $1, pages_attempted = $2,
         score = $3, summary_json = $4, completed_at = NOW() WHERE id = $5 RETURNING *`,
      [pagesCrawled, urls.length, score, JSON.stringify(summary), audit.id]
    );
    return updated.rows[0];
  } catch (err) {
    await pool.query(
      `UPDATE site_audits SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2`,
      [err.message, audit.id]
    );
    throw err;
  }
}

module.exports = { runAudit };
