// Bot-challenge / empty-shell detection for the fetch-with-fallback wrapper
// (utils/fetchHtml.js). Kept as a separate, dependency-free module so the
// detection logic is pure and unit-testable without pulling in axios.
//
// The job: decide whether a plain axios response is the REAL page, or a WAF
// interstitial / JS shell that warrants a retry through the Camofox stealth
// browser. False positives just cost a Camofox fetch; false negatives leave a
// challenge page to be parsed as if it were content (today's failure mode in
// siteAudit, which files them as broken links).

// Markers that appear in bot-challenge / WAF interstitial bodies. Matched
// case-insensitively against the first few KB of the response.
const CHALLENGE_MARKERS = [
  'just a moment',
  'checking your browser',
  'cf-browser-verification',
  'cf-challenge',
  '__cf_chl',
  'cf_chl_opt',
  'security verification',
  'sucuri_cloudproxy',
  'sucuri website firewall',
  'attention required',
  'enable javascript and cookies to continue',
  'ddos protection by',
  'please verify you are a human',
];

function isHtmlResponse({ html, contentType }) {
  if (/html/i.test(contentType || '')) return true;
  return /^\s*<!?(doctype|html)/i.test(html || '');
}

// A bot challenge: a blocking status that returns an HTML page (not JSON), or
// a body carrying a known challenge marker regardless of status (some WAFs
// serve the interstitial with a 200).
function looksLikeChallenge({ status, html, contentType }) {
  const html_ = html || '';
  if ([401, 403, 429, 503].includes(status) && isHtmlResponse({ html: html_, contentType })) {
    return true;
  }
  const body = html_.slice(0, 4000).toLowerCase();
  return CHALLENGE_MARKERS.some(m => body.includes(m));
}

// An empty client-rendered shell: a 200 HTML page with a known SPA mount node
// (#root / #app / __next / __nuxt) but negligible human-visible text — the
// real content only appears after JavaScript runs, which axios doesn't do.
// Capped at 60KB so a large server-rendered document isn't mistaken for one.
function looksLikeEmptyShell({ status, html, contentType }) {
  if (status !== 200) return false;
  if (!isHtmlResponse({ html, contentType })) return false;
  const h = html || '';
  if (h.length > 60000) return false;
  const hasMount = /<div[^>]+id=["'](root|app|__next|__nuxt)["']/i.test(h);
  if (!hasMount) return false;
  const text = h
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length < 200;
}

// Single predicate the wrapper uses: should we retry through Camofox?
function needsStealthFetch(result) {
  if (!result || result.status === 0) return true; // network error / no response
  return looksLikeChallenge(result) || looksLikeEmptyShell(result);
}

module.exports = { looksLikeChallenge, looksLikeEmptyShell, needsStealthFetch, CHALLENGE_MARKERS };
