// FlareSolverr — stealth proxy that solves Cloudflare/WAF challenges with a
// real headless browser and returns the SOLVED PAGE HTML. We run it as a
// sibling service on the box (Docker is its standard distribution; bind to
// 127.0.0.1:8191, internal only) and use it as the render backend for the
// fetch-with-fallback wrapper (utils/fetchHtml.js).
//
// Why FlareSolverr and not camofox-browser for this job: our scrapers
// (siteAudit, competitorPages) parse HTML with cheerio, and FlareSolverr
// returns the full page HTML after solving the challenge — exactly what they
// need. (camofox-browser intentionally returns only an accessibility
// snapshot, no raw HTML, so it can't feed cheerio. It's kept in the codebase
// for future agentic/snapshot use, not for this path.)
//
// API (no auth):
//   POST {base}/v1   { cmd: 'request.get', url, maxTimeout, session? }
//     -> { status: 'ok'|'error', message, solution: { status, response (HTML),
//          url, headers, cookies, userAgent } }
//   GET  {base}/     -> { msg: 'FlareSolverr is ready!', version, userAgent }

const axios = require('axios');
const { getSetting } = require('../utils/settings');

const DEFAULT_MAX_TIMEOUT_MS = 60000;

async function baseUrl() {
  const u = await getSetting('FLARESOLVERR_URL');
  return u ? String(u).replace(/\/+$/, '') : null;
}

// True when an operator has set FLARESOLVERR_URL. The wrapper uses this to
// no-op cleanly (stay on axios) when no solver is deployed.
async function isConfigured() {
  return Boolean(await baseUrl());
}

// GET / — liveness ping for the daily health check. Never throws.
async function health() {
  const url = await baseUrl();
  if (!url) return { ok: false, configured: false, message: 'FLARESOLVERR_URL not set in Settings' };
  try {
    const { data } = await axios.get(`${url}/`, { timeout: 8000 });
    const ready = typeof data?.msg === 'string' && /ready/i.test(data.msg);
    return {
      ok: ready,
      configured: true,
      message: ready ? `FlareSolverr reachable (v${data.version || '?'})` : 'Unexpected health response',
      detail: data,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      message: err.response?.status ? `FlareSolverr returned HTTP ${err.response.status}` : err.message,
    };
  }
}

// Solve any challenge on `url` and return the rendered HTML.
// Returns { html, status, finalUrl, userAgent, cookies } or null when the
// solver itself reports failure (so the wrapper can fall back / flag it).
// Throws only on transport errors (caught by the wrapper).
async function render(url, { maxTimeout = DEFAULT_MAX_TIMEOUT_MS } = {}) {
  const base = await baseUrl();
  if (!base) throw new Error('FLARESOLVERR_URL not set in Settings');
  const { data } = await axios.post(
    `${base}/v1`,
    { cmd: 'request.get', url, maxTimeout },
    { headers: { 'Content-Type': 'application/json' }, timeout: maxTimeout + 15000 }
  );
  if (data?.status !== 'ok' || !data?.solution) return null;
  return {
    html: data.solution.response || '',
    status: data.solution.status || 200,
    finalUrl: data.solution.url || url,
    userAgent: data.solution.userAgent || null,
    cookies: data.solution.cookies || [],
  };
}

module.exports = { isConfigured, health, render };
