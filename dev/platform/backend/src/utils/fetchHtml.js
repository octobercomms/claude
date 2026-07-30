// Fetch-with-fallback: get a URL's HTML over plain axios, and when that
// response looks like a bot-challenge or an empty JS shell, retry through
// FlareSolverr (a stealth proxy that solves the challenge and returns the
// rendered page HTML). This is the integration seam for stealth fetching —
// the scrapers (siteAudit, competitorPages) call this instead of axios
// directly.
//
// Design guarantees:
//  - Cheap path first: the overwhelming majority of pages are fetched by axios
//    exactly as today; the solver is only reached for the minority that need it.
//  - Never throws: a solver outage, a missing config, or an empty render all
//    fall back to the original axios result, so behaviour degrades to exactly
//    today's rather than breaking the caller.
//  - Always reports which path served the response via `via`.

const axios = require('axios');
const flaresolverr = require('../services/flaresolverr');
const { needsStealthFetch } = require('./challengeDetect');

const DEFAULT_UA =
  'Mozilla/5.0 (compatible; OctoberMarketingIntelligence/1.0; +https://platform.octobercomms.com)';

async function tryAxios(url, opts) {
  const start = Date.now();
  try {
    const res = await axios.get(url, {
      timeout: opts.timeout || 12000,
      maxRedirects: opts.maxRedirects != null ? opts.maxRedirects : 5,
      validateStatus: () => true,
      headers: {
        'User-Agent': opts.userAgent || DEFAULT_UA,
        Accept: 'text/html,application/xhtml+xml',
        ...(opts.headers || {}),
      },
    });
    return {
      status: res.status,
      html: typeof res.data === 'string' ? res.data : '',
      contentType: res.headers['content-type'] || '',
      responseMs: Date.now() - start,
      finalUrl: res.request?.res?.responseUrl || url,
      retryAfter: res.headers['retry-after'] || null,
    };
  } catch (err) {
    return { status: 0, html: '', contentType: '', responseMs: Date.now() - start, error: err.message };
  }
}

// Fetch `url`, falling back to Camofox on a detected challenge/shell.
// Returns { status, html, contentType, responseMs, finalUrl?, via, ... }.
// `via` is 'axios' or 'camofox'; extra flags (fallbackSkipped/fallbackError/
// fallbackEmpty) explain why a fallback didn't replace the axios result.
// Parse a Retry-After header (delta-seconds or an HTTP-date) into a bounded ms
// wait. Falls back to `fallbackMs` when absent/unparseable; capped so a hostile
// "retry in 3600s" can't hang the request.
function retryAfterMs(header, fallbackMs) {
  const CAP = 6000;
  if (header != null) {
    const secs = Number(header);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, CAP);
    const when = Date.parse(header);
    if (Number.isFinite(when)) return Math.min(Math.max(0, when - Date.now()), CAP);
  }
  return Math.min(fallbackMs, CAP);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchRenderedHtml(url, opts = {}) {
  let axiosResult = await tryAxios(url, opts);

  // Transient rate-limit / unavailable (429 / 503): honour Retry-After (capped)
  // and retry a couple of times before giving up — many sites throttle a first
  // automated hit but serve the retry.
  for (let attempt = 0; (axiosResult.status === 429 || axiosResult.status === 503) && attempt < 2; attempt++) {
    await sleep(retryAfterMs(axiosResult.retryAfter, 1500 * (attempt + 1)));
    axiosResult = await tryAxios(url, opts);
  }

  if (!needsStealthFetch(axiosResult)) {
    return { ...axiosResult, via: 'axios' };
  }

  // Fallback only makes sense if a FlareSolverr instance is actually configured.
  let configured = false;
  try {
    configured = await flaresolverr.isConfigured();
  } catch {
    configured = false;
  }
  if (!configured) {
    return { ...axiosResult, via: 'axios', fallbackSkipped: 'flaresolverr_not_configured' };
  }

  try {
    const solved = await flaresolverr.render(url, opts);
    if (solved && solved.html) {
      return {
        status: solved.status || 200,
        html: solved.html,
        contentType: 'text/html',
        responseMs: axiosResult.responseMs,
        finalUrl: solved.finalUrl || axiosResult.finalUrl || url,
        via: 'flaresolverr',
      };
    }
    // Solver couldn't solve it (or returned nothing) — keep the axios result so
    // the caller still sees the challenge/shell and can flag it (e.g.
    // siteAudit's waf_blocked).
    return { ...axiosResult, via: 'axios', fallbackEmpty: true };
  } catch (err) {
    return { ...axiosResult, via: 'axios', fallbackError: err.message };
  }
}

module.exports = { fetchRenderedHtml };
