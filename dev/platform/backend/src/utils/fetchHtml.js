// Fetch-with-fallback: get a URL's HTML over plain axios, and when that
// response looks like a bot-challenge or an empty JS shell, retry through the
// Camofox stealth browser. This is the integration seam for Camofox — the
// scrapers (siteAudit, competitorPages) call this instead of axios directly.
//
// Design guarantees:
//  - Cheap path first: the overwhelming majority of pages are fetched by axios
//    exactly as today; Camofox is only reached for the minority that need it.
//  - Never throws: a Camofox outage, a missing config, or an empty render all
//    fall back to the original axios result, so behaviour degrades to exactly
//    today's rather than breaking the caller.
//  - Always reports which path served the response via `via`.

const axios = require('axios');
const camofox = require('../services/camofox');
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
    };
  } catch (err) {
    return { status: 0, html: '', contentType: '', responseMs: Date.now() - start, error: err.message };
  }
}

// Fetch `url`, falling back to Camofox on a detected challenge/shell.
// Returns { status, html, contentType, responseMs, finalUrl?, via, ... }.
// `via` is 'axios' or 'camofox'; extra flags (fallbackSkipped/fallbackError/
// fallbackEmpty) explain why a fallback didn't replace the axios result.
async function fetchRenderedHtml(url, opts = {}) {
  const axiosResult = await tryAxios(url, opts);

  if (!needsStealthFetch(axiosResult)) {
    return { ...axiosResult, via: 'axios' };
  }

  // Fallback only makes sense if a Camofox sidecar is actually configured.
  let configured = false;
  try {
    configured = await camofox.isConfigured();
  } catch {
    configured = false;
  }
  if (!configured) {
    return { ...axiosResult, via: 'axios', fallbackSkipped: 'camofox_not_configured' };
  }

  try {
    const html = await camofox.renderHtml(url, opts);
    if (html) {
      return {
        status: 200,
        html,
        contentType: 'text/html',
        responseMs: axiosResult.responseMs,
        finalUrl: axiosResult.finalUrl || url,
        via: 'camofox',
      };
    }
    // Seam not yet wired (renderHtml returns null until verified against a live
    // instance) or an empty render — keep the axios result so the caller still
    // sees the challenge/shell and can flag it (e.g. siteAudit's waf_blocked).
    return { ...axiosResult, via: 'axios', fallbackEmpty: true };
  } catch (err) {
    return { ...axiosResult, via: 'axios', fallbackError: err.message };
  }
}

module.exports = { fetchRenderedHtml };
