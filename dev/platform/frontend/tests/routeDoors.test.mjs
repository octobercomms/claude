// Every page needs a door.
//
// Twice in one day a working page turned out to be unreachable. ClientVideoPage
// was imported by nothing, so the reel checks and caption templates mounted on
// it had never been seen by anybody. Then ReportsPage: the route existed, the
// page worked, and the only link to it was a KPI tile that was a link solely
// when a report had failed — so in a quiet week nothing in the app opened it.
// Both were found by a person asking "where am I supposed to be looking?",
// which is the expensive way to find them.
//
// This walks the routes in App.jsx and checks each has at least one link
// somewhere else in src/.
//
// Client-scoped routes (/clients/:id/*) are checked too, from 29 Oct 2026.
// Skipping them hid a third orphan: /clients/:id/brand had no link anywhere
// in the app. The only affordance for Brand kit was a node in the Dashboard's
// setup diagram pointing at ?tab=brand — a tab with no render block, so it
// showed an empty page. A diagram whose job is wayfinding, with a dead link
// in it. They are matched on their literal tail (`/brand`) because the links
// are template literals carrying the client id.
//
// A page that is genuinely URL-only goes in URL_ONLY below, with the reason.
// The list is a decision, not a dumping ground: adding to it is saying out
// loud that nobody is meant to find this page by clicking.
//
// What it does not catch, stated plainly so nobody trusts it further than it
// goes: a door that is sometimes shut. `to={cond ? '/reports' : undefined}`
// reads as a link to this check, because the path does appear in a `to=`, and
// that is exactly the shape Reports shipped with for an afternoon — a tile
// that was only clickable in a week where something had failed. The check
// catches a page with no door at all, which is the ClientVideoPage case and
// the more common one. A conditional link still needs a person to ask whether
// the condition is ever false.
//
//   node --test tests/routeDoors.test.mjs

import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

// Reference pages reached by typing the URL, on purpose.
const URL_ONLY = {
  '/design': 'Living gallery of the shell components. A developer reference, not a place the AM goes.',
  '/proposals/sample': 'A filled-in sample proposal for checking the design. Shared as a link when it is needed.',
  // Superseded: SeoSuite does rankings per client, inside Owned. The global
  // page is left routable while it is decided whether anything still wants it.
  '/rankings': 'Superseded by the per-client rankings in SeoSuite (Owned). Pending removal.',
};

// Client-scoped pages nobody is meant to click to. Same contract as URL_ONLY:
// a decision with a reason, not a dumping ground.
//
// Empty since the URL sweep: /audiences and /ai-visibility were shells around
// panels that already live inside Paid and Owned, and they were deleted along
// with every other redirect-only page rather than left "pending removal".
const CLIENT_URL_ONLY = {};

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.jsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = sourceFiles(SRC);
const appPath = path.join(SRC, 'App.jsx');
const app = readFileSync(appPath, 'utf8');

// Top-level page routes: a literal path, rendering a component rather than a
// redirect, and not client-scoped.
// A redirect is not a page and needs no door of its own — it exists so an
// old link keeps working. `Navigate` is the obvious one; the repo also wraps
// redirects that need to carry a param or a query string in a small component
// named `<Something>Redirect`, and those count the same.
const isRedirect = (el) => el === 'Navigate' || /Redirect$/.test(el);

const allRoutes = [...app.matchAll(/<Route path="([^"]+)" element=\{<(\w+)/g)]
  .map(([, p, el]) => ({ path: '/' + p.replace(/^\//, ''), el }))
  .filter(r => !isRedirect(r.el))
  .filter(r => r.path !== '/' && r.path !== '/*');

const routes = allRoutes.filter(r => !r.path.includes(':'));

// Client-scoped pages: /clients/:id/<tail>. The link is built from a template
// literal, so the tail is what there is to look for.
const clientRoutes = allRoutes
  .filter(r => r.path.startsWith('/clients/:id/'))
  .map(r => ({ ...r, tail: '/' + r.path.split('/').slice(3).join('/') }))
  .filter(r => !r.tail.includes(':'));

// Everything that is not App.jsx — a route defined in App.jsx is not a door.
const haystack = files
  .filter(f => f !== appPath)
  .map(f => readFileSync(f, 'utf8'))
  .join('\n');

// A door is a navigation, not a mention. The first version of this check
// searched for the bare path anywhere in the source, which counted
// `api.get('/reports')` — the page's own data fetch — as a link to itself, and
// so passed cleanly with every real link to Reports deleted. The check has to
// see the thing that actually moves a person: a Link/NavLink `to`, an anchor
// `href`, or a navigate() call.
const doorPatterns = (route) => {
  const r = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The path, optionally followed by a query string, inside a quote or backtick.
  const tail = `${r}(?:\\?[^'"\`]*)?`;
  return [
    new RegExp(`\\bto=\\{?\\s*['"\`]${tail}['"\`]`),
    new RegExp(`\\bhref=\\{?\\s*['"\`]${tail}['"\`]`),
    new RegExp(`\\bnavigate\\(\\s*['"\`]${tail}['"\`]`),
    // Ternaries inside a `to={...}`: to={cond ? '/a' : '/b'}
    new RegExp(`\\bto=\\{[^}]*['"\`]${tail}['"\`]`),
  ];
};

const hasDoor = (route) => doorPatterns(route).some(re => re.test(haystack));

test('App.jsx still declares top-level routes in the shape this test reads', () => {
  // Lower than it was: eleven redirect-only top-level routes went in the URL
  // sweep (/dashboard, /media, /video, /recordings, /reports, /leads,
  // /tenders, /proposals, /manage, /integrations, /lab/checker).
  assert.ok(routes.length >= 6, `found only ${routes.length} top-level routes — the regex has probably stopped matching`);
  assert.ok(routes.some(r => r.path === '/clients'), '/clients should be among them');
});

test('every top-level page is linked from somewhere', () => {
  const orphans = routes.filter(r => !URL_ONLY[r.path] && !hasDoor(r.path));
  assert.deepEqual(
    orphans.map(r => `${r.path} (${r.el})`),
    [],
    'these pages exist and nothing in the app opens them — add a link, or add them to URL_ONLY with a reason',
  );
});

test('Reports is reachable', () => {
  // The specific regression: it was routable, worked, and had no door. Its
  // home is now a Settings tab, so that is what has to be linked — checking
  // /reports would pass on the redirect alone and prove nothing.
  assert.ok(hasDoor('/settings/reports'), 'the Reports screen needs a link outside App.jsx');
});

test('a redirect is not counted as a page needing a door', () => {
  assert.equal(isRedirect('Navigate'), true);
  assert.equal(isRedirect('ClientHome'), false, 'ClientHome is a component, not a *Redirect name');
  assert.equal(isRedirect('ReportsPage'), false, 'a page is not a redirect because it ends in Page');
});

// A client page is reached by a link ending in its tail inside a template
// literal: `/clients/${id}/brand`, `/clients/${clientId}/social`.
//
// It has to be a navigation, not a mention — the same trap as the top-level
// check, and this one caught it a second time. A first version matched the
// path anywhere, and passed with every real link to Brand kit deleted,
// because ClientTopBar compares `location.pathname` against
// `/clients/${clientId}/brand` to decide whether to light the cog. Reading
// a path is not offering one.
const hasClientDoor = (tail) => {
  const t = tail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const target = `\\$\\{[^}]+\\}${t}(?:\\?[^'"\`]*)?`;
  return [
    new RegExp(`\\bto=\\{?\\s*[\`'"][^'"\`]*${target}[\`'"]`),
    new RegExp(`\\bhref=\\{?\\s*[\`'"][^'"\`]*${target}[\`'"]`),
    new RegExp(`\\bnavigate\\(\\s*[\`'"][^'"\`]*${target}[\`'"]`),
    new RegExp(`\\bto=\\{[^}]*[\`'"][^'"\`]*${target}[\`'"]`),
  ].some(re => re.test(haystack));
};

test('every client-scoped page is linked from somewhere', () => {
  const orphans = clientRoutes
    .filter(r => !CLIENT_URL_ONLY[r.tail] && !hasClientDoor(r.tail))
    .map(r => `${r.path} (${r.el})`);
  assert.deepEqual(orphans, [], 'these client pages exist and nothing opens them');
});

test('the brand kit has exactly one home, and it is inside Setup', () => {
  // This used to assert a link to /clients/:id/brand, because the kit was a
  // standalone route whose only door was a button. Both are gone: the kit
  // renders inside Setup, and the separate route was a second copy of the
  // same component reached by a button a few hundred pixels above the real
  // one. The test now guards the arrangement that replaced it, rather than
  // the one it was written for.
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.ok(!/path="clients\/:id\/brand"/.test(app),
    'the standalone brand route is back; the kit would have two homes again');

  const detail = fs.readFileSync(new URL('../src/pages/ClientDetailPage.jsx', import.meta.url), 'utf8');
  assert.ok(/<ClientBrandPage embedded \/>/.test(detail),
    'the brand kit is not rendered inside Setup, so it has no home at all');
  assert.ok(!/to=\{`\/clients\/\$\{id\}\/brand`\}/.test(detail),
    'a link to the removed standalone route is back');
});

test('CLIENT_URL_ONLY has no stale entries', () => {
  const known = new Set(clientRoutes.map(r => r.tail));
  const gone = Object.keys(CLIENT_URL_ONLY).filter(t => !known.has(t));
  assert.deepEqual(gone, [], 'these client routes no longer exist — drop them from CLIENT_URL_ONLY');
});

test('URL_ONLY has no stale entries', () => {
  const declared = Object.keys(URL_ONLY);
  const known = new Set(routes.map(r => r.path));
  const gone = declared.filter(p => !known.has(p));
  assert.deepEqual(gone, [], 'these routes no longer exist — drop them from URL_ONLY');
});

test('every URL_ONLY entry carries a reason', () => {
  for (const [route, reason] of Object.entries(URL_ONLY)) {
    assert.ok(reason && reason.length > 20, `${route} needs a real reason, not a placeholder`);
  }
});
