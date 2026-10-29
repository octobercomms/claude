// No tab may depend on an Overview for its only way in.
//
// The suites are large — Owned carries 38 tabs, Shared 18, Paid 14 — and each
// Overview is partly a diagram of links into them. That makes deleting one a
// navigation change: a tab linked only from inside it becomes a working page
// nobody can open. This codebase has produced that failure three times
// (ClientVideoPage, ReportsPage, ClientBrandPage), each found by a person
// asking where something had gone rather than by anything automatic.
//
// The Overviews were deleted on 29 Oct 2026, which this check cleared them
// for: it showed none of them was load-bearing. The one match left is
// SocialSuiteOverview, and it is a different thing — the Review readout inside
// Shared's Measure group, not a page describing the section. It is matched
// here only because it shares the name.
//
// The check keeps its job either way: if an Overview-shaped component comes
// back and a tab ends up depending on it, this fails. That is the failure mode
// worth guarding, and it does not care whether the component is new or old.
//
// The scanner's own behaviour is tested in tabDoorsLib.test.mjs, because two
// earlier attempts at this analysis were confidently wrong: one missed
// accordion items, and the first version of this one reported five tabs that
// were all reachable through a step rail.
//
//   node --test tests/tabDoors.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  knownTabs, overviewBlocks, tabsOnlyReachableFromOverview,
} from './lib/tabDoors.mjs';

const PAGES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'pages');

// Every page that renders an Overview. Discovered rather than listed, so a new
// suite is covered without anyone remembering to add it here.
const withOverview = readdirSync(PAGES)
  .filter(f => f.endsWith('.jsx'))
  .map(f => ({ file: f, src: readFileSync(path.join(PAGES, f), 'utf8') }))
  .filter(p => overviewBlocks(p.src).length > 0);

// Exactly the pages expected to render an Overview-named component. Pinned so
// one reappearing is a decision somebody made on purpose rather than a thing
// that drifted back in.
const EXPECTED = ['ClientSocialPage.jsx'];

test('only the pages we expect render an Overview-named component', () => {
  assert.deepEqual(withOverview.map(p => p.file).sort(), EXPECTED,
    'an Overview has come back, or one we deleted is still being matched');
});

test('no tab is reachable only from an Overview', () => {
  const stranded = withOverview
    .map(p => ({ file: p.file, tabs: tabsOnlyReachableFromOverview(p.src) }))
    .filter(p => p.tabs.length)
    .map(p => `${p.file}: ${p.tabs.join(', ')}`);

  assert.deepEqual(stranded, [],
    'these tabs would be orphaned by deleting their page\'s Overview — give each a door in a tab strip, an accordion or a step rail first');
});

// Pages whose tab state this cannot enumerate, so it cannot check them. Empty
// now that ClientDetailPage and ClientPRPage no longer render an Overview, but
// kept and asserted: a page appearing here is invisible to the check, and a
// green run should never imply coverage it does not have.
const UNREADABLE = [];

test('pages the check cannot read are known, not silently skipped', () => {
  const unreadable = withOverview
    .filter(p => knownTabs(p.src).length === 0)
    .map(p => p.file)
    .sort();

  assert.deepEqual(unreadable, UNREADABLE,
    'a page with an Overview and no readable tab list is invisible to this check — give it a useTabParam allow-list, or add it here deliberately');
});
