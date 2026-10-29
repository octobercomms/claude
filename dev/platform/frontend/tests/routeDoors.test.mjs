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
// This walks the top-level routes in App.jsx and checks each has at least one
// link somewhere else in src/. It deliberately does not check client-scoped
// routes (/clients/:id/*), which are reached through the Workspace sub-nav
// built from a template literal and would need a far looser match to see.
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
const routes = [...app.matchAll(/<Route path="([^"]+)" element=\{<(\w+)/g)]
  .map(([, p, el]) => ({ path: '/' + p.replace(/^\//, ''), el }))
  .filter(r => r.el !== 'Navigate')
  .filter(r => !r.path.includes(':'))
  .filter(r => r.path !== '/' && r.path !== '/*');

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
  assert.ok(routes.length >= 8, `found only ${routes.length} top-level routes — the regex has probably stopped matching`);
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
  // The specific regression: it was routable, worked, and had no door.
  assert.ok(hasDoor('/reports'), 'ReportsPage needs a link somewhere outside App.jsx');
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
