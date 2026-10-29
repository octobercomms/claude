// The postcode panel's revenue needs the store's currency, and getting it out
// of the order walk has two traps.
//
// The first is the return shape: `fetchCustomerPostcodes` used to return the
// customer array itself, and `audienceInsights` now reads `.customers` off it.
// Returning a bare array again would not throw — `walked.customers` would be
// undefined and the whole distribution would silently read zero.
//
// The second is where the currency is read. The loop skips orders with no
// postcode, so taking the currency from a mapped order only would leave a
// store whose orders lack postcodes unlabelled for no reason.
//
//   node tests/postcode-currency.test.js

const assert = require('assert');
const axios = require('axios');
const shopify = require('../src/connectors/shopify');

let failed = 0;
function check(name, fn) {
  return fn().then(
    () => console.log(`  ok   ${name}`),
    (e) => { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
  );
}

// One page of orders, then no `link` header so the walk stops.
function stubOrders(orders) {
  const realGet = axios.get;
  axios.get = async () => ({ data: { orders }, headers: {} });
  return () => { axios.get = realGet; };
}

const creds = { shop_domain: 'example.myshopify.com', access_token: 'x' };

async function walk(orders) {
  const restore = stubOrders(orders);
  try { return await shopify.fetchCustomerPostcodes(creds); }
  finally { restore(); }
}

async function main() {
  console.log('fetchCustomerPostcodes');

  await check('returns an object with customers and currency, not a bare array', async () => {
    const out = await walk([
      { id: 1, customer: { id: 7 }, total_price: '120.00', currency: 'USD', shipping_address: { zip: 'SW1A 1AA' } },
    ]);
    assert.ok(!Array.isArray(out), 'a bare array would make audienceInsights read undefined');
    assert.strictEqual(out.currency, 'USD');
    assert.strictEqual(out.customers.length, 1);
    assert.strictEqual(out.customers[0].postcode_district, 'SW1A');
    assert.strictEqual(out.customers[0].revenue, 120);
  });

  await check('the currency survives an order with no postcode', async () => {
    // This is the real case: a store selling digital goods, or one whose
    // first page of orders happens to be collections. It still bills in a
    // currency, and the total is still denominated in it.
    const out = await walk([
      { id: 1, customer: { id: 7 }, total_price: '50.00', currency: 'EUR' },
    ]);
    assert.strictEqual(out.currency, 'EUR');
    assert.strictEqual(out.customers.length, 0);
  });

  await check('a store reporting no currency gives null, not a guess', async () => {
    const out = await walk([
      { id: 1, customer: { id: 7 }, total_price: '50.00', shipping_address: { zip: 'EH1 2AB' } },
    ]);
    assert.strictEqual(out.currency, null, 'null shows the figure unlabelled; a guess shows it wrong');
  });

  await check('junk in the currency field is ignored', async () => {
    for (const junk of ['', '  ', '$', 'pounds', 12, null]) {
      const out = await walk([{ id: 1, customer: { id: 7 }, total_price: '1.00', currency: junk }]);
      assert.strictEqual(out.currency, null, JSON.stringify(junk));
    }
  });

  await check('the first real currency wins over later junk', async () => {
    const out = await walk([
      { id: 1, customer: { id: 7 }, total_price: '1.00', currency: 'gbp' },
      { id: 2, customer: { id: 8 }, total_price: '1.00', currency: '' },
    ]);
    assert.strictEqual(out.currency, 'GBP', 'and it is upper-cased for the ISO check downstream');
  });

  await check('no orders at all is no currency and no customers', async () => {
    const out = await walk([]);
    assert.strictEqual(out.currency, null);
    assert.deepStrictEqual(out.customers, []);
  });

  if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
  console.log('\nall passed');
}

main();
