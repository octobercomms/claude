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
import { SECTIONS, tabsOf, slugsOf, slugOf, tabForSlug, slugForTab, SLUG_ALIASES, navCtx, visibleGroups, phoneGroups } from '../src/nav/sections.js';

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
  // Four sections, one page. Settings, Database, Biz dev and Accounts are
  // four paths over SettingsPage, which reads which one it is in from the path.
  settings:  { file: 'SettingsPage.jsx',     v: 'tab' },
  database:  { file: 'SettingsPage.jsx',     v: 'tab' },
  bizdev:    { file: 'SettingsPage.jsx',     v: 'tab' },
  accounts:  { file: 'SettingsPage.jsx',     v: 'tab' },
};

// The sections that live at the top level rather than under /clients/:id.
const GLOBAL = new Set(['settings', 'database', 'bizdev', 'accounts']);

test('every section is covered by this file, so nothing is silently skipped', () => {
  assert.deepEqual(Object.keys(PAGES).sort(), Object.keys(SECTIONS).sort());
});

test('the sections are not empty, so the checks below cannot pass vacuously', () => {
  // Convert carries seven: Optimise, Forms, and the five under Outreach.
  // It briefly carried two, while Email was promoted to a section of its
  // own — which is the arrangement this threshold would have let through
  // either way, so it is not what caught that.
  for (const [key, section] of Object.entries(SECTIONS)) {
    assert.ok(tabsOf(section).length >= 2, `${key} has almost no rows`);
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

test('every section has an entry in the nav rail', () => {
  // The rule the Email section broke. It was promoted out of Convert on
  // 1 November with its own leaf, base, route and five rows, and nothing was
  // added to Layout.jsx — so the panel was correct, the URLs worked, every
  // check in this file passed, and there was no way to get there by clicking.
  //
  // The rail is the only door to a section. A section without one is reachable
  // by typing its URL or by the search palette, which is not a menu.
  const layout = read(path.join('components', 'Layout.jsx'));
  const missing = [];
  for (const [key, section] of Object.entries(SECTIONS)) {
    const pat = GLOBAL.has(key)
      ? new RegExp(`to="/${section.leaf}"`)
      : new RegExp('to=\\{`/clients/\\$\\{clientId\\}/' + section.leaf + '`\\}');
    if (!pat.test(layout)) missing.push(`${key} (/${section.leaf})`);
  }
  assert.deepEqual(missing, [],
    'these sections have rows, routes and no way in — add a NavLink to the rail');
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
  // The analyst chat and Visualise are pages-within-pages; they are the only
  // query-param tabs left, and they say so. Outreach was a third until its
  // `embedded` prop went: it is only ever rendered by Convert, which reads the
  // screen off the path, so its ?tab= half was unreachable.
  const users = ['ClientChatPage.jsx', 'ClientVisualisePage.jsx']
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

test('the four SettingsPage sections together name exactly its screens', () => {
  // Was settings alone. Database, Biz dev and Accounts moved out into sections
  // of their own, so the page's table is now the union of all four — and the
  // union is what has to match, or a screen is either unreachable or orphaned.
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

test('/settings/connections resolves to integrations, not to the default tab', () => {
  const settings = SECTIONS.settings;
  assert.equal(tabForSlug(settings, 'connections'), 'integrations',
    '/settings/connections must land on the Integrations tab');
});

// Renaming a row's SLUG retires a URL, and a retired URL that resolves to the
// section default is the worst outcome: the page opens, shows the wrong screen,
// and nothing fails. /produce/compose is the one that matters — it is in the
// address bar of anyone who had the editor open before 9 November, and in
// several places in docs/.
//
// It keeps working because tabForSlug matches `r.tab === resolved` as well as
// the slug (sections.js), so an old slug that is still a tab key resolves
// without a SLUG_ALIASES entry. That is load-bearing and undocumented, so it
// is pinned here rather than left to be rediscovered: this test fails if that
// fallback is ever removed.
test('a row renamed to a new slug keeps answering on its old one', () => {
  const produce = SECTIONS.produce;
  assert.equal(slugForTab(produce, 'compose'), 'studio',
    'the canonical URL for the editor is /produce/studio');
  assert.equal(tabForSlug(produce, 'studio'), 'compose');
  assert.equal(tabForSlug(produce, 'compose'), 'compose',
    '/produce/compose stopped resolving — it must not fall through to the default tab');
  assert.notEqual(produce.defaultTab, null);
});

// One rule for who sees what, in one place.
//
// The bug this pins: the panel, the phone picker and the search box each read
// canVisualise as the per-user grant `can_use_visualise`, while the page reads
// it as `!readOnly || grant`, because the grant exists to let a CLIENT in and
// an agency login was always allowed. The grant is only ever set on client
// accounts, so Visualise rendered for any agency user who typed the URL and
// appeared in the nav for none of them. Reproduced in a browser as an admin
// before the fix: Make showed Studio, Record, Design and no Visualise.
//
// The second assertion is the one that matters long term. navCtx can be
// correct and still be bypassed, which is how the four copies came about, so
// the test reads the components rather than trusting them.
test('the viewer is turned into a nav ctx in exactly one place', () => {
  assert.deepEqual(navCtx({ role: 'admin' }), { readOnly: false, canVisualise: true },
    'an agency login must see Visualise without a per-user grant');
  assert.deepEqual(navCtx({ role: 'client' }), { readOnly: true, canVisualise: false },
    'a read-only client without the grant must not');
  assert.deepEqual(navCtx({ role: 'client', can_use_visualise: true }),
    { readOnly: true, canVisualise: true }, 'the grant is what lets a client in');
  assert.deepEqual(navCtx(undefined), { readOnly: false, canVisualise: true },
    'no user yet must not crash the panel');

  // Nothing may derive it inline again. Checked by source, because a second
  // copy is invisible to every other assertion here.
  const offenders = [];
  for (const f of ['components/SectionPanel.jsx', 'components/MobileScreenNav.jsx',
                   'components/Layout.jsx', 'components/GlobalSearch.jsx']) {
    const body = read(f);
    if (/can_use_visualise/.test(body) && !/navCtx/.test(body)) offenders.push(f);
  }
  assert.deepEqual(offenders, [],
    `these read the grant directly instead of calling navCtx: ${offenders.join(', ')}`);

  // And the page has to agree with the nav, or a row opens a screen that
  // bounces you off it (ClientVideoTab sends you to Record when it disagrees).
  const tab = page('ClientVideoTab.jsx');
  assert.match(tab, /const canVisualise = !readOnly \|\| !!user\?\.can_use_visualise;/,
    'ClientVideoTab no longer computes canVisualise the way navCtx does — if the '
    + 'page rule changed, change navCtx with it');
});

// Produce is agency-only and desktop-only, both decided by Daniel on
// 9 November: "read only clients dont see Produce - good point. and they dont
// need it", and "phone - lets not have it on phone. its a desktop
// application."
//
// Asserted as "the section contributes nothing" rather than row by row,
// because a row added later would otherwise slip through with no `when`: the
// default for a new row is visible to everyone.
test('a read-only client is offered no part of Produce, on any device', () => {
  const produce = SECTIONS.produce;
  const client = { readOnly: true, canVisualise: false };
  const granted = { readOnly: true, canVisualise: true };

  for (const [name, ctx] of [['a client', client], ['a granted client', granted]]) {
    const rows = visibleGroups(produce, ctx).flatMap(g => g.rows).map(r => r.label);
    assert.deepEqual(rows, [],
      `${name} can still reach ${rows.join(', ')} in Produce`);
  }

  // The grant used to let a client into Visualise. With Produce agency-only
  // it reaches nothing, which is a decision for Daniel rather than a licence
  // to delete the column — recorded in the brief, pinned here so the next
  // session does not reintroduce the row by removing the readOnly half.
  assert.deepEqual(
    visibleGroups(produce, granted).flatMap(g => g.rows).map(r => r.tab), [],
    'can_use_visualise opened a Produce row again');

  // And nothing in it on a phone, for an agency login either.
  const agency = { readOnly: false, canVisualise: true };
  assert.ok(visibleGroups(produce, agency).flatMap(g => g.rows).length >= 8,
    'the agency lost rows it should still have');
  assert.deepEqual(phoneGroups(produce, agency).flatMap(g => g.rows).map(r => r.label), [],
    'Produce still offers rows on a phone');

  // The rail link has to agree with the panel. A link to a section whose
  // every row is hidden lands on a page with an empty directory beside it.
  const layout = read(path.join('components', 'Layout.jsx'));
  const produceLink = layout.slice(layout.indexOf('/produce`'), layout.indexOf('/produce`') + 160);
  assert.ok(/!readOnly/.test(layout.slice(Math.max(0, layout.indexOf('/produce`') - 400), layout.indexOf('/produce`'))),
    'the rail still offers Produce to a read-only client');
  void produceLink;

  // And the page has to refuse the typed URL, not redirect: setTab returns
  // early when a tab has no row, silently, so a redirect leaves a blank page.
  const tab = page('ClientVideoTab.jsx');
  assert.ok(/if \(readOnly\) \{/.test(tab),
    'ClientVideoTab no longer guards a read-only visitor');
  // Comments stripped: the file explains the old redirect directly above the
  // guard that replaced it, and a test that cannot tell the fix from its own
  // explanation fails on the explanation. Caught this way twice now.
  const code = tab.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/setTab\('record'\)/.test(code),
    'the old redirect is back — Record is agency-only now, so setTab returns '
    + 'early and the client gets the compose branch, which renders nothing');
});

test('every SLUG_ALIASES target is a real tab in at least one section', () => {
  const allTabs = new Set(Object.values(SECTIONS).flatMap(s => tabsOf(s)));
  const dangling = Object.entries(SLUG_ALIASES)
    .filter(([, tab]) => !allTabs.has(tab))
    .map(([slug, tab]) => `${slug} -> ${tab}`);
  assert.deepEqual(dangling, [], 'an alias targets a tab that does not exist');
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
