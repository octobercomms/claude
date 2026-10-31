// Stripe — revenue for clients who take payments through a custom cart.
//
// Architecture Tours and Atlanta Design Festival sell through carts built
// against Stripe directly, so Stripe already holds every charge, customer and
// refund. OMI reads it with a restricted key, the same shape as the Shopify
// and WooCommerce connectors, and salesTraffic treats all three alike.
//
// Daniel's first instinct was to have the cart expose an API for OMI to call.
// That would be a second system to keep alive serving data Stripe already
// publishes. What the cart does need to do is set metadata — see
// docs/omi/stripe-connector.md — so a charge can say what was sold.
//
// On the key: a restricted key (rk_live_…) with read access to Charges and
// Customers is enough, and is what should be used. A full secret key would
// also work and should not be: this connector only ever reads, and a stolen
// read key cannot move money.

const axios = require('axios');

const authType = 'apikey';

const API = 'https://api.stripe.com/v1';
const PER_PAGE = 100;
// 50 pages is 5,000 charges in a window. Past that the figure is reported as
// truncated rather than quietly wrong, which is what WooCommerce's connector
// learned the hard way: it capped at 100 orders and every long range read
// "exactly 100 orders" regardless of true volume.
const MAX_PAGES = 50;

// How many minor units make one unit of the currency.
//
// Stripe quotes every amount in the currency's smallest unit: 1000 is £10.00
// in GBP, but ¥1000 in JPY, which has no minor unit at all. Getting this
// wrong is a 100x error on a revenue figure, so it is not guessed.
//
// Derived from the runtime's own CLDR data rather than a table copied into
// this file, because a hardcoded list goes stale silently and this one cannot:
// Intl knows the ISO 4217 minor units for every currency and ships with Node.
// Checked against GBP/USD/EUR (2), JPY/KRW/CLP/VND/XOF (0) and BHD/KWD/TND
// (3), which are the shapes that exist.
//
// Caveat worth knowing: Stripe has historically differed from ISO on one or
// two currencies. docs.stripe.com is outside this container's allowed network
// domains so it could not be checked here. If a client ever charges in
// anything exotic, verify that currency against Stripe's own table and add it
// to OVERRIDES below. Everything October currently bills in is a plain
// two-decimal currency.
const OVERRIDES = {};

function minorUnits(currency) {
  const code = String(currency || 'GBP').toUpperCase();
  if (code in OVERRIDES) return OVERRIDES[code];
  try {
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency: code })
      .resolvedOptions().maximumFractionDigits;
    return Math.pow(10, digits);
  } catch {
    // An unknown code. Two decimals is both the commonest case and the one
    // that makes a wrong answer smallest.
    return 100;
  }
}

function toMajor(amount, currency) {
  return (Number(amount) || 0) / minorUnits(currency);
}

function client(credentials) {
  const key = String(credentials?.secret_key || credentials?.api_key || '').trim();
  if (!key) throw new Error('A Stripe API key is required.');
  if (!/^(rk|sk)_(test|live)_/.test(key)) {
    throw new Error('That does not look like a Stripe API key — it should start with rk_live_, rk_test_, sk_live_ or sk_test_.');
  }
  return axios.create({
    baseURL: API,
    timeout: 30000,
    validateStatus: () => true,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'OctoberMarketingIntelligence/1.0 (+https://platform.octobercomms.com)',
    },
  });
}

// Stripe's errors are structured and specific; passing them through intact is
// more use than "Stripe fetch 401".
function explain(res) {
  const e = res?.data?.error || {};
  const base = e.message || `Stripe returned ${res?.status}`;
  if (res?.status === 401) {
    return `${base} Check the key is for the right account and has not been rolled.`;
  }
  if (res?.status === 403) {
    // The ordinary cause: a restricted key without the right read permission.
    return `${base} If this is a restricted key (rk_…), give it read access to Charges and Customers in the Stripe dashboard.`;
  }
  if (res?.status === 429) return `${base} Stripe is rate-limiting; try a shorter date range.`;
  return base;
}

function isLiveKey(credentials) {
  return /_live_/.test(String(credentials?.secret_key || credentials?.api_key || ''));
}

async function checkTokenValidity(credentials) {
  try {
    const res = await client(credentials).get('/balance');
    if (res.status === 200) {
      return {
        valid: true,
        live: isLiveKey(credentials),
        message: isLiveKey(credentials)
          ? 'Connected to Stripe (live).'
          : 'Connected to Stripe — this is a TEST key, so it reads test data only.',
      };
    }
    return { valid: false, message: explain(res) };
  } catch (err) {
    return { valid: false, message: err.message };
  }
}

// Charges in a window, following Stripe's cursor pagination.
//
// Charges rather than PaymentIntents because a charge is the thing that
// actually took money and carries amount_refunded on it, so net revenue is
// one subtraction rather than a second round of lookups.
async function listCharges(http, { startDate, endDate }) {
  // Stripe filters on unix seconds. The end of the day is inclusive, so the
  // window is [00:00:00, 23:59:59] of the dates given, matching what the
  // WooCommerce connector does with its ISO strings.
  const gte = Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000);
  const lte = Math.floor(new Date(`${endDate}T23:59:59Z`).getTime() / 1000);

  const out = [];
  let startingAfter = null;
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = {
      limit: PER_PAGE,
      'created[gte]': gte,
      'created[lte]': lte,
    };
    if (startingAfter) params.starting_after = startingAfter;

    const res = await http.get('/charges', { params });
    if (res.status >= 400) throw new Error(explain(res));

    const data = res.data?.data || [];
    out.push(...data);
    if (!res.data?.has_more || !data.length) break;
    startingAfter = data[data.length - 1].id;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  return { charges: out, truncated };
}

// A charge counts towards revenue when it succeeded and was paid. A failed
// charge is not revenue, and a fully refunded one nets to zero rather than
// being dropped, so the refund shows up as the reduction it is.
function countsAsRevenue(c) {
  return c.status === 'succeeded' && c.paid === true;
}

// What was sold, from charge metadata.
//
// Stripe charges carry no line items — that lives on Checkout Sessions or
// Invoices, which a custom cart may not create at all. So the product name
// comes from metadata the cart sets, and when the cart does not set it this
// is honestly empty rather than invented. docs/omi/stripe-connector.md is the
// brief for making it non-empty.
function topProducts(charges) {
  const byName = new Map();
  for (const c of charges) {
    if (!countsAsRevenue(c)) continue;
    const name = (c.metadata?.product || c.metadata?.product_name || '').trim();
    if (!name) continue;
    const net = toMajor(c.amount - (c.amount_refunded || 0), c.currency);
    const row = byName.get(name) || { name, orders: 0, revenue: 0 };
    row.orders += 1;
    row.revenue += net;
    byName.set(name, row);
  }
  return [...byName.values()]
    .map(r => ({ ...r, revenue: +r.revenue.toFixed(2) }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);
}

async function fetchData(credentials, params) {
  const { startDate, endDate } = params;
  const http = client(credentials);
  const { charges, truncated } = await listCharges(http, { startDate, endDate });

  const paid = charges.filter(countsAsRevenue);

  // A Stripe account can take several currencies. Summing across them would
  // produce a number that is not money in any currency, so the headline is
  // the currency that took the most and anything else is reported beside it.
  const byCurrency = new Map();
  for (const c of paid) {
    const cur = (c.currency || '').toUpperCase();
    const net = toMajor(c.amount - (c.amount_refunded || 0), c.currency);
    const row = byCurrency.get(cur) || { currency: cur, revenue: 0, orders: 0 };
    row.revenue += net;
    row.orders += 1;
    byCurrency.set(cur, row);
  }
  const currencies = [...byCurrency.values()].sort((a, b) => b.revenue - a.revenue);
  const primary = currencies[0] || null;

  // Daily buckets in the primary currency only, for the same reason.
  const dailyMap = {};
  for (const c of paid) {
    if (primary && (c.currency || '').toUpperCase() !== primary.currency) continue;
    const date = new Date((c.created || 0) * 1000).toISOString().slice(0, 10);
    const net = toMajor(c.amount - (c.amount_refunded || 0), c.currency);
    const d = dailyMap[date] || (dailyMap[date] = { date, revenue: 0, orders: 0 });
    d.revenue += net;
    d.orders += 1;
  }
  const daily = Object.values(dailyMap)
    .map(d => ({ ...d, revenue: +d.revenue.toFixed(2) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalRevenue = primary ? primary.revenue : 0;
  const totalOrders = primary ? primary.orders : 0;
  const refunded = paid.reduce((sum, c) => sum + toMajor(c.amount_refunded || 0, c.currency), 0);

  return {
    period: { start: startDate, end: endDate },
    summary: {
      total_orders: totalOrders,
      total_revenue: totalRevenue.toFixed(2),
      avg_order_value: totalOrders ? (totalRevenue / totalOrders).toFixed(2) : '0.00',
      currency: primary ? primary.currency : null,
      // Named so nobody reads a test-mode figure as real money.
      mode: isLiveKey(credentials) ? 'live' : 'test',
      refunded: +refunded.toFixed(2),
      failed_charges: charges.length - paid.length,
      truncated: truncated || undefined,
      // Only when there is more than one, so the ordinary single-currency
      // account is not given a caveat it does not need.
      other_currencies: currencies.length > 1 ? currencies.slice(1) : undefined,
      daily,
    },
    orders: paid.slice(0, 50).map(c => ({
      id: c.id,
      date: new Date((c.created || 0) * 1000).toISOString(),
      total: toMajor(c.amount - (c.amount_refunded || 0), c.currency).toFixed(2),
      currency: (c.currency || '').toUpperCase(),
      refunded: (c.amount_refunded || 0) > 0,
      description: c.description || c.metadata?.product || null,
      customer_email: c.billing_details?.email || c.receipt_email || null,
    })),
    top_products: topProducts(paid),
  };
}

// What the Settings → Security access report shows for this connector.
async function getAccessReport(credentials) {
  const res = await client(credentials).get('/balance');
  if (res.status >= 400) return { ok: false, detail: explain(res) };
  const key = String(credentials?.secret_key || credentials?.api_key || '');
  const restricted = key.startsWith('rk_');
  return {
    ok: true,
    detail: [
      restricted
        ? 'Restricted key — read-only by construction.'
        : 'Full secret key. A restricted key with read access to Charges and Customers would be enough, and safer.',
      isLiveKey(credentials) ? 'Live mode.' : 'Test mode — figures are not real money.',
    ].join(' '),
    restricted,
    live: isLiveKey(credentials),
  };
}

module.exports = {
  authType, checkTokenValidity, fetchData, getAccessReport,
  // Exported for the tests: these are the parts where being wrong is
  // expensive and silent.
  minorUnits, toMajor, countsAsRevenue, topProducts,
};
