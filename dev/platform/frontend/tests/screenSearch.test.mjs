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

// ── Credentials ───────────────────────────────────────────────────────────
// Search covered the record tables and the 91 screens. A credential is in
// neither, so "n8n" found nothing although the field is on Settings →
// Connections → Other. The account lead: "So i don't think it's searching
// enough."

import { matchSettings } from '../src/nav/screenSearch.js';
import { settingsEntries, KEY_GROUPS, SUBTAB_CATS } from '../src/settings/catalogue.js';

test('the reported query finds the field', () => {
  const hits = matchSettings('n8n', settingsEntries());
  assert.ok(hits.length, 'n8n found nothing');
  assert.equal(hits[0].key, 'N8N_WEBHOOK_BASE_URL');
  // 'other' until the 31 Oct restructure dissolved that screen; n8n is on
  // Integrations now. The assertion is unchanged in substance: the row has to
  // point at the screen that actually renders the field.
  assert.equal(hits[0].slug, 'integrations');
});

test('a credential is findable by its label, its variable name and its group', () => {
  const all = settingsEntries();
  // What it is called on screen.
  assert.ok(matchSettings('moz', all).some(e => e.key === 'MOZ_API_TOKEN'));
  // What somebody pasting a key has in their clipboard.
  assert.ok(matchSettings('MOZ_API_TOKEN', all).some(e => e.key === 'MOZ_API_TOKEN'));
  // How you look for a thing whose name you have forgotten.
  assert.ok(matchSettings('ecommerce', all).length, 'the category is not searchable');
});

test('an exact label beats a partial one', () => {
  const all = settingsEntries();
  const hits = matchSettings('claude api key', all);
  assert.equal(hits[0].key, 'CLAUDE_API_KEY');
});

test('two words both have to appear', () => {
  const all = settingsEntries();
  assert.ok(matchSettings('anthropic admin', all).some(e => e.key === 'ANTHROPIC_ADMIN_KEY'));
  assert.deepEqual(matchSettings('anthropic bicycle', all), []);
});

test('one character matches nothing, as with screens', () => {
  assert.deepEqual(matchSettings('a', settingsEntries()), []);
  assert.deepEqual(matchSettings('', settingsEntries()), []);
});

test('every credential offered has a screen that renders it', () => {
  // A row that goes nowhere is worse than no row. Each entry's slug has to be
  // a real sub-tab, and that sub-tab has to show the entry's category.
  for (const e of settingsEntries()) {
    assert.ok(SUBTAB_CATS[e.slug], `${e.key} points at sub-tab '${e.slug}', which does not exist`);
    assert.ok(SUBTAB_CATS[e.slug].includes(e.category),
      `${e.key} points at '${e.slug}', which does not show the ${e.category} category`);
  }
});

test('every key in the catalogue is offered, or deliberately not', () => {
  // A group whose category belongs to no sub-tab renders nowhere, so it is
  // skipped on purpose. Anything else missing is a gap.
  const offered = new Set(settingsEntries().map(e => e.key));
  const renderable = KEY_GROUPS.filter(g =>
    Object.values(SUBTAB_CATS).some(cats => cats.includes(g.category)));
  for (const g of renderable) {
    for (const k of g.keys || []) {
      assert.ok(offered.has(k.key), `${k.key} renders on a settings screen but search cannot find it`);
    }
  }
});

test('no credential value is ever in what search matches on', () => {
  // The catalogue holds labels and placeholders, never values — values live
  // encrypted in platform_settings and arrive masked. If a placeholder ever
  // carried a real key, this is where it would leak into a search index.
  for (const e of settingsEntries()) {
    assert.doesNotMatch(e.terms, /sk-ant-api|sk-ant-admin|rk_live_|sk_live_/,
      `${e.key}'s searchable text looks like it contains a real credential`);
  }
});

test('a credential whose category renders nowhere is not offered', () => {
  // Every group in the real catalogue belongs to a sub-tab, so this is the
  // only way to reach the guard. Without it, a group added without a sub-tab
  // would be findable and then open a screen that does not show it.
  const orphan = [{
    title: 'Nowhere', category: 'Not A Category',
    keys: [{ key: 'ORPHAN_KEY', label: 'Orphan key' }],
  }];
  assert.deepEqual(settingsEntries(orphan), []);
  // And a group that does belong is still offered, so the guard is not
  // rejecting everything.
  const real = [{
    title: 'AI models', category: 'AI',
    keys: [{ key: 'REAL_KEY', label: 'Real key' }],
  }];
  assert.equal(settingsEntries(real).length, 1);
});

test('an exact match outranks a longer label that merely starts with it', () => {
  // Without the exact tier this ordering falls to the alphabetical tie-break,
  // which put the wrong row first for any label that is the prefix of
  // another. Synthetic, because the real catalogue happens not to contain
  // such a pair today and a test that depends on that is a test that breaks
  // when somebody adds a key.
  const groups = [{
    title: 'AI models', category: 'AI',
    keys: [
      { key: 'A_LONGER', label: 'Moz API token for agencies' },
      { key: 'B_EXACT', label: 'Moz' },
    ],
  }];
  const hits = matchSettings('moz', settingsEntries(groups));
  assert.equal(hits[0].key, 'B_EXACT', hits.map(h => h.label).join(' | '));
});

test('credentials rank prefix, then contains, then group', () => {
  // The ranking is the part worth testing, and the earlier assertions only
  // checked that a match was found at all: three mutations of the tiers and
  // one that reversed the sort all passed unnoticed.
  //
  // The labels are chosen so alphabetical order *opposes* tier order. The
  // first attempt used 'Fax API key', 'Outbound fax token' and 'Transport
  // endpoint', where A-to-Z happens to produce the same sequence as the
  // tiers — so deleting either tier changed nothing and the test passed on
  // code that no longer ranked at all.
  const groups = [
    { title: 'Fax tooling', category: 'AI', keys: [
      // tier 3: the term is only in the group title. Sorts first of the three.
      { key: 'GROUP_ONLY', label: 'Abacus endpoint' },
    ] },
    { title: 'AI models', category: 'AI', keys: [
      // tier 1: the label starts with it. Sorts last of the three.
      { key: 'PREFIX', label: 'Fax API key' },
      // tier 2: the label contains it, not at the start.
      { key: 'CONTAINS', label: 'Admin fax token' },
    ] },
  ];
  const hits = matchSettings('fax', settingsEntries(groups));
  assert.deepEqual(hits.map(h => h.key), ['PREFIX', 'CONTAINS', 'GROUP_ONLY'],
    hits.map(h => `${h.key}:${h.label}`).join(' | '));
});

test('the limit keeps the palette short', () => {
  const keys = Array.from({ length: 12 }, (_, i) => ({ key: `K${i}`, label: `Fax key ${i}` }));
  const groups = [{ title: 'AI models', category: 'AI', keys }];
  assert.equal(matchSettings('fax', settingsEntries(groups)).length, 5);
  assert.equal(matchSettings('fax', settingsEntries(groups), 2).length, 2);
});

test('a credential row says which provider it belongs to', () => {
  const by = Object.fromEntries(settingsEntries().map(e => [e.key, e]));
  // "API token" on its own is three identical rows once Moz, SAM.gov and
  // PageSpeed are configured.
  assert.equal(by.MOZ_API_TOKEN.title, 'Moz · API token');
  // And a label that already names the provider is not made to say it twice.
  assert.equal(by.CLAUDE_API_KEY.title, 'Claude API Key');
  assert.equal(by.OPENAI_API_KEY.title, 'OpenAI API Key');
});

test('the provider is matched on whole words, not substrings', () => {
  // 'Moz' inside 'Amazon' is the trap: a substring test calls every Amazon
  // key a Moz key and then hides the provider from the row.
  const groups = [{
    title: 'Moz', category: 'SEO',
    keys: [{ key: 'AMZ', label: 'Amazon SES region' }],
  }];
  assert.equal(settingsEntries(groups)[0].title, 'Moz · Amazon SES region');
});

test('a group whose name is only generic words does not prefix the row', () => {
  // "API keys" identifies nothing, so prefixing with it adds length and no
  // information.
  const groups = [{
    title: 'API keys', category: 'AI',
    keys: [{ key: 'X', label: 'Secret' }],
  }];
  assert.equal(settingsEntries(groups)[0].title, 'Secret');
});
