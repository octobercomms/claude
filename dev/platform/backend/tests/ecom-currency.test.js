// A revenue figure never wears a currency nothing vouched for.
//
// Architecture Tours bills in USD and Measure showed its revenue with a pound
// sign, because the frontend hardcoded one and the API never said otherwise.
// The connectors now report each store's currency and agreeCurrency decides
// what the summed figure is denominated in.
//
// The cases that matter are the refusals. /sales-traffic sums revenue across
// stores with no FX conversion, so a client whose stores bill in different
// currencies has a total that is not money in any currency — it must come back
// unlabelled and noted, never stamped with whichever store answered first.
//
//   node tests/ecom-currency.test.js

const assert = require('assert');
const { agreeCurrency } = require('../src/services/ecomCurrency');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

console.log('agreeCurrency');

check('one store gives its own currency', () => {
  assert.deepStrictEqual(agreeCurrency([{ currency: 'USD' }]), { currency: 'USD', note: null });
  assert.deepStrictEqual(agreeCurrency([{ currency: 'GBP' }]), { currency: 'GBP', note: null });
});

check('stores that agree give that currency once', () => {
  const r = agreeCurrency([{ currency: 'USD' }, { currency: 'USD' }, { currency: 'usd' }]);
  assert.deepStrictEqual(r, { currency: 'USD', note: null });
});

check('stores that disagree give NO currency, and say why', () => {
  const r = agreeCurrency([{ currency: 'USD' }, { currency: 'GBP' }]);
  assert.strictEqual(r.currency, null, 'a mixed-currency sum must not be labelled');
  assert.match(r.note, /different currencies/);
  assert.match(r.note, /GBP, USD/, 'the note names both, sorted');
  assert.match(r.note, /FX rate/, 'and says what fixing it would take');
});

check('a store reporting nothing contributes nothing', () => {
  assert.deepStrictEqual(agreeCurrency([{ currency: null }]), { currency: null, note: null });
  assert.deepStrictEqual(agreeCurrency([{}]), { currency: null, note: null });
  // One silent store alongside one that reports is not a disagreement.
  assert.deepStrictEqual(agreeCurrency([{ currency: null }, { currency: 'EUR' }]),
    { currency: 'EUR', note: null });
});

check('no stores at all is no currency, not a crash', () => {
  assert.deepStrictEqual(agreeCurrency([]), { currency: null, note: null });
  assert.deepStrictEqual(agreeCurrency(null), { currency: null, note: null });
  assert.deepStrictEqual(agreeCurrency(undefined), { currency: null, note: null });
});

check('junk is not a currency', () => {
  // Whatever these are, they are not money, and must not reach the UI as a
  // label. A blank string was the real risk: Woo returns one for a store that
  // has never been configured.
  for (const junk of ['', '   ', 'pounds', '£', 'US', 'USDOLLAR', '123', 'null']) {
    const r = agreeCurrency([{ currency: junk }]);
    assert.strictEqual(r.currency, null, `${JSON.stringify(junk)} was accepted as a currency`);
    assert.strictEqual(r.note, null, `${JSON.stringify(junk)} should be silent, not noted`);
  }
});

check('junk alongside a real code does not count as a disagreement', () => {
  const r = agreeCurrency([{ currency: '' }, { currency: 'USD' }]);
  assert.strictEqual(r.currency, 'USD');
  assert.strictEqual(r.note, null);
});

check('a non-string code is handled rather than thrown on', () => {
  for (const odd of [0, 1, true, {}, []]) {
    const r = agreeCurrency([{ currency: odd }]);
    assert.strictEqual(r.currency, null, `${JSON.stringify(odd)} was accepted`);
  }
});

check('three or more disagreeing currencies are all named', () => {
  const r = agreeCurrency([{ currency: 'USD' }, { currency: 'GBP' }, { currency: 'EUR' }]);
  assert.strictEqual(r.currency, null);
  assert.match(r.note, /EUR, GBP, USD/);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
