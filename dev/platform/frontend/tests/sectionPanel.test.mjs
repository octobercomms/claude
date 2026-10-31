// The panel, the URLs and the pages must agree.
//
// Every screen in the app is now a path segment: /clients/:id/seo/site-audit.
// nav/sections.js is the only list of them, which removes the old failure
// (a page's whitelist and the panel's rows drifting apart) and introduces
// three new ones, none of which announces itself:
//
//   a row whose `tab` key no page renders — a link that opens a blank screen;
//   a slug that collides inside its section — two rows, one URL;
//   a section with no route — every row in it 404s.
//
//   node --test tests/sectionPanel.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTIONS, tabsOf, slugsOf, slugOf, tabForSlug, slugForTab } from '../src/nav/sections.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel) => readFileSync(path.join(SRC, rel), 'utf8');
const page = (f) => read(path.join('pages', f));
const app = read('App.jsx');

// Which page renders each section, and how that page names the screen it is
// showing. The keys are what the page compares against; the slugs are the URL.
const PAGES = {
  dashboard: { file: 'ClientDetailPage.jsx', v: 'tab' },
  paid:      { file: 'ClientAdsPage.jsx',    v: 'tab' },
  earned:    { file: 'ClientPRPage.jsx',     v: 'tab' },
  shared:    { file: 'ClientSocialPage.jsx', v: 'socialTab' },
  owned:     { file: 'ClientSEOPage.jsx',    v: 'activeTab' },
  convert:   { file: 'ClientConvertPage.jsx', v: 'tab' },
  produce:   { file: 'ClientVideoTab.jsx',   v: 'tab' },
  // Three sections, one page. Settings, Database and Biz dev are three paths
  // over SettingsPage, which reads which one it is in from the path.
  settings:  { file: 'SettingsPage.jsx',     v: 'tab' },
  database:  { file: 'SettingsPage.jsx',     v: 'tab' },
  bizdev:    { file: 'SettingsPage.jsx',     v: 'tab' },
};

// The sections that live at the top level rather than under /clients/:id.
const GLOBAL = new Set(['settings', 'database', 'bizdev']);

test('every section is covered by this file, so nothing is silently skipped', () => {
  assert.deepEqual(Object.keys(PAGES).sort(), Object.keys(SECTIONS).sort());
});

test('the sections are not empty, so the checks below cannot pass vacuously', () => {
  for (const [key, section] of Object.entries(SECTIONS)) {
    assert.ok(tabsOf(section).length >= 3, `${key} has almost no rows`);
  }
});

// ── the URL side ────────────────────────────────────────────────────────

test('every slug is URL-safe: lowercase, digits and hyphens only', () => {
  const bad = [];
  for (const [key, section] of Object.entries(SECTIONS)) {
    for (const slug of slugsOf(section)) {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) bad.push(`${key}/${slug}`);
    }
  }
  assert.deepEqual(bad, [], 'an underscore or capital in a slug makes an ugly permalink and an easy typo');
});

test('no slug is used twice inside a section', () => {
  for (const [key, section] of Object.entries(SECTIONS)) {
    const slugs = slugsOf(section);
    const dupes = [...new Set(slugs.filter((s, i) => slugs.indexOf(s) !== i))];
    assert.deepEqual(dupes, [], `${key} gives ${dupes.join(', ')} to two rows, so one URL opens two screens`);
  }
});

test('slug and key round-trip in both directions', () => {
  for (const [key, section] of Object.entries(SECTIONS)) {
    for (const g of section.groups) {
      for (const row of g.rows) {
        assert.equal(tabForSlug(section, slugOf(row)), row.tab, `${key}: ${slugOf(row)} -> tab`);
        assert.equal(slugForTab(section, row.tab), slugOf(row), `${key}: ${row.tab} -> slug`);
      }
    }
  }
});

test('no slug repeats its own section leaf', () => {
  // /convert/convert is legal and absurd. Another section's leaf is fine —
  // /seo/dashboard and /settings/seo both read correctly, because the leaf
  // comes first and settles which section you are in.
  const clashes = [];
  for (const [key, section] of Object.entries(SECTIONS)) {
    if (slugsOf(section).includes(section.leaf)) clashes.push(`${key}/${section.leaf}`);
  }
  assert.deepEqual(clashes, []);
});

// ── the route side ──────────────────────────────────────────────────────

test('every section has a route that takes a screen', () => {
  const missing = [];
  for (const [key, section] of Object.entries(SECTIONS)) {
    const pat = GLOBAL.has(key)
      ? `path="${section.leaf}/:screen?"`
      : `path="clients/:id/${section.leaf}/:screen?`;
    if (!app.includes(pat)) missing.push(`${key} (${pat})`);
  }
  assert.deepEqual(missing, [], 'a section with no :screen route 404s on every row');
});

test('no route or link still carries ?tab=', () => {
  // The whole point of the sweep. Comments may still describe the old scheme.
  const offenders = [];
  for (const [key, { file }] of Object.entries(PAGES)) {
    const src = page(file).split('\n')
      .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    // Only links into the sections. Pages outside them (ContactCleanupPage)
    // keep their own ?tab=, which is theirs to own.
    const hit = src.find(l => /(to=|href=|navigate\(|Navigate to=)/.test(l)
      && /\?tab=/.test(l) && /['"`](\/clients\/|\/settings)/.test(l));
    if (hit) offenders.push(`${file}: ${hit.trim().slice(0, 80)}`);
  }
  assert.deepEqual(offenders, []);
});

// ── the page side ───────────────────────────────────────────────────────

// Whether a row opens something is checked in the browser, not here: these
// pages branch through group variables and step indexes, so no amount of
// grepping the source proves a screen renders. The drive walks all 91 rows and
// asserts the body is not empty — see drive38.mjs, "every row opens a screen".

test('each page reads its screen from the path, not from a query', () => {
  for (const [key, { file }] of Object.entries(PAGES)) {
    const src = page(file);
    if (GLOBAL.has(key)) {
      // SettingsPage serves three sections, so it cannot name one. It has to
      // derive the section from the path instead — a literal would send
      // /database/journalists to the Settings default and the row would look
      // broken. Both halves are required: the lookup and the use.
      assert.ok(/sectionForPath\(location\.pathname\)/.test(src),
        `${file} serves ${key} but does not read the section from the path`);
      assert.ok(/useScreen\(sectionKey\)/.test(src),
        `${file} looks the section up and then ignores it`);
      continue;
    }
    assert.ok(src.includes(`useScreen('${key}')`),
      `${file} does not call useScreen('${key}') — its rows cannot drive it`);
  }
});

test('useTabParam survives only where a page is embedded in another', () => {
  // Outreach standalone and the analyst chat are pages-within-pages; they are
  // the only query-param tabs left, and they say so.
  const users = ['ClientOutreachPage.jsx', 'ClientChatPage.jsx', 'ClientVisualisePage.jsx']
    .filter(f => { try { return page(f).includes('useTabParam'); } catch { return false; } });
  for (const [, { file }] of Object.entries(PAGES)) {
    assert.ok(!page(file).includes('useTabParam('),
      `${file} is a section page and must not use useTabParam`);
  }
  assert.ok(users.length >= 1, 'nothing uses useTabParam — delete the hook rather than leaving it');
});

// ── the panel and the heading ───────────────────────────────────────────

test('every page behind a section panel prints the screen name', () => {
  const HEROES = [
    ['ClientAdsPage.jsx', 'PageShell'], ['ClientPRPage.jsx', 'PageShell'],
    ['ClientSocialPage.jsx', 'PageShell'], ['ClientSEOPage.jsx', 'PageShell'],
    ['ClientConvertPage.jsx', 'PageShell'],
    ['ClientDetailPage.jsx', 'ScreenHeading'], ['SettingsPage.jsx', 'ScreenHeading'],
    ['ClientVideoTab.jsx', 'ScreenHeading'],
  ];
  const missing = HEROES.filter(([f, needle]) => !page(f).includes(needle)).map(([f]) => f);
  assert.deepEqual(missing, []);
  assert.ok(read('components/shells/PageShell.jsx').includes('ScreenHeading'),
    'PageShell stopped rendering the screen name, so five pages lost it at once');
});

test('the default screen has a row, so a bare section URL highlights something', () => {
  for (const [key, section] of Object.entries(SECTIONS)) {
    assert.ok(tabsOf(section).includes(section.defaultTab),
      `${key}: the landing screen '${section.defaultTab}' has no row`);
  }
});

test('the three SettingsPage sections together name exactly its screens', () => {
  // Was settings alone. Database and Biz dev moved out into sections of their
  // own, so the page's table is now the union of all three — and the union is
  // what has to match, or a screen is either unreachable or orphaned.
  const src = page('SettingsPage.jsx');
  // Sliced to ALL_SUBS, not the old SECTION_GROUPS: that const was dead code
  // and is deleted, and indexOf on a missing marker returns -1, which slice
  // reads as "one from the end" — the table would have quietly grown to the
  // whole rest of the file and this test would have gone on passing while
  // reading keys that are not in it.
  const marker = src.indexOf('const ALL_SUBS');
  assert.ok(marker > 0, 'the marker this test slices the table at has moved');
  const table = src.slice(src.indexOf('const SECTIONS = ['), marker);
  const pageKeys = [...table.matchAll(/\{ k: '([a-z_]+)'/g)].map(m => m[1]).sort();
  assert.ok(pageKeys.length >= 20, `only read ${pageKeys.length} keys out of SettingsPage — the table moved`);

  const navKeys = [...GLOBAL].flatMap(k => tabsOf(SECTIONS[k])).sort();
  assert.deepEqual(navKeys, pageKeys);

  // And no screen appears in two of them, which would make one row dead.
  const seen = new Set(); const dupes = [];
  for (const k of navKeys) { if (seen.has(k)) dupes.push(k); seen.add(k); }
  assert.deepEqual(dupes, [], 'a screen is listed under more than one section');
});

// tabDoors.test.mjs, tabDoorsLib.test.mjs and lib/tabDoors.mjs were deleted
// here. They guarded one failure: a tab whose only link lived inside an
// Overview, so deleting that Overview left a working screen nobody could open.
// That failure needed a screen and its door to be separate things.
//
// They are not separate any more. A screen exists because nav/sections.js
// lists it, and that listing is simultaneously the panel row, the URL and the
// route — there is no way to have one without the others. The scanner also
// read each page's useTabParam whitelist to enumerate tabs, and no section
// page has one now, so it was about to report every page as unreadable.
//
// A test whose failure mode no longer exists passes on nothing, which is worse
// than not having it. What remains worth checking is whether a row opens
// something, and that is in the browser drive where it can be proven.

test('no slug names a different row in the same section', () => {
  // There are none, and there was one. Shared had `tab: 'review'` at slug
  // 'brief' (step 2) while `tab: 'perf_insights'` sat at slug 'review'
  // (Measure), so the word "review" was a tab key for one screen and a slug
  // for another in the same section. Nothing was broken: the round trip
  // tab → slug → tab held. The trap was one line away — pass a slug where a
  // tab is expected and you land on the other screen with no error, and both
  // screens render, so it reads as a working page showing the wrong thing.
  // Six dead links got into this app that way.
  //
  // Renaming step 2 to Refine (31 October, Daniel's call) closed it: the row
  // is now tab 'refine' at slug 'refine', and 'review' belongs to one screen
  // only. The empty allowlist is the point. Adding to it is a decision
  // somebody makes on purpose rather than a thing that happens.
  const KNOWN = [];
  const found = [];
  for (const key of Object.keys(SECTIONS)) {
    const section = SECTIONS[key];
    const tabs = new Set(tabsOf(section));
    for (const slug of slugsOf(section)) {
      // A row whose slug equals its own tab is the ordinary case.
      const ownTab = tabForSlugIn(section, slug);
      if (tabs.has(slug) && slug !== ownTab) found.push(`${key}:${slug}`);
    }
  }
  assert.deepEqual(found.sort(), KNOWN.sort(),
    'a slug now names a different row\'s tab. Either rename one, or add it here '
    + 'with a note on why the collision is safe.');
});

// The tab a slug resolves to, within one section.
function tabForSlugIn(section, slug) {
  for (const g of section.groups) {
    for (const r of g.rows) {
      if ((r.slug || r.tab.replace(/_/g, '-')) === slug) return r.tab;
    }
  }
  return null;
}
