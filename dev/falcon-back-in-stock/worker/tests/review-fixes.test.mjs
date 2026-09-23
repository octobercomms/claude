// Regression tests for defects found in review. Run with the rest:
//   node --test dev/falcon-back-in-stock/worker/tests/
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import worker, {
  runtime,
  signToken,
  isDryRun,
  buildBrevoPayload,
  uuidV5,
  keepByPassed,
  checkConsentDeadlines,
  processDateChange,
  fanOutWaitlist,
  changeMarker,
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
const makeEnv = (extra = {}) => ({
  SHOPS: JSON.stringify({ uk: SHOP, us: { ...SHOP, domain: 'falcon-us.myshopify.com', storefront: 'https://us.falconenamelware.com' } }),
  ADMIN_TOKEN_UK: 'shpat_test',
  ADMIN_TOKEN_US: 'shpat_test',
  BREVO_API_KEY: 'brevo',
  FLOW_KEY: 'flow-key',
  LINK_SECRET: SECRET,
  API_VERSION: '2026-07',
  DRY_RUN: 'false',
  WORKER_URL: 'https://falcon-stock.example.workers.dev',
  ...extra,
});
const makeCtx = (store = 'uk', { today = '2026-09-23', dryRun = false } = {}) => ({
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

/** Mock fetch: GraphQL routed by operation name; Brevo and Turnstile recorded. */
function installFetch(handlers) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
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

describe('DRY_RUN safety', () => {
  test('DRY_RUN parsing is forgiving about spelling, so it never fails open', () => {
    for (const v of ['true', 'TRUE', ' true ', '1', 'yes', 'on']) assert.equal(isDryRun({ DRY_RUN: v }), true, v);
    for (const v of ['false', '', '0', 'no', undefined]) assert.equal(isDryRun({ DRY_RUN: v }), false, String(v));
  });

  test('dry-run sends use their own idempotency key, so the real send later is not dropped as a duplicate', async () => {
    const args = { shop: SHOP, store: 'uk', template: 'bis', to: { email: 'jane@example.com' }, params: {}, idempotencyKey: 'bis|uk|1|2|2026-09-23' };
    const dry = await buildBrevoPayload({ ...args, dryRun: true });
    const live = await buildBrevoPayload({ ...args, dryRun: false });
    assert.notEqual(dry.headers.idempotencyKey, live.headers.idempotencyKey);
    assert.equal(live.headers.idempotencyKey, await uuidV5('bis|uk|1|2|2026-09-23'));
    // Staff mail is unaffected by DRY_RUN.
    const staff = await buildBrevoPayload({ ...args, template: 'staff', dryRun: true });
    assert.equal(staff.headers.idempotencyKey, live.headers.idempotencyKey);
  });

  test('dry run without staff_email fails closed instead of emailing anyone else', async () => {
    const shop = { ...SHOP, staff_email: '' };
    await assert.rejects(buildBrevoPayload({ shop, store: 'uk', template: 'bis', to: { email: 'jane@example.com' }, params: {}, idempotencyKey: 'k', dryRun: true }));
  });

  test('POST on a link from a dry-run email changes nothing', async () => {
    mock = installFetch({});
    const t = await signToken({ s: 'uk', a: 'c', o: '5001', v: '111', n: 1, d: 1 }, SECRET);
    const form = new FormData();
    form.append('t', t);
    const res = await worker.fetch(new Request('https://w.example/c', { method: 'POST', body: form }), makeEnv(), {});
    assert.equal(res.status, 200);
    assert.match(await res.text(), /nothing changed/i);
    assert.equal(mock.calls.length, 0, 'no Shopify or Brevo call');
  });

  test('links in dry-run emails carry the dry-run flag', async () => {
    mock = installFetch({
      FalconCustomersByTag: () => ({ customers: { pageInfo: { hasNextPage: false }, nodes: [{ id: 'gid://shopify/Customer/7', firstName: 'Jane', tags: ['restock-111'], defaultEmailAddress: { emailAddress: 'jane@example.com' } }] } }),
      FalconShop: () => ({ shop: { currencyCode: 'GBP' } }),
      FalconCustomer: (v) => ({ customer: { id: v.id, firstName: 'Jane', tags: ['restock-111'], defaultEmailAddress: { emailAddress: 'jane@example.com' } } }),
    });
    const ctx = makeCtx('uk', { dryRun: true });
    const variant = { id: '111', qty: 3, title: 'Grey', productTitle: 'Pie Dish', handle: 'pie-dish', price: '22.00', productStatus: 'ACTIVE' };
    const stats = await fanOutWaitlist(ctx, variant, { emails: 400, deadline: 0 });
    assert.equal(stats.sent, 1);
    const mail = mock.calls.find((c) => c.kind === 'brevo');
    assert.equal(mail.body.to[0].email, 'staff@example.com');
    const token = decodeURIComponent(mail.body.params.remove_url.split('t=')[1]);
    const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
    assert.equal(payload.d, 1);
    assert.ok(!mock.calls.some((c) => c.op === 'FalconWaitlistDone'), 'waitlist tags kept in dry run');
  });
});

describe('US keep-by deadline', () => {
  test('the deadline day counts in US time: passed only after the following UTC day', () => {
    assert.equal(keepByPassed('2026-11-12', '2026-11-12'), false);
    assert.equal(keepByPassed('2026-11-12', '2026-11-13'), false, 'still Nov 12 in California');
    assert.equal(keepByPassed('2026-11-12', '2026-11-14'), true);
    assert.equal(keepByPassed('', '2026-11-14'), false);
  });

  test('daily job does not flag an order the UTC day after the deadline', async () => {
    mock = installFetch({ FalconTagsAdd: (v) => ({ tagsAdd: { node: { id: v.id }, userErrors: [] } }) });
    const order = { id: 'gid://shopify/Order/1', name: '#US1', tags: ['preorder', 'preorder-v111', 'preorder-delay-v111-2', 'preorder-keep-by-v111-2026-11-12'] };
    const rows = [];
    await checkConsentDeadlines(makeCtx('us', { today: '2026-11-13' }), [order], rows);
    assert.equal(rows.length, 0);
    await checkConsentDeadlines(makeCtx('us', { today: '2026-11-14' }), [order], rows);
    assert.equal(rows.length, 1);
    assert.deepEqual(mock.calls.find((c) => c.op === 'FalconTagsAdd').variables.tags, ['preorder-cancel-due-v111']);
  });

  test('an order whose pre-order lines were all released is not flagged for cancellation', async () => {
    mock = installFetch({});
    const order = { id: 'gid://shopify/Order/1', name: '#US1', tags: ['preorder', 'preorder-v111', 'preorder-released-v111', 'preorder-delay-v111-2', 'preorder-keep-by-v111-2026-11-12'] };
    const rows = [];
    await checkConsentDeadlines(makeCtx('us', { today: '2026-11-20' }), [order], rows);
    assert.equal(rows.length, 0);
    assert.equal(mock.calls.length, 0);
  });

  test('/k still works on the UTC day after the deadline', async () => {
    const fixed = Date.UTC(2026, 10, 13, 5, 0, 0); // 13 Nov 05:00 UTC = 12 Nov evening in the US
    const realNow = runtime.now;
    runtime.now = () => fixed;
    try {
      mock = installFetch({
        FalconOrder: (v) => ({ order: { id: v.id, name: '#US1', tags: ['preorder', 'preorder-v111', 'preorder-delay-v111-2', 'preorder-keep-by-v111-2026-11-12'], cancelledAt: null, lineItems: { nodes: [] }, fulfillmentOrders: { nodes: [] } } }),
      });
      const t = await signToken({ s: 'us', a: 'k', o: '1', v: '111', n: 2 }, SECRET, { nowMs: fixed });
      const res = await worker.fetch(new Request(`https://w.example/k?t=${encodeURIComponent(t)}`), makeEnv(), {});
      assert.match(await res.text(), /Keep my order/);
    } finally {
      runtime.now = realNow;
    }
  });
});

describe('date-change job', () => {
  const baseVariant = {
    gid: 'gid://shopify/ProductVariant/111',
    id: '111',
    title: 'Grey',
    productTitle: 'Pie Dish',
    delayReason: 'The ship was late.',
    delayCount: 1,
  };
  const order = (id, tags, promised, email = 'jane@example.com') => ({
    id: `gid://shopify/Order/${id}`,
    name: `#UK${id}`,
    tags: ['preorder', 'preorder-v111', ...tags],
    email,
    statusPageUrl: 'https://x',
    customer: { firstName: 'Jane' },
    lineItems: { nodes: [{ id: `gid://shopify/LineItem/${id}`, quantity: 1, unfulfilledQuantity: 1, variantTitle: 'Grey', variant: { id: 'gid://shopify/ProductVariant/111' }, product: { title: 'Pie Dish' }, customAttributes: [{ key: '_preorder_date', value: promised }] }] },
  });
  const handlers = () => ({
    FalconTagsAdd: (v) => ({ tagsAdd: { node: { id: v.id }, userErrors: [] } }),
    FalconMetafieldsSet: (v) => ({ metafieldsSet: { metafields: v.metafields, userErrors: [] } }),
    FalconMetafieldsDelete: () => ({ metafieldsDelete: { deletedMetafields: [], userErrors: [] } }),
  });

  test('a customer told an earlier date is emailed when the date moves back to their checkout date', async () => {
    mock = installFetch(handlers());
    // Ordered at 2026-11-12, then told 2026-11-01 (earlier), now back to 2026-11-12.
    const told = order(1, [changeMarker('111', 1, '2026-11-12', '2026-11-01')], '2026-11-12');
    const neverTold = order(2, [], '2026-11-12');
    const v = { ...baseVariant, notifiedDate: '2026-11-01', expectedDate: '2026-11-12' };
    const rows = [];
    const r = await processDateChange(makeCtx('uk'), v, rows, [told, neverTold]);
    const mails = mock.calls.filter((c) => c.kind === 'brevo');
    assert.equal(mails.length, 1, 'only the customer who was told another date');
    assert.equal(mails[0].body.params.order_name, '#UK1');
    assert.equal(mails[0].body.params.old_date, '1 November 2026');
    assert.equal(mails[0].body.params.earlier, false);
    const tags = mock.calls.find((c) => c.op === 'FalconTagsAdd').variables.tags;
    assert.ok(tags.includes(changeMarker('111', 1, '2026-11-01', '2026-11-12')));
    assert.ok(tags.includes('preorder-delay-v111-1'));
    assert.equal(r.failures, 0);
  });

  test('old date in the email is the checkout date for a customer never told anything else', async () => {
    mock = installFetch(handlers());
    const v = { ...baseVariant, notifiedDate: '2026-11-01', expectedDate: '2026-12-01' };
    await processDateChange(makeCtx('uk'), v, [], [order(3, [], '2026-11-12')]);
    const mail = mock.calls.find((c) => c.kind === 'brevo');
    assert.equal(mail.body.params.old_date, '12 November 2026');
  });

  test('a customer with no email is flagged but does not block notified_date for ever', async () => {
    mock = installFetch(handlers());
    const v = { ...baseVariant, notifiedDate: '2026-11-12', expectedDate: '2026-12-01' };
    const rows = [];
    const r = await processDateChange(makeCtx('uk'), v, rows, [order(4, [], '2026-11-12', null), order(5, [], '2026-11-12')]);
    assert.equal(r.failures, 0);
    assert.ok(rows.some((row) => row[0] === 'Pre-order customer has no email'));
    const set = mock.calls.find((c) => c.op === 'FalconMetafieldsSet');
    assert.ok(set, 'notified_date updated');
    assert.equal(set.variables.metafields[0].value, '2026-12-01');
  });

  test('the change marker includes the old date, so a move back to a date seen before is not skipped', () => {
    assert.notEqual(changeMarker('111', 1, '2026-11-01', '2026-11-05'), changeMarker('111', 1, '2026-10-20', '2026-11-05'));
  });
});

test('waitlist fan-out skips a draft or archived product and keeps everyone waiting', async () => {
  mock = installFetch({});
  const ctx = makeCtx('uk');
  const stats = await fanOutWaitlist(ctx, { id: '111', qty: 5, productStatus: 'DRAFT' }, { emails: 400, deadline: 0 });
  assert.equal(stats.sent, 0);
  assert.equal(mock.calls.length, 0);
});
