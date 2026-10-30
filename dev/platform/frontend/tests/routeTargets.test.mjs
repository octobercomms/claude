// Every place the app navigates to has to be a place the app can render.
//
// This replaces tabDoors, which I deleted during the URL sweep with the
// reasoning that "a panel row IS the route now, so a screen without a door
// cannot happen." That was wrong in both directions, and both failures shipped:
//
//   - A screen can exist with no row. ClientDetailPage rendered `details`
//     (Setup), `connectors` and `forms`, none of which had a row in
//     nav/sections.js. useScreen maps a slug through the rows, so those three
//     slugs resolved to nothing and fell back to Measure: the cog in the client
//     bar put /dashboard/setup in the address bar and showed you Measure.
//   - A link can point at a route that no longer exists. Five navigations
//     still named /clients/:id/sales-traffic (renamed to /data) and
//     /clients/:id/outreach (moved inside Convert). All five were on the
//     client-login path, which is why nobody hit them.
//
// Neither is a type error, neither throws, and both look like "the link does
// nothing". So this checks the two directions against each other:
//
//   1. every screen a section page renders has a row that reaches it
//   2. every hardcoded /clients/... navigation resolves to a real route
//
//   node --test tests/routeTargets.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { SECTIONS, slugsOf } from '../src/nav/sections.js';

const root = path.join(import.meta.dirname, '..');
const src = path.join(root, 'src');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (/\.jsx?$/.test(e.name) ? [p] : []);
  });
}
const FILES = walk(src);
const read = (f) => fs.readFileSync(f, 'utf8');

// ── 1. every screen a page renders is reachable ──────────────────────────────

// The page component behind each section. Each dispatches on its own variable
// — `tab` mostly, `socialTab` in Shared — so the scan matches any identifier
// ending in "tab" rather than one name.
const SECTION_PAGES = {
  dashboard: 'pages/ClientDetailPage.jsx',
  paid: 'pages/ClientAdsPage.jsx',
  earned: 'pages/ClientPRPage.jsx',
  shared: 'pages/ClientSocialPage.jsx',
  owned: 'pages/ClientSEOPage.jsx',
  convert: 'pages/ClientConvertPage.jsx',
  produce: 'pages/ClientVideoTab.jsx',
};

const TAB_COMPARE = /\b\w*[Tt]ab === '([a-z0-9_]+)'/g;
const TAB_SETTER = /\bset\w*[Tt]ab\('([a-z0-9_]+)'\)/g;

function rowTabs(key) {
  return new Set(SECTIONS[key].groups.flatMap(g => g.rows.map(r => r.tab)));
}

test('every screen a section page renders has a panel row that reaches it', () => {
  // The direction that broke: ClientDetailPage rendered Setup, Connectors and
  // Forms, none of which had a row, so the cog put /dashboard/setup in the
  // address bar and useScreen fell back to Measure.
  const problems = [];
  for (const [key, rel] of Object.entries(SECTION_PAGES)) {
    const file = path.join(src, rel);
    if (!fs.existsSync(file)) { problems.push(`${rel} is missing`); continue; }
    const body = read(file);
    const rows = rowTabs(key);
    for (const m of body.matchAll(TAB_COMPARE)) {
      const t = m[1];
      if (rows.has(t)) continue;
      problems.push(
        `${key}: ${rel} branches on tab '${t}', which nav/sections.js has no row for. `
        + `That slug resolves to nothing and useScreen falls back to '${SECTIONS[key].defaultTab}'.`);
    }
  }
  assert.deepStrictEqual([...new Set(problems)], [], '\n  ' + [...new Set(problems)].join('\n  '));
});

test('every in-page tab switch targets a row that exists', () => {
  // The other half of the same failure, and a silent one: setTab looks the key
  // up with slugForTab and returns early when there is no row, so a button
  // wired to a retired key does nothing at all. Shared's Learn step had a Back
  // button pointing at 'publish' long after that row was merged into Schedule.
  const problems = [];
  for (const [key, rel] of Object.entries(SECTION_PAGES)) {
    const file = path.join(src, rel);
    if (!fs.existsSync(file)) continue;
    const body = read(file);
    const rows = rowTabs(key);
    for (const m of body.matchAll(TAB_SETTER)) {
      const t = m[1];
      if (rows.has(t)) continue;
      problems.push(
        `${key}: ${rel} switches to tab '${t}', which has no row. `
        + `setTab finds no slug for it and returns without navigating, so that control is dead.`);
    }
  }
  assert.deepStrictEqual([...new Set(problems)], [], '\n  ' + [...new Set(problems)].join('\n  '));
});

// The reverse — a row whose screen nothing renders — is deliberately not
// checked here. Pages dispatch in several styles (a group boolean in Paid, a
// numbered step in Shared's factory), so a source scan produces false
// positives, and tests/browser already drives all 90 rows and asserts real
// content on the 87 the stub can feed.

// ── 2. every hardcoded navigation resolves ───────────────────────────────────

// The route table in App.jsx, as path patterns under /clients/:id.
function clientRoutes() {
  const app = read(path.join(src, 'App.jsx'));
  return [...app.matchAll(/path="clients\/:id\/?([^"]*)"/g)].map(m => m[1]);
}

// Build the set of leaves that take a :screen, and those that do not.
function routeShape() {
  const withScreen = new Set();
  const bare = new Set();
  for (const r of clientRoutes()) {
    if (!r) continue;                                  // "clients/:id" itself
    const [leaf, ...rest] = r.split('/');
    if (rest.some(p => p.startsWith(':screen'))) withScreen.add(leaf);
    else bare.add(leaf);
  }
  return { withScreen, bare };
}

test('the route table and the section table name the same leaves', () => {
  const { withScreen } = routeShape();
  const sectionLeaves = new Set(
    Object.values(SECTIONS).filter(s => s.scope === 'client').map(s => s.leaf));
  for (const leaf of sectionLeaves) {
    assert.ok(withScreen.has(leaf),
      `nav/sections.js has a client section at '${leaf}' but App.jsx has no `
      + `clients/:id/${leaf}/:screen? route, so none of its screens can be opened`);
  }
});

test('every hardcoded /clients/... navigation resolves to a real screen', () => {
  const { withScreen, bare } = routeShape();
  const slugsByLeaf = Object.fromEntries(
    Object.values(SECTIONS).filter(s => s.scope === 'client')
      .map(s => [s.leaf, new Set(slugsOf(s))]));

  const problems = [];
  for (const file of FILES) {
    const body = read(file);
    // Every /clients/... string literal in the file, minus the ones that are
    // backend calls. Anchoring on navigate(/to=/href= instead missed the case
    // that prompted this: Layout assigns the path to `workspaceTarget` on one
    // line and renders `to={workspaceTarget}` on another, so the literal sits
    // next to no navigation keyword at all.
    const re = /[`'"](\/clients\/[^`'"\s)]*)/g;
    for (const m of body.matchAll(re)) {
      const raw = m[1];
      // api.get('/clients/…') and fetch('/clients/…') are backend paths that
      // happen to share the prefix.
      const before = body.slice(Math.max(0, m.index - 40), m.index);
      if (/\b(?:api\.\w+|fetch|apiUrl|request)\s*\(\s*$/.test(before)) continue;
      // Normalise the interpolations away: ${id} and friends become one segment.
      const norm = raw.replace(/\$\{[^}]*\}/g, ':v');
      const parts = norm.split('/').filter(Boolean);     // ['clients', ':v', …]
      if (parts.length < 3) continue;                    // /clients or /clients/:id
      const leaf = parts[2];
      const screen = parts[3];
      const where = `${path.relative(root, file)}: ${raw}`;

      if (bare.has(leaf) && !withScreen.has(leaf)) {
        // A leaf route with no :screen (data, brand). Anything after it is wrong.
        if (screen) problems.push(`${where} — /${leaf} takes no screen segment`);
        continue;
      }
      if (!withScreen.has(leaf)) {
        problems.push(`${where} — there is no clients/:id/${leaf} route`);
        continue;
      }
      // A bare section link is fine: it lands on the section's default screen.
      if (!screen || screen.startsWith(':v')) continue;
      const slugs = slugsByLeaf[leaf];
      if (slugs && !slugs.has(screen)) {
        problems.push(
          `${where} — '${screen}' is not a screen of the ${leaf} section. `
          + `useScreen will silently fall back to its default.`);
      }
    }
  }
  assert.deepStrictEqual(problems, [], '\n  ' + problems.join('\n  '));
});
