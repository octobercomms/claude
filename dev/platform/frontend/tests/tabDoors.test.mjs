// No tab may depend on an Overview for its only way in.
//
// The suites are large — Owned carries 38 tabs, Shared 18, Paid 14 — and each
// Overview is partly a diagram of links into them. That makes deleting one a
// navigation change: a tab linked only from inside it becomes a working page
// nobody can open. This codebase has produced that failure three times
// (ClientVideoPage, ReportsPage, ClientBrandPage), each found by a person
// asking where something had gone rather than by anything automatic.
//
// As of 29 Oct 2026 every suite passes: no Overview is load-bearing. So the
// Overviews can be removed section by section without stranding anything, and
// this is the ratchet that keeps that true — add a tab linked only from an
// Overview and this fails before the Overview is deleted, not after.
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

test('the suites that carry an Overview are still found', () => {
  assert.ok(withOverview.length >= 5,
    `found only ${withOverview.length} pages with an Overview — the scan has probably stopped matching`);
});

test('no tab is reachable only from an Overview', () => {
  const stranded = withOverview
    .map(p => ({ file: p.file, tabs: tabsOnlyReachableFromOverview(p.src) }))
    .filter(p => p.tabs.length)
    .map(p => `${p.file}: ${p.tabs.join(', ')}`);

  assert.deepEqual(stranded, [],
    'these tabs would be orphaned by deleting their page\'s Overview — give each a door in a tab strip, an accordion or a step rail first');
});

// Two pages hold their tab somewhere this cannot read: ClientPRPage in
// useState with no allow-list, ClientDetailPage straight off the search
// params. There is nothing to enumerate, so the check is blind to both.
//
// Pinned rather than left implied. A green run does not mean every Overview
// was checked, and a list that silently grows is how a check stops meaning
// anything. A third page appearing here fails this test and has to be an
// explicit decision.
const UNREADABLE = ['ClientDetailPage.jsx', 'ClientPRPage.jsx'];

test('pages the check cannot read are known, not silently skipped', () => {
  const unreadable = withOverview
    .filter(p => knownTabs(p.src).length === 0)
    .map(p => p.file)
    .sort();

  assert.deepEqual(unreadable, UNREADABLE,
    'a page with an Overview and no readable tab list is invisible to this check — give it a useTabParam allow-list, or add it here deliberately');
});
