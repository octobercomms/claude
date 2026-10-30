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
  shared: ['loop', 'learn', 'dm_bot', 'video', 'produce'],
  owned:  ['aio', 'fanout', 'gaps', 'perf_hub', 'optimise', 'convert', 'cro', 'forms', 'email'],
  produce: [],
  earned: [],
};

const PAGES = {
  paid: 'ClientAdsPage.jsx',
  shared: 'ClientSocialPage.jsx',
  owned: 'ClientSEOPage.jsx',
  produce: 'ClientVideoTab.jsx',
};

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

test('earned: the panel rows match the page, which keeps its tabs elsewhere', () => {
  // ClientPRPage drives its tabs from section tables rather than useTabParam,
  // so it is checked against the literal keys it uses.
  const src = page('ClientPRPage.jsx');
  for (const tab of tabsOf(SECTIONS.earned)) {
    assert.ok(src.includes(`'${tab}'`), `ClientPRPage.jsx never mentions the tab '${tab}'`);
  }
});

test('no row is listed twice across a section, which would mean two doors to one screen', () => {
  for (const [key, section] of Object.entries(SECTIONS)) {
    const tabs = tabsOf(section);
    const dupes = tabs.filter((t, i) => tabs.indexOf(t) !== i);
    assert.deepEqual(dupes, [], `${key} lists ${dupes.join(', ')} more than once`);
  }
});
