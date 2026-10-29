// The Strategist's queue has to keep its identity between briefings.
//
// An item that loses its thread silently becomes a new item: its age resets to
// zero and a failure that has been open for three weeks reads as raised today.
// Nothing on screen would say so, which is why the carry-forward cases below
// matter more than the parsing ones.
//
//   node tests/strategist-queue.test.js

const assert = require('assert');
const { parseQueue, reconcile, openItemsBlock, ageInDays } = require('../src/services/strategist/queue');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

console.log('parseQueue');

check('reads priority, action and rationale', () => {
  const q = parseQueue('- [CRUCIAL] Fix the Meta Pixel :: 4,360 clicks at zero conversions is a tracking failure.');
  assert.strictEqual(q.length, 1);
  // Deep-equal on the whole item on purpose: it is the shape the generator
  // and the database both depend on, so a field appearing or vanishing should
  // break here rather than somewhere downstream. Adding `pillar` did.
  assert.deepStrictEqual(q[0], {
    priority: 'crucial', carryTag: null, pillar: null,
    text: 'Fix the Meta Pixel',
    rationale: '4,360 clicks at zero conversions is a tracking failure.',
  });
});

check('reads a carry tag', () => {
  const q = parseQueue('- [CRUCIAL][A2] Fix the Meta Pixel :: still dead.');
  assert.strictEqual(q[0].carryTag, 'A2');
  assert.strictEqual(q[0].text, 'Fix the Meta Pixel');
});

check('a line with no rationale is still an item', () => {
  const q = parseQueue('[NICE] Draft the retargeting plan');
  assert.strictEqual(q[0].rationale, null);
  assert.strictEqual(q[0].text, 'Draft the retargeting plan');
  assert.strictEqual(q[0].priority, 'nice');
});

check('the old format still parses, so an existing briefing is not lost', () => {
  const q = parseQueue('- [CRUCIAL] Get GA4 attributing revenue cleanly across all six stores.');
  assert.strictEqual(q.length, 1);
  assert.strictEqual(q[0].carryTag, null);
  assert.strictEqual(q[0].rationale, null);
});

check('bullet styles, numbering and case all work', () => {
  const md = [
    '* [crucial] one :: a',
    '1. [Nice] two :: b',
    '2) [NICE] three :: c',
    '[CRUCIAL] four :: d',
  ].join('\n');
  const q = parseQueue(md);
  assert.strictEqual(q.length, 4, JSON.stringify(q));
  assert.deepStrictEqual(q.map(i => i.priority), ['crucial', 'nice', 'nice', 'crucial']);
});

check('bold markers are stripped from both halves', () => {
  const q = parseQueue('- [CRUCIAL] **Fix the Pixel** :: **4,360** clicks.');
  assert.strictEqual(q[0].text, 'Fix the Pixel');
  assert.strictEqual(q[0].rationale, '4,360 clicks.');
});

check('a rationale containing its own colons survives', () => {
  const q = parseQueue('- [NICE] Thing :: at 09:00 the ratio is 3:1 :: and more');
  assert.strictEqual(q[0].text, 'Thing');
  assert.strictEqual(q[0].rationale, 'at 09:00 the ratio is 3:1 :: and more');
});

check('prose around the queue is ignored', () => {
  const md = [
    '### What changed', 'Revenue held flat.', '', '### The queue',
    '- [CRUCIAL] Fix it :: because.', 'Some trailing note.',
  ].join('\n');
  assert.strictEqual(parseQueue(md).length, 1);
});

check('empty, null and tag-only lines yield nothing', () => {
  assert.deepStrictEqual(parseQueue(''), []);
  assert.deepStrictEqual(parseQueue(null), []);
  assert.deepStrictEqual(parseQueue(undefined), []);
  assert.deepStrictEqual(parseQueue('- [CRUCIAL]'), []);
  assert.deepStrictEqual(parseQueue('- [CRUCIAL][A1]   '), []);
});

console.log('\nreconcile');

const open = [
  { id: 'id-1', text: 'Fix the Meta Pixel', pillar: 'paid', priority: 'crucial', first_raised_at: '2026-10-01T00:00:00Z' },
  { id: 'id-2', text: 'Restore Google Ads data', pillar: 'paid', priority: 'crucial', first_raised_at: '2026-10-08T00:00:00Z' },
];

check('a tagged item keeps its age and records its lineage', () => {
  const { items } = reconcile(parseQueue('- [CRUCIAL][A1] Fix the Meta Pixel :: still dead.'), open);
  assert.strictEqual(items[0].first_raised_at, '2026-10-01T00:00:00Z', 'age must not reset');
  assert.strictEqual(items[0].carried_from, 'id-1');
  assert.strictEqual(items[0].pillar, 'paid', 'a carried item keeps its pillar');
});

check('an untagged item is new: no age, no lineage', () => {
  const { items } = reconcile(parseQueue('- [CRUCIAL] Something new :: because.'), open);
  assert.strictEqual(items[0].first_raised_at, null);
  assert.strictEqual(items[0].carried_from, null);
  assert.strictEqual(items[0].pillar, null);
});

check('items the model stopped re-emitting come back as dropped', () => {
  const { items, dropped } = reconcile(parseQueue('- [CRUCIAL][A1] Fix the Meta Pixel :: still dead.'), open);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(dropped.length, 1);
  assert.strictEqual(dropped[0].id, 'id-2');
});

check('an invented tag is treated as new, never as someone else\'s history', () => {
  const { items } = reconcile(parseQueue('- [CRUCIAL][A9] Who knows :: hm.'), open);
  assert.strictEqual(items[0].carried_from, null, 'A9 does not exist and must not attach to anything');
  assert.strictEqual(items[0].first_raised_at, null);
});

check('a tag used twice only threads once', () => {
  const md = '- [CRUCIAL][A1] First :: a.\n- [CRUCIAL][A1] Second :: b.';
  const { items } = reconcile(parseQueue(md), open);
  assert.strictEqual(items[0].carried_from, 'id-1');
  assert.strictEqual(items[1].carried_from, null, 'the second use must not claim the same history');
});

check('no open items means everything is new, and nothing is dropped', () => {
  const { items, dropped } = reconcile(parseQueue('- [CRUCIAL][A1] x :: y.'), []);
  assert.strictEqual(items[0].carried_from, null);
  assert.strictEqual(dropped.length, 0);
  const n = reconcile(parseQueue('- [NICE] x :: y.'), null);
  assert.strictEqual(n.items.length, 1);
  assert.strictEqual(n.dropped.length, 0);
});

check('an empty queue drops everything that was open', () => {
  const { items, dropped } = reconcile([], open);
  assert.strictEqual(items.length, 0);
  assert.strictEqual(dropped.length, 2, 'both open items are unclaimed');
});

console.log('\nageInDays');

check('counts whole days', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  assert.strictEqual(ageInDays('2026-10-29T00:00:00Z', now), 0);
  assert.strictEqual(ageInDays('2026-10-28T00:00:00Z', now), 1);
  assert.strictEqual(ageInDays('2026-10-01T00:00:00Z', now), 28);
});

check('a missing or unparseable date is unknown, never a wrong number', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  assert.strictEqual(ageInDays(null, now), null);
  assert.strictEqual(ageInDays(undefined, now), null);
  assert.strictEqual(ageInDays('not a date', now), null);
});

check('a future date is zero rather than negative', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  assert.strictEqual(ageInDays('2026-11-05T00:00:00Z', now), 0);
});

console.log('\nopenItemsBlock');

check('tags, priority and age reach the model', () => {
  const block = openItemsBlock(open, new Date('2026-10-29T00:00:00Z'));
  assert.match(block, /\[A1\].*crucial.*open 28 days.*Fix the Meta Pixel/);
  assert.match(block, /\[A2\].*open 21 days/);
});

check('one day is singular', () => {
  const block = openItemsBlock(
    [{ id: 'x', text: 'y', priority: 'nice', first_raised_at: '2026-10-28T00:00:00Z' }],
    new Date('2026-10-29T00:00:00Z'));
  assert.match(block, /open 1 day\b/);
  assert.ok(!/1 days/.test(block), block);
});

check('nothing open says so in words the model can use', () => {
  const block = openItemsBlock([], new Date());
  assert.match(block, /Nothing is currently open/);
  assert.ok(!/\[A1\]/.test(block));
});

console.log('\nthe pillar tag');

check('an item carries the pillar it came from', () => {
  // Falcon's first real queue came back nine items long with every row
  // reading ACCOUNT-WIDE, because the line shape had nowhere to put the
  // pillar and everything defaulted to cross. The chip that replaced the
  // pillar filter was telling the account lead nothing.
  const [a, b] = parseQueue('- [CRUCIAL][PAID] Cap UK PMax :: branded spend hides in the broad feed.\n- [CRUCIAL][OWNED] Audit 143 keywords :: pages mistargeted.');
  assert.strictEqual(a.pillar, 'paid');
  assert.strictEqual(b.pillar, 'owned');
  assert.strictEqual(a.text, 'Cap UK PMax', 'the tag must not survive into the action');
});

check('the pillar and carry tags work in either order', () => {
  const [a] = parseQueue('- [CRUCIAL][PAID][A1] Cap UK PMax :: why.');
  const [b] = parseQueue('- [CRUCIAL][A1][PAID] Cap UK PMax :: why.');
  for (const item of [a, b]) {
    assert.strictEqual(item.pillar, 'paid');
    assert.strictEqual(item.carryTag, 'A1');
    assert.strictEqual(item.text, 'Cap UK PMax');
  }
});

check('no pillar tag is null, not a guess', () => {
  // The caller defaults this to `cross`, which is the honest answer for work
  // that spans the account. Inferring a pillar from the words would put items
  // in sections they did not come from.
  const [a] = parseQueue('- [CRUCIAL] Validate attribution across the six stores :: no baseline until then.');
  assert.strictEqual(a.pillar, null);
});

check('an unknown bracket is part of the action, not a dropped tag', () => {
  // A greedy tag group would eat this and the item would read "call the dev".
  const [a] = parseQueue('- [CRUCIAL] [Urgent] call the dev :: the pixel is dead.');
  assert.strictEqual(a.text, '[Urgent] call the dev');
  assert.strictEqual(a.pillar, null);
});

check('the pillar is case-insensitive, as the tags already were', () => {
  const [a] = parseQueue('- [crucial][Owned] Fix the page :: why.');
  assert.strictEqual(a.pillar, 'owned');
});

check('a carried item keeps its pillar when the model leaves the tag off', () => {
  const open = [{ id: 'old-1', text: 'Fix the Pixel', pillar: 'paid', first_raised_at: '2026-10-01T00:00:00Z' }];
  const { items } = reconcile(parseQueue('- [CRUCIAL][A1] Fix the Pixel :: still dead.'), open);
  assert.strictEqual(items[0].pillar, 'paid', 'it must not drift to cross');
  assert.strictEqual(items[0].carried_from, 'old-1');
});

check('and the model can move a carried item to another pillar', () => {
  // It has just read all four analyses. If it says the item now belongs to
  // Owned, that is a judgement, not a parse error.
  const open = [{ id: 'old-1', text: 'Fix tracking', pillar: 'paid', first_raised_at: '2026-10-01T00:00:00Z' }];
  const { items } = reconcile(parseQueue('- [CRUCIAL][OWNED][A1] Fix tracking :: it is a site problem.'), open);
  assert.strictEqual(items[0].pillar, 'owned');
  assert.strictEqual(items[0].carried_from, 'old-1', 'and it still keeps its age');
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
