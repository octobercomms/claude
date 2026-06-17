// Free lead scraper — fetch a public page through the stealth-aware
// fetchRenderedHtml seam (axios → FlareSolverr fallback, behind the SSRF
// guard) and have Claude extract the real contacts on it. Returns rows in the
// same shape the Hunter/Icypeas finders return, so they flow into the existing
// outreach find → library path (with its email dedupe) unchanged.
//
// This is the "free first pass": no per-lookup cost, built on infra the
// platform already runs. Paid finders stay as the fallback for email-pattern
// guessing where nothing is on the page. See docs/omi/lead-scraper-plan.md.
//
// Slice 1: a single URL. Multi-page crawl + ICP/Serper discovery + run history
// land in later slices.

const claudeService = require('./claude');
const { fetchRenderedHtml } = require('../utils/fetchHtml');
const { assertPublicHttpUrl } = require('../utils/urlSafety');

function normUrl(u) {
  const s = String(u || '').trim();
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, '')}`;
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Keep mailto: targets — they're often the only place an email appears.
    .replace(/<a[^>]+href=["']mailto:([^"'?]+)[^>]*>/gi, ' $1 ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseJson(raw) {
  const cleaned = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); }
  catch { throw new Error(`Claude returned malformed JSON: ${cleaned.slice(0, 200)}`); }
}

const EXTRACT_SYSTEM =
  'You extract real, on-page contact details from a web page for a B2B outreach list. ' +
  'Only return people or contact points that ACTUALLY appear on the page — never invent or guess emails. ' +
  'Include named people (with their role) and generic team inboxes (info@, sales@, press@) when present. ' +
  'British English. Respond with JSON only — no prose, no code fences.';

const EXTRACT_PROMPT = (url, text) => `Page: ${url}

Extract every contact present on this page. Return ONLY a JSON object:
{"contacts":[{"name":"full name or null","first_name":"","last_name":"","role":"job title / role or null","email":"only if literally on the page, else null","phone":"or null","company":"the business this page belongs to","location":"or null","linkedin":"profile URL if present, else null","confidence":"high|medium|low"}]}

Rules:
- Never fabricate an email or guess a pattern (no "firstname@domain"). email must be null unless it appears verbatim on the page.
- A generic inbox (info@, hello@, sales@, press@) is a valid contact: name null, role "General", that email.
- confidence: high = name + role + email present; medium = some fields; low = sparse/uncertain.
- If the page has no contacts at all, return {"contacts":[]}.

Page content (plain text, may be truncated):
"""
${text}
"""`;

// Scrape one URL → array of contacts in the outreach /contacts/bulk shape.
// Fetch a URL (SSRF-guarded) and return its visible text, or null if it can't
// be read. Never throws on fetch failure — callers crawling several pages
// should skip a dead one, not abort the whole run.
async function fetchPageText(rawUrl, { hard = false } = {}) {
  const url = normUrl(rawUrl);
  if (!url) { if (hard) throw new Error('url required'); return null; }
  await assertPublicHttpUrl(url); // SSRF guard — throws (→ 400) on internal/private hosts
  const r = await fetchRenderedHtml(url, { timeout: 15000 });
  if (!r.html || r.status >= 400) {
    if (hard) throw new Error(`Could not fetch ${url} — ${r.status ? `status ${r.status}` : 'no response'}`);
    return null;
  }
  const text = htmlToText(r.html).slice(0, 16000);
  if (text.length < 40) {
    if (hard) throw new Error(`Fetched ${url} but it had no readable text (JS-only shell?).`);
    return { url, text: '', html: r.html };
  }
  return { url, text, html: r.html };
}

// Map one page's text → normalised contacts via Claude.
async function extractContacts(url, text) {
  if (!text || text.length < 40) return [];
  const raw = await claudeService.callClaude({
    max_tokens: 3000,
    system: EXTRACT_SYSTEM,
    user: EXTRACT_PROMPT(url, text),
    feature: 'lead_scrape',
  });
  const list = Array.isArray(parseJson(raw)?.contacts) ? parseJson(raw).contacts : [];
  return list
    .map((c) => {
      const name = (c.name || [c.first_name, c.last_name].filter(Boolean).join(' ') || '').trim() || null;
      const email = c.email && /@/.test(c.email) ? String(c.email).trim() : null;
      if (!name && !email) return null; // nothing to act on
      return {
        name,
        first_name: c.first_name || null,
        last_name: c.last_name || null,
        email,
        company: c.company || null,
        role: c.role || c.title || null,
        title: c.title || c.role || null,
        location: c.location || null,
        linkedin_url: c.linkedin || c.linkedin_url || null,
        website: url,
        source: 'scrape',
        confidence: ['high', 'medium', 'low'].includes(c.confidence) ? c.confidence : null,
      };
    })
    .filter(Boolean);
}

// Single page → contacts (the slice-1 path).
async function scrapeUrl(rawUrl) {
  const page = await fetchPageText(rawUrl, { hard: true });
  return extractContacts(page.url, page.text);
}

// Find same-host Contact/About/Team-style links on a page to crawl for more
// contacts. Capped, deduped, homepage excluded (the caller already has it).
const CONTACT_PATH_RE = /(contact|about|team|people|our[-_]?team|meet[-_]?the|staff|leadership|directors?|founders?)/i;
function sameHost(a, b) { try { return new URL(a).host === new URL(b).host; } catch { return false; } }
function discoverContactLinks(html, baseUrl, max = 4) {
  const out = [];
  const seen = new Set([baseUrl.replace(/\/$/, '')]);
  const re = /<a[^>]+href=["']([^"'<>]+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null && out.length < max) {
    const href = m[1].trim();
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    let abs;
    try { abs = new URL(href, baseUrl).toString().split('#')[0].replace(/\/$/, ''); } catch { continue; }
    if (!sameHost(abs, baseUrl) || seen.has(abs)) continue;
    let pathname; try { pathname = new URL(abs).pathname; } catch { continue; }
    if (CONTACT_PATH_RE.test(pathname)) { out.push(abs); seen.add(abs); }
  }
  return out;
}

// Crawl a site: the given page + its Contact/About/Team pages, merged and
// deduped by email-or-name. Per-page failures are skipped so one bad page
// doesn't sink the run.
async function scrapeSite(rawUrl, { maxPages = 5 } = {}) {
  const home = await fetchPageText(rawUrl, { hard: true });
  const extraUrls = discoverContactLinks(home.html, home.url, maxPages - 1);
  const dedup = new Map(); // email|name(lower) → contact
  const addAll = (contacts) => {
    for (const c of contacts) {
      const key = (c.email || c.name || '').toLowerCase();
      if (key && !dedup.has(key)) dedup.set(key, c);
    }
  };
  addAll(await extractContacts(home.url, home.text));
  for (const u of extraUrls) {
    let page;
    try { page = await fetchPageText(u); } catch { continue; } // SSRF/etc — skip
    if (!page || !page.text) continue;
    try { addAll(await extractContacts(page.url, page.text)); } catch { /* skip bad page */ }
  }
  return { contacts: Array.from(dedup.values()), pages_scraped: 1 + extraUrls.length, pages: [home.url, ...extraUrls] };
}

module.exports = { scrapeUrl, scrapeSite };
