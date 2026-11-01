// The single place a 401 turns into a trip to the login screen.
//
// It used to be three copies of `window.location.href = '/login'`, one per
// transport (fetch, XHR upload, download). On 1 November one of them locked
// OMI's login screen into a reload loop: FeatureCostProvider sits above the
// router, so it mounts on every page including /login, and it asked an
// admin-only endpoint for what each AI feature costs. Signed out, that
// answers 401. The 401 branch navigated to /login. The app remounted, the
// provider asked again, and the page reloaded about sixteen times a second.
// What Daniel saw was a flickering login screen.
//
// A navigation to the page you are already on cannot fix a missing session,
// so this refuses to make it. Same for the pages that have no session by
// design — a share link, a proposal, an approval, a password reset — where
// bouncing a client to a login form they have no account for would replace
// the thing they were sent with a dead end.
//
// Returns true when it navigated, so a caller can tell "on its way to login"
// from "stayed put, handle this error".

// Public addresses: reachable with no session, by someone who may not have
// an account at all. Kept in step with the public routes in App.jsx.
const PUBLIC_PREFIXES = [
  '/login',
  '/approve/',
  '/coverage/',
  '/press-release/',
  '/share/',
  '/watch/',
  '/p/',
  '/b/',
  '/set-password/',
];

export function isPublicPath(pathname) {
  return PUBLIC_PREFIXES.some(p => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p || pathname.startsWith(p + '/')));
}

export function bounceToLogin() {
  if (typeof window === 'undefined') return false;
  if (isPublicPath(window.location.pathname)) return false;
  window.location.href = '/login';
  return true;
}

export default bounceToLogin;
