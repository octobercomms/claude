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
const { agreeCurrency, resolveCurrency, currencyIsUnset } = require('../src/services/ecomCurrency');

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

console.log('\nresolveCurrency');

check('a GA4-only client falls back to its stated currency', () => {
  // The regression this exists to prevent: kpis.revenue comes from GA4 whether
  // or not a store reported, so a client with no working ecom connector went
  // from a wrong symbol to no symbol at all.
  const r = resolveCurrency('GBP', []);
  assert.strictEqual(r.currency, 'GBP');
  assert.strictEqual(r.note, null);
});

check('with nothing stated it is still whatever the stores agree', () => {
  assert.strictEqual(resolveCurrency(null, [{ currency: 'USD' }]).currency, 'USD');
  assert.strictEqual(resolveCurrency('', [{ currency: 'USD' }]).currency, 'USD');
  assert.strictEqual(resolveCurrency(undefined, [{ currency: 'USD' }]).currency, 'USD');
});

check('the client setting beats the stores, and says so', () => {
  const r = resolveCurrency('GBP', [{ currency: 'USD' }]);
  assert.strictEqual(r.currency, 'GBP', "the account lead's setting wins");
  assert.match(r.note, /set to report in GBP/);
  assert.match(r.note, /reports USD/);
  assert.match(r.note, /Setup/, 'and says where to change it');
});

check('agreement is silent', () => {
  const r = resolveCurrency('USD', [{ currency: 'USD' }, { currency: 'usd' }]);
  assert.strictEqual(r.currency, 'USD');
  assert.strictEqual(r.note, null, 'nothing to report when they match');
});

check('a stated currency does NOT silence disagreeing stores', () => {
  // The dangerous case. Revenue is summed across currencies with no
  // conversion, so stamping GBP on it is arithmetic that is simply wrong.
  // The label must not imply a conversion nobody performed.
  const r = resolveCurrency('GBP', [{ currency: 'USD' }, { currency: 'EUR' }]);
  assert.strictEqual(r.currency, 'GBP', 'the stated currency is still what is shown');
  assert.match(r.note, /different currencies \(EUR, USD\)/);
  assert.match(r.note, /without conversion/);
  assert.match(r.note, /not a true GBP figure/, 'it has to say the total is not real');
});

check('junk in the client setting is ignored, not shown', () => {
  for (const junk of ['', '  ', 'pounds', '£', 'GB', 'GBPX', '123', null]) {
    const r = resolveCurrency(junk, [{ currency: 'USD' }]);
    assert.strictEqual(r.currency, 'USD', `${JSON.stringify(junk)} should fall through to the store`);
  }
});

check('nothing stated and nothing reported is still no symbol', () => {
  const r = resolveCurrency(null, []);
  assert.strictEqual(r.currency, null, 'guessing sterling is the bug this all started with');
  assert.strictEqual(r.note, null);
});

console.log('\ncurrencyIsUnset');

check('nothing stated and nothing reported is unset', () => {
  // The Falcon case: GA4 revenue, no working store connector, nobody has said.
  // One field in Setup fixes it, and the dashboard should point at that field
  // rather than showing a bare number twice reported as a bug.
  assert.strictEqual(currencyIsUnset(null, []), true);
  assert.strictEqual(currencyIsUnset(null, [{ currency: null }]), true);
});

check('a stated currency is not unset', () => {
  assert.strictEqual(currencyIsUnset('GBP', []), false);
});

check('stores agreeing is not unset', () => {
  assert.strictEqual(currencyIsUnset(null, [{ currency: 'USD' }]), false);
});

check('stores DISAGREEING is not "unset"', () => {
  // The distinction that matters. Both give a null currency, but this one is a
  // real problem with its own note, and telling the account lead to set a
  // field would paper over a cross-currency sum rather than fix it.
  assert.strictEqual(currencyIsUnset(null, [{ currency: 'GBP' }, { currency: 'USD' }]), false);
});

check('junk reported by the only store still counts as nobody having said', () => {
  assert.strictEqual(currencyIsUnset(null, [{ currency: '' }, { currency: 'pounds' }]), true);
});

check('junk in the client setting does not count as stated', () => {
  assert.strictEqual(currencyIsUnset('£', []), true);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
