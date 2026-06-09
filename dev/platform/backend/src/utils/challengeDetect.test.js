// Standalone fixture tests for challengeDetect.js. No test framework in this
// project, so this runs with plain `node src/utils/challengeDetect.test.js`
// and exits non-zero on the first failure. Pure module — no axios needed.

const assert = require('assert');
const { looksLikeChallenge, looksLikeEmptyShell, needsStealthFetch } = require('./challengeDetect');

let passed = 0;
function check(name, cond) {
  assert.ok(cond, `FAILED: ${name}`);
  passed++;
}

// ── Fixtures ────────────────────────────────────────────────────────────────
const cloudflare = {
  status: 403,
  contentType: 'text/html; charset=UTF-8',
  html: '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>' +
        '<div class="cf-browser-verification">Checking your browser before accessing.</div></body></html>',
};
const sucuri = {
  status: 200, // Sucuri often serves its interstitial with a 200
  contentType: 'text/html',
  html: '<html><body>Sucuri WebSite Firewall - Access Denied. ' +
        'Please enable JavaScript and cookies to continue.</body></html>',
};
const cf503 = {
  status: 503,
  contentType: 'text/html',
  html: '<html><body>Attention Required! | Cloudflare</body></html>',
};
const emptyNextShell = {
  status: 200,
  contentType: 'text/html',
  html: '<!DOCTYPE html><html><head><title>App</title></head><body>' +
        '<div id="__next"></div><script src="/_next/static/chunks/main.js"></script></body></html>',
};
const realPage = {
  status: 200,
  contentType: 'text/html',
  html: '<!DOCTYPE html><html><head><title>Acme Garden Designer</title>' +
        '<meta name="description" content="Bespoke garden design in Surrey."></head><body>' +
        '<h1>Bespoke garden design</h1><p>' + 'We design beautiful gardens across the south east. '.repeat(20) +
        '</p></body></html>',
};
const jsonApi = {
  status: 200,
  contentType: 'application/json',
  html: '{"orders":[{"id":1},{"id":2}]}',
};
const networkError = { status: 0, contentType: '', html: '', error: 'ETIMEDOUT' };

// ── Challenge detection ─────────────────────────────────────────────────────
check('cloudflare 403 is a challenge', looksLikeChallenge(cloudflare));
check('sucuri 200-with-marker is a challenge', looksLikeChallenge(sucuri));
check('cloudflare 503 is a challenge', looksLikeChallenge(cf503));
check('real page is NOT a challenge', !looksLikeChallenge(realPage));
check('empty shell is NOT a challenge', !looksLikeChallenge(emptyNextShell));
check('json api is NOT a challenge', !looksLikeChallenge(jsonApi));

// ── Empty-shell detection ───────────────────────────────────────────────────
check('next shell is an empty shell', looksLikeEmptyShell(emptyNextShell));
check('real page is NOT an empty shell', !looksLikeEmptyShell(realPage));
check('cloudflare page is NOT an empty shell (no mount node)', !looksLikeEmptyShell(cloudflare));
check('json api is NOT an empty shell', !looksLikeEmptyShell(jsonApi));

// ── Combined predicate ──────────────────────────────────────────────────────
check('network error needs stealth fetch', needsStealthFetch(networkError));
check('cloudflare needs stealth fetch', needsStealthFetch(cloudflare));
check('empty shell needs stealth fetch', needsStealthFetch(emptyNextShell));
check('real page does NOT need stealth fetch', !needsStealthFetch(realPage));
check('json api does NOT need stealth fetch', !needsStealthFetch(jsonApi));

console.log(`challengeDetect: ${passed} assertions passed`);
