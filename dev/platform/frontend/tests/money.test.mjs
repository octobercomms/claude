// The currency has to come from the data, never from a default.
//
// This existed because Architecture Tours bills in USD and Measure showed its
// revenue with a pound sign. A wrong symbol is worse than no symbol: the
// number reads as a fact. So the cases that matter most here are the ones
// where nothing reported a currency, and where a currency we have no symbol
// for comes through — neither may quietly become sterling.
//
//   node --test tests/money.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney, currencySymbol } from '../src/utils/money.js';

test('a reported currency is the one that shows', () => {
  assert.equal(formatMoney(48210, 'USD'), '$48,210');
  assert.equal(formatMoney(48210, 'GBP'), '£48,210');
  assert.equal(formatMoney(48210, 'EUR'), '€48,210');
  assert.equal(formatMoney(48210, 'CAD'), 'C$48,210');
});

test('the code is accepted in any case', () => {
  assert.equal(formatMoney(100, 'usd'), '$100');
  assert.equal(formatMoney(100, 'Usd'), '$100');
});

test('no currency means no symbol, not a pound sign', () => {
  for (const missing of [null, undefined, '']) {
    const out = formatMoney(48210, missing);
    assert.equal(out, '48,210', String(missing));
    assert.ok(!/[£$€]/.test(out), `${missing} must not invent a symbol, got ${out}`);
  }
});

test('a currency with no symbol of ours still never reads as sterling', () => {
  for (const code of ['CHF', 'SEK', 'ZAR', 'INR']) {
    const out = formatMoney(1200, code);
    assert.ok(!out.includes('£'), `${code} rendered as ${out}`);
    assert.ok(out.includes('1,200') || out.includes('1 200'), `${code} lost the amount: ${out}`);
  }
});

test('a nonsense code degrades to the code itself rather than throwing', () => {
  const out = formatMoney(1200, 'NOTACODE');
  assert.ok(out.includes('1,200'), out);
  assert.ok(!out.includes('£'), out);
});

test('missing amounts read as an em dash, not zero', () => {
  assert.equal(formatMoney(null, 'USD'), '—');
  assert.equal(formatMoney(undefined, 'USD'), '—');
  assert.equal(formatMoney('', 'USD'), '—');
  assert.equal(formatMoney('nonsense', 'USD'), '—');
  // Zero is a real figure and must survive.
  assert.equal(formatMoney(0, 'USD'), '$0');
});

test('negatives keep the sign in front of the symbol', () => {
  assert.equal(formatMoney(-250, 'USD'), '-$250');
  assert.equal(formatMoney(-250, 'GBP'), '-£250');
});

test('decimal places are available for the places that need pence', () => {
  assert.equal(formatMoney(1234.56, 'USD', { dp: 2 }), '$1,234.56');
  assert.equal(formatMoney(1234.56, 'USD'), '$1,235');
});

test('currencySymbol never falls back to sterling', () => {
  assert.equal(currencySymbol('USD'), '$');
  assert.equal(currencySymbol('GBP'), '£');
  assert.equal(currencySymbol('CHF'), 'CHF');
  assert.equal(currencySymbol(null), '');
  assert.equal(currencySymbol(''), '');
});
