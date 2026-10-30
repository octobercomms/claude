// What the search box offers before it has asked the server anything.
//
// Screens are matched in the browser, which makes the ranking the one part of
// search that runs on every keystroke and the one part worth pinning down. The
// records half is tested server-side, against a real database.
//
//   node tests/screenSearch.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS, allScreens } from '../src/nav/sections.js';
import { matchScreens, screenPathLabel } from '../src/nav/screenSearch.js';

const ALL = allScreens({});

test('every screen in the product is reachable by search', () => {
  // The count is the point: if a section stops contributing rows, search
  // quietly stops finding them and nothing else fails.
  const sections = new Set(ALL.map(s => s.sectionKey));
  assert.equal(sections.size, Object.keys(SECTIONS).length,
    `only ${sections.size} of ${Object.keys(SECTIONS).length} sections contribute screens`);
  assert.ok(ALL.length >= 80, `only ${ALL.length} screens — the panel holds more than that`);
  for (const s of ALL) {
    assert.ok(s.label && s.slug && s.section && s.scope, `incomplete screen: ${JSON.stringify(s)}`);
  }
});

test('typing a screen name puts that screen first', () => {
  for (const name of ['Coverage', 'Reports', 'Contacts', 'Connectors']) {
    const hits = matchScreens(name, ALL);
    assert.ok(hits.length, `"${name}" matched nothing`);
    assert.equal(hits[0].label, name,
      `"${name}" put ${hits[0].label} first (${screenPathLabel(hits[0])})`);
  }
});

test('a prefix beats a word that merely contains it', () => {
  // Both pairs are ones where the screen that merely CONTAINS the term is
  // declared earlier than the one that starts with it, so declaration order
  // and the ranking disagree. An earlier version of this test used 'rep' ->
  // Reports, where they happened to agree: dropping the sort entirely, and
  // flattening the prefix tier into the contains tier, both still passed.
  //
  //   're'  Measure contains it (first row in the product), Reports starts with it
  //   'ta'  SOSTAC contains it (fourth row), Tags starts with it (eighty-fourth)
  for (const [term, want] of [['re', 'Reports'], ['ta', 'Tags']]) {
    const hits = matchScreens(term, ALL);
    assert.ok(hits.length, `"${term}" matched nothing`);
    assert.equal(hits[0].label, want,
      `"${term}" put ${hits[0].label} first; ${want} starts with it and should lead`);
  }
});

test('a section name finds that section\'s screens', () => {
  const hits = matchScreens('earned', ALL, 20);
  assert.ok(hits.length >= 5, `"earned" found ${hits.length} screens`);
  assert.ok(hits.every(h => h.sectionKey === 'earned'),
    'a section term returned screens from another section');
});

test('two words are read as section plus screen', () => {
  // The way a screen is named out loud. Neither word is the whole phrase, so
  // without the all-words tier this matches nothing at all.
  const hits = matchScreens('earned coverage', ALL);
  assert.ok(hits.length, '"earned coverage" matched nothing');
  assert.equal(hits[0].label, 'Coverage');
  assert.equal(hits[0].sectionKey, 'earned');
});

test('one character runs nothing', () => {
  // A single letter matches most of the product; the palette would fill with
  // noise before anything has been said.
  assert.deepEqual(matchScreens('r', ALL), []);
  assert.deepEqual(matchScreens('', ALL), []);
  assert.deepEqual(matchScreens('   ', ALL), []);
});

test('the list is capped', () => {
  // "e" would match almost everything if it ran; "re" matches plenty.
  assert.ok(matchScreens('re', ALL, 8).length <= 8);
  assert.ok(matchScreens('re', ALL, 3).length <= 3);
});

test('a read-only login cannot find a screen its nav would hide', () => {
  // The agency-only rows are gated with `when` in sections.js. Search gates on
  // the same ctx, or it becomes a way around the panel.
  const agencyScreens = allScreens({ readOnly: false });
  const clientScreens = allScreens({ readOnly: true });
  assert.ok(clientScreens.length < agencyScreens.length,
    'a read-only login sees the same screens as the agency — the ctx is not being applied');
  // Compared on section AND slug, because a slug is only unique within its
  // section: 'forms' is a screen of both Dashboard/Setup (agency-only) and
  // Convert (everyone). Matching on the slug alone reads the surviving Convert
  // row as the hidden Dashboard one and reports a leak that is not there.
  // Which is also why the palette prints the path beside every title.
  const visible = new Set(clientScreens.map(s => `${s.sectionKey}:${s.slug}`));
  const gated = agencyScreens.filter(a => !visible.has(`${a.sectionKey}:${a.slug}`));
  assert.ok(gated.length, 'no screen is agency-only — the `when` gates have gone');
  for (const s of gated) {
    const reached = matchScreens(s.label, clientScreens, 50)
      .filter(h => h.sectionKey === s.sectionKey && h.slug === s.slug);
    assert.deepEqual(reached, [], `a read-only login can search its way to ${screenPathLabel(s)}`);
  }
});

test('every match carries a path that can be built', () => {
  // The palette navigates to `section.base(clientId)` plus the slug. A match
  // with no base, or a client section whose base ignores the id, navigates
  // nowhere.
  for (const h of matchScreens('re', ALL, 50)) {
    assert.equal(typeof h.section.base, 'function', `${h.label} has no base()`);
    const href = h.scope === 'client' ? h.section.base('abc') : h.section.base();
    assert.ok(href.startsWith('/'), `${h.label} built a relative path: ${href}`);
    if (h.scope === 'client') {
      assert.ok(href.includes('abc'), `${h.label} is client-scoped but its base drops the id`);
    }
  }
});
