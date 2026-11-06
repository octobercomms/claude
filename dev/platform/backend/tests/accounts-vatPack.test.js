// Accounts module — VAT pack pure-logic tests.
//
//   node tests/accounts-vatPack.test.js

const assert = require('assert');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const {
  getCurrentQuarter,
  getPreviousQuarter,
  quarterDates,
  detectExceptions,
} = require('../src/services/accounts/vatPack');

// ── Quarter helpers ──────────────────────────────────────────────────

console.log('Quarter helpers');

check('getCurrentQuarter returns valid quarter', () => {
  const q = getCurrentQuarter();
  assert.ok(q.year >= 2024);
  assert.ok(q.q >= 1 && q.q <= 4);
  assert.ok(q.label);
  assert.ok(q.start);
  assert.ok(q.end);
});

check('getPreviousQuarter wraps to Q4 of previous year from Q1', () => {
  const prev = getPreviousQuarter();
  const curr = getCurrentQuarter();
  if (curr.q === 1) {
    assert.strictEqual(prev.q, 4);
    assert.strictEqual(prev.year, curr.year - 1);
  } else {
    assert.strictEqual(prev.q, curr.q - 1);
    assert.strictEqual(prev.year, curr.year);
  }
});

check('quarterDates produces correct date range for Q1 2026', () => {
  const d = quarterDates(2026, 1);
  assert.strictEqual(d.periodStart, '2026-01-01');
  assert.strictEqual(d.periodEnd, '2026-03-31');
  assert.ok(d.periodLabel.includes('2026'));
});

check('quarterDates produces correct date range for Q4 2025', () => {
  const d = quarterDates(2025, 4);
  assert.strictEqual(d.periodStart, '2025-10-01');
  assert.strictEqual(d.periodEnd, '2025-12-31');
});

// ── detectExceptions ────────────────────────────────────────────────

console.log('\ndetectExceptions');

check('flags entertainment expense with INPUT2', () => {
  const flags = detectExceptions({
    payee: 'Dinner at Restaurant',
    suggested_rate: 'INPUT2',
    amount: '50.00',
    currency: 'GBP',
  });
  assert.ok(flags.some(f => f.includes('entertainment')),
    `Expected entertainment flag, got: ${flags.join('; ')}`);
});

check('does not flag entertainment with NONE', () => {
  const flags = detectExceptions({
    payee: 'Restaurant bill',
    suggested_rate: 'NONE',
    amount: '50.00',
    currency: 'GBP',
  });
  assert.ok(!flags.some(f => f.includes('entertainment')));
});

check('flags overseas SaaS with INPUT2 as likely reverse charge', () => {
  const payees = ['Stripe', 'Google', 'Meta', 'Adobe', 'Slack', 'Notion', 'Figma'];
  for (const payee of payees) {
    const flags = detectExceptions({
      payee,
      suggested_rate: 'INPUT2',
      amount: '100.00',
      currency: 'USD',
    });
    assert.ok(flags.some(f => f.includes('reverse charge') || f.includes('RRINPUT')),
      `${payee} with INPUT2 should flag reverse charge, got: ${flags.join('; ')}`);
  }
});

check('does not flag overseas SaaS with RRINPUT', () => {
  const flags = detectExceptions({
    payee: 'Google',
    suggested_rate: 'RRINPUT',
    amount: '100.00',
    currency: 'USD',
  });
  assert.ok(!flags.some(f => f.includes('Overseas SaaS')));
});

check('flags high-value transaction without matched invoice', () => {
  const flags = detectExceptions({
    payee: 'Big Supplier',
    suggested_rate: 'INPUT2',
    amount: '1500.00',
    currency: 'GBP',
  });
  assert.ok(flags.some(f => f.includes('without a matched invoice')));
});

check('does not flag small transaction for missing invoice', () => {
  const flags = detectExceptions({
    payee: 'Small Supplier',
    suggested_rate: 'INPUT2',
    amount: '50.00',
    currency: 'GBP',
  });
  assert.ok(!flags.some(f => f.includes('without a matched invoice')));
});

check('flags FX transaction over 100', () => {
  const flags = detectExceptions({
    payee: 'US Vendor',
    suggested_rate: 'RRINPUT',
    amount: '200.00',
    currency: 'USD',
  });
  assert.ok(flags.some(f => f.includes('Foreign currency')));
});

check('does not flag GBP transaction as FX', () => {
  const flags = detectExceptions({
    payee: 'UK Vendor',
    suggested_rate: 'INPUT2',
    amount: '200.00',
    currency: 'GBP',
  });
  assert.ok(!flags.some(f => f.includes('Foreign currency')));
});

check('flags large zero-rated input for review', () => {
  const flags = detectExceptions({
    payee: 'Some Supplier',
    suggested_rate: 'ZERORATEDINPUT',
    amount: '600.00',
    currency: 'GBP',
  });
  assert.ok(flags.some(f => f.includes('zero-rated')));
});

check('returns empty array for clean transaction', () => {
  const flags = detectExceptions({
    payee: 'UK Office Supplies',
    suggested_rate: 'INPUT2',
    amount: '45.00',
    currency: 'GBP',
    invoice_status: 'matched',
  });
  assert.deepStrictEqual(flags, []);
});

// ── Summary ─────────────────────────────────────────────────────────

console.log('');
process.exit(failed ? 1 : 0);
