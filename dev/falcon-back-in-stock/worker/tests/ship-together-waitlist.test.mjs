// Tests for the mixed-basket delivery choice (ship together / ship separately,
// split fee), the waitlist-joined email and the per-product waitlist opt-out.
// Run with the rest:  node --test dev/falcon-back-in-stock/worker/tests/
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import worker, {
  runtime,
  signToken,
  verifyToken,
  deliveryPreference,
  isMixedOrder,
  splitFeeVariantId,
  withoutSplitFeeLines,
  isShipTogetherWaiting,
  releaseForVariant,
  releaseShipTogetherIfDone,
  fanOutWaitlist,
  processDateChange,
  runDailyForStore,
  SHIP_TOGETHER_HANDLE,
} from '../worker.js';

runtime.sleep = async () => {};
const SECRET = 'test-link-secret';
const FEE_VID = '999';
const SHOP = {
  domain: 'falcon-uk.myshopify.com',
  storefront: 'https://www.falconenamelware.com',
  sender: { name: 'Falcon Enamelware', email: 'hello@falconenamelware.com' },
  templates: { bis: 1, delay_uk: 2, delay_us_notice: 3, delay_us_consent: 4, staff: 5, waitlist_joined: 6 },
  staff_email: 'staff@example.com',
  withdrawal_url: null,
  split_fee_variant_id: FEE_VID,
};
const makeEnv = ({ dryRun = false, shop = SHOP } = {}) => ({
  SHOPS: JSON.stringify({ uk: shop, us: { ...shop, domain: 'falcon-us.myshopify.com', storefront: 'https://us.falconenamelware.com' } }),
  ADMIN_TOKEN_UK: 'shpat_test',
  ADMIN_TOKEN_US: 'shpat_test',
  BREVO_API_KEY: 'brevo',
  TURNSTILE_SECRET: 'ts',
  FLOW_KEY: 'flow-key',
  LINK_SECRET: SECRET,
  API_VERSION: '2026-07',
  DRY_RUN: dryRun ? 'true' : 'false',
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

function installFetch(handlers, { brevoStatus = 201 } = {}) {
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
      return brevoStatus < 300 ? Response.json({ messageId: '<m@brevo>' }, { status: brevoStatus }) : new Response('{"code":"invalid_parameter"}', { status: brevoStatus });
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
let logs = [];
beforeEach(() => {
  logs = [];
  origLog = console.log;
  console.log = (l) => logs.push(l);
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
const holdCalls = () => mock.calls.filter((c) => c.op === 'FalconHold').map((c) => c.variables);
const ok = {
  FalconTagsAdd: (v) => ({ tagsAdd: { node: { id: v.id }, userErrors: [] } }),
  FalconTagsRemove: (v) => ({ tagsRemove: { node: { id: v.id }, userErrors: [] } }),
  FalconHold: (v) => ({ fulfillmentOrderHold: { fulfillmentHold: { id: 'gid://shopify/FulfillmentHold/1', handle: v.fulfillmentHold.handle }, fulfillmentOrder: { id: v.id, status: 'ON_HOLD' }, remainingFulfillmentOrder: null, userErrors: [] } }),
  FalconVariantPolicy: (v) => ({ productVariantsBulkUpdate: { productVariants: v.variants, userErrors: [] } }),
  FalconMetafieldsSet: (v) => ({ metafieldsSet: { metafields: v.metafields, userErrors: [] } }),
  FalconMetafieldsDelete: () => ({ metafieldsDelete: { deletedMetafields: [], userErrors: [] } }),
  FalconRelease: (v) => ({ fulfillmentOrderReleaseHold: { fulfillmentOrder: { id: v.id, status: 'OPEN' }, userErrors: [] } }),
};

const lineVariant = (id, qty, { policy = 'CONTINUE', tracked = true } = {}) => ({ id: `gid://shopify/ProductVariant/${id}`, title: 'Grey', inventoryQuantity: qty, inventoryPolicy: policy, inventoryItem: { tracked } });
const line = (id, variant, quantity, { preorderDate = null, unfulfilled = quantity, requiresShipping, title = 'Pie Dish' } = {}) => ({
  id: `gid://shopify/LineItem/${id}`,
  quantity,
  unfulfilledQuantity: unfulfilled,
  ...(requiresShipping === undefined ? {} : { requiresShipping }),
  title,
  variantTitle: 'Grey',
  variant,
  product: { title },
  customAttributes: preorderDate ? [{ key: '_preorder_date', value: preorderDate }] : [],
});
const feeLine = (id = 9) => line(id, { id: `gid://shopify/ProductVariant/${FEE_VID}`, title: 'Default Title', inventoryQuantity: 0, inventoryPolicy: 'DENY', inventoryItem: { tracked: false } }, 1, { requiresShipping: false, title: 'Second delivery' });
const foLine = (id, lineId, variantId, remaining) => ({ id: `gid://shopify/FulfillmentOrderLineItem/${id}`, remainingQuantity: remaining, totalQuantity: remaining, lineItem: { id: `gid://shopify/LineItem/${lineId}`, variant: { id: `gid://shopify/ProductVariant/${variantId}` } } });
const fo = (id, lines, { status = 'OPEN', handle = null } = {}) => ({
  id: `gid://shopify/FulfillmentOrder/${id}`,
  status,
  fulfillmentHolds: handle ? [{ id: `gid://shopify/FulfillmentHold/${id}`, handle, reason: 'OTHER' }] : [],
  lineItems: { nodes: lines },
});
const pref = (value) => (value ? [{ key: 'Delivery preference', value }] : []);
const makeOrder = (lines, fos, { tags = [], attrs = [] } = {}) => ({
  id: 'gid://shopify/Order/5001',
  name: '#UK1001',
  createdAt: '2026-09-23T09:00:00Z',
  tags,
  email: 'jane@example.com',
  cancelledAt: null,
  closed: false,
  customAttributes: attrs,
  lineItems: { nodes: lines },
  fulfillmentOrders: { nodes: fos },
});
const fullVariant = (id, { qty = -2, policy = 'CONTINUE', expected = future, limit = '10', status = 'ACTIVE' } = {}) => ({
  productVariant: {
    id: `gid://shopify/ProductVariant/${id}`,
    title: 'Grey',
    price: '22.00',
    inventoryQuantity: qty,
    inventoryPolicy: policy,
    inventoryItem: { tracked: true },
    media: { nodes: [{ preview: { image: { url: 'https://cdn.example/pie.jpg' } } }] },
    product: { id: 'gid://shopify/Product/9', title: 'Pie Dish', handle: 'pie-dish', status },
    expectedDate: expected ? { value: expected } : null,
    preorderLimit: limit ? { value: limit } : null,
  },
});
const postHook = (path, body, env = makeEnv()) =>
  worker.fetch(new Request(`https://w.example${path}`, { method: 'POST', headers: { 'X-Falcon-Key': 'flow-key', 'content-type': 'application/json' }, body: JSON.stringify(body) }), env, {});

// ---------------------------------------------------------------- pure helpers
describe('delivery preference and mixed basket (pure)', () => {
  test('deliveryPreference: "separately" anywhere in the value, any case; otherwise together', () => {
    assert.equal(deliveryPreference({ customAttributes: pref('Ship separately') }), 'separately');
    assert.equal(deliveryPreference({ customAttributes: [{ key: 'delivery PREFERENCE', value: 'ship SEPARATELY please' }] }), 'separately');
    assert.equal(deliveryPreference({ customAttributes: pref('Ship together') }), 'together');
    assert.equal(deliveryPreference({ customAttributes: pref('whatever') }), 'together');
    assert.equal(deliveryPreference({ customAttributes: [] }), 'together', 'missing = together');
    assert.equal(deliveryPreference({}), 'together');
    assert.equal(deliveryPreference({ customAttributes: [{ key: 'Other', value: 'Ship separately' }] }), 'together', 'only the Delivery preference key counts');
  });

  test('isMixedOrder: pre-order line plus a shippable non-pre-order line', () => {
    const pre = line(1, lineVariant(111, -1), 1, { preorderDate: future });
    const held = new Map([['gid://shopify/LineItem/1', 1]]);
    assert.equal(isMixedOrder(makeOrder([pre, line(2, lineVariant(222, 5), 1)], []), held), true);
    // Only pre-order lines, even for two variants: not mixed.
    const pre2 = line(2, lineVariant(222, -1), 1, { preorderDate: future });
    assert.equal(isMixedOrder(makeOrder([pre, pre2], []), new Map([...held, ['gid://shopify/LineItem/2', 1]])), false);
    // A non-shippable line (gift card, fee) does not make it mixed.
    assert.equal(isMixedOrder(makeOrder([pre, line(3, lineVariant(333, 5), 1, { requiresShipping: false })], []), held), false);
    // Nothing held: not mixed.
    assert.equal(isMixedOrder(makeOrder([pre, line(2, lineVariant(222, 5), 1)], []), new Map()), false);
    // An already-fulfilled other line does not count.
    assert.equal(isMixedOrder(makeOrder([pre, line(2, lineVariant(222, 5), 1, { unfulfilled: 0 })], []), held), false);
    // A partly held unlabelled line is a pre-order line, not "other".
    const unl = line(4, lineVariant(111, -1), 3);
    assert.equal(isMixedOrder(makeOrder([unl], []), new Map([['gid://shopify/LineItem/4', 1]])), false);
  });

  test('fee line helpers: configured id only, excluded from the items', () => {
    assert.equal(splitFeeVariantId(SHOP), FEE_VID);
    assert.equal(splitFeeVariantId({}), '');
    const order = makeOrder([line(1, lineVariant(111, -1), 1, { preorderDate: future }), feeLine()], []);
    assert.deepEqual(withoutSplitFeeLines(order, FEE_VID).lineItems.nodes.map((l) => l.id), ['gid://shopify/LineItem/1']);
    assert.equal(withoutSplitFeeLines(order, '').lineItems.nodes.length, 2);
    // Fee line is never a shippable "other" line, even if requiresShipping were missing.
    const noFlag = { ...feeLine(), requiresShipping: undefined };
    assert.equal(isMixedOrder(withoutSplitFeeLines(makeOrder([line(1, lineVariant(111, -1), 1, { preorderDate: future }), noFlag], []), FEE_VID), new Map([['gid://shopify/LineItem/1', 1]])), false);
  });

  test('isShipTogetherWaiting', () => {
    assert.equal(isShipTogetherWaiting({ tags: ['ship-together'] }), true);
    assert.equal(isShipTogetherWaiting({ tags: ['ship-together', 'ship-together-released'] }), false);
    assert.equal(isShipTogetherWaiting({ tags: ['ship-separately'] }), false);
  });
});

// ---------------------------------------------------------------- /hooks/order
describe('/hooks/order delivery choice', () => {
  const mixedOrder = (opts = {}) =>
    makeOrder([line(1, lineVariant(111, -2), 2, { preorderDate: future }), line(2, lineVariant(222, 5), 1), ...(opts.fee ? [feeLine()] : [])], [fo(9001, [foLine(1, 1, 111, 2), foLine(2, 2, 222, 1)], { status: opts.status || 'OPEN' })], opts);
  // After the partial pre-order hold, Shopify moves the in-stock line to a new fulfillment order.
  const afterSplit = () => ({ order: { id: 'gid://shopify/Order/5001', fulfillmentOrders: { nodes: [fo(9001, [foLine(1, 1, 111, 2)], { status: 'ON_HOLD', handle: 'falcon-preorder' }), fo(9002, [foLine(2, 2, 222, 1)])] } } });

  test('together (attribute missing = default): pre-order lines held, then the rest held with falcon-ship-together', async () => {
    const order = mixedOrder();
    mock = installFetch({ ...ok, FalconOrder: () => ({ order }), FalconOrderFulfillmentOrders: afterSplit, FalconVariant: () => fullVariant(111) });
    const res = await postHook('/hooks/order', { store: 'uk', order_id: '5001' });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.delivery, 'together');
    assert.deepEqual(gqlOps(), ['FalconOrder', 'FalconTagsAdd', 'FalconHold', 'FalconOrderFulfillmentOrders', 'FalconHold', 'FalconVariant', 'FalconTagsAdd']);
    assert.deepEqual(tagCalls()[0], ['preorder-v111', 'ship-together']);
    const [preHold, stHold] = holdCalls();
    assert.equal(preHold.fulfillmentHold.handle, 'falcon-preorder');
    assert.equal(stHold.id, 'gid://shopify/FulfillmentOrder/9002');
    assert.equal(stHold.fulfillmentHold.handle, SHIP_TOGETHER_HANDLE);
    assert.equal(stHold.fulfillmentHold.reasonNotes, 'Ship together with pre-order');
    assert.equal(stHold.fulfillmentHold.fulfillmentOrderLineItems, undefined, 'whole fulfillment order');
    assert.deepEqual(tagCalls().at(-1), ['preorder'], 'idempotency tag last');
    assert.equal(mails().length, 0);
  });

  test('together chosen explicitly behaves the same; a retry does not hold twice', async () => {
    const order = mixedOrder({ attrs: pref('Ship together') });
    const split = afterSplit();
    split.order.fulfillmentOrders.nodes[1] = fo(9002, [foLine(2, 2, 222, 1)], { status: 'ON_HOLD', handle: SHIP_TOGETHER_HANDLE });
    order.fulfillmentOrders.nodes = split.order.fulfillmentOrders.nodes; // retry: both holds already on
    order.tags = ['preorder-v111', 'ship-together'];
    mock = installFetch({ ...ok, FalconOrder: () => ({ order }), FalconOrderFulfillmentOrders: () => split, FalconVariant: () => fullVariant(111) });
    const res = await postHook('/hooks/order', { store: 'uk', order_id: '5001' });
    assert.equal(res.status, 200);
    assert.equal(holdCalls().length, 0);
  });

  test('separately with the fee line: current behaviour, tagged ship-separately, no alert', async () => {
    const order = mixedOrder({ attrs: pref('Ship separately'), fee: true });
    mock = installFetch({ ...ok, FalconOrder: () => ({ order }), FalconVariant: () => fullVariant(111) });
    const res = await postHook('/hooks/order', { store: 'uk', order_id: '5001' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.delivery, 'separately');
    assert.deepEqual(tagCalls()[0], ['preorder-v111', 'ship-separately']);
    assert.equal(holdCalls().length, 1);
    assert.deepEqual(holdCalls()[0].fulfillmentHold.fulfillmentOrderLineItems, [{ id: 'gid://shopify/FulfillmentOrderLineItem/1', quantity: 2 }]);
    assert.ok(!gqlOps().includes('FalconOrderFulfillmentOrders'));
    assert.equal(mails().length, 0);
  });

  test('separately without a fee line: split-fee-missing, one staff alert, choice honoured', async () => {
    const order = mixedOrder({ attrs: pref('Ship separately') });
    mock = installFetch({ ...ok, FalconOrder: () => ({ order }), FalconVariant: () => fullVariant(111) });
    const res = await postHook('/hooks/order', { store: 'uk', order_id: '5001' });
    assert.equal(res.status, 200);
    assert.deepEqual(tagCalls()[0], ['preorder-v111', 'ship-separately', 'split-fee-missing']);
    assert.equal(holdCalls().length, 1, 'no ship-together hold');
    assert.equal(mails().length, 1);
    assert.match(mails()[0].body.params.rows_html, /Ship separately chosen, no delivery fee paid/);
    // A retry (e.g. after a failed hold) with the tag present does not alert again.
    mock.restore();
    order.tags = ['preorder-v111', 'ship-separately', 'split-fee-missing'];
    mock = installFetch({ ...ok, FalconOrder: () => ({ order }), FalconVariant: () => fullVariant(111) });
    await postHook('/hooks/order', { store: 'uk', order_id: '5001' });
    assert.equal(mails().length, 0);
  });

  test('fee line on an order with no pre-order: split-fee-unneeded + one alert, then nothing', async () => {
    const order = makeOrder([line(2, lineVariant(222, 5), 1), feeLine()], [fo(9001, [foLine(2, 2, 222, 1)])]);
    mock = installFetch({ ...ok, FalconOrder: () => ({ order }) });
    const res = await postHook('/hooks/order', { store: 'uk', order_id: '5001' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.preorder, false);
    assert.deepEqual(body.delivery_tags, ['split-fee-unneeded']);
    assert.deepEqual(tagCalls(), [['split-fee-unneeded']]);
    assert.equal(holdCalls().length, 0);
    assert.equal(mails().length, 1);
    assert.match(mails()[0].body.params.rows_html, /Refund the Second delivery fee/);
    mock.restore();
    order.tags = ['split-fee-unneeded'];
    mock = installFetch({ ...ok, FalconOrder: () => ({ order }) });
    const again = await postHook('/hooks/order', { store: 'uk', order_id: '5001' });
    assert.deepEqual(await again.json(), { ok: true, preorder: false });
    assert.deepEqual(gqlOps(), ['FalconOrder']);
    assert.equal(mails().length, 0);
  });

  test('fee line on a pre-order-only order (two variants): not mixed, split-fee-unneeded, no ship-together', async () => {
    const order = makeOrder(
      [line(1, lineVariant(111, -1), 1, { preorderDate: future }), line(2, lineVariant(222, -1), 1, { preorderDate: future }), feeLine()],
      [fo(9001, [foLine(1, 1, 111, 1), foLine(2, 2, 222, 1)])],
      { attrs: pref('Ship separately') },
    );
    mock = installFetch({
      ...ok,
      FalconOrder: () => ({ order }),
      FalconOrderFulfillmentOrders: () => ({ order: { id: order.id, fulfillmentOrders: { nodes: [fo(9001, [foLine(1, 1, 111, 1)], { status: 'ON_HOLD', handle: 'falcon-preorder' }), fo(9002, [foLine(2, 2, 222, 1)])] } } }),
      FalconVariant: (v) => fullVariant(v.id.split('/').pop()),
    });
    const res = await postHook('/hooks/order', { store: 'uk', order_id: '5001' });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.delivery, null);
    assert.deepEqual(tagCalls()[0], ['preorder-v111', 'preorder-v222', 'split-fee-unneeded']);
    assert.ok(holdCalls().every((h) => h.fulfillmentHold.handle === 'falcon-preorder'));
    assert.match(mails()[0].body.params.rows_html, /nothing to ship separately/);
  });

  test('pre-order-only order without a fee: no delivery tags at all', async () => {
    const order = makeOrder([line(1, lineVariant(111, -1), 1, { preorderDate: future })], [fo(9001, [foLine(1, 1, 111, 1)])]);
    mock = installFetch({ ...ok, FalconOrder: () => ({ order }), FalconVariant: () => fullVariant(111) });
    const res = await postHook('/hooks/order', { store: 'uk', order_id: '5001' });
    assert.equal(res.status, 200);
    assert.deepEqual(tagCalls()[0], ['preorder-v111']);
    assert.equal(holdCalls().length, 1);
  });

  test('together but the fee was paid: ship together, split-fee-unneeded + alert', async () => {
    const order = mixedOrder({ fee: true });
    mock = installFetch({ ...ok, FalconOrder: () => ({ order }), FalconOrderFulfillmentOrders: afterSplit, FalconVariant: () => fullVariant(111) });
    const res = await postHook('/hooks/order', { store: 'uk', order_id: '5001' });
    assert.equal(res.status, 200);
    assert.deepEqual(tagCalls()[0], ['preorder-v111', 'ship-together', 'split-fee-unneeded']);
    assert.equal(holdCalls().length, 2);
    assert.match(mails()[0].body.params.rows_html, /chose Ship together/);
  });

  test('the fee line is never treated as a pre-order or oversell, even when tracked below zero', async () => {
    const trackedFee = line(9, lineVariant(FEE_VID, -3), 1, { title: 'Second delivery' });
    const order = makeOrder([line(2, lineVariant(222, 5), 1), trackedFee], [fo(9001, [foLine(2, 2, 222, 1)])]);
    mock = installFetch({ ...ok, FalconOrder: () => ({ order }) });
    const res = await postHook('/hooks/order', { store: 'uk', order_id: '5001' });
    const body = await res.json();
    assert.deepEqual(body.oversold, []);
    assert.deepEqual(tagCalls(), [['split-fee-unneeded']]);
    assert.ok(!gqlOps().includes('FalconVariant'));
  });

  test('no ship-together hold while a pre-order hold is failing (retry places both later)', async () => {
    const order = mixedOrder({ status: 'IN_PROGRESS' });
    mock = installFetch({ ...ok, FalconOrder: () => ({ order }), FalconVariant: () => fullVariant(111) });
    const res = await postHook('/hooks/order', { store: 'uk', order_id: '5001' });
    assert.equal(res.status, 500);
    assert.equal(holdCalls().length, 0);
    assert.ok(!gqlOps().includes('FalconOrderFulfillmentOrders'));
    assert.ok(tagCalls()[0].includes('ship-together'));
    assert.ok(tagCalls().some((t) => t.includes('preorder-hold-failed')));
  });

  test('a ship-together hold that fails is a hold failure (500, preorder tag withheld)', async () => {
    const order = mixedOrder();
    const split = afterSplit();
    split.order.fulfillmentOrders.nodes[1].status = 'IN_PROGRESS';
    mock = installFetch({ ...ok, FalconOrder: () => ({ order }), FalconOrderFulfillmentOrders: () => split, FalconVariant: () => fullVariant(111) });
    const res = await postHook('/hooks/order', { store: 'uk', order_id: '5001' });
    assert.equal(res.status, 500);
    assert.ok(!tagCalls().some((t) => t.includes('preorder')));
    assert.match(mails()[0].body.params.rows_html, /ship together/);
  });
});

// ---------------------------------------------------------------- release
describe('ship-together release', () => {
  const stOrder = (tags = ['preorder', 'preorder-v111', 'ship-together']) => ({ id: 'gid://shopify/Order/1', name: '#UK1', createdAt: '2026-09-01T00:00:00Z', tags });

  test('when the last pre-order item is released, the ship-together hold is released in the same run', async () => {
    let preReleased = false;
    mock = installFetch({
      ...ok,
      FalconOrderFulfillmentOrders: (v) => ({
        order: {
          id: v.id,
          fulfillmentOrders: { nodes: [fo(1, [foLine(1, 1, 111, 1)], preReleased ? {} : { status: 'ON_HOLD', handle: 'falcon-preorder' }), fo(2, [foLine(2, 2, 222, 1)], { status: 'ON_HOLD', handle: SHIP_TOGETHER_HANDLE })] },
        },
      }),
      FalconRelease: (v) => {
        if (v.id.endsWith('/1')) preReleased = true;
        return ok.FalconRelease(v);
      },
    });
    const r = await releaseForVariant(makeCtx(), '111', 0, [stOrder()]);
    assert.deepEqual(r.released, ['#UK1']);
    assert.deepEqual(r.ship_together_released, ['#UK1']);
    const rel = mock.calls.filter((c) => c.op === 'FalconRelease').map((c) => c.variables);
    assert.deepEqual(rel.map((x) => x.id), ['gid://shopify/FulfillmentOrder/1', 'gid://shopify/FulfillmentOrder/2']);
    assert.deepEqual(rel[1].holdIds, ['gid://shopify/FulfillmentHold/2']);
    assert.ok(tagCalls().some((t) => t.includes('ship-together-released')));
  });

  test('another pre-order item still held: the rest keeps waiting', async () => {
    let preReleased = false;
    mock = installFetch({
      ...ok,
      FalconOrderFulfillmentOrders: (v) => ({
        order: {
          id: v.id,
          fulfillmentOrders: {
            nodes: [
              fo(1, [foLine(1, 1, 111, 1)], preReleased ? {} : { status: 'ON_HOLD', handle: 'falcon-preorder' }),
              fo(3, [foLine(3, 3, 333, 1)], { status: 'ON_HOLD', handle: 'falcon-preorder' }),
              fo(2, [foLine(2, 2, 222, 1)], { status: 'ON_HOLD', handle: SHIP_TOGETHER_HANDLE }),
            ],
          },
        },
      }),
      FalconRelease: (v) => {
        preReleased = true;
        return ok.FalconRelease(v);
      },
    });
    const r = await releaseForVariant(makeCtx(), '111', 0, [stOrder(['preorder', 'preorder-v111', 'preorder-v333', 'ship-together'])]);
    assert.deepEqual(r.released, ['#UK1']);
    assert.deepEqual(r.ship_together_released, []);
    assert.equal(mock.calls.filter((c) => c.op === 'FalconRelease').length, 1);
  });

  test('never released for an order whose holds did not all go on', async () => {
    mock = installFetch({});
    const r = await releaseShipTogetherIfDone(makeCtx(), stOrder(['preorder-v111', 'ship-together', 'preorder-hold-failed']));
    assert.equal(r.released, false);
    assert.equal(r.pending, true);
    assert.equal(mock.calls.length, 0);
  });

  test('daily: pre-order item refunded/cancelled, so the rest is released and listed in the digest', async () => {
    const order = {
      ...makeOrder([line(1, lineVariant(111, 0), 1, { preorderDate: future, unfulfilled: 0 }), line(2, lineVariant(222, 5), 1)], []),
      tags: ['preorder', 'preorder-v111', 'ship-together'],
    };
    mock = installFetch({
      ...ok,
      FalconVariants: () => ({ productVariants: { pageInfo: { hasNextPage: false }, nodes: [fullVariant(111, { qty: 0, policy: 'DENY', expected: null, limit: null }).productVariant] } }),
      FalconOrders: (v) => ({ orders: { pageInfo: { hasNextPage: false }, nodes: v.q.includes('hold-failed') ? [] : [order] } }),
      FalconCustomersByTag: () => ({ customers: { pageInfo: { hasNextPage: false }, nodes: [] } }),
      // Pre-order line refunded: its fulfillment order is closed with nothing left.
      FalconOrderFulfillmentOrders: (v) => ({ order: { id: v.id, fulfillmentOrders: { nodes: [fo(1, [foLine(1, 1, 111, 0)], { status: 'CLOSED' }), fo(2, [foLine(2, 2, 222, 1)], { status: 'ON_HOLD', handle: SHIP_TOGETHER_HANDLE })] } } }),
    });
    const summary = await runDailyForStore(makeCtx('uk'));
    assert.equal(summary.ship_together_released, 1);
    const rel = mock.calls.filter((c) => c.op === 'FalconRelease').map((c) => c.variables);
    assert.deepEqual(rel, [{ id: 'gid://shopify/FulfillmentOrder/2', holdIds: ['gid://shopify/FulfillmentHold/2'] }]);
    assert.ok(tagCalls().some((t) => t.includes('ship-together-released')));
    const digest = mails().find((m) => /Daily check/.test(m.body.params.subject));
    assert.match(digest.body.params.rows_html, /Ship-together order released/);
  });

  test('daily: an order released earlier (tagged) is not read again', async () => {
    const order = { ...makeOrder([], []), tags: ['preorder', 'preorder-v111', 'preorder-released-v111', 'ship-together', 'ship-together-released'] };
    mock = installFetch({
      ...ok,
      FalconVariants: () => ({ productVariants: { pageInfo: { hasNextPage: false }, nodes: [] } }),
      FalconOrders: (v) => ({ orders: { pageInfo: { hasNextPage: false }, nodes: v.q.includes('hold-failed') ? [] : [order] } }),
      FalconCustomersByTag: () => ({ customers: { pageInfo: { hasNextPage: false }, nodes: [] } }),
    });
    await runDailyForStore(makeCtx('uk'));
    assert.ok(!gqlOps().includes('FalconOrderFulfillmentOrders'));
  });
});

// ---------------------------------------------------------------- /c alert
describe('/c staff alert for a ship-together order', () => {
  const post = async (tags) => {
    const order = { ...makeOrder([line(1, lineVariant(111, -1), 1, { preorderDate: future }), line(2, lineVariant(222, 3), 1)], []), tags };
    mock = installFetch({ ...ok, FalconOrder: () => ({ order }) });
    const t = await signToken({ s: 'uk', a: 'c', o: '5001', v: '111', n: 1 }, SECRET);
    const form = new FormData();
    form.append('t', t);
    await worker.fetch(new Request('https://w.example/c', { method: 'POST', body: form }), makeEnv(), {});
    return mails()[0].body.params.intro;
  };
  const SENTENCE = 'After cancelling the pre-order item, the rest of this order will be released automatically at the next daily check (or release it now by hand).';

  test('says the rest will be released at the next daily check', async () => {
    assert.ok((await post(['preorder', 'preorder-v111', 'ship-together'])).includes(SENTENCE));
  });

  test('not said for a ship-separately order', async () => {
    assert.ok(!(await post(['preorder', 'preorder-v111', 'ship-separately'])).includes(SENTENCE));
  });
});

// ---------------------------------------------------------------- delay emails
describe('delay emails carry ship_together', () => {
  const v = { gid: 'gid://shopify/ProductVariant/111', id: '111', title: 'Grey', productTitle: 'Pie Dish', delayReason: 'Late ship.', delayCount: 0, notifiedDate: '2099-11-12', expectedDate: '2099-12-01' };
  const order = (tags) => ({ ...makeOrder([line(1, lineVariant(111, -1), 1, { preorderDate: '2099-11-12' }), line(2, lineVariant(222, 3), 1)], []), tags });

  for (const [store, template] of [
    ['uk', 2],
    ['us', 3],
  ]) {
    test(`${store}: true for a ship-together order, false otherwise`, async () => {
      mock = installFetch({ ...ok });
      await processDateChange(makeCtx(store, { today: '2099-09-01' }), v, [], [order(['preorder', 'preorder-v111', 'ship-together'])]);
      assert.equal(mails()[0].body.templateId, template);
      assert.equal(mails()[0].body.params.ship_together, true);
      mock.restore();
      mock = installFetch({ ...ok });
      await processDateChange(makeCtx(store, { today: '2099-09-01' }), v, [], [order(['preorder', 'preorder-v111', 'ship-separately'])]);
      assert.equal(mails()[0].body.params.ship_together, false);
    });
  }

  test('us consent template too', async () => {
    mock = installFetch({ ...ok });
    const far = { ...v, expectedDate: '2100-06-01' }; // > 30 days: consent
    await processDateChange(makeCtx('us', { today: '2099-09-01' }), far, [], [order(['preorder', 'preorder-v111', 'ship-together'])]);
    assert.equal(mails()[0].body.templateId, 4);
    assert.equal(mails()[0].body.params.ship_together, true);
  });
});

// ---------------------------------------------------------------- /subscribe + waitlist_joined
describe('waitlist sign-up email', () => {
  const customer = (tags, extra = {}) => ({ id: 'gid://shopify/Customer/7', firstName: 'Jane', tags, defaultEmailAddress: { emailAddress: 'jane@example.com', marketingState: 'NOT_SUBSCRIBED' }, ...extra });
  const subscribe = (env = makeEnv(), execCtx = {}) =>
    worker.fetch(
      new Request('https://w.example/subscribe', {
        method: 'POST',
        headers: { Origin: 'https://www.falconenamelware.com', 'content-type': 'application/json' },
        body: JSON.stringify({ store: 'uk', variant_id: '111', email: 'jane@example.com', marketing: false, turnstile_token: 'tok' }),
      }),
      env,
      execCtx,
    );
  const handlers = (found) => ({
    ...ok,
    FalconVariant: () => fullVariant(111, { qty: 0, policy: 'DENY' }),
    FalconFindCustomer: () => ({ customers: { nodes: found ? [found] : [] } }),
    FalconCustomerCreate: (v) => ({ customerCreate: { customer: customer(v.input.tags, { firstName: null }), userErrors: [] } }),
  });

  test('new customer: tagged, then one waitlist_joined email with the right params', async () => {
    mock = installFetch(handlers(null));
    const res = await subscribe();
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(mails().length, 1);
    const m = mails()[0].body;
    assert.equal(m.templateId, 6);
    assert.deepEqual(m.to, [{ email: 'jane@example.com' }]);
    assert.deepEqual(m.tags, ['falcon', 'uk', 'waitlist_joined']);
    const p = m.params;
    assert.equal(p.store, 'uk');
    assert.equal(p.product_title, 'Pie Dish');
    assert.equal(p.variant_title, 'Grey');
    assert.equal(p.product_url, 'https://www.falconenamelware.com/products/pie-dish?variant=111');
    assert.equal(p.image_url, 'https://cdn.example/pie.jpg');
    assert.equal(p.dry_run_banner, undefined);
    const optout = await verifyToken(decodeURIComponent(p.optout_url.split('t=')[1]), SECRET);
    assert.deepEqual([optout.s, optout.a, optout.c, optout.v], ['uk', 'u', '7', '111']);
    assert.ok(p.optout_url.startsWith('https://falcon-stock.example.workers.dev/u?t='));
    const all = await verifyToken(decodeURIComponent(p.remove_all_url.split('t=')[1]), SECRET);
    assert.equal(all.v, undefined);
    assert.equal(all.a, 'u');
  });

  test('existing customer newly added to this waitlist gets it; the idempotency key is stable', async () => {
    mock = installFetch(handlers(customer(['restock-request', 'restock-222'])));
    await subscribe();
    await subscribe();
    const keys = mails().map((m) => m.body.headers.idempotencyKey);
    assert.equal(keys.length, 2, 'the found customer still lacks the tag in this mock');
    assert.equal(keys[0], keys[1], 'Brevo drops the second as a duplicate');
  });

  test('repeat sign-up (already has restock-{id}): no email', async () => {
    mock = installFetch(handlers(customer(['restock-request', 'restock-111'])));
    const res = await subscribe();
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(mails().length, 0);
  });

  test('race: create fails, the customer found already has the tag: no email', async () => {
    let finds = 0;
    mock = installFetch({
      ...handlers(null),
      FalconFindCustomer: () => ({ customers: { nodes: finds++ === 0 ? [] : [customer(['restock-111'])] } }),
      FalconCustomerCreate: () => ({ customerCreate: { customer: null, userErrors: [{ field: ['email'], message: 'Email has already been taken' }] } }),
    });
    const res = await subscribe();
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(mails().length, 0);
  });

  test('a customer who opted out of this product and signs up again: opt-out removed, email sent', async () => {
    mock = installFetch(handlers(customer(['restock-request', 'restock-optout-111', 'restock-notified-111'])));
    await subscribe();
    const removed = mock.calls.filter((c) => c.op === 'FalconTagsRemove').map((c) => c.variables.tags);
    assert.deepEqual(removed, [['restock-notified-111', 'restock-optout-111']]);
    assert.equal(mails().length, 1);
  });

  test('a Brevo failure never fails the sign-up', async () => {
    mock = installFetch(handlers(null), { brevoStatus: 400 });
    const res = await subscribe();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(mails().length, 1);
    assert.ok(logs.some((l) => l.includes('"event":"waitlist_joined_failed"')));
  });

  test('no template id configured: skipped and logged, sign-up fine', async () => {
    const shop = { ...SHOP, templates: { ...SHOP.templates, waitlist_joined: undefined } };
    mock = installFetch(handlers(null));
    const res = await subscribe(makeEnv({ shop }));
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(mails().length, 0);
    assert.ok(logs.some((l) => l.includes('waitlist_joined_no_template')));
  });

  test('DRY_RUN: goes to staff with the banner and a test-only link', async () => {
    mock = installFetch(handlers(null));
    await subscribe(makeEnv({ dryRun: true }));
    const m = mails()[0].body;
    assert.equal(m.to[0].email, 'staff@example.com');
    assert.match(m.params.dry_run_banner, /jane@example\.com/);
    const t = await verifyToken(decodeURIComponent(m.params.optout_url.split('t=')[1]), SECRET);
    assert.equal(t.d, 1);
  });

  test('with an execution context the email is sent in waitUntil', async () => {
    mock = installFetch(handlers(null));
    const pending = [];
    const res = await subscribe(makeEnv(), { waitUntil: (p) => pending.push(p) });
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(pending.length, 1);
    await pending[0];
    assert.equal(mails().length, 1);
  });
});

// ---------------------------------------------------------------- /u per product
describe('/u per-product opt-out', () => {
  const get = async (payload) => {
    const t = await signToken(payload, SECRET);
    return (await worker.fetch(new Request(`https://w.example/u?t=${encodeURIComponent(t)}`), makeEnv(), {})).text();
  };
  const post = async (payload) => {
    const t = await signToken(payload, SECRET);
    const form = new FormData();
    form.append('t', t);
    return worker.fetch(new Request('https://w.example/u', { method: 'POST', body: form }), makeEnv(), {});
  };
  const optoutOk = { FalconWaitlistOptOut: (v) => ({ added: { node: { id: v.id }, userErrors: [] }, removed: { node: { id: v.id }, userErrors: [] } }) };

  test('GET with v names the product and changes nothing', async () => {
    mock = installFetch({ FalconVariant: () => fullVariant(111) });
    const html = await get({ s: 'uk', a: 'u', c: '7', v: '111' });
    assert.match(html, /Stop emails about Pie Dish Grey\?/);
    assert.deepEqual(gqlOps(), ['FalconVariant']);
  });

  test('GET without v: "Leave all waitlists?"', async () => {
    mock = installFetch({});
    const html = await get({ s: 'uk', a: 'u', c: '7' });
    assert.match(html, /Leave all waitlists\?/);
    assert.equal(mock.calls.length, 0);
  });

  test('POST with v: adds restock-optout-{v} and removes restock-{v} only', async () => {
    mock = installFetch({ ...optoutOk, FalconVariant: () => fullVariant(111) });
    const res = await post({ s: 'uk', a: 'u', c: '7', v: '111' });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /won&#39;t email you about Pie Dish Grey/);
    const call = mock.calls.find((c) => c.op === 'FalconWaitlistOptOut').variables;
    assert.deepEqual(call, { id: 'gid://shopify/Customer/7', add: ['restock-optout-111'], remove: ['restock-111'] });
  });

  test('POST with v: unknown variant still works, worded "this product"', async () => {
    mock = installFetch({ ...optoutOk, FalconVariant: () => ({ productVariant: null }) });
    const res = await post({ s: 'uk', a: 'u', c: '7', v: '111' });
    assert.match(await res.text(), /this product/);
  });

  test('POST without v still leaves every waitlist (and keeps opt-out tags)', async () => {
    mock = installFetch({ ...ok, FalconCustomer: (v) => ({ customer: { id: v.id, tags: ['restock-111', 'restock-222', 'restock-optout-333', 'restock-request'] } }) });
    const res = await post({ s: 'uk', a: 'u', c: '7' });
    assert.equal(res.status, 200);
    assert.deepEqual(mock.calls.find((c) => c.op === 'FalconTagsRemove').variables.tags, ['restock-111', 'restock-222']);
  });

  test('DRY_RUN link with v: POST changes nothing', async () => {
    mock = installFetch({});
    const res = await post({ s: 'uk', a: 'u', c: '7', v: '111', d: 1 });
    assert.match(await res.text(), /nothing changed/);
    assert.equal(mock.calls.length, 0);
  });
});

// ---------------------------------------------------------------- fan-out
describe('fan-out and the per-product opt-out', () => {
  const variant = { id: '111', qty: 3, title: 'Grey', productTitle: 'Pie Dish', handle: 'pie-dish', price: '22', productStatus: 'ACTIVE' };
  const list = (customers) => ({
    ...ok,
    FalconCustomersByTag: () => ({ customers: { pageInfo: { hasNextPage: false }, nodes: customers } }),
    FalconShop: () => ({ shop: { currencyCode: 'GBP' } }),
    FalconCustomer: (v) => ({ customer: customers.find((c) => c.id === v.id) }),
    FalconWaitlistDone: (v) => ({ added: { node: { id: v.id }, userErrors: [] }, removed: { node: { id: v.id }, userErrors: [] } }),
  });

  test('skips a customer with restock-optout-{v} (and tidies the list); others get bis with optout_url', async () => {
    const out = { id: 'gid://shopify/Customer/1', tags: ['restock-111', 'restock-optout-111'], defaultEmailAddress: { emailAddress: 'out@example.com' } };
    const inn = { id: 'gid://shopify/Customer/2', tags: ['restock-111'], defaultEmailAddress: { emailAddress: 'in@example.com' } };
    mock = installFetch(list([out, inn]));
    const stats = await fanOutWaitlist(makeCtx(), variant, { emails: 400, deadline: 0 });
    assert.equal(stats.sent, 1);
    assert.equal(stats.skipped, 1);
    assert.equal(mails().length, 1);
    const p = mails()[0].body.params;
    assert.equal(mails()[0].body.to[0].email, 'in@example.com');
    const opt = await verifyToken(decodeURIComponent(p.optout_url.split('t=')[1]), SECRET);
    assert.deepEqual([opt.a, opt.c, opt.v], ['u', '2', '111']);
    const all = await verifyToken(decodeURIComponent(p.remove_url.split('t=')[1]), SECRET);
    assert.equal(all.v, undefined);
    const removed = mock.calls.filter((c) => c.op === 'FalconTagsRemove').map((c) => [c.variables.id, c.variables.tags]);
    assert.deepEqual(removed, [['gid://shopify/Customer/1', ['restock-111']]]);
  });

  test('DRY_RUN: opted-out customer skipped, tags untouched', async () => {
    const out = { id: 'gid://shopify/Customer/1', tags: ['restock-111', 'restock-optout-111'], defaultEmailAddress: { emailAddress: 'out@example.com' } };
    mock = installFetch(list([out]));
    await fanOutWaitlist(makeCtx('uk', { dryRun: true }), variant, { emails: 400, deadline: 0 });
    assert.equal(mails().length, 0);
    assert.ok(!gqlOps().includes('FalconTagsRemove'));
  });
});

// ---------------------------------------------------------------- templates
describe('email templates', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'emails');
  const read = (f) => readFileSync(join(dir, f), 'utf8');
  const SHIP_LINE = 'The rest of your order is being held so it all ships together in one delivery.';

  test('no em dashes in any template', () => {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.html'))) {
      assert.ok(!read(f).includes('—'), `${f} has an em dash`);
    }
  });

  test('delay templates show the ship-together line only when params.ship_together', () => {
    for (const f of ['delay-uk.html', 'delay-us-notice.html', 'delay-us-consent.html']) {
      const html = read(f);
      assert.equal(html.split(SHIP_LINE).length - 1, 1, f);
      const block = html.slice(html.indexOf('{% if params.ship_together %}'));
      assert.ok(block.indexOf(SHIP_LINE) < block.indexOf('{% endif %}'), `${f}: line inside the if`);
    }
  });

  test('bis has the per-product link and keeps the all-waitlists link', () => {
    const html = read('bis.html');
    assert.match(html, /href="\{\{ params\.optout_url \}\}"[^>]*>Don't email me about this product again</);
    assert.match(html, /href="\{\{ params\.remove_url \}\}"/);
  });

  test('waitlist-joined: service copy, every param used, no buy button or price', () => {
    const html = read('waitlist-joined.html');
    assert.ok(html.includes("You're on the waitlist for {{ params.product_title }}. We'll email you once, when it's back in stock."));
    for (const p of ['store', 'product_title', 'variant_title', 'product_url', 'image_url', 'optout_url', 'remove_all_url', 'dry_run_banner']) {
      assert.ok(html.includes(`params.${p}`), `uses ${p}`);
    }
    assert.match(html, /Don't email me about this product again/);
    assert.doesNotMatch(html, /Buy it now|params\.price|btn-cell/i);
    // Spelling-neutral: none of the words that differ between UK and US copy.
    const text = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]*>/g, ' ');
    assert.doesNotMatch(text, /colou?r|dispatch|cancel|favou?rite|pre-?order/i);
  });
});
