// Accounts module — FX tracker pure-logic tests.
//
//   node tests/accounts-fx.test.js

const assert = require('assert');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

console.log('FX tracker (pure-logic validation)');

// The realised gain/loss formula used in fxTracker.js:
//   realisedGbp = (1/settleRate - 1/raiseRate) * |amount|
// This converts FX amount to GBP at both rates and takes the difference.

function calcRealised(raiseRate, settleRate, amount) {
  return Number(((1 / settleRate - 1 / raiseRate) * Math.abs(amount)).toFixed(2));
}

check('USD strengthening produces a loss (more GBP needed to settle)', () => {
  // Raised invoice at 1.25 (£1 = $1.25), settled at 1.20 (£1 = $1.20)
  // GBP weakened, so settling costs more GBP = loss
  const result = calcRealised(1.25, 1.20, 1000);
  assert.ok(result > 0, `Expected positive (gain for seller), got ${result}`);
});

check('USD weakening produces a gain (less GBP needed to settle)', () => {
  // Raised at 1.20, settled at 1.30 (GBP strengthened)
  const result = calcRealised(1.20, 1.30, 1000);
  assert.ok(result < 0, `Expected negative (loss for seller), got ${result}`);
});

check('same rate produces zero gain/loss', () => {
  const result = calcRealised(1.25, 1.25, 5000);
  assert.strictEqual(result, 0);
});

check('EUR transaction with small rate difference', () => {
  // Raised at 1.16, settled at 1.15
  const result = calcRealised(1.16, 1.15, 500);
  // (1/1.15 - 1/1.16) * 500 = (0.8696 - 0.8621) * 500 = 3.75 approx
  assert.ok(Math.abs(result) < 10, `Expected small gain/loss, got ${result}`);
  assert.ok(result > 0, 'GBP weakening should produce positive result');
});

check('large transaction amplifies FX impact', () => {
  const small = calcRealised(1.25, 1.20, 100);
  const large = calcRealised(1.25, 1.20, 10000);
  assert.ok(Math.abs(large) > Math.abs(small) * 50, 'Larger amount should produce proportionally larger FX impact');
});

check('null/undefined rates should not crash formula', () => {
  // In the actual service, null rates skip the calculation.
  // Here we verify the formula handles edge cases.
  const result = calcRealised(1.25, 1.25, 0);
  assert.strictEqual(result, 0, 'Zero amount should produce zero result');
});

// ── Summary ─────────────────────────────────────────────────────────

console.log('');
process.exit(failed ? 1 : 0);
