// The panel and the pages must name the same tabs.
//
// Once the horizontal strips are gone, the section panel is the only way into
// a tab. So two failures become possible and neither announces itself:
//
//   a tab a page accepts with no row in the panel is a working screen with no
//   door — this codebase has shipped that three times, each found by a person
//   asking where something went;
//
//   a row naming a tab the page does not accept lands on the page's default
//   instead, so the row looks like it works and silently shows the wrong thing.
//
// Both are checked here, in both directions, by reading the page's own
// useTabParam whitelist rather than a list kept beside it.
//
//   node --test tests/sectionPanel.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTIONS, tabsOf } from '../src/nav/sections.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const page = (f) => readFileSync(path.join(SRC, 'pages', f), 'utf8');
const readLib = (rel) => readFileSync(path.join(SRC, rel), 'utf8');

// Pull the allow-list out of the page's own useTabParam call. Brace/bracket
// counting rather than a regex over the whole call: the lists run to dozens of
// entries across many lines with comments between them.
function whitelistOf(src) {
  const at = src.indexOf('useTabParam(');
  if (at < 0) return null;
  const open = src.indexOf('[', at);
  if (open < 0) return null;
  let depth = 1, i = open + 1;
  while (i < src.length && depth > 0) {
    if (src[i] === '[') depth += 1;
    else if (src[i] === ']') depth -= 1;
    i += 1;
  }
  return [...src.slice(open, i).matchAll(/'([a-z0-9_]+)'/g)].map(m => m[1]);
}

// Tabs a page still accepts but the panel deliberately does not offer: old
// deep links from emails and saved reports, kept working by a redirect. A row
// for one of these would be a second door to a screen that already has one.
const LEGACY = {
  paid:   ['health', 'performance', 'playbook', 'resize', 'pipeline', 'creative'],
  // 'reels' is the avatar-reel overlay, not a step, and 'publish' lands on the
  // same factory step as 'plans' — each had a row that opened a screen other
  // than the one it named, which reads as the row being broken.
  shared: ['loop', 'learn', 'dm_bot', 'video', 'reels', 'publish'],
  // 'perf_insights' renders the same panel as 'health', so a row for it was a
  // second door onto the Dashboard.
  owned:  ['aio', 'fanout', 'gaps', 'perf_hub', 'perf_insights', 'optimise', 'convert', 'cro', 'forms', 'email'],
  produce: [],
  earned: [],
};

const PAGES = {
  paid: 'ClientAdsPage.jsx',
  shared: 'ClientSocialPage.jsx',
  owned: 'ClientSEOPage.jsx',
  produce: 'ClientVideoTab.jsx',
};

test('every section declares a scope, because the panel renders on it', () => {
  for (const [key, section] of Object.entries(SECTIONS)) {
    assert.ok(['client', 'global'].includes(section.scope),
      `${key} has no scope: a client section without one never renders, a global one is asked for a client id it has not got`);
  }
});

test('the sections are not empty, so the checks below cannot pass vacuously', () => {
  for (const [key, section] of Object.entries(SECTIONS)) {
    assert.ok(tabsOf(section).length >= 3, `${key} has almost no rows`);
  }
  assert.ok(Object.keys(SECTIONS).length >= 5, 'sections have gone missing');
});

for (const [key, file] of Object.entries(PAGES)) {
  const accepted = whitelistOf(page(file));

  test(`${key}: the page's tab whitelist was actually found`, () => {
    assert.ok(accepted && accepted.length >= 5,
      `could not read a useTabParam whitelist out of ${file} — every check below would pass on nothing`);
  });

  test(`${key}: every panel row names a tab the page accepts`, () => {
    const unknown = tabsOf(SECTIONS[key]).filter(t => !accepted.includes(t));
    assert.deepEqual(unknown, [],
      `${file} would fall back to its default for these rows: ${unknown.join(', ')}`);
  });

  test(`${key}: every tab the page accepts has a row or is a known legacy alias`, () => {
    const rows = new Set(tabsOf(SECTIONS[key]));
    const stranded = accepted.filter(t => !rows.has(t) && !LEGACY[key].includes(t));
    assert.deepEqual(stranded, [],
      `no way into these from the panel: ${stranded.join(', ')} — add a row, or list it as a legacy alias and make sure it redirects`);
  });

  test(`${key}: the default tab has a row`, () => {
    assert.ok(tabsOf(SECTIONS[key]).includes(SECTIONS[key].defaultTab),
      `the landing tab '${SECTIONS[key].defaultTab}' has no row, so nothing lights up on a bare URL`);
  });
}

// Settings keeps its own SECTIONS table — it is the source of the tab keys and
// the legacy-alias handling — and nav/sections.js mirrors its shape. Two lists
// of the same 26 keys drift, so they are compared directly rather than by
// eye.
test('settings: the panel and SettingsPage name exactly the same tabs', () => {
  const src = page('SettingsPage.jsx');
  const table = src.slice(src.indexOf('const SECTIONS = ['), src.indexOf('const SECTION_GROUPS'));
  const pageKeys = [...table.matchAll(/\{ k: '([a-z_]+)'/g)].map(m => m[1]).sort();
  const rows = tabsOf(SECTIONS.settings).sort();
  assert.ok(pageKeys.length >= 20, `only read ${pageKeys.length} keys out of SettingsPage — the table moved`);
  assert.deepEqual(rows, pageKeys,
    'the Settings panel and the page have drifted: a row with no sub-tab shows an empty page, and a sub-tab with no row cannot be reached at all');
});

test('settings: the group headings match the page\'s own sections', () => {
  const src = page('SettingsPage.jsx');
  const table = src.slice(src.indexOf('const SECTIONS = ['), src.indexOf('const SECTION_GROUPS'));
  const pageLabels = [...table.matchAll(/\{ key: '[a-z]+', label: '([^']+)'/g)].map(m => m[1]);
  const headings = SECTIONS.settings.groups.map(g => g.heading);
  assert.deepEqual(headings, pageLabels, 'the panel groups Settings differently from the page');
});

test('dashboard: every panel row is a tab ClientDetailPage renders', () => {
  // This page drives its tabs from searchParams directly rather than
  // useTabParam, so it is checked against the literal keys it branches on.
  const src = page('ClientDetailPage.jsx');
  for (const tab of tabsOf(SECTIONS.dashboard)) {
    assert.ok(src.includes(`tab === '${tab}'`),
      `ClientDetailPage.jsx has no render branch for '${tab}', so that row opens a blank page`);
  }
});

test('earned: the panel rows match the page, which keeps its tabs elsewhere', () => {
  // ClientPRPage drives its tabs from section tables rather than useTabParam,
  // so it is checked against the literal keys it uses.
  const src = page('ClientPRPage.jsx');
  for (const tab of tabsOf(SECTIONS.earned)) {
    assert.ok(src.includes(`'${tab}'`), `ClientPRPage.jsx never mentions the tab '${tab}'`);
  }
});

// A legacy alias earns its place by landing somewhere, not by being listed. An
// alias nobody redirects is a dead link that this file's own allow-list is
// hiding — which is the failure mode of allow-lists.
test('every legacy alias actually resolves somewhere', () => {
  const RESOLVES = {
    paid:   page('ClientAdsPage.jsx') + readLib('utils/paidTabs.js'),
    shared: page('ClientSocialPage.jsx'),
    owned:  page('ClientSEOPage.jsx'),
    produce: page('ClientVideoTab.jsx'),
    earned: page('ClientPRPage.jsx'),
  };
  for (const [key, aliases] of Object.entries(LEGACY)) {
    for (const alias of aliases) {
      assert.ok(RESOLVES[key].includes(`'${alias}'`),
        `${key}: '${alias}' is allow-listed as a legacy alias but ${key}'s page never mentions it, so the link goes nowhere`);
    }
  }
});

// Every section's page says which screen you are on. The strips used to do
// that; the panel says it 170px away in a list of up to 27. A page that draws
// its own hero instead of using PageShell has to opt in by hand, which is
// exactly the kind of thing that gets forgotten on the next page someone adds.
test('every page behind a section panel prints the screen name', () => {
  const HEROES = [
    // PageShell renders ScreenHeading for everything that uses it.
    ['ClientAdsPage.jsx', 'PageShell'], ['ClientPRPage.jsx', 'PageShell'],
    ['ClientSocialPage.jsx', 'PageShell'], ['ClientSEOPage.jsx', 'PageShell'],
    ['ClientConvertPage.jsx', 'PageShell'],
    // These three draw their own <header className="hero">.
    ['ClientDetailPage.jsx', 'ScreenHeading'], ['SettingsPage.jsx', 'ScreenHeading'],
    ['ClientVideoTab.jsx', 'ScreenHeading'],
  ];
  const missing = HEROES
    .filter(([file, needle]) => !page(file).includes(needle))
    .map(([file, needle]) => `${file} renders neither ${needle} nor anything that would`);
  assert.deepEqual(missing, []);

  assert.ok(readLib('components/shells/PageShell.jsx').includes('ScreenHeading'),
    'PageShell stopped rendering the screen name, so five pages lost it at once');
});

test('no row is listed twice across a section, which would mean two doors to one screen', () => {
  for (const [key, section] of Object.entries(SECTIONS)) {
    const tabs = tabsOf(section);
    const dupes = tabs.filter((t, i) => tabs.indexOf(t) !== i);
    assert.deepEqual(dupes, [], `${key} lists ${dupes.join(', ')} more than once`);
  }
});
