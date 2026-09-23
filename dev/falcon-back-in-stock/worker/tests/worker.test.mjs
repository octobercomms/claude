// Run: node --test dev/falcon-back-in-stock/worker/tests/
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import worker, {
  runtime,
  signToken,
  verifyToken,
  classifyDelay,
  allocateReleases,
  variantPreorderState,
  hasExactTag,
  restockVariantIds,
  maxDelayNumber,
  keepByDates,
  formatDate,
  addWorkingDays,
  refundDeadline,
  uuidV5,
  isValidEmail,
  timingSafeEqual,
  preorderLinesFromOrder,
  buildBrevoPayload,
  rowsToHtml,
  cleanVariantTitle,
} from '../worker.js';

runtime.sleep = async () => {};
const SECRET = 'test-link-secret';

// ---------------------------------------------------------------- tokens
describe('link tokens', () => {
  test('sign and verify round trip', async () => {
    const t = await signToken({ s: 'uk', a: 'c', o: '123', v: '456', n: 1 }, SECRET);
    const p = await verifyToken(t, SECRET);
    assert.equal(p.s, 'uk');
    assert.equal(p.a, 'c');
    assert.equal(p.o, '123');
    assert.equal(p.n, 1);
    assert.ok(p.exp > Date.now() / 1000 + 119 * 86400, 'expiry about 120 days');
    assert.match(t, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'base64url, no padding');
  });

  test('expired token is rejected', async () => {
    const now = Date.UTC(2026, 0, 1);
    const t = await signToken({ s: 'uk', a: 'u', c: '1' }, SECRET, { nowMs: now });
    assert.ok(await verifyToken(t, SECRET, { nowMs: now + 119 * 86400000 }));
    assert.equal(await verifyToken(t, SECRET, { nowMs: now + 121 * 86400000 }), null);
  });

  test('tampered payload, tampered signature and wrong secret are rejected', async () => {
    const t = await signToken({ s: 'uk', a: 'u', c: '1' }, SECRET);
    const [p, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ s: 'uk', a: 'u', c: '2', exp: 9999999999 })).toString('base64url');
    assert.equal(await verifyToken(`${forged}.${sig}`, SECRET), null);
    const badSig = sig.slice(0, -2) + (sig.endsWith('AA') ? 'BB' : 'AA');
    assert.equal(await verifyToken(`${p}.${badSig}`, SECRET), null);
    assert.equal(await verifyToken(t, 'other-secret'), null);
    assert.equal(await verifyToken('garbage', SECRET), null);
    assert.equal(await verifyToken('', SECRET), null);
    assert.equal(await verifyToken('a.b.c', SECRET), null);
  });
});

// ---------------------------------------------------------------- delay classification
describe('classifyDelay', () => {
  const today = '2026-09-23';
  test('uk later', () => {
    assert.deepEqual(classifyDelay({ store: 'uk', old_date: '2026-11-12', new_date: '2026-12-10', delay_count_before: 0, has_definite_date: true, today }), { template: 'delay_uk', earlier: false });
  });
  test('uk earlier', () => {
    assert.deepEqual(classifyDelay({ store: 'uk', old_date: '2026-11-12', new_date: '2026-11-01', delay_count_before: 2, has_definite_date: true, today }), { template: 'delay_uk', earlier: true });
  });
  test('eu uses the uk template', () => {
    assert.equal(classifyDelay({ store: 'eu', old_date: '2026-11-12', new_date: '2027-03-01', delay_count_before: 3, today }).template, 'delay_uk');
  });
  test('us first delay within 30 days: notice (silence = consent)', () => {
    assert.deepEqual(classifyDelay({ store: 'us', old_date: '2026-11-12', new_date: '2026-12-12', delay_count_before: 0, has_definite_date: true, today }), { template: 'delay_us_notice', earlier: false });
  });
  test('us first delay over 30 days: consent, keep by old date', () => {
    const r = classifyDelay({ store: 'us', old_date: '2026-11-12', new_date: '2026-12-13', delay_count_before: 0, has_definite_date: true, today });
    assert.equal(r.template, 'delay_us_consent');
    assert.equal(r.keep_by_date, '2026-11-12');
  });
  test('us second delay: consent even if short', () => {
    const r = classifyDelay({ store: 'us', old_date: '2026-11-12', new_date: '2026-11-19', delay_count_before: 1, has_definite_date: true, today });
    assert.equal(r.template, 'delay_us_consent');
  });
  test('us consent keep_by is at least today + 7 days', () => {
    const r = classifyDelay({ store: 'us', old_date: '2026-09-25', new_date: '2026-12-01', delay_count_before: 1, has_definite_date: true, today });
    assert.equal(r.keep_by_date, '2026-09-30');
  });
  test('us no definite date: consent', () => {
    const r = classifyDelay({ store: 'us', old_date: '2026-11-12', new_date: '', delay_count_before: 0, has_definite_date: false, today });
    assert.equal(r.template, 'delay_us_consent');
  });
  test('us earlier: notice template with earlier flag', () => {
    assert.deepEqual(classifyDelay({ store: 'us', old_date: '2026-11-12', new_date: '2026-11-01', delay_count_before: 1, has_definite_date: true, today }), { template: 'delay_us_notice', earlier: true });
  });
});

// ---------------------------------------------------------------- release allocation
describe('allocateReleases', () => {
  const held = [
    { id: 'A', createdAt: '2026-09-01T10:00:00Z', units: 3 },
    { id: 'B', createdAt: '2026-09-02T10:00:00Z', units: 2 },
    { id: 'C', createdAt: '2026-09-03T10:00:00Z', units: 5 },
  ];
  test('stock 5 releases the first two', () => assert.deepEqual(allocateReleases(held, 5).map((o) => o.id), ['A', 'B']));
  test('stock 0 releases none', () => assert.deepEqual(allocateReleases(held, 0), []));
  test('negative stock releases none', () => assert.deepEqual(allocateReleases(held, -4), []));
  test('stock 10 releases all', () => assert.deepEqual(allocateReleases(held, 10).map((o) => o.id), ['A', 'B', 'C']));
  test('oldest first regardless of input order; no queue jumping', () => {
    const shuffled = [held[2], held[0], held[1]];
    assert.deepEqual(allocateReleases(shuffled, 4).map((o) => o.id), ['A']);
    // C (5) does not fit in 9 - 5 = 4, and nothing after it may jump the queue
    assert.deepEqual(allocateReleases([...held, { id: 'D', createdAt: '2026-09-04', units: 1 }], 9).map((o) => o.id), ['A', 'B']);
  });
});

// ---------------------------------------------------------------- theme rule mirror
describe('variantPreorderState (mirrors falcon-variant-data.liquid)', () => {
  const today = '2026-09-23';
  const base = { inventory_management: 'shopify', inventory_policy: 'continue', inventory_quantity: -3, available: true, expected_date: '2026-11-12', preorder_limit: 20 };
  test('preorder with max_qty = limit + qty', () => assert.deepEqual(variantPreorderState(base, today), { state: 'preorder', max_qty: 17 }));
  test('in stock', () => assert.deepEqual(variantPreorderState({ ...base, inventory_quantity: 8 }, today), { state: 'in_stock', max_qty: 8 }));
  test('cap reached: notify', () => assert.equal(variantPreorderState({ ...base, inventory_quantity: -20 }, today).state, 'notify'));
  test('date in past: notify', () => assert.equal(variantPreorderState({ ...base, expected_date: '2026-09-22' }, today).state, 'notify'));
  test('date today: still preorder', () => assert.equal(variantPreorderState({ ...base, expected_date: today }, today).state, 'preorder'));
  test('no limit: notify', () => assert.equal(variantPreorderState({ ...base, preorder_limit: null }, today).state, 'notify'));
  test('no date: notify', () => assert.equal(variantPreorderState({ ...base, expected_date: null }, today).state, 'notify'));
  test('policy deny: notify', () => assert.equal(variantPreorderState({ ...base, inventory_policy: 'deny' }, today).state, 'notify'));
  test('untracked: in stock if available', () => {
    assert.equal(variantPreorderState({ ...base, inventory_management: null }, today).state, 'in_stock');
    assert.equal(variantPreorderState({ ...base, inventory_management: null, available: false }, today).state, 'notify');
  });
});

// ---------------------------------------------------------------- tags
describe('tags', () => {
  test('exact tag matching', () => {
    assert.equal(hasExactTag(['restock-1234', 'restock-request'], 'restock-123'), false);
    assert.equal(hasExactTag(['restock-1234', 'restock-123'], 'restock-123'), true);
    assert.equal(hasExactTag('restock-request, restock-123', 'restock-123'), true);
    assert.equal(hasExactTag('restock-request, restock-1230', 'restock-123'), false);
    assert.equal(hasExactTag(['Preorder'], 'preorder'), true, 'Shopify tags are case-insensitive');
    assert.equal(hasExactTag(['preorder-v1'], 'preorder'), false);
    assert.equal(hasExactTag(null, 'x'), false);
  });
  test('restock variant ids ignore restock-request and restock-notified-*', () => {
    assert.deepEqual(restockVariantIds(['restock-request', 'restock-111', 'restock-notified-222', 'restock-333']), ['111', '333']);
  });
  test('delay numbers and keep-by dates are per variant', () => {
    const tags = ['preorder', 'preorder-delay-v111-1', 'preorder-delay-v111-2', 'preorder-delay-v222-5', 'preorder-keep-by-v111-2026-11-12', 'preorder-keep-by-v111-2026-10-01', 'preorder-keep-by-v222-2026-12-24'];
    assert.equal(maxDelayNumber(tags, '111'), 2);
    assert.equal(maxDelayNumber(tags, '222'), 5);
    assert.equal(maxDelayNumber(tags, '1'), 0, 'exact variant id, not a prefix');
    assert.equal(maxDelayNumber(['preorder'], '111'), 0);
    assert.deepEqual(keepByDates(tags, '111'), ['2026-10-01', '2026-11-12']);
    assert.deepEqual(keepByDates(tags, '222'), ['2026-12-24']);
  });
});

// ---------------------------------------------------------------- dates and misc
describe('dates', () => {
  test('store date formats', () => {
    assert.equal(formatDate('2026-11-12', 'uk'), '12 November 2026');
    assert.equal(formatDate('2026-11-12', 'eu'), '12 November 2026');
    assert.equal(formatDate('2026-11-12', 'us'), 'November 12, 2026');
    assert.equal(formatDate('2026-01-05', 'us'), 'January 5, 2026');
    assert.equal(formatDate('2026-02-30', 'uk'), '');
    assert.equal(formatDate('', 'uk'), '');
  });
  test('refund deadlines: 14 days UK/EU, 7 working days US', () => {
    // 2026-09-23 is a Wednesday
    assert.equal(refundDeadline('uk', '2026-09-23'), '2026-10-07');
    assert.equal(refundDeadline('us', '2026-09-23'), '2026-10-02');
    assert.equal(addWorkingDays('2026-09-25', 1), '2026-09-28', 'Friday + 1 working day = Monday');
  });
});

describe('uuid v5', () => {
  test('matches the RFC 4122 / Python reference vector', async () => {
    assert.equal(await uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'), '2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });
  test('deterministic, version 5, variant bits', async () => {
    const a = await uuidV5('bis|uk|123|456|2026-09-23');
    const b = await uuidV5('bis|uk|123|456|2026-09-23');
    const c = await uuidV5('bis|uk|123|456|2026-09-24');
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('email validation', () => {
  test('valid', () => {
    for (const e of ['jane@example.com', 'jane.smith+falcon@example.co.uk', "o'brien@example.ie", 'a_b@sub.example.org']) assert.ok(isValidEmail(e), e);
  });
  test('invalid', () => {
    for (const e of ['', 'jane', 'jane@', '@example.com', 'jane@example', 'ja ne@example.com', 'jane@@example.com', 'jane@example.c', 'jane"x@example.com', '.jane@example.com', 'jane..x@example.com', 'a@b.c', null, 42, `${'a'.repeat(65)}@example.com`]) {
      assert.equal(isValidEmail(e), false, String(e));
    }
  });
});

test('timingSafeEqual', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
  assert.equal(timingSafeEqual('', 'x'), false);
  assert.equal(timingSafeEqual(undefined, ''), true);
});

test('preorderLinesFromOrder finds only _preorder_date lines', () => {
  const order = {
    lineItems: {
      nodes: [
        { id: 'gid://shopify/LineItem/1', quantity: 2, unfulfilledQuantity: 2, variant: { id: 'gid://shopify/ProductVariant/111' }, customAttributes: [{ key: '_preorder_date', value: '2026-11-12' }, { key: 'Pre-order', value: 'Ships from 12 November 2026' }] },
        { id: 'gid://shopify/LineItem/2', quantity: 1, unfulfilledQuantity: 1, variant: { id: 'gid://shopify/ProductVariant/222' }, customAttributes: [] },
      ],
    },
  };
  assert.deepEqual(preorderLinesFromOrder(order), [{ lineItemId: 'gid://shopify/LineItem/1', variantId: '111', date: '2026-11-12', quantity: 2, unfulfilledQuantity: 2 }]);
});

test('cleanVariantTitle drops Default Title', () => {
  assert.equal(cleanVariantTitle('Default Title'), '');
  assert.equal(cleanVariantTitle('Pigeon Grey'), 'Pigeon Grey');
});

test('rowsToHtml escapes values', () => {
  const html = rowsToHtml([['Issue', 'Item'], ['<b>x</b>', 'A & B']]);
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(html.includes('A &amp; B'));
});

test('Brevo payload: tags, idempotency header, DRY_RUN redirect', async () => {
  const shop = { sender: { name: 'Falcon Enamelware', email: 'hello@falconenamelware.com' }, templates: { bis: 1, staff: 5 }, staff_email: 'staff@example.com' };
  const live = await buildBrevoPayload({ shop, store: 'uk', template: 'bis', to: { email: 'jane@example.com', name: 'Jane' }, params: { product_title: 'Mug' }, idempotencyKey: 'k1', dryRun: false });
  assert.equal(live.templateId, 1);
  assert.deepEqual(live.to, [{ email: 'jane@example.com', name: 'Jane' }]);
  assert.deepEqual(live.tags, ['falcon', 'uk', 'bis']);
  assert.equal(live.headers.idempotencyKey, await uuidV5('k1'));
  assert.equal(live.params.dry_run_banner, undefined);
  const dry = await buildBrevoPayload({ shop, store: 'uk', template: 'bis', to: { email: 'jane@example.com' }, params: {}, idempotencyKey: 'k1', dryRun: true });
  assert.equal(dry.to[0].email, 'staff@example.com');
  assert.match(dry.params.dry_run_banner, /jane@example\.com/);
});

// ---------------------------------------------------------------- end to end with mocked fetch
const SHOPS = {
  uk: {
    domain: 'falcon-uk.myshopify.com',
    storefront: 'https://www.falconenamelware.com',
    sender: { name: 'Falcon Enamelware', email: 'hello@falconenamelware.com' },
    templates: { bis: 1, delay_uk: 2, delay_us_notice: 3, delay_us_consent: 4, staff: 5 },
    staff_email: 'staff@example.com',
    withdrawal_url: null,
  },
};
const makeEnv = () => ({
  SHOPS: JSON.stringify(SHOPS),
  ADMIN_TOKEN_UK: 'shpat_test',
  BREVO_API_KEY: 'brevo',
  TURNSTILE_SECRET: 'ts',
  FLOW_KEY: 'flow-key',
  LINK_SECRET: SECRET,
  API_VERSION: '2026-07',
  DRY_RUN: 'false',
  WORKER_URL: 'https://falcon-stock.example.workers.dev',
});

/** Mock fetch: routes GraphQL by operation name; records every call. */
function installFetch(handlers) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://challenges.cloudflare.com/')) {
      calls.push({ kind: 'turnstile' });
      return Response.json({ success: true, action: 'restock-subscribe', hostname: 'www.falconenamelware.com' });
    }
    if (u === 'https://api.brevo.com/v3/smtp/email') {
      const body = JSON.parse(init.body);
      calls.push({ kind: 'brevo', body });
      return Response.json({ messageId: '<m1@brevo>' }, { status: 201 });
    }
    if (u.includes('/admin/api/')) {
      assert.equal(u, 'https://falcon-uk.myshopify.com/admin/api/2026-07/graphql.json');
      assert.equal(init.headers['X-Shopify-Access-Token'], 'shpat_test');
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

describe('end to end', () => {
  let mock;
  let logs;
  let origLog;
  beforeEach(() => {
    logs = [];
    origLog = console.log;
    console.log = (line) => logs.push(line);
  });
  afterEach(() => {
    console.log = origLog;
    if (mock) mock.restore();
  });

  test('POST /subscribe happy path: new customer, tags, marketing consent', async () => {
    let throttledOnce = false;
    mock = installFetch({
      FalconVariant: (v) => {
        assert.equal(v.id, 'gid://shopify/ProductVariant/44012345678901');
        return { productVariant: { id: v.id, title: 'Pigeon Grey', price: '22.00', inventoryQuantity: 0, inventoryPolicy: 'DENY', inventoryItem: { tracked: true }, product: { id: 'gid://shopify/Product/9', title: 'Pie Dish', handle: 'pie-dish' } } };
      },
      FalconFindCustomer: (v) => {
        assert.equal(v.q, 'email:"jane@example.com"');
        return { customers: { nodes: [] } };
      },
      FalconCustomerCreate: (v) => {
        assert.deepEqual(v.input, { email: 'jane@example.com', tags: ['restock-request', 'restock-44012345678901'] });
        return { customerCreate: { customer: { id: 'gid://shopify/Customer/7', tags: ['restock-request', 'restock-44012345678901'], defaultEmailAddress: { emailAddress: 'jane@example.com', marketingState: 'NOT_SUBSCRIBED' } }, userErrors: [] } };
      },
      FalconTagsAdd: (v) => ({ tagsAdd: { node: { id: v.id }, userErrors: [] } }),
      FalconConsent: (v) => {
        assert.equal(v.input.customerId, 'gid://shopify/Customer/7');
        assert.equal(v.input.emailMarketingConsent.marketingState, 'SUBSCRIBED');
        assert.equal(v.input.emailMarketingConsent.marketingOptInLevel, 'SINGLE_OPT_IN');
        return { customerEmailMarketingConsentUpdate: { customer: { id: v.input.customerId }, userErrors: [] } };
      },
    });
    // Preflight
    const pre = await worker.fetch(new Request('https://w.example/subscribe', { method: 'OPTIONS', headers: { Origin: 'https://www.falconenamelware.com', 'Access-Control-Request-Method': 'POST' } }), makeEnv(), {});
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('Access-Control-Allow-Origin'), 'https://www.falconenamelware.com');
    const badPre = await worker.fetch(new Request('https://w.example/subscribe', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), makeEnv(), {});
    assert.equal(badPre.status, 403);

    const res = await worker.fetch(
      new Request('https://w.example/subscribe', {
        method: 'POST',
        headers: { Origin: 'https://www.falconenamelware.com', 'content-type': 'application/json' },
        body: JSON.stringify({ store: 'uk', variant_id: '44012345678901', email: 'jane@example.com', marketing: true, turnstile_token: 'tok' }),
      }),
      makeEnv(),
      {},
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://www.falconenamelware.com');
    const ops = mock.calls.map((c) => c.op || c.kind);
    assert.deepEqual(ops, ['turnstile', 'FalconVariant', 'FalconFindCustomer', 'FalconCustomerCreate', 'FalconTagsAdd', 'FalconConsent']);
    const tagCall = mock.calls.find((c) => c.op === 'FalconTagsAdd');
    assert.deepEqual(tagCall.variables.tags, ['restock-request', 'restock-44012345678901']);
    assert.ok(logs.some((l) => l.includes('"event":"subscribed"')), 'structured log line');
    assert.ok(!logs.some((l) => l.includes('jane@example.com')), 'full email never logged');
  });

  test('POST /subscribe rejects wrong origin and bad input', async () => {
    mock = installFetch({ FalconVariant: () => ({ productVariant: null }) });
    const send = (origin, body) =>
      worker.fetch(new Request('https://w.example/subscribe', { method: 'POST', headers: { Origin: origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }), makeEnv(), {});
    const good = { store: 'uk', variant_id: '1', email: 'jane@example.com', marketing: false, turnstile_token: 'tok' };
    assert.equal((await send('https://us.falconenamelware.com', good)).status, 403);
    assert.deepEqual(await (await send('https://www.falconenamelware.com', { ...good, email: 'nope' })).json(), { ok: false, error: 'invalid_email' });
    assert.deepEqual(await (await send('https://www.falconenamelware.com', { ...good, variant_id: 'abc' })).json(), { ok: false, error: 'unknown_variant' });
    assert.deepEqual(await (await send('https://www.falconenamelware.com', good)).json(), { ok: false, error: 'unknown_variant' });
  });

  test('POST /hooks/order: tags, partial hold of preorder lines only, cap reached sets DENY', async () => {
    const orderGid = 'gid://shopify/Order/5001';
    mock = installFetch({
      FalconOrder: (v) => {
        assert.equal(v.id, orderGid);
        return {
          order: {
            id: orderGid,
            name: '#UK1001',
            createdAt: '2026-09-23T09:00:00Z',
            tags: [],
            email: 'jane@example.com',
            cancelledAt: null,
            closed: false,
            lineItems: {
              nodes: [
                { id: 'gid://shopify/LineItem/1', quantity: 2, unfulfilledQuantity: 2, variant: { id: 'gid://shopify/ProductVariant/111' }, customAttributes: [{ key: '_preorder_date', value: '2026-11-12' }] },
                { id: 'gid://shopify/LineItem/2', quantity: 1, unfulfilledQuantity: 1, variant: { id: 'gid://shopify/ProductVariant/222' }, customAttributes: [] },
              ],
            },
            fulfillmentOrders: {
              nodes: [
                {
                  id: 'gid://shopify/FulfillmentOrder/9001',
                  status: 'OPEN',
                  fulfillmentHolds: [],
                  lineItems: {
                    nodes: [
                      { id: 'gid://shopify/FulfillmentOrderLineItem/1', remainingQuantity: 2, totalQuantity: 2, lineItem: { id: 'gid://shopify/LineItem/1', variant: { id: 'gid://shopify/ProductVariant/111' } } },
                      { id: 'gid://shopify/FulfillmentOrderLineItem/2', remainingQuantity: 1, totalQuantity: 1, lineItem: { id: 'gid://shopify/LineItem/2', variant: { id: 'gid://shopify/ProductVariant/222' } } },
                    ],
                  },
                },
              ],
            },
          },
        };
      },
      FalconTagsAdd: (v) => ({ tagsAdd: { node: { id: v.id }, userErrors: [] } }),
      FalconHold: (v) => ({ fulfillmentOrderHold: { fulfillmentHold: { id: 'gid://shopify/FulfillmentHold/1', handle: 'falcon-preorder' }, fulfillmentOrder: { id: v.id, status: 'ON_HOLD' }, remainingFulfillmentOrder: { id: 'gid://shopify/FulfillmentOrder/9002' }, userErrors: [] } }),
      FalconVariant: (v) => ({
        productVariant: {
          id: v.id,
          title: 'Pigeon Grey',
          price: '22.00',
          inventoryQuantity: -10,
          inventoryPolicy: 'CONTINUE',
          inventoryItem: { tracked: true },
          product: { id: 'gid://shopify/Product/9', title: 'Pie Dish', handle: 'pie-dish' },
          expectedDate: { value: '2026-11-12' },
          preorderLimit: { value: '10' },
        },
      }),
      FalconVariantPolicy: (v) => ({ productVariantsBulkUpdate: { productVariants: v.variants, userErrors: [] } }),
    });

    const env = makeEnv();
    const unauth = await worker.fetch(new Request('https://w.example/hooks/order', { method: 'POST', headers: { 'X-Falcon-Key': 'wrong' }, body: JSON.stringify({ store: 'uk', order_id: orderGid }) }), env, {});
    assert.equal(unauth.status, 401);
    assert.equal(mock.calls.length, 0);

    const res = await worker.fetch(new Request('https://w.example/hooks/order', { method: 'POST', headers: { 'X-Falcon-Key': 'flow-key', 'content-type': 'application/json' }, body: JSON.stringify({ store: 'uk', order_id: orderGid }) }), env, {});
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);

    const gql = mock.calls.filter((c) => c.kind === 'gql');
    assert.deepEqual(gql.map((c) => c.op), ['FalconOrder', 'FalconTagsAdd', 'FalconHold', 'FalconVariant', 'FalconVariantPolicy', 'FalconTagsAdd']);
    assert.deepEqual(gql[1].variables, { id: orderGid, tags: ['preorder-v111'] });
    const hold = gql[2].variables;
    assert.equal(hold.id, 'gid://shopify/FulfillmentOrder/9001');
    assert.equal(hold.fulfillmentHold.reason, 'OTHER');
    assert.equal(hold.fulfillmentHold.handle, 'falcon-preorder');
    assert.equal(hold.fulfillmentHold.reasonNotes, 'Pre-order, expected 12 November 2026');
    assert.deepEqual(hold.fulfillmentHold.fulfillmentOrderLineItems, [{ id: 'gid://shopify/FulfillmentOrderLineItem/1', quantity: 2 }], 'only the preorder line is held');
    assert.deepEqual(gql[4].variables, { productId: 'gid://shopify/Product/9', variants: [{ id: 'gid://shopify/ProductVariant/111', inventoryPolicy: 'DENY' }] });
    assert.deepEqual(gql[5].variables.tags, ['preorder'], 'idempotency tag last');
    assert.equal(mock.calls.filter((c) => c.kind === 'brevo').length, 0, 'at the cap (not over): no staff alert');
    assert.ok(logs.some((l) => l.includes('"event":"mutation_ok"') && l.includes('fulfillmentOrderHold')));
  });

  test('POST /hooks/order is idempotent when already tagged preorder', async () => {
    mock = installFetch({
      FalconOrder: (v) => ({ order: { id: v.id, name: '#UK1001', tags: ['preorder', 'preorder-v111'], lineItems: { nodes: [] }, fulfillmentOrders: { nodes: [] } } }),
    });
    const res = await worker.fetch(new Request('https://w.example/hooks/order', { method: 'POST', headers: { 'X-Falcon-Key': 'flow-key' }, body: JSON.stringify({ store: 'uk', order_id: '5001' }) }), makeEnv(), {});
    assert.deepEqual(await res.json(), { ok: true, skipped: 'already_processed' });
    assert.deepEqual(mock.calls.map((c) => c.op), ['FalconOrder']);
  });

  test('GET /c never changes state; POST /c tags and alerts staff', async () => {
    const orderGid = 'gid://shopify/Order/5001';
    mock = installFetch({
      FalconOrder: (v) => ({ order: { id: v.id, name: '#UK1001', tags: ['preorder', 'preorder-v111', 'preorder-delay-v111-1'], cancelledAt: null, lineItems: { nodes: [] }, fulfillmentOrders: { nodes: [] } } }),
      FalconTagsAdd: (v) => ({ tagsAdd: { node: { id: v.id }, userErrors: [] } }),
      FalconVariant: (v) => ({ productVariant: { id: v.id, title: 'Pigeon Grey', product: { id: 'gid://shopify/Product/9', title: 'Pie Dish' } } }),
    });
    const t = await signToken({ s: 'uk', a: 'c', o: '5001', v: '111', n: 1 }, SECRET);
    const get = await worker.fetch(new Request(`https://w.example/c?t=${encodeURIComponent(t)}`), makeEnv(), {});
    assert.equal(get.status, 200);
    const html = await get.text();
    assert.match(html, /Cancel this pre-order/);
    assert.match(html, /#243588/);
    assert.ok(!mock.calls.some((c) => c.op === 'FalconTagsAdd'), 'GET made no mutation');

    const form = new FormData();
    form.append('t', t);
    const post = await worker.fetch(new Request('https://w.example/c', { method: 'POST', body: form }), makeEnv(), {});
    assert.equal(post.status, 200);
    const tagCall = mock.calls.find((c) => c.op === 'FalconTagsAdd');
    assert.equal(tagCall.variables.id, orderGid);
    assert.equal(tagCall.variables.tags[0], 'preorder-cancel-requested');
    assert.equal(tagCall.variables.tags[1], 'preorder-cancel-requested-v111');
    assert.match(tagCall.variables.tags[2], /^preorder-cancel-requested-v111-on-\d{4}-\d{2}-\d{2}$/);
    const mail = mock.calls.find((c) => c.kind === 'brevo');
    assert.equal(mail.body.templateId, 5);
    assert.equal(mail.body.to[0].email, 'staff@example.com');
    assert.match(mail.body.params.subject, /Cancel request: #UK1001/);

    // A /u token must not work on /c
    const u = await signToken({ s: 'uk', a: 'u', c: '7' }, SECRET);
    const wrong = await worker.fetch(new Request(`https://w.example/c?t=${encodeURIComponent(u)}`), makeEnv(), {});
    assert.equal(wrong.status, 400);
  });
});
