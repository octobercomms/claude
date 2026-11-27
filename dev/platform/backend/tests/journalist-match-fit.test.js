// Every match carries a fit, in both modes.
//
// journalistMatch has two rankers. Semantic returns a 0-100 cosine
// percentage as `fit`. Keyword returned only a raw `score` and no `fit` at
// all, which meant the Fit column of anything consuming it held a percentage
// on an install with an OpenAI key and nothing at all on an install without
// one — and the merged Match list, which sorts on fit, collapsed to whatever
// order the rows arrived in. Same code, same data, different product,
// decided by a setting nobody looks at.
//
// Keyword fit is relative: the best row in the result set is 100% by
// construction. That is a real limitation and the reason `mode` travels with
// the results, so the screen can say which kind of number it is showing. A
// column whose TYPE changes with a backend setting is the worse problem.
//
//   node tests/journalist-match-fit.test.js

const assert = require('assert');

// The db is stubbed with contacts whose scores are known, so the arithmetic
// is checkable. Claude is stubbed out too, which drops extractTerms to its
// local keyword skim.
const dbPath = require.resolve('../src/db');
let rows = [];
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { query: async () => ({ rows }) },
};
const claudePath = require.resolve('../src/services/claude');
require.cache[claudePath] = { id: claudePath, filename: claudePath, loaded: true, exports: {} };
const embedPath = require.resolve('../src/services/embeddings');
// One object, mutated in place. journalistMatch binds the module at require
// time, so swapping `exports` for a new object later changes nothing it can
// see — the first attempt did that and got "embeddings.embed is not a
// function" from a stub that plainly had one.
const embedStub = {
  available: async () => false,                  // keyword mode to start with
  embed: async () => [[1, 0]],
};
require.cache[embedPath] = { id: embedPath, filename: embedPath, loaded: true, exports: embedStub };

const journalistMatch = require('../src/services/journalistMatch');

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; console.log(`PASS  ${what}`); };

const contact = (id, name, beats, over = {}) => ({
  id, name, email: `${id}@example.com`, verification_status: 'verified',
  outlet: 'Dezeen', tier: 2, beats, topics: [], auto_topics: [],
  recent_titles: '', covered_client: false, last_article: null, ...over,
});

(async () => {
  // "architecture" scores 3 on a declared beat. The second contact matches
  // two terms, so it scores higher, and tier 1 adds one more.
  rows = [
    contact('weak', 'Weak Match', ['architecture']),
    contact('strong', 'Strong Match', ['architecture', 'interiors'], { tier: 1 }),
    contact('mid', 'Mid Match', ['interiors']),
  ];

  const out = await journalistMatch.matchKeyword('architecture and interiors in London', { limit: 40 });

  ok('keyword mode returns a fit on every row', () => {
    assert.ok(out.items.length >= 2, `only ${out.items.length} rows came back`);
    for (const item of out.items) {
      assert.strictEqual(typeof item.fit, 'number',
        `${item.name} has no numeric fit, so a Fit column renders empty and a sort on it does nothing`);
    }
  });

  ok('the mode says which kind of number it is', () => {
    assert.strictEqual(out.mode, 'keyword',
      'without the mode the screen cannot caveat a relative score as relative');
  });

  ok('the best row is 100 and the rest are relative to it', () => {
    assert.strictEqual(out.items[0].fit, 100, 'the top row is 100% by construction in this mode');
    assert.strictEqual(out.items[0].id, 'strong');
    for (const item of out.items.slice(1)) {
      assert.ok(item.fit < 100, `${item.name} ties the top row at ${item.fit}`);
      assert.ok(item.fit > 0, `${item.name} scored ${item.fit}, which reads as no match at all`);
    }
  });

  ok('fit agrees with the order the rows are in', () => {
    const fits = out.items.map(i => i.fit);
    const sorted = [...fits].sort((a, b) => b - a);
    assert.deepStrictEqual(fits, sorted,
      `the list is ordered ${fits.join(', ')}, which is not descending — the number and the order disagree`);
  });

  ok('the raw score is still there for anything that wants it', () => {
    assert.ok(out.items.every(i => typeof i.score === 'number'),
      'score was replaced rather than supplemented, which changes what existing callers read');
  });

  rows = [];
  const empty = await journalistMatch.matchKeyword('nothing matches this', { limit: 40 });

  ok('no matches is an empty list, not a divide by zero', () => {
    assert.deepStrictEqual(empty.items, []);
    assert.strictEqual(empty.mode, 'keyword');
  });

  // ── the semantic ranker, where both faults lived ──────────────────────────
  //
  // Keyword mode drops a contact before scoring it when no term matches
  // (`if (!matched.length) continue`), so it can never show the fallback. The
  // semantic ranker scores on meaning and keeps rows that matched no topic by
  // name — which is exactly where the fallback printed their own topics as
  // though they were the reason.

  // Two dimensions makes similarity predictable: [1,0] is the story, so a
  // contact at [1,0] is a perfect match and [0,1] is unrelated.
  embedStub.available = async () => true;

  rows = [
    { ...contact('on', 'On Topic', ['architecture']), topic_embedding: [1, 0] },
    // Matches strongly on meaning, matches no term by name, and is tier 1 so
    // the bonuses apply. This is the Manchester Wire shape.
    { ...contact('meaning', 'Meaning Only', ['manchester music events', 'live music', 'hospitality openings'], { tier: 1 }),
      topic_embedding: [0.9, 0.44] },
  ];

  const sem = await journalistMatch.matchSemantic('architecture in shenzhen', { limit: 40 });

  ok('a row that matched no topic by name says so, rather than listing its own', () => {
    const m = sem.items.find(i => i.id === 'meaning');
    assert.ok(m, 'the meaning-only row was dropped; semantic mode is supposed to keep it');
    assert.deepStrictEqual(m.matched, [],
      `it claims to have matched ${JSON.stringify(m.matched)} — those are its own topics, printed as `
      + 'the reason it is in the list. That is how a Manchester nightlife writer came ninth on a '
      + 'Shenzhen architecture story');
    assert.deepStrictEqual(m.topics, ['manchester music events', 'live music', 'hospitality openings'],
      'its beat should still be available, just not as a claim about the match');
  });

  ok('the fit shown is the fit sorted on', () => {
    // fit was the raw similarity while the order used similarity plus
    // bonuses for tier, recency and prior coverage, so a row could sit above
    // one showing a higher number.
    const bySort = sem.items.map(i => i.fit);
    assert.deepStrictEqual(bySort, [...bySort].sort((a, b) => b - a),
      `fits run ${bySort.join(', ')} down the list, so the column disagrees with the order`);
    const m = sem.items.find(i => i.id === 'meaning');
    assert.strictEqual(m.fit, Math.min(100, Math.round(m.score * 100)),
      'the displayed fit is not derived from the score the list is sorted on');
  });

  console.log(`\n${passed} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
