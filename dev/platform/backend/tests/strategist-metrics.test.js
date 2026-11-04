// The metric enum for the GTM Brain.
//
//   node tests/strategist-metrics.test.js

const assert = require('assert');
const { isValid, windowFor, labelFor, allRefs, refsByPillar, directionFor } = require('../src/services/strategist/metrics');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

console.log('isValid');

check('accepts a valid pillar:metric ref', () => {
  assert.strictEqual(isValid('paid:roas'), true);
  assert.strictEqual(isValid('earned:tier1_placements'), true);
  assert.strictEqual(isValid('owned:top3'), true);
  assert.strictEqual(isValid('shared:engagement_rate'), true);
  assert.strictEqual(isValid('cross:revenue'), true);
});

check('rejects invalid refs', () => {
  assert.strictEqual(isValid('paid:nonsense'), false);
  assert.strictEqual(isValid('unknown:roas'), false);
  assert.strictEqual(isValid('roas'), false);
  assert.strictEqual(isValid(''), false);
  assert.strictEqual(isValid(null), false);
  assert.strictEqual(isValid(undefined), false);
});

console.log('\nwindowFor');

check('returns the pillar-specific default window', () => {
  assert.strictEqual(windowFor('paid:roas'), 30);
  assert.strictEqual(windowFor('earned:published'), 60);
  assert.strictEqual(windowFor('owned:domain_authority'), 60);
});

check('returns 30 as default for null/unknown', () => {
  assert.strictEqual(windowFor(null), 30);
  assert.strictEqual(windowFor('paid:nonsense'), 30);
});

console.log('\nlabelFor');

check('returns a human label', () => {
  assert.strictEqual(labelFor('paid:roas'), 'ROAS');
  assert.strictEqual(labelFor('earned:tier1_placements'), 'Tier 1 placements');
});

check('returns null for null input', () => {
  assert.strictEqual(labelFor(null), null);
});

console.log('\nallRefs');

check('returns all refs as pillar:name strings', () => {
  const refs = allRefs();
  assert.ok(refs.includes('paid:roas'));
  assert.ok(refs.includes('earned:tier1_placements'));
  assert.ok(refs.includes('cross:orders'));
  assert.ok(refs.length > 15, `expected >15 refs, got ${refs.length}`);
});

console.log('\nrefsByPillar');

check('returns refs for a specific pillar', () => {
  const paid = refsByPillar('paid');
  assert.ok(paid.includes('paid:roas'));
  assert.ok(paid.includes('paid:cpa'));
  assert.ok(!paid.includes('owned:top10'));
});

check('returns empty for unknown pillar', () => {
  assert.deepStrictEqual(refsByPillar('unknown'), []);
});

console.log('\ndirectionFor');

check('returns up for metrics where higher is better', () => {
  assert.strictEqual(directionFor('paid:roas'), 'up');
  assert.strictEqual(directionFor('owned:top3'), 'up');
  assert.strictEqual(directionFor('cross:revenue'), 'up');
});

check('returns down for metrics where lower is better', () => {
  assert.strictEqual(directionFor('paid:cpa'), 'down');
});

check('returns neutral for context-dependent metrics', () => {
  assert.strictEqual(directionFor('paid:spend'), 'neutral');
});

check('returns null for invalid refs', () => {
  assert.strictEqual(directionFor(null), null);
  assert.strictEqual(directionFor('paid:nonsense'), null);
  assert.strictEqual(directionFor(''), null);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
