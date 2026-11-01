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
import { createRequire } from 'node:module';
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
// A *render* branch, not any comparison: a JSX expression that switches on the
// tab. Direction 2 needs this narrower match because the pages also compare the
// tab inside useEffect data loaders — `if (tab === 'monitor') loadMonitor()` —
// and counting those as "renders it" let two rows that opened a blank screen
// pass.
const RENDER_BRANCH = /^\s*\{(?:!?\w+\s*&&\s*)*\w*[Tt]ab === '([a-z0-9_]+)'\s*&&/gm;
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

// Rows whose screen is reached some other way than a `tab === 'x'` branch.
// Each needs a reason: "the scan does not see it" is how a blank screen hides.
const DISPATCHED_ELSEWHERE = {
  // Paid groups its screens — `currentGroup === 'measure'` renders the whole
  // measure group rather than one branch per row.
  paid: ['measure'],
  // Convert's five Outreach rows are one branch: ClientOutreachPage takes the
  // screen as a prop and renders it, the way SettingsPage serves three
  // sections. Five `tab === 'x' && <ClientOutreachPage screen="x">` branches
  // would differ only in the string and would be worse code written to satisfy
  // this scan. The check below keeps the entry honest.
  convert: ['campaigns', 'contacts', 'tasks', 'sending', 'prospecting'],
};

test('nothing is allowlisted that is no longer a row', () => {
  // The half the check below does not cover. It asks whether the page still
  // mentions the tab; this asks whether the panel still offers it. An entry
  // that outlives its row is dead weight that reads as a decision, and the
  // next person widening the list has no way to tell the two apart.
  const problems = [];
  for (const [key, tabs] of Object.entries(DISPATCHED_ELSEWHERE)) {
    assert.ok(SECTION_PAGES[key], `DISPATCHED_ELSEWHERE names section '${key}', which has no page`);
    const rows = new Set(SECTIONS[key].groups.flatMap(g => g.rows.map(r => r.tab)));
    for (const t of tabs) {
      if (!rows.has(t)) problems.push(`${key}: '${t}' is allowlisted but is no longer a row`);
    }
  }
  assert.deepStrictEqual(problems, [], '\n  ' + problems.join('\n  '));
});

test('every panel row points at a screen its page renders', () => {
  // The other direction, and the one a row-level mutation slips through: a row
  // whose tab nothing renders is a menu item that opens a blank page. It is
  // checked here rather than left to the browser drive because the drive does
  // not run in CI.
  //
  // Rows carrying a `step` drive Shared's numbered factory rather than a
  // branch, so the step is what reaches them.
  const problems = [];
  for (const [key, rel] of Object.entries(SECTION_PAGES)) {
    const file = path.join(src, rel);
    if (!fs.existsSync(file)) continue;
    const body = read(file);
    const rendered = new Set([...body.matchAll(RENDER_BRANCH)].map(m => m[1]));
    const allowed = DISPATCHED_ELSEWHERE[key] || [];
    for (const g of SECTIONS[key].groups) {
      for (const r of g.rows) {
        if (r.step) continue;
        if (rendered.has(r.tab) || allowed.includes(r.tab)) continue;
        problems.push(
          `${key}: row '${r.label}' (tab '${r.tab}') — ${rel} never renders it, `
          + `so that row opens a blank screen.`);
      }
    }
  }
  assert.deepStrictEqual(problems, [], '\n  ' + problems.join('\n  '));
});


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

test('the dispatched-elsewhere list cannot hide a screen that is simply missing', () => {
  // An allow-list is only as good as the discipline around it, and widening it
  // is the cheapest way to make the test above go quiet. A page that renders a
  // tab some other way still mentions that tab somewhere; one that has no
  // screen for it does not mention it at all.
  const problems = [];
  for (const [key, tabs] of Object.entries(DISPATCHED_ELSEWHERE)) {
    const body = read(path.join(src, SECTION_PAGES[key]));
    for (const t of tabs) {
      if (new RegExp(`'${t}'`).test(body)) continue;
      problems.push(
        `${key}: '${t}' is allow-listed as dispatched elsewhere, but `
        + `${SECTION_PAGES[key]} never mentions it. That row opens a blank screen.`);
    }
  }
  assert.deepStrictEqual(problems, [], '\n  ' + problems.join('\n  '));
});

test('every search result opens a screen that exists', () => {
  // The search endpoint hands back a section leaf and a screen slug per kind of
  // record, and this side builds the path from them. A renamed screen would
  // leave search pointing at a slug that resolves to the section default: no
  // error, just the wrong page. Checked here rather than in the backend test
  // because that one cannot import this ES module, and parsing it with a regex
  // read tab keys where it meant slugs.
  //
  // From globalSearch.entities.js, not the service: this job installs only the
  // frontend's dependencies, and the service reaches src/db.js and `pg`. The
  // first version imported the service and failed in CI having passed locally,
  // where the backend's node_modules happen to be sitting there.
  const req = createRequire(import.meta.url);
  const { ENTITIES } = req(
    path.join(src, '..', '..', 'backend', 'src', 'services', 'globalSearch.entities.js'));
  assert.ok(ENTITIES.length >= 6, `only ${ENTITIES.length} searchable entities — did the list move?`);

  const byLeaf = Object.fromEntries(
    Object.values(SECTIONS).filter(s => s.scope === 'client')
      .map(s => [s.leaf, new Set(slugsOf(s))]));

  const problems = [];
  for (const e of ENTITIES) {
    const slugs = byLeaf[e.leaf];
    if (!slugs) { problems.push(`${e.type}: no client section has leaf '${e.leaf}'`); continue; }
    if (!slugs.has(e.screen)) {
      problems.push(
        `${e.type} opens /${e.leaf}/${e.screen}, which is not a screen of that section — `
        + `search would land on its default. Screens: ${[...slugs].join(', ')}`);
    }
  }
  assert.deepStrictEqual(problems, [], '\n  ' + problems.join('\n  '));
});

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

// Every navigation in one file's source, judged against the route table.
//
// Extracted from the test below so the test can also feed it source of its
// own: a scanner with no positive control is one `continue` away from passing
// on everything, and that mutation escaped the first time it was tried.
function scanNavigations(body, label, { withScreen, bare }, slugsByLeaf) {
  const problems = [];
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
    // Normalise the interpolations away: ${id} and friends become one segment,
    // and drop any query or hash — a screen is addressed by the path, and
    // `/pr/releases?open=<id>` is a real navigation the palette makes, not a
    // screen called "releases?open=<id>".
    const norm = raw.replace(/\$\{[^}]*\}/g, ':v').split(/[?#]/)[0];
    const parts = norm.split('/').filter(Boolean);     // ['clients', ':v', …]
    if (parts.length < 3) continue;                    // /clients or /clients/:id
    const leaf = parts[2];
    const screen = parts[3];
    const where = `${label}: ${raw}`;

    // An interpolated section cannot be checked from the source: the value
    // arrives at runtime. The one place that does this is the search
    // palette, opening a record at the leaf and screen the search endpoint
    // named, and the pair is checked against this same table by 'every
    // search result opens a screen that exists' above.
    if (leaf.startsWith(':v')) continue;

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
  return problems;
}

function clientSlugsByLeaf() {
  return Object.fromEntries(
    Object.values(SECTIONS).filter(s => s.scope === 'client')
      .map(s => [s.leaf, new Set(slugsOf(s))]));
}

test('every hardcoded /clients/... navigation resolves to a real screen', () => {
  const shape = routeShape();
  const slugsByLeaf = clientSlugsByLeaf();
  const problems = FILES.flatMap(
    file => scanNavigations(read(file), path.relative(root, file), shape, slugsByLeaf));
  assert.deepStrictEqual(problems, [], '\n  ' + problems.join('\n  '));
});

test('the navigation scan actually rejects a bad path', () => {
  // The control. The scan above reports nothing when the app is correct, which
  // is also what it reports when the scan is broken — and it was: making its
  // interpolated-section exemption unconditional left every real navigation
  // unchecked and all seven tests still green.
  const shape = routeShape();
  const slugsByLeaf = clientSlugsByLeaf();
  const leaf = Object.keys(slugsByLeaf).find(l => shape.withScreen.has(l));
  assert.ok(leaf, 'no client section has a :screen route — the route table is not being read');
  const slug = [...slugsByLeaf[leaf]][0];

  const cases = [
    [`navigate('/clients/abc/not-a-section/measure')`, 'an unknown section'],
    [`navigate(\`/clients/\${id}/${leaf}/not-a-screen\`)`, 'an unknown screen'],
    [`navigate('/clients/abc/${leaf}/not-a-screen?open=xyz')`, 'an unknown screen behind a query'],
  ];
  for (const [source, what] of cases) {
    assert.ok(scanNavigations(source, 'control', shape, slugsByLeaf).length,
      `the scan passed ${what}: ${source}`);
  }

  // And does not cry wolf over the three shapes that are legitimate.
  const fine = [
    `navigate('/clients')`,
    // The palette's own shape: a real screen plus the record to open on it.
    `navigate('/clients/abc/${leaf}/${slug}?open=xyz')`,
    `navigate(\`/clients/\${id}\`)`,
    `navigate(\`/clients/\${id}/${leaf}\`)`,
    `navigate('/clients/abc/${leaf}/${slug}')`,
    `api.get(\`/clients/\${id}/anything\`)`,
  ];
  for (const source of fine) {
    assert.deepStrictEqual(scanNavigations(source, 'control', shape, slugsByLeaf), [],
      `the scan rejected a legitimate path: ${source}`);
  }
});

// ── 3. every hardcoded top-level navigation resolves to a real route ─────────
//
// Direction 2 only looks at /clients/… paths, which is how the next one got
// through: Snapshot Studio's "All leads" button navigated to '/leads'. There
// is a leads/:id route and no /leads one, so the button put a dead path in the
// address bar and rendered nothing. The leads list is at /biz-dev/leads.
//
// Same failure as the five client links direction 2 was written for, one level
// up, so the scan belongs one level up too.

// The top-level route shapes App.jsx can render, as first segments. A route
// with a parameter in it needs the parameter, so `leads/:id` means /leads is
// not renderable on its own — which is the whole point.
function topLevelRoutes() {
  const app = read(path.join(src, 'App.jsx'));
  const exact = new Set();      // renderable with nothing after them
  const needsMore = new Set();  // first segment that requires a further one
  for (const m of app.matchAll(/<Route\s+path="([^"]+)"/g)) {
    const p = m[1].replace(/^\//, '');
    if (!p) { exact.add(''); continue; }
    const segs = p.split('/');
    const first = segs[0];
    const rest = segs.slice(1);
    // An optional :screen? still renders the bare section.
    if (!rest.length || rest.every(s => s.endsWith('?'))) exact.add(first);
    else needsMore.add(first);
  }
  return { exact, needsMore };
}

// Global sections address their screens as <leaf>/<slug>, so their slugs are
// checked the same way client sections' are.
function globalSlugsByLeaf() {
  return Object.fromEntries(
    Object.values(SECTIONS).filter(s => s.scope === 'global')
      .map(s => [s.leaf, new Set(slugsOf(s))]));
}

// Anchored on the navigations themselves, unlike direction 2.
//
// Direction 2 can match every quoted /clients/… path because that prefix
// belongs to the router and nothing else. A top-level path has no such
// marker: the first version of this matched /g (a regex flag), /100 (a
// score), /logo-black (an image) and sixteen backend routes whose api.get
// sat on the line above. A scan that reports twenty-two false positives is
// one nobody keeps, so this reads only navigate(), to= and href=, and
// accepts the known gap — a path assigned to a variable first is not seen.
const NAV_SITES = [
  /\bnavigate\(\s*[`'"]([^`'"]+)/g,
  /\bto=\{?\s*[`'"]([^`'"]+)/g,
  /\bhref=\{?\s*[`'"]([^`'"]+)/g,
  /\bwindow\.location(?:\.href)?\s*=\s*[`'"]([^`'"]+)/g,
];

function scanTopLevel(body, label, routes, globalSlugs) {
  const problems = [];
  const found = [];
  for (const re of NAV_SITES) for (const m of body.matchAll(re)) found.push(m[1]);
  for (const raw of found) {
    // Off-site, in-page and scheme links are not routes.
    if (!raw.startsWith('/')) continue;
    if (/^\/api\//.test(raw)) continue;
    // Direction 2 owns the client paths.
    if (/^\/clients(\/|$)/.test(raw)) continue;
    const norm = raw.replace(/\$\{[^}]*\}/g, ':v').split(/[?#]/)[0];
    const parts = norm.split('/').filter(Boolean);
    const first = parts[0];
    // An interpolated first segment is a runtime value; nothing to check.
    if (!first || first.startsWith(':v')) continue;
    // An asset served from the public folder is not a route.
    if (/\.(png|jpg|jpeg|svg|webp|mp4|css|js|json|pdf|ico|txt)$/.test(norm)) continue;

    const where = `${label}: ${raw}`;
    if (routes.needsMore.has(first) && !routes.exact.has(first)) {
      if (parts.length < 2) {
        problems.push(
          `${where} — /${first} needs a further segment (App.jsx only has `
          + `${first}/:param), so this renders nothing`);
      }
      continue;
    }
    if (!routes.exact.has(first)) {
      problems.push(`${where} — there is no /${first} route in App.jsx`);
      continue;
    }
    // A global section's screen segment has to be one of its slugs.
    const slugs = globalSlugs[first];
    const screen = parts[1];
    if (slugs && screen && !screen.startsWith(':v') && !slugs.has(screen)) {
      problems.push(
        `${where} — '${screen}' is not a screen of the ${first} section. `
        + `useScreen will silently fall back to its default.`);
    }
  }
  return problems;
}

test('every hardcoded top-level navigation resolves to a real route', () => {
  const routes = topLevelRoutes();
  const globalSlugs = globalSlugsByLeaf();
  const problems = [];
  for (const f of FILES) {
    // App.jsx holds the route table itself, and the tests hold deliberate
    // counter-examples.
    if (f.endsWith('App.jsx')) continue;
    problems.push(...scanTopLevel(read(f), path.relative(src, f), routes, globalSlugs));
  }
  assert.deepStrictEqual(problems, [], `\n${problems.join('\n')}\n`);
});

test('the top-level scan would catch a dead path', () => {
  const routes = topLevelRoutes();
  const globalSlugs = globalSlugsByLeaf();
  // A scanner with no positive control passes on everything, which is how
  // direction 2 was nearly shipped broken.
  const bad = [
    [`navigate('/leads')`, 'the bug this test exists for'],
    [`navigate('/not-a-page')`, 'a route that does not exist'],
    [`navigate('/biz-dev/not-a-screen')`, 'a screen the section does not have'],
    [`navigate('/tenders')`, 'a detail route addressed without its id'],
    // The slug this very restructure retired. A rename that leaves links
    // behind is the exact fault direction 3 exists to catch, and it has now
    // happened once, so it gets a control of its own.
    [`navigate('/settings/other')`, 'a settings screen that was renamed away'],
  ];
  for (const [source, what] of bad) {
    assert.ok(scanTopLevel(source, 'control', routes, globalSlugs).length,
      `the scan passed ${what}: ${source}`);
  }

  const fine = [
    `navigate('/biz-dev/leads')`,
    `navigate('/biz-dev')`,
    `navigate('/guide')`,
    // Was '/settings/ai'. The 31 Oct restructure split that screen into
    // Models and Generation, so 'ai' is now a slug the section does not have
    // and the control was asserting that a dead path is fine. Picked a slug
    // that is stable rather than one that reads well: 'security' is a screen
    // nobody is proposing to rename.
    `navigate('/settings/security')`,
    `navigate(\`/leads/\${id}\`)`,
    `navigate('/login')`,
    `navigate('/')`,
    `api.get('/pr/clients/abc/releases')`,
    `api.post('/heygen/clients/abc/heygen/reels/keep')`,
    `<img src="/vite.svg" />`,
  ];
  for (const source of fine) {
    assert.deepStrictEqual(scanTopLevel(source, 'control', routes, globalSlugs), [],
      `the scan rejected a legitimate path: ${source}`);
  }
});
