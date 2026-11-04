// GTM Brain Phase 3 — track record tests.
//
//   node tests/strategist-trackRecord.test.js

const assert = require('assert');
const { classifyOutcome, pctChange, classifyRows, FLAT_THRESHOLD } = require('../src/services/strategist/trackRecord');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

// ── classifyOutcome ─────────────────────────────────────────────────

console.log('classifyOutcome — up direction (higher is better)');

check('outcome above baseline + threshold → improved', () => {
  assert.strictEqual(classifyOutcome(100, 110, 'up'), 'improved');
});

check('outcome below baseline - threshold → declined', () => {
  assert.strictEqual(classifyOutcome(100, 85, 'up'), 'declined');
});

check('outcome within threshold → flat', () => {
  assert.strictEqual(classifyOutcome(100, 103, 'up'), 'flat');
  assert.strictEqual(classifyOutcome(100, 97, 'up'), 'flat');
});

check('exact threshold boundary is flat', () => {
  assert.strictEqual(classifyOutcome(100, 105, 'up'), 'flat');
  assert.strictEqual(classifyOutcome(100, 95, 'up'), 'flat');
});

check('just past threshold is improved/declined', () => {
  assert.strictEqual(classifyOutcome(100, 105.1, 'up'), 'improved');
  assert.strictEqual(classifyOutcome(100, 94.9, 'up'), 'declined');
});

console.log('\nclassifyOutcome — down direction (lower is better)');

check('outcome below baseline → improved', () => {
  assert.strictEqual(classifyOutcome(50, 40, 'down'), 'improved');
});

check('outcome above baseline → declined', () => {
  assert.strictEqual(classifyOutcome(50, 60, 'down'), 'declined');
});

check('outcome within threshold → flat', () => {
  assert.strictEqual(classifyOutcome(50, 51, 'down'), 'flat');
});

console.log('\nclassifyOutcome — neutral direction');

check('neutral direction → observed regardless of change', () => {
  assert.strictEqual(classifyOutcome(1000, 2000, 'neutral'), 'observed');
  assert.strictEqual(classifyOutcome(1000, 500, 'neutral'), 'observed');
  assert.strictEqual(classifyOutcome(1000, 1000, 'neutral'), 'observed');
});

console.log('\nclassifyOutcome — edge cases');

check('null baseline → null', () => {
  assert.strictEqual(classifyOutcome(null, 100, 'up'), null);
});

check('null outcome → null', () => {
  assert.strictEqual(classifyOutcome(100, null, 'up'), null);
});

check('null direction → observed', () => {
  assert.strictEqual(classifyOutcome(100, 200, null), 'observed');
});

check('zero baseline, non-zero outcome → improved (up)', () => {
  assert.strictEqual(classifyOutcome(0, 5, 'up'), 'improved');
});

check('zero baseline, negative outcome → declined (up)', () => {
  assert.strictEqual(classifyOutcome(0, -5, 'up'), 'declined');
});

check('zero baseline, non-zero outcome → improved (down)', () => {
  assert.strictEqual(classifyOutcome(0, -5, 'down'), 'improved');
});

check('zero to zero → flat', () => {
  assert.strictEqual(classifyOutcome(0, 0, 'up'), 'flat');
  assert.strictEqual(classifyOutcome(0, 0, 'down'), 'flat');
});

check('NaN values → null', () => {
  assert.strictEqual(classifyOutcome(NaN, 100, 'up'), null);
  assert.strictEqual(classifyOutcome(100, NaN, 'up'), null);
});

check('string numbers are coerced', () => {
  assert.strictEqual(classifyOutcome('100', '150', 'up'), 'improved');
});

// ── pctChange ───────────────────────────────────────────────────────

console.log('\npctChange');

check('positive change', () => {
  assert.strictEqual(pctChange(100, 150), 50.0);
});

check('negative change', () => {
  assert.strictEqual(pctChange(100, 80), -20.0);
});

check('zero baseline → null', () => {
  assert.strictEqual(pctChange(0, 50), null);
});

check('small change rounds to one decimal', () => {
  assert.strictEqual(pctChange(100, 103.33), 3.3);
});

check('null inputs → null', () => {
  assert.strictEqual(pctChange(null, 100), null);
  assert.strictEqual(pctChange(100, null), null);
});

// ── classifyRows ────────────────────────────────────────────────────

console.log('\nclassifyRows');

check('enriches rows with classification and change_pct', () => {
  const rows = [
    { metric_ref: 'paid:roas', baseline_value: 2.0, outcome_value: 3.0 },
    { metric_ref: 'paid:cpa', baseline_value: 50, outcome_value: 40 },
    { metric_ref: 'paid:spend', baseline_value: 5000, outcome_value: 6000 },
  ];
  const classified = classifyRows(rows);
  assert.strictEqual(classified[0].classification, 'improved');
  assert.strictEqual(classified[0].direction, 'up');
  assert.strictEqual(classified[0].change_pct, 50.0);

  assert.strictEqual(classified[1].classification, 'improved');
  assert.strictEqual(classified[1].direction, 'down');
  assert.strictEqual(classified[1].change_pct, -20.0);

  assert.strictEqual(classified[2].classification, 'observed');
  assert.strictEqual(classified[2].direction, 'neutral');
  assert.strictEqual(classified[2].change_pct, 20.0);
});

check('handles rows with null values', () => {
  const rows = [
    { metric_ref: 'paid:roas', baseline_value: null, outcome_value: 3.0 },
  ];
  const classified = classifyRows(rows);
  assert.strictEqual(classified[0].classification, null);
  assert.strictEqual(classified[0].change_pct, null);
});

check('handles unknown metric ref gracefully', () => {
  const rows = [
    { metric_ref: 'unknown:metric', baseline_value: 100, outcome_value: 200 },
  ];
  const classified = classifyRows(rows);
  assert.strictEqual(classified[0].direction, null);
  assert.strictEqual(classified[0].classification, 'observed');
});

// ── FLAT_THRESHOLD ──────────────────────────────────────────────────

console.log('\nFLAT_THRESHOLD');

check('is 5%', () => {
  assert.strictEqual(FLAT_THRESHOLD, 0.05);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
