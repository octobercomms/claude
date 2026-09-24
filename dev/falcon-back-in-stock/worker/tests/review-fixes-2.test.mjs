// Regression tests for the second review round (unlabelled oversell, async
// inventory hook, line-level holds, per-variant /c /k and delay tags, CORS
// origins, hold-failed dedupe, first-setup date change). Run with the rest:
//   node --test dev/falcon-back-in-stock/worker/tests/
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import worker, {
  runtime,
  signToken,
  unlabelledOversell,
  orderNeedsPreorderCheck,
  hasValidPreorderSetup,
  releaseForVariant,
  fanOutWaitlist,
  processDateChange,
  checkConsentDeadlines,
  runDailyForStore,
  allowedOrigins,
  maxDelayNumber,
} from '../worker.js';

runtime.sleep = async () => {};
const SECRET = 'test-link-secret';
const SHOP = {
  domain: 'falcon-uk.myshopify.com',
  storefront: 'https://www.falconenamelware.com',
  sender: { name: 'Falcon Enamelware', email: 'hello@falconenamelware.com' },
  templates: { bis: 1, delay_uk: 2, delay_us_notice: 3, delay_us_consent: 4, staff: 5 },
  staff_email: 'staff@example.com',
  withdrawal_url: null,
};
const makeEnv = (shops = { uk: SHOP, us: { ...SHOP, domain: 'falcon-us.myshopify.com', storefront: 'https://us.falconenamelware.com' } }) => ({
  SHOPS: JSON.stringify(shops),
  ADMIN_TOKEN_UK: 'shpat_test',
  ADMIN_TOKEN_US: 'shpat_test',
  BREVO_API_KEY: 'brevo',
  TURNSTILE_SECRET: 'ts',
  FLOW_KEY: 'flow-key',
  LINK_SECRET: SECRET,
  API_VERSION: '2026-07',
  DRY_RUN: 'false',
  WORKER_URL: 'https://falcon-stock.example.workers.dev',
});
const TODAY = new Date().toISOString().slice(0, 10);
const makeCtx = (store = 'uk', { today = TODAY, dryRun = false } = {}) => ({
  env: makeEnv(),
  store,
  shop: { ...SHOP, domain: `falcon-${store}.myshopify.com` },
  token: 'shpat_test',
  apiVersion: '2026-07',
  dryRun,
  baseUrl: 'https://falcon-stock.example.workers.dev',
  today,
  waitUntil: null,
  cache: {},
});

function installFetch(handlers) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://challenges.cloudflare.com/')) {
      calls.push({ kind: 'turnstile' });
      return Response.json({ success: true, action: 'restock-subscribe' });
    }
    if (u === 'https://api.brevo.com/v3/smtp/email') {
      calls.push({ kind: 'brevo', body: JSON.parse(init.body) });
      return Response.json({ messageId: '<m@brevo>' }, { status: 201 });
    }
    if (u.includes('/admin/api/')) {
      const { query, variables } = JSON.parse(init.body);
      const op = (query.match(/(?:query|mutation)\s+(\w+)/) || [])[1];
      calls.push({ kind: 'gql', op, variables });
      const h = handlers[op];
      if (!h) throw new Error(`unexpected GraphQL op ${op}`);
      return Response.json({ data: h(variables, calls) });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

let mock = null;
let origLog;
beforeEach(() => {
  origLog = console.log;
  console.log = () => {};
});
afterEach(() => {
  console.log = origLog;
  if (mock) mock.restore();
  mock = null;
});

const future = '2099-11-12';
const gqlOps = () => mock.calls.filter((c) => c.kind === 'gql').map((c) => c.op);
const mails = () => mock.calls.filter((c) => c.kind === 'brevo');
const tagCalls = () => mock.calls.filter((c) => c.op === 'FalconTagsAdd').map((c) => c.variables.tags);
const ok = {
  FalconTagsAdd: (v) => ({ tagsAdd: { node: { id: v.id }, userErrors: [] } }),
  FalconTagsRemove: (v) => ({ tagsRemove: { node: { id: v.id }, userErrors: [] } }),
  FalconHold: (v) => ({ fulfillmentOrderHold: { fulfillmentHold: { id: 'gid://shopify/FulfillmentHold/1', handle: 'falcon-preorder' }, fulfillmentOrder: { id: v.id, status: 'ON_HOLD' }, remainingFulfillmentOrder: null, userErrors: [] } }),
  FalconVariantPolicy: (v) => ({ productVariantsBulkUpdate: { productVariants: v.variants, userErrors: [] } }),
  FalconMetafieldsSet: (v) => ({ metafieldsSet: { metafields: v.metafields, userErrors: [] } }),
  FalconMetafieldsDelete: () => ({ metafieldsDelete: { deletedMetafields: [], userErrors: [] } }),
  FalconRelease: (v) => ({ fulfillmentOrderReleaseHold: { fulfillmentOrder: { id: v.id, status: 'OPEN' }, userErrors: [] } }),
};

const lineVariant = (id, qty, { policy = 'CONTINUE', tracked = true } = {}) => ({ id: `gid://shopify/ProductVariant/${id}`, title: 'Grey', inventoryQuantity: qty, inventoryPolicy: policy, inventoryItem: { tracked } });
const line = (id, variant, quantity, { preorderDate = null, unfulfilled = quantity } = {}) => ({
  id: `gid://shopify/LineItem/${id}`,
  quantity,
  unfulfilledQuantity: unfulfilled,
  title: 'Pie Dish',
  variantTitle: 'Grey',
  variant,
  product: { title: 'Pie Dish' },
  customAttributes: preorderDate ? [{ key: '_preorder_date', value: preorderDate }] : [],
});
const foLine = (id, lineId, variantId, remaining) => ({ id: `gid://shopify/FulfillmentOrderLineItem/${id}`, remainingQuantity: remaining, totalQuantity: remaining, lineItem: { id: `gid://shopify/LineItem/${lineId}`, variant: { id: `gid://shopify/ProductVariant/${variantId}` } } });
const fo = (id, lines, { status = 'OPEN', held = false } = {}) => ({ id: `gid://shopify/FulfillmentOrder/${id}`, status, fulfillmentHolds: held ? [{ id: `gid://shopify/FulfillmentHold/${id}`, handle: 'falcon-preorder', reason: 'OTHER' }] : [], lineItems: { nodes: lines } });
// Mixed orders here pin "Ship separately" (the pre-existing behaviour); ship-together has its own tests.
const SEPARATELY = [{ key: 'Delivery preference', value: 'Ship separately' }];
const makeOrder = (lines, fos, tags = [], customAttributes = SEPARATELY) => ({ id: 'gid://shopify/Order/5001', name: '#UK1001', createdAt: '2026-09-23T09:00:00Z', tags, email: 'jane@example.com', cancelledAt: null, closed: false, customAttributes, lineItems: { nodes: lines }, fulfillmentOrders: { nodes: fos } });
const fullVariant = (id, { qty = -2, policy = 'CONTINUE', tracked = true, expected = future, limit = '10' } = {}) => ({
  productVariant: {
    id: `gid://shopify/ProductVariant/${id}`,
    title: 'Grey',
    price: '22.00',
    inventoryQuantity: qty,
    inventoryPolicy: policy,
    inventoryItem: { tracked },
    product: { id: 'gid://shopify/Product/9', title: 'Pie Dish', handle: 'pie-dish', status: 'ACTIVE' },
    expectedDate: expected ? { value: expected } : null,
    preorderLimit: limit ? { value: limit } : null,
  },
});
const postHook = (path, body, execCtx = {}) =>
  worker.fetch(new Request(`https://w.example${path}`, { method: 'POST', headers: { 'X-Falcon-Key': 'flow-key', 'content-type': 'application/json' }, body: JSON.stringify(body) }), makeEnv(), execCtx);

// ---------------------------------------------------------------- 1. unlabelled oversell
describe('unlabelled oversell', () => {
  test('pure: counts only this order\'s units below zero, labelled units first, untracked ignored', () => {
    const v = lineVariant(111, -2);
    // 3 unlabelled units, stock now -2: 2 units were sold below zero.
    assert.deepEqual(unlabelledOversell(makeOrder([line(1, v, 3)], [])), [{ variantId: '111', units: 2, qty: -2, policy: 'CONTINUE', lines: [{ lineItemId: 'gid://shopify/LineItem/1', holdQty: 2 }] }]);
    // 2 labelled + 3 unlabelled, stock -4: labelled cover 2, so 2 unlabelled.
    const v4 = lineVariant(111, -4);
    const mixed = unlabelledOversell(makeOrder([line(1, v4, 2, { preorderDate: future }), line(2, v4, 3)], []));
    assert.equal(mixed.length, 1);
    assert.equal(mixed[0].units, 2);
    assert.deepEqual(unlabelledOversell(makeOrder([line(1, lineVariant(111, -2, { tracked: false }), 3)], [])), [], 'untracked');
    assert.deepEqual(unlabelledOversell(makeOrder([line(1, lineVariant(111, 0), 3)], [])), [], 'not below zero');
  });

  test('a normal order costs one order query and exits early', async () => {
    mock = installFetch({ FalconOrder: (v) => ({ order: makeOrder([line(1, lineVariant(111, 4), 1), line(2, lineVariant(222, 0, { tracked: false }), 1)], []) }) });
    assert.equal(orderNeedsPreorderCheck(makeOrder([line(1, lineVariant(111, 4), 1)], [])), false);
    const res = await postHook('/hooks/order', { store: 'uk', order_id: '5001' });
    assert.deepEqual(await res.json(), { ok: true, preorder: false });
    assert.deepEqual(gqlOps(), ['FalconOrder']);
  });

  test('valid pre-order setup: the oversold units are held and tagged, staff told the customer saw no date', async () => {
    const v = lineVariant(111, -2);
    const order = makeOrder([line(1, v, 3), line(2, lineVariant(222, 5), 1)], [fo(9001, [foLine(1, 1, 111, 3), foLine(2, 2, 222, 1)])]);
    mock = installFetch({ ...ok, FalconOrder: () => ({ order }), FalconVariant: () => fullVariant(111) });
    const res = await postHook('/hooks/order', { store: 'uk', order_id: '5001' });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.deepEqual(body.unlabelled, ['111']);
    assert.deepEqual(tagCalls()[0], ['preorder-v111', 'preorder-unlabelled', 'ship-separately', 'split-fee-missing']);
    const hold = mock.calls.find((c) => c.op === 'FalconHold').variables;
    assert.deepEqual(hold.fulfillmentHold.fulfillmentOrderLineItems, [{ id: 'gid://shopify/FulfillmentOrderLineItem/1', quantity: 2 }], 'only the 2 units below zero');
    assert.deepEqual(tagCalls().at(-1), ['preorder']);
    assert.equal(mails().length, 1);
    assert.match(mails()[0].body.params.rows_html, /NOT shown a dispatch date/);
  });

  test('no valid setup (policy DENY): tagged oversold-v{id}, not held, staff alerted once', async () => {
    const order = makeOrder([line(1, lineVariant(111, -1, { policy: 'DENY' }), 2)], [fo(9001, [foLine(1, 1, 111, 2)])]);
    mock = installFetch({ ...ok, FalconOrder: () => ({ order }), FalconVariant: () => fullVariant(111, { qty: -1, policy: 'DENY' }) });
    const res = await postHook('/hooks/order', { store: 'uk', order_id: '5001' });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).oversold, ['111']);
    assert.deepEqual(tagCalls(), [['oversold-v111']]);
    assert.ok(!gqlOps().includes('FalconHold'));
    assert.equal(mails().length, 1);
    assert.match(mails()[0].body.params.rows_html, /Oversold, not held/);
    // Flow retry: the tag is there, no second alert.
    mock.restore();
    order.tags = ['oversold-v111'];
    mock = installFetch({ ...ok, FalconOrder: () => ({ order }), FalconVariant: () => fullVariant(111, { qty: -1, policy: 'DENY' }) });
    await postHook('/hooks/order', { store: 'uk', order_id: '5001' });
    assert.equal(mails().length, 0);
  });

  test('untracked variant is never held or flagged', async () => {
    mock = installFetch({ ...ok, FalconOrder: () => ({ order: makeOrder([line(1, lineVariant(111, -3, { tracked: false }), 2)], []) }) });
    const res = await postHook('/hooks/order', { store: 'uk', order_id: '5001' });
    assert.deepEqual(await res.json(), { ok: true, preorder: false });
    assert.deepEqual(gqlOps(), ['FalconOrder']);
  });

  test('hasValidPreorderSetup follows the theme rule (ignoring the cap)', () => {
    const base = { tracked: true, policy: 'CONTINUE', expectedDate: future, preorderLimit: 5 };
    assert.equal(hasValidPreorderSetup(base, TODAY), true);
    assert.equal(hasValidPreorderSetup({ ...base, policy: 'DENY' }, TODAY), false);
    assert.equal(hasValidPreorderSetup({ ...base, tracked: false }, TODAY), false);
    assert.equal(hasValidPreorderSetup({ ...base, expectedDate: '2000-01-01' }, TODAY), false);
    assert.equal(hasValidPreorderSetup({ ...base, preorderLimit: 0 }, TODAY), false);
  });
});

// ---------------------------------------------------------------- 3. hold by line item
test('hold by line item: a same-variant line without _preorder_date is not held when stock covers it', async () => {
  const v = lineVariant(111, 0);
  const order = makeOrder([line(1, v, 1, { preorderDate: future }), line(2, v, 1)], [fo(9001, [foLine(1, 1, 111, 1), foLine(2, 2, 111, 1)])]);
  mock = installFetch({ ...ok, FalconOrder: () => ({ order }), FalconVariant: () => fullVariant(111, { qty: 0 }) });
  const res = await postHook('/hooks/order', { store: 'uk', order_id: '5001' });
  assert.equal(res.status, 200);
  const hold = mock.calls.find((c) => c.op === 'FalconHold').variables;
  assert.deepEqual(hold.fulfillmentHold.fulfillmentOrderLineItems, [{ id: 'gid://shopify/FulfillmentOrderLineItem/1', quantity: 1 }]);
});

// ---------------------------------------------------------------- 7. hold refused
describe('hold refused on a non-OPEN fulfillment order', () => {
  const heldElsewhere = () => makeOrder([line(1, lineVariant(111, -1), 1, { preorderDate: future })], [fo(9001, [foLine(1, 1, 111, 1)], { status: 'IN_PROGRESS' })]);

  test('first failure alerts staff and tags preorder-hold-failed; a Flow retry does not alert again', async () => {
    let order = heldElsewhere();
    mock = installFetch({ ...ok, FalconOrder: () => ({ order }), FalconVariant: () => fullVariant(111, { qty: -1 }) });
    const r1 = await postHook('/hooks/order', { store: 'uk', order_id: '5001' });
    assert.equal(r1.status, 500);
    assert.equal(mails().length, 1);
    assert.ok(tagCalls().some((t) => t.includes('preorder-hold-failed')));
    mock.restore();
    order = { ...heldElsewhere(), tags: ['preorder-v111', 'preorder-hold-failed'] };
    mock = installFetch({ ...ok, FalconOrder: () => ({ order }), FalconVariant: () => fullVariant(111, { qty: -1 }) });
    const r2 = await postHook('/hooks/order', { store: 'uk', order_id: '5001' });
    assert.equal(r2.status, 500);
    assert.equal(mails().length, 0, 'no repeat alert');
  });

  test('the daily job retries the hold and clears preorder-hold-failed on success', async () => {
    const order = { ...makeOrder([line(1, lineVariant(111, -1), 1, { preorderDate: future })], [fo(9001, [foLine(1, 1, 111, 1)])]), tags: ['preorder-v111', 'preorder-hold-failed'] };
    mock = installFetch({
      ...ok,
      FalconVariants: () => ({ productVariants: { pageInfo: { hasNextPage: false }, nodes: [] } }),
      FalconOrders: (v) => ({ orders: { pageInfo: { hasNextPage: false }, nodes: v.q.includes('preorder-hold-failed') ? [order] : [] } }),
      FalconCustomersByTag: () => ({ customers: { pageInfo: { hasNextPage: false }, nodes: [] } }),
      FalconOrder: () => ({ order }),
      FalconVariant: () => fullVariant(111, { qty: -1 }),
    });
    const summary = await runDailyForStore(makeCtx('uk'));
    assert.equal(summary.holds_retried, 1);
    assert.ok(gqlOps().includes('FalconHold'));
    assert.deepEqual(mock.calls.find((c) => c.op === 'FalconTagsRemove').variables.tags, ['preorder-hold-failed']);
  });
});

// ---------------------------------------------------------------- 2. inventory hook timing
describe('inventory hook', () => {
  test('answers 202 at once and does the work in waitUntil', async () => {
    const held = { id: 'gid://shopify/Order/1', name: '#UK1', createdAt: '2026-09-01T00:00:00Z', tags: ['preorder', 'preorder-v111'] };
    mock = installFetch({
      ...ok,
      FalconVariant: () => fullVariant(111, { qty: 0 }),
      FalconOrders: () => ({ orders: { pageInfo: { hasNextPage: false }, nodes: [held] } }),
      FalconOrderFulfillmentOrders: () => ({ order: { id: held.id, fulfillmentOrders: { nodes: [fo(1, [foLine(1, 1, 111, 1)], { status: 'ON_HOLD', held: true })] } } }),
    });
    const pending = [];
    const res = await postHook('/hooks/inventory', { store: 'uk', variant_id: '111', inventory_quantity: 1 }, { waitUntil: (p) => pending.push(p) });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { ok: true, accepted: true });
    assert.equal(pending.length, 1);
    const r = await pending[0];
    assert.deepEqual(r.body.released, ['#UK1']);
  });

  test('bad input is rejected before anything is queued', async () => {
    mock = installFetch({});
    const pending = [];
    const res = await postHook('/hooks/inventory', { store: 'uk', variant_id: 'x' }, { waitUntil: (p) => pending.push(p) });
    assert.equal(res.status, 400);
    assert.equal(pending.length, 0);
    assert.equal(mock.calls.length, 0);
  });

  test('release stops once the time budget is spent (the daily job finishes it)', async () => {
    mock = installFetch({ ...ok });
    const orders = [{ id: 'gid://shopify/Order/1', name: '#UK1', createdAt: '2026-09-01', tags: ['preorder-v111'] }];
    const r = await releaseForVariant(makeCtx(), '111', 5, orders, { deadline: runtime.now() - 1 });
    assert.equal(r.incomplete, true);
    assert.deepEqual(r.released, []);
    assert.equal(mock.calls.length, 0);
  });

  test('overlapping runs: a hold already released by another run is not released again', async () => {
    let reads = 0;
    mock = installFetch({
      ...ok,
      FalconOrderFulfillmentOrders: (v) => {
        reads++;
        // First read (planning): held. Second read (just before release): another run released it.
        const f = reads === 1 ? fo(1, [foLine(1, 1, 111, 1)], { status: 'ON_HOLD', held: true }) : fo(1, [foLine(1, 1, 111, 1)]);
        return { order: { id: v.id, fulfillmentOrders: { nodes: [f] } } };
      },
    });
    const orders = [{ id: 'gid://shopify/Order/1', name: '#UK1', createdAt: '2026-09-01', tags: ['preorder-v111'] }];
    const r = await releaseForVariant(makeCtx(), '111', 0, orders);
    assert.deepEqual(r.released, []);
    assert.ok(!gqlOps().includes('FalconRelease'));
  });

  test('overlapping runs: a customer already emailed by another run is not emailed again', async () => {
    mock = installFetch({
      FalconCustomersByTag: () => ({ customers: { pageInfo: { hasNextPage: false }, nodes: [{ id: 'gid://shopify/Customer/7', tags: ['restock-111'], defaultEmailAddress: { emailAddress: 'jane@example.com' } }] } }),
      FalconShop: () => ({ shop: { currencyCode: 'GBP' } }),
      FalconCustomer: (v) => ({ customer: { id: v.id, tags: ['restock-notified-111'], defaultEmailAddress: { emailAddress: 'jane@example.com' } } }),
    });
    const stats = await fanOutWaitlist(makeCtx(), { id: '111', qty: 3, title: 'Grey', productTitle: 'Pie Dish', handle: 'pie-dish', price: '22', productStatus: 'ACTIVE' }, { emails: 400, deadline: 0 });
    assert.equal(stats.sent, 0);
    assert.equal(mails().length, 0);
  });
});

// ---------------------------------------------------------------- 4. /c per variant
describe('/c per variant', () => {
  const orderWith = (unfulfilled, tags = ['preorder', 'preorder-v111']) => ({
    ...makeOrder([line(1, lineVariant(111, -1), 2, { preorderDate: future, unfulfilled }), line(2, lineVariant(222, 3), 1)], []),
    tags,
  });
  const post = async (t) => {
    const form = new FormData();
    form.append('t', t);
    return worker.fetch(new Request('https://w.example/c', { method: 'POST', body: form }), makeEnv(), {});
  };

  test('a token without a variant is refused', async () => {
    mock = installFetch({});
    const t = await signToken({ s: 'uk', a: 'c', o: '5001', n: 1 }, SECRET);
    const res = await post(t);
    assert.equal(res.status, 400);
    assert.equal(mock.calls.length, 0);
  });

  test('refused (returns page) when that variant has already been dispatched', async () => {
    mock = installFetch({ ...ok, FalconOrder: () => ({ order: orderWith(0) }) });
    const t = await signToken({ s: 'uk', a: 'c', o: '5001', v: '111', n: 1 }, SECRET);
    const res = await post(t);
    const html = await res.text();
    assert.match(html, /already been dispatched/);
    assert.match(html, /returns/);
    assert.ok(!gqlOps().includes('FalconTagsAdd'));
    assert.equal(mails().length, 0);
  });

  test('tags per variant and the staff email names the item, quantity and refund deadline', async () => {
    mock = installFetch({ ...ok, FalconOrder: () => ({ order: orderWith(2) }) });
    const t = await signToken({ s: 'uk', a: 'c', o: '5001', v: '111', n: 1 }, SECRET);
    const res = await post(t);
    assert.equal(res.status, 200);
    const tags = tagCalls()[0];
    assert.ok(tags.includes('preorder-cancel-requested-v111'));
    assert.ok(tags.some((x) => /^preorder-cancel-requested-v111-on-\d{4}-\d{2}-\d{2}$/.test(x)));
    const m = mails()[0].body.params;
    assert.match(m.subject, /Pie Dish Grey \(111\)/);
    assert.match(m.subject, /refund by/);
    assert.match(m.rows_html, /<th align="left">Quantity<\/th>/);
    assert.match(m.rows_html, /<td>2<\/td>/);
  });

  test('a request for another variant in the same order is not blocked by the first', async () => {
    mock = installFetch({ ...ok, FalconOrder: () => ({ order: orderWith(2, ['preorder', 'preorder-v111', 'preorder-v222', 'preorder-cancel-requested', 'preorder-cancel-requested-v111']) }) });
    const t = await signToken({ s: 'uk', a: 'c', o: '5001', v: '222', n: 1 }, SECRET);
    const res = await worker.fetch(new Request(`https://w.example/c?t=${encodeURIComponent(t)}`), makeEnv(), {});
    assert.match(await res.text(), /Cancel this pre-order/);
  });
});

// ---------------------------------------------------------------- 5. per-variant delays
describe('delay numbering per (order, variant)', () => {
  test('a delay to one item does not make the first delay of another item a "second delay" (US)', async () => {
    mock = installFetch({ ...ok });
    const order = {
      ...makeOrder([line(1, lineVariant(111, -1), 1, { preorderDate: '2099-11-12' }), line(2, lineVariant(222, -1), 1, { preorderDate: '2099-11-12' })], []),
      tags: ['preorder', 'preorder-v111', 'preorder-v222', 'preorder-delay-v222-1', 'preorder-delay-v222-2'],
    };
    const v = { gid: 'gid://shopify/ProductVariant/111', id: '111', title: 'Grey', productTitle: 'Pie Dish', delayReason: 'Late ship.', delayCount: 0, notifiedDate: '2099-11-12', expectedDate: '2099-11-20' };
    await processDateChange(makeCtx('us', { today: '2099-09-01' }), v, [], [order]);
    assert.equal(mails()[0].body.templateId, 3, 'delay_us_notice, not consent');
    assert.ok(tagCalls()[0].includes('preorder-delay-v111-1'));
    assert.equal(maxDelayNumber(order.tags, '111'), 0);
  });

  test('a missed keep-by flags only that variant, and the alert names it', async () => {
    mock = installFetch({ ...ok });
    const order = {
      ...makeOrder([line(1, lineVariant(111, -1), 1, { preorderDate: '2026-11-12' }), line(2, { ...lineVariant(222, -1), title: 'Blue' }, 1, { preorderDate: '2026-11-12' })], []),
      tags: ['preorder', 'preorder-v111', 'preorder-v222', 'preorder-delay-v111-2', 'preorder-keep-by-v111-2026-11-12', 'preorder-delay-v222-2', 'preorder-keep-by-v222-2026-11-12', 'preorder-kept-v222-2'],
    };
    const rows = [];
    await checkConsentDeadlines(makeCtx('us', { today: '2026-11-20' }), [order], rows);
    assert.deepEqual(tagCalls(), [['preorder-cancel-due-v111']]);
    assert.equal(mails().length, 1);
    assert.match(mails()[0].body.params.subject, /\(111\)/);
    assert.equal(rows.length, 1);
  });

  test('/k records a keep for that variant only', async () => {
    const order = { ...makeOrder([line(1, lineVariant(111, -1), 1, { preorderDate: future })], []), tags: ['preorder', 'preorder-v111', 'preorder-delay-v111-2', `preorder-keep-by-v111-${future}`] };
    mock = installFetch({ ...ok, FalconOrder: () => ({ order }) });
    const t = await signToken({ s: 'us', a: 'k', o: '5001', v: '111', n: 2 }, SECRET);
    const form = new FormData();
    form.append('t', t);
    const res = await worker.fetch(new Request('https://w.example/k', { method: 'POST', body: form }), makeEnv(), {});
    assert.match(await res.text(), /your order is kept/i);
    assert.deepEqual(tagCalls(), [['preorder-kept-v111-2']]);
  });
});

// ---------------------------------------------------------------- 6. CORS origins
describe('CORS origins', () => {
  test('SHOPS.origins allows the myshopify and preview origins; storefront is the fallback', async () => {
    assert.deepEqual(allowedOrigins({ storefront: 'https://www.falconenamelware.com/' }), ['https://www.falconenamelware.com']);
    assert.deepEqual(allowedOrigins({ storefront: 'https://www.falconenamelware.com', origins: ['https://www.falconenamelware.com', 'https://falcon-uk.myshopify.com', 'not a url'] }), ['https://www.falconenamelware.com', 'https://falcon-uk.myshopify.com']);

    const env = makeEnv({ uk: { ...SHOP, origins: ['https://www.falconenamelware.com', 'https://falcon-uk.myshopify.com'] }, us: { ...SHOP, storefront: 'https://us.falconenamelware.com' } });
    const pre = await worker.fetch(new Request('https://w.example/subscribe', { method: 'OPTIONS', headers: { Origin: 'https://falcon-uk.myshopify.com' } }), env, {});
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('Access-Control-Allow-Origin'), 'https://falcon-uk.myshopify.com');
    mock = installFetch({ FalconVariant: () => ({ productVariant: null }) });
    const send = (origin, store) =>
      worker.fetch(new Request('https://w.example/subscribe', { method: 'POST', headers: { Origin: origin }, body: JSON.stringify({ store, variant_id: '1', email: 'jane@example.com', turnstile_token: 'tok' }) }), env, {});
    const okRes = await send('https://falcon-uk.myshopify.com', 'uk');
    assert.equal(okRes.status, 200);
    assert.equal(okRes.headers.get('Access-Control-Allow-Origin'), 'https://falcon-uk.myshopify.com');
    assert.equal((await send('https://falcon-uk.myshopify.com', 'us')).status, 403, 'an origin is only valid for its own store');
    assert.equal((await send('https://us.falconenamelware.com', 'us')).status, 200, 'fallback to storefront');
  });
});

// ---------------------------------------------------------------- first-setup date change
describe('date changed before the first daily run', () => {
  const v = { gid: 'gid://shopify/ProductVariant/111', id: '111', title: 'Grey', productTitle: 'Pie Dish', delayReason: 'Late ship.', delayCount: 0, notifiedDate: '', expectedDate: '2099-12-01' };
  const order = (id, promised) => ({ ...makeOrder([line(id, lineVariant(111, -1), 1, { preorderDate: promised })], []), id: `gid://shopify/Order/${id}`, name: `#UK${id}`, tags: ['preorder', 'preorder-v111'] });

  test('customers whose checkout date differs are emailed, then notified_date is set', async () => {
    mock = installFetch({ ...ok });
    const rows = [];
    const r = await processDateChange(makeCtx('uk', { today: '2099-09-01' }), v, rows, [order(1, '2099-11-12'), order(2, '2099-12-01')]);
    assert.equal(r.sent, 1);
    assert.equal(mails().length, 1);
    assert.equal(mails()[0].body.params.order_name, '#UK1');
    assert.equal(mails()[0].body.params.old_date, '12 November 2099');
    assert.equal(mails()[0].body.params.new_date, '1 December 2099');
    assert.ok(tagCalls()[0].includes('preorder-delay-v111-1'));
    const set = mock.calls.find((c) => c.op === 'FalconMetafieldsSet');
    assert.equal(set.variables.metafields[0].value, '2099-12-01');
  });

  test('nobody to tell: notified_date is just set, no email', async () => {
    mock = installFetch({ ...ok });
    await processDateChange(makeCtx('uk', { today: '2099-09-01' }), v, [], [order(2, '2099-12-01')]);
    assert.equal(mails().length, 0);
    assert.equal(mock.calls.find((c) => c.op === 'FalconMetafieldsSet').variables.metafields[0].value, '2099-12-01');
  });

  test('in DRY_RUN, notified_date is not set while customers still need telling', async () => {
    mock = installFetch({ ...ok });
    await processDateChange(makeCtx('uk', { today: '2099-09-01', dryRun: true }), v, [], [order(1, '2099-11-12')]);
    assert.equal(mails().length, 1);
    assert.ok(!gqlOps().includes('FalconMetafieldsSet'));
  });
});
