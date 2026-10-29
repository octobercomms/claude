// The Paid page adds spend up three ways, and each sum needs its own answer
// to "in what currency".
//
// The failure that matters is the quiet one: a UK and a US Google Ads account
// under one client is an ordinary setup, and the blended total used to print
// their sum with a pound sign. Nothing on screen said the number was a mix.
//
//   node tests/ads-currency.test.js

const assert = require('assert');
const { summariseAdsCurrency, currenciesOf } = require('../src/services/adsCurrency');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const acct = (currency) => ({ data: { currency } });
const broken = (currency) => ({ error: 'invalid customer id', data: { currency } });

console.log('currenciesOf');

check('a failed account contributes no currency', () => {
  // Its spend is not in the sum either — the page filters errors out before
  // it adds up — so counting its currency would invent a disagreement.
  assert.deepStrictEqual(currenciesOf([acct('GBP'), broken('USD')]), [{ currency: 'GBP' }]);
});

check('an account that reported nothing is still an entry, with no currency', () => {
  assert.deepStrictEqual(currenciesOf([{ data: {} }]), [{ currency: undefined }]);
});

check('no entries, or junk entries, do not throw', () => {
  for (const input of [[], null, undefined, [null, {}]]) {
    assert.ok(Array.isArray(currenciesOf(input)), String(input));
  }
});

console.log('\nsummariseAdsCurrency');

check('one account per platform, both in the same currency', () => {
  const r = summariseAdsCurrency(null, [acct('GBP')], [acct('GBP')]);
  assert.strictEqual(r.google.currency, 'GBP');
  assert.strictEqual(r.meta.currency, 'GBP');
  assert.strictEqual(r.blended.currency, 'GBP');
  assert.strictEqual(r.blended.note, null, 'agreement says nothing');
});

check('each platform keeps its own currency', () => {
  const r = summariseAdsCurrency(null, [acct('GBP')], [acct('USD')]);
  assert.strictEqual(r.google.currency, 'GBP');
  assert.strictEqual(r.meta.currency, 'USD');
});

check('the blended total across two currencies is NOT labelled', () => {
  // The whole point. Google in GBP plus Meta in USD is a sum of two units,
  // and stamping either symbol on it would be arithmetic nobody performed.
  const r = summariseAdsCurrency(null, [acct('GBP')], [acct('USD')]);
  assert.strictEqual(r.blended.currency, null);
  assert.match(r.blended.note, /GBP, USD/);
  assert.match(r.blended.note, /ad accounts/i, 'the note must name ad accounts, not stores');
});

check('two Google accounts on different currencies flag their own total too', () => {
  const r = summariseAdsCurrency(null, [acct('GBP'), acct('USD')], []);
  assert.strictEqual(r.google.currency, null);
  assert.match(r.google.note, /GBP, USD/);
});

check("the client's reporting currency wins over the accounts", () => {
  const r = summariseAdsCurrency('GBP', [acct('USD')], []);
  assert.strictEqual(r.google.currency, 'GBP');
  assert.match(r.google.note, /set to report in GBP/);
  assert.match(r.google.note, /ad account reports USD/, 'singular for one account');
});

check('a stated currency does not silence a cross-currency blend', () => {
  // It labels the figure, because the account lead said so, but the note has
  // to survive: the sum is still across two currencies with no conversion.
  const r = summariseAdsCurrency('GBP', [acct('GBP')], [acct('USD')]);
  assert.strictEqual(r.blended.currency, 'GBP');
  assert.ok(r.blended.note, 'a mixed blend must still carry its note');
  assert.match(r.blended.note, /not a true GBP figure/);
});

check('a platform with no accounts is simply unlabelled', () => {
  const r = summariseAdsCurrency(null, [], []);
  assert.strictEqual(r.google.currency, null);
  assert.strictEqual(r.google.note, null);
  assert.strictEqual(r.blended.currency, null);
});

check('a platform with no accounts still takes the stated currency', () => {
  const r = summariseAdsCurrency('EUR', [], []);
  assert.strictEqual(r.google.currency, 'EUR');
  assert.strictEqual(r.google.note, null);
});

check('every account failing reads as no data, not as a disagreement', () => {
  const r = summariseAdsCurrency(null, [broken('GBP'), broken('USD')], []);
  assert.strictEqual(r.google.currency, null);
  assert.strictEqual(r.google.note, null, 'nothing was summed, so there is nothing to warn about');
});

check('junk from a connector is not treated as a currency', () => {
  const r = summariseAdsCurrency(null, [acct('GBP'), acct('')], []);
  assert.strictEqual(r.google.currency, 'GBP');
  assert.strictEqual(r.google.note, null);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
