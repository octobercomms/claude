// The login screen must not reload itself.
//
// 1 November, deployed 13:12, reported within the hour: "the login screen is
// flickering for OMI". It was not a flicker. It was 94 full page loads in six
// seconds, measured in Chromium against the built app.
//
// The chain: FeatureCostProvider sits above BrowserRouter, so it mounts on
// every page including the ones with no session — the login form, a client's
// share link, a proposal, an approval, a password reset. It asked
// /settings/usage/feature-costs, which is behind router.use(authenticate), so
// signed out it answered 401. The api layer's 401 branch did
// window.location.href = '/login'. The app remounted, the provider asked
// again, and round it went at about sixteen reloads a second.
//
// Two things were wrong and both are fixed here:
//   - the provider asked a question only a signed-in admin can answer, before
//     knowing whether anyone was signed in
//   - a 401 navigated to a page it was already on, which cannot fix a missing
//     session and can only repeat
//
// The second is the one that matters: any future provider mounted above the
// router would otherwise rediscover this the same way.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FE = path.join(__dirname, '..', '..', 'frontend');
const read = (p) => fs.readFileSync(path.join(FE, p), 'utf8');
let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

const guardSrc = read('src/utils/bounceToLogin.js');
const api = read('src/utils/api.js');
const featureCost = read('src/components/FeatureCost.jsx');
const app = read('src/App.jsx');

// The guard is a pure function over window.location, so run the real thing
// rather than reading it. Strip the ES module keywords and hand it a window.
function loadGuard(pathname) {
  const body = guardSrc
    .replace(/^export default .*$/m, '')
    .replace(/\bexport (function|const)\b/g, '$1');
  const fn = new Function('window', `${body}\nreturn { isPublicPath, bounceToLogin };`);
  let went = null;
  const win = { location: { pathname, get href() { return went; }, set href(v) { went = v; } } };
  const mod = fn(win);
  return { ...mod, went: () => went };
}

ok('a 401 on the login page does not navigate to the login page', () => {
  const g = loadGuard('/login');
  assert.strictEqual(g.bounceToLogin(), false, 'it refuses the trip');
  assert.strictEqual(g.went(), null, 'and nothing was assigned to location.href');
});

ok('nor on any page a client is sent to without an account', () => {
  // Each of these is a real public route in App.jsx. A client following a
  // share link has no OMI login; replacing the video with a login form is
  // worse than the error the 401 came from.
  for (const p of [
    '/share/abc123', '/watch/abc123', '/coverage/tok', '/press-release/tok',
    '/approve/tok', '/p/tok', '/b/tok', '/set-password/tok',
  ]) {
    const g = loadGuard(p);
    assert.strictEqual(g.bounceToLogin(), false, `${p} stays put`);
    assert.strictEqual(g.went(), null, `${p} did not navigate`);
  }
});

ok('but a 401 inside the app still bounces', () => {
  // The guard narrows the rule; it must not remove it. An expired session on
  // a real screen is exactly what the redirect is for.
  for (const p of ['/clients', '/clients/c1/dashboard', '/settings/connections', '/rankings', '/']) {
    const g = loadGuard(p);
    assert.strictEqual(g.bounceToLogin(), true, `${p} bounces`);
    assert.strictEqual(g.went(), '/login', `${p} went to the login form`);
  }
});

ok('a prefix is not matched halfway through a segment', () => {
  // '/p/' must not make '/proposals/9' public: that is an app screen behind
  // the session, and silently not bouncing it would strand someone on a page
  // that cannot load.
  for (const p of ['/proposals/9', '/biz-dev/leads', '/logins', '/approvex']) {
    assert.strictEqual(loadGuard(p).isPublicPath(p), false, `${p} is not public`);
  }
});

ok('every public route in App.jsx is covered by the guard', () => {
  // The list in bounceToLogin.js has to track the router. A public route
  // added without one is the next flicker.
  const g = loadGuard('/login');
  const routes = [...app.matchAll(/<Route path="(\/[^"]*)" element=\{<(\w+)/g)]
    .map(([, p, el]) => ({ p, el }))
    // The protected tree is the block under ProtectedRoute; its children are
    // relative paths with no leading slash, so they never match above.
    .filter(r => r.p !== '/');
  const publicEls = new Set([
    'LoginPage', 'ApprovePage', 'PublicCoveragePage', 'PressReviewPage',
    'WatchPage', 'ProposalPublicPage', 'BookingManagePage', 'SetPasswordPage',
  ]);
  const pub = routes.filter(r => publicEls.has(r.el));
  assert.ok(pub.length >= 9, `found the public routes (${pub.length})`);
  for (const r of pub) {
    const concrete = r.p.replace(/:[A-Za-z]+\??/g, 'tok');
    assert.strictEqual(g.isPublicPath(concrete), true, `${r.p} (${concrete}) is in the guard's list`);
  }
});

ok('no transport sets location.href for a 401 on its own any more', () => {
  // Three copies of the redirect existed: fetch, the XHR upload, the download
  // helper. One guarded transport and two unguarded ones is the same bug with
  // a longer reproduction.
  const raw = api.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /location\.href\s*=\s*['"]\/login/.test(l));
  assert.deepStrictEqual(raw, [], `api.js still redirects directly: ${JSON.stringify(raw)}`);
  const calls = (api.match(/bounceToLogin\(\)/g) || []).length;
  assert.strictEqual(calls, 3, `all three transports go through the guard (${calls})`);
  assert.ok(/import \{ bounceToLogin \} from '\.\/bounceToLogin'/.test(api), 'and it is imported');
});

ok('the cost provider waits until somebody is signed in', () => {
  assert.ok(/useAuth/.test(featureCost), 'it reads the auth state');
  const eff = featureCost.slice(featureCost.indexOf('useEffect'));
  assert.ok(/if \(loading \|\| !isAuthenticated\) return/.test(eff),
    'and returns before the fetch when there is no session');
  assert.ok(/\}, \[isAuthenticated, loading\]\)/.test(eff),
    'and re-runs once the session arrives, or the number never appears');
});

ok('and it is still mounted above the router, which is why this mattered', () => {
  // If this ever moves inside the protected tree the gate becomes redundant
  // rather than wrong. Asserting the position keeps the comment honest.
  const at = app.indexOf('<FeatureCostProvider>');
  const router = app.indexOf('<BrowserRouter>');
  assert.ok(at > -1, 'FeatureCostProvider is mounted');
  assert.ok(router > -1, 'and BrowserRouter is where it was');
  assert.ok(at < router, 'FeatureCostProvider wraps BrowserRouter');
});

console.log(`${passed} guards`);
console.log('---');
console.log('LOGIN DOES NOT FLICKER');
