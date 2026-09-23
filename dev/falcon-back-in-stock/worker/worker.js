/**
 * Falcon stock Worker (`falcon-stock`): back-in-stock waitlist + preorder holds.
 *
 * Spec: docs/falcon-back-in-stock/ARCHITECTURE.md section 6.
 * One self-contained ES module, no imports, pasteable into the Cloudflare
 * dashboard editor. `export default { fetch, scheduled }` is the Worker; the
 * named exports are pure helpers used by tests/worker.test.mjs (Cloudflare
 * ignores them).
 *
 * Safety rules this file follows:
 *  - Never cancels or refunds anything. Cancellation is always a staff action.
 *  - Never emails a customer twice for the same event: Shopify tags are the
 *    record of what was sent, and every Brevo call carries a deterministic
 *    idempotency key (UUID v5) as a second line of defence.
 *  - Every mutation checks userErrors and logs the outcome.
 *  - GET requests never change state (email scanners prefetch links).
 *
 * `// VERIFY:` marks Admin API fields or behaviour to confirm on API 2026-07.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const HOLD_HANDLE = 'falcon-preorder';
export const DEFAULT_API_VERSION = '2026-07';
export const TOKEN_TTL_DAYS = 120;
export const FANOUT_MAX_PER_INVOCATION = 400;
export const DRY_RUN_MAX_PER_BATCH = 5;
/** Total time for one /hooks/inventory run in waitUntil (Cloudflare allows 30 s after the response). */
export const INVENTORY_BUDGET_MS = 25000;
const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_ACTION = 'restock-subscribe';
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const BRAND_NAVY = '#243588';
const STORES = ['uk', 'us', 'eu'];
/** Namespace for the Brevo idempotency UUIDs (fixed, random). */
export const FALCON_UUID_NAMESPACE = '3f6c2a1e-8b4d-4e5f-9a7c-1d2e3f4a5b6c';

/** Test hooks: tests replace sleep/now so retries do not wait for real. */
export const runtime = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

// ---------------------------------------------------------------------------
// Pure helpers: ids, tags, dates, validation
// ---------------------------------------------------------------------------

/** Numeric id from a GID or a number/string. Returns '' if none. */
export function numericId(value) {
  if (value === null || value === undefined) return '';
  const s = String(value).trim();
  const m = s.match(/(\d+)(?:\?.*)?$/);
  return m ? m[1] : '';
}

export function toGid(type, value) {
  const id = numericId(value);
  return id ? `gid://shopify/${type}/${id}` : '';
}

/** Tags come back from GraphQL as an array; Flow/REST use a comma string. */
export function parseTags(tags) {
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof tags === 'string') return tags.split(',').map((t) => t.trim()).filter(Boolean);
  return [];
}

/**
 * Exact tag match. Shopify tag search may tokenise hyphenated tags, so
 * `tag:'restock-123'` can also return `restock-1234`; always re-check here.
 * Shopify tags are case-insensitive, so compare lower-cased.
 */
export function hasExactTag(tags, tag) {
  const want = String(tag).trim().toLowerCase();
  return parseTags(tags).some((t) => t.toLowerCase() === want);
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Variant id part of a per-variant tag pattern: the given id, or any id when omitted. */
function vidPattern(variantId) {
  return variantId === undefined || variantId === null || variantId === '' ? '\\d+' : escapeRe(numericId(variantId));
}

/**
 * Highest n among `preorder-delay-v{variantId}-{n}` tags (0 if none).
 * Delays are numbered per (order, variant): a delay to one item in an order
 * does not count as a delay to another item in the same order.
 */
export function maxDelayNumber(tags, variantId) {
  const re = new RegExp(`^preorder-delay-v${vidPattern(variantId)}-(\\d+)$`, 'i');
  let max = 0;
  for (const t of parseTags(tags)) {
    const m = t.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** Dates in the `preorder-keep-by-v{variantId}-{YYYY-MM-DD}` tags, sorted ascending. */
export function keepByDates(tags, variantId) {
  const re = new RegExp(`^preorder-keep-by-v${vidPattern(variantId)}-(\\d{4}-\\d{2}-\\d{2})$`, 'i');
  return parseTags(tags)
    .map((t) => t.match(re))
    .filter(Boolean)
    .map((m) => m[1])
    .sort();
}

/** Numeric variant ids from an order's `preorder-v{id}` tags. */
export function preorderVariantIdsFromTags(tags) {
  return [...new Set(parseTags(tags).map((t) => t.match(/^preorder-v(\d+)$/i)).filter(Boolean).map((m) => m[1]))];
}

/** Per-variant order tags (see ARCHITECTURE section 3). */
export const orderTags = {
  delay: (vid, n) => `preorder-delay-v${vid}-${n}`,
  kept: (vid, n) => `preorder-kept-v${vid}-${n}`,
  keepBy: (vid, date) => `preorder-keep-by-v${vid}-${date}`,
  cancelDue: (vid) => `preorder-cancel-due-v${vid}`,
  cancelRequested: (vid) => `preorder-cancel-requested-v${vid}`,
  cancelRequestedOn: (vid, date) => `preorder-cancel-requested-v${vid}-on-${date}`,
  oversold: (vid) => `oversold-v${vid}`,
};

/** Numeric variant ids from `restock-{id}` tags (not restock-request / restock-notified-*). */
export function restockVariantIds(tags) {
  return parseTags(tags)
    .map((t) => t.match(/^restock-(\d+)$/i))
    .filter(Boolean)
    .map((m) => m[1]);
}

export function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Today's date in UTC as YYYY-MM-DD. */
export function todayUtc(nowMs = runtime.now()) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Add working days (Mon-Fri). Public holidays are not counted: staff get a slightly early deadline, which is the safe side. */
export function addWorkingDays(iso, days) {
  let cur = iso;
  let left = days;
  while (left > 0) {
    cur = addDays(cur, 1);
    const [y, m, d] = cur.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return cur;
}

/** Whole days from a to b (b - a). */
export function daysBetween(a, b) {
  const pa = a.split('-').map(Number);
  const pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** uk/eu: `12 November 2026`; us: `November 12, 2026`. Input is a UTC date string. */
export function formatDate(iso, store) {
  if (!isIsoDate(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return store === 'us' ? `${MONTHS[m - 1]} ${d}, ${y}` : `${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * Pragmatic email check: one @, no spaces, sane lengths, domain with a dot
 * and a letter TLD. Deliberately excludes quotes and backslashes so the
 * address can be placed inside a Shopify search query safely.
 */
export function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const e = email.trim();
  if (e.length < 6 || e.length > 254) return false;
  const m = e.match(/^([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+)@([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)$/);
  if (!m) return false;
  const [, local, domain] = m;
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  const tld = domain.split('.').pop();
  return /^[A-Za-z]{2,63}$/.test(tld);
}

export function maskEmail(email) {
  if (typeof email !== 'string' || !email.includes('@')) return '';
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

export function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Constant-time string compare (for X-Falcon-Key). Length leaks only via the loop bound on the longer input. */
export function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(String(a === null || a === undefined ? '' : a));
  const y = enc.encode(String(b === null || b === undefined ? '' : b));
  const len = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i++) diff |= (x[i] | 0) ^ (y[i] | 0);
  return diff === 0;
}

/** Variant title for emails: never "Default Title". */
export function cleanVariantTitle(title) {
  const t = String(title || '').trim();
  return t.toLowerCase() === 'default title' ? '' : t;
}

// ---------------------------------------------------------------------------
// Pure business rules
// ---------------------------------------------------------------------------

/**
 * Mirror of the theme rule in theme/snippets/falcon-variant-data.liquid and
 * ARCHITECTURE section 3. Returns { state: in_stock|preorder|notify, max_qty }.
 * Input uses the Liquid names: inventory_management ('shopify' or null),
 * inventory_policy ('continue'|'deny', any case), inventory_quantity,
 * available, expected_date (ISO), preorder_limit.
 */
export function variantPreorderState(v, today = todayUtc()) {
  const tracked = v.inventory_management === 'shopify' || v.tracked === true;
  const qty = Number(v.inventory_quantity) || 0;
  const available = v.available !== false;
  const policy = String(v.inventory_policy || '').toLowerCase();
  if (!tracked) return { state: available ? 'in_stock' : 'notify', max_qty: null };
  if (qty > 0) return available ? { state: 'in_stock', max_qty: qty } : { state: 'notify', max_qty: null };
  if (policy === 'continue') {
    const date = isIsoDate(v.expected_date) ? v.expected_date : '';
    const limit = parseInt(v.preorder_limit, 10) || 0;
    if (date && date >= today && limit > 0 && -qty < limit) {
      return { state: 'preorder', max_qty: limit + qty };
    }
  }
  return { state: 'notify', max_qty: null };
}

/**
 * Which date-change email an order gets.
 * Input: { store, old_date, new_date, delay_count_before, has_definite_date, today }.
 * Output: { template, earlier, keep_by_date? }.
 *
 * LEGAL REVIEW NEEDED: the US branch implements our reading of the FTC Mail,
 * Internet, or Telephone Order Merchandise Rule (16 CFR 435.2(b),(c)):
 * first delay of <= 30 days with a definite date = option notice where silence
 * is consent; any renewed delay, a first delay > 30 days, or no definite date
 * = express consent required. The keep_by_date rule
 * (max(old_date, today + 7 days)) is a business choice to give the customer a
 * fair window; counsel must confirm it satisfies "before the current
 * deadline" in 435.2(c). delay_count_before is counted per order, not per
 * variant (an order placed after a delay has not itself been delayed).
 */
export function classifyDelay({ store, old_date, new_date, delay_count_before = 0, has_definite_date = true, today = todayUtc() }) {
  const definite = has_definite_date !== false && isIsoDate(new_date);
  const earlier = !!(definite && isIsoDate(old_date) && new_date < old_date);
  if (store === 'uk' || store === 'eu') return { template: 'delay_uk', earlier };
  if (store !== 'us') throw new Error(`classifyDelay: unknown store ${store}`);
  if (earlier) return { template: 'delay_us_notice', earlier: true };
  if (definite && Number(delay_count_before) === 0 && isIsoDate(old_date) && new_date <= addDays(old_date, 30)) {
    return { template: 'delay_us_notice', earlier: false };
  }
  // LEGAL REVIEW NEEDED: deadline rule, see comment above.
  const minKeepBy = addDays(today, 7);
  const keep_by_date = isIsoDate(old_date) && old_date > minKeepBy ? old_date : minKeepBy;
  return { template: 'delay_us_consent', earlier: false, keep_by_date };
}

/**
 * Oldest-first release. heldOrders: [{ id, createdAt, units }].
 * Releases whole orders only, in createdAt order, while the running total
 * stays <= stockForPreorders. Stops at the first order that does not fit
 * (strict first come, first served: a later small order never jumps an
 * earlier large one).
 */
export function allocateReleases(heldOrders, stockForPreorders) {
  const stock = Number(stockForPreorders) || 0;
  const sorted = [...heldOrders].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const out = [];
  let cumulative = 0;
  for (const o of sorted) {
    const units = Number(o.units) || 0;
    if (units <= 0) continue;
    if (cumulative + units > stock) break;
    cumulative += units;
    out.push(o);
  }
  return out;
}

/** Preorder lines of an order: those carrying a `_preorder_date` custom attribute. */
export function preorderLinesFromOrder(order) {
  const nodes = (order && order.lineItems && order.lineItems.nodes) || [];
  const out = [];
  for (const li of nodes) {
    const attrs = li.customAttributes || [];
    const attr = attrs.find((a) => a && a.key === '_preorder_date');
    if (!attr || !li.variant || !li.variant.id) continue;
    out.push({
      lineItemId: li.id,
      variantId: numericId(li.variant.id),
      date: String(attr.value || '').trim(),
      quantity: Number(li.quantity) || 0,
      unfulfilledQuantity: li.unfulfilledQuantity === undefined ? Number(li.quantity) || 0 : Number(li.unfulfilledQuantity) || 0,
    });
  }
  return out;
}

/** Units of a line not yet fulfilled. */
function lineOpenQty(li) {
  return li.unfulfilledQuantity === undefined || li.unfulfilledQuantity === null ? Number(li.quantity) || 0 : Number(li.unfulfilledQuantity) || 0;
}

function hasPreorderProperty(li) {
  return (li.customAttributes || []).some((a) => a && a.key === '_preorder_date');
}

/**
 * Cheap pre-check for /hooks/order: false when no line carries
 * `_preorder_date` and no line's variant is at or below zero (a normal order).
 * Untracked variants are ignored (their quantity means nothing).
 */
export function orderNeedsPreorderCheck(order) {
  const nodes = (order && order.lineItems && order.lineItems.nodes) || [];
  return nodes.some((li) => {
    if (hasPreorderProperty(li)) return true;
    const v = li.variant;
    if (!v || v.inventoryQuantity === undefined || v.inventoryQuantity === null) return false;
    if (v.inventoryItem && v.inventoryItem.tracked === false) return false;
    return Number(v.inventoryQuantity) <= 0;
  });
}

/**
 * Unlabelled oversell: lines WITHOUT `_preorder_date` whose variant is now
 * below zero. The theme caps quantity per add only, so a customer (or another
 * sales channel) can take an in-stock variant into negative stock without the
 * preorder label. The units below zero that this order is responsible for
 * are treated as preorder units. This order's labelled units for the variant
 * are counted as below zero first, and never more than -inventoryQuantity.
 * Untracked variants are skipped. Returns
 * [{ variantId, units, qty, policy, lines: [{ lineItemId, holdQty }] }].
 */
export function unlabelledOversell(order) {
  const nodes = (order && order.lineItems && order.lineItems.nodes) || [];
  const byVariant = new Map();
  for (const li of nodes) {
    const v = li.variant;
    if (!v || !v.id) continue;
    const vid = numericId(v.id);
    if (!byVariant.has(vid)) byVariant.set(vid, { variant: v, labelled: 0, unlabelled: [] });
    const entry = byVariant.get(vid);
    const open = lineOpenQty(li);
    if (hasPreorderProperty(li)) entry.labelled += open;
    else if (open > 0) entry.unlabelled.push({ lineItemId: li.id, open });
  }
  const out = [];
  for (const [variantId, { variant, labelled, unlabelled }] of byVariant) {
    if (!unlabelled.length) continue;
    if (variant.inventoryItem && variant.inventoryItem.tracked === false) continue;
    if (variant.inventoryQuantity === undefined || variant.inventoryQuantity === null) continue;
    const qty = Number(variant.inventoryQuantity);
    if (!(qty < 0)) continue;
    const unlabelledTotal = unlabelled.reduce((s, l) => s + l.open, 0);
    const units = Math.max(0, Math.min(unlabelledTotal, -qty - labelled));
    if (units <= 0) continue;
    let left = units;
    const lines = [];
    for (const l of unlabelled) {
      if (left <= 0) break;
      const holdQty = Math.min(l.open, left);
      lines.push({ lineItemId: l.lineItemId, holdQty });
      left -= holdQty;
    }
    out.push({ variantId, units, qty, policy: String(variant.inventoryPolicy || '').toUpperCase(), lines });
  }
  return out;
}

/**
 * Has a US keep-by deadline passed? The email says "by {date}" and US
 * customers read that in their own time zone, which is up to 10 hours behind
 * UTC. So the date counts as passed only once the whole following UTC day is
 * over: the /k link still works for them late on the deadline day, and the
 * daily job never flags an order while it is still the deadline day in the US.
 */
export function keepByPassed(keepBy, today) {
  return !!keepBy && isIsoDate(keepBy) && today > addDays(keepBy, 1);
}

/** Refund deadline for a cancellation request received on `today`. */
export function refundDeadline(store, today) {
  return store === 'us' ? addWorkingDays(today, 7) : addDays(today, 14);
}

// ---------------------------------------------------------------------------
// Base64url, HMAC tokens, UUID v5
// ---------------------------------------------------------------------------

function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('bad base64url');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret, usage) {
  if (!secret) throw new Error('LINK_SECRET not set');
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

/**
 * Link token: base64url(payload JSON) + '.' + base64url(HMAC-SHA256(secret, payload JSON)).
 * Payload keys: s store, a action (u|k|c), c customer id, o order id,
 * v variant id, n delay number, exp (unix seconds).
 */
export async function signToken(payload, secret, { nowMs = runtime.now(), ttlDays = TOKEN_TTL_DAYS } = {}) {
  const body = { ...payload };
  if (body.exp === undefined) body.exp = Math.floor(nowMs / 1000) + ttlDays * 86400;
  const json = JSON.stringify(body);
  const data = new TextEncoder().encode(json);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), data));
  return `${bytesToB64url(data)}.${bytesToB64url(sig)}`;
}

/** Returns the payload, or null if malformed, tampered or expired. */
export async function verifyToken(token, secret, { nowMs = runtime.now() } = {}) {
  try {
    if (typeof token !== 'string' || token.length > 4096) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const data = b64urlToBytes(parts[0]);
    const sig = b64urlToBytes(parts[1]);
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), sig, data);
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(data));
    if (!payload || typeof payload !== 'object') return null;
    if (!(Number(payload.exp) > Math.floor(nowMs / 1000))) return null;
    return payload;
  } catch {
    return null;
  }
}

function uuidToBytes(uuid) {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('bad uuid');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** RFC 4122 version 5 UUID (SHA-1 of namespace bytes + name). Deterministic. */
export async function uuidV5(name, namespace = FALCON_UUID_NAMESPACE) {
  const ns = uuidToBytes(namespace);
  const nb = new TextEncoder().encode(String(name));
  const buf = new Uint8Array(ns.length + nb.length);
  buf.set(ns);
  buf.set(nb, ns.length);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', buf)).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

/** One JSON line per action (Cloudflare → Worker → Logs). Never log full emails or secrets. */
export function log(event, fields = {}) {
  try {
    console.log(JSON.stringify({ ts: new Date(runtime.now()).toISOString(), event, ...fields }));
  } catch {
    console.log(`{"event":"${event}","note":"unserialisable fields"}`);
  }
}

// ---------------------------------------------------------------------------
// Config and context
// ---------------------------------------------------------------------------

export function getShops(env) {
  if (!env.__shops) {
    const raw = typeof env.SHOPS === 'string' ? env.SHOPS : JSON.stringify(env.SHOPS || {});
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('SHOPS is not valid JSON');
    }
    Object.defineProperty(env, '__shops', { value: parsed, enumerable: false, configurable: true });
  }
  return env.__shops;
}

/**
 * DRY_RUN is on for "true", "1", "yes" or "on" (any case, surrounding spaces
 * ignored), so a value typed slightly differently in the dashboard never
 * silently turns customer email on.
 */
export function isDryRun(env) {
  return ['true', '1', 'yes', 'on'].includes(String((env && env.DRY_RUN) || '').trim().toLowerCase());
}

function makeCtx(env, store, { baseUrl = '', waitUntil = null } = {}) {
  const shops = getShops(env);
  const shop = shops[store];
  if (!shop || !STORES.includes(store)) throw new Error(`unknown store ${store}`);
  const token = env[`ADMIN_TOKEN_${store.toUpperCase()}`];
  if (!token) throw new Error(`ADMIN_TOKEN_${store.toUpperCase()} not set`);
  return {
    env,
    store,
    shop,
    token,
    apiVersion: env.API_VERSION || DEFAULT_API_VERSION,
    dryRun: isDryRun(env),
    baseUrl: String(env.WORKER_URL || baseUrl || '').replace(/\/+$/, ''),
    today: todayUtc(),
    waitUntil,
    cache: {},
  };
}

/** Sign an email link. DRY_RUN links carry `d:1` and never change anything on POST. */
async function linkToken(ctx, payload) {
  return signToken(ctx.dryRun ? { ...payload, d: 1 } : payload, ctx.env.LINK_SECRET);
}

function linkUrl(ctx, path, token) {
  if (!ctx.baseUrl) throw new Error('WORKER_URL not set (needed for email links)');
  return `${ctx.baseUrl}${path}?t=${encodeURIComponent(token)}`;
}

function adminOrderUrl(ctx, orderGid) {
  const handle = String(ctx.shop.domain || '').split('.')[0];
  return `https://admin.shopify.com/store/${handle}/orders/${numericId(orderGid)}`;
}

// ---------------------------------------------------------------------------
// Shopify Admin GraphQL client
// ---------------------------------------------------------------------------

export class ShopifyError extends Error {}

/** One GraphQL call with retry on THROTTLED, 429 and 5xx. Returns `data`. */
export async function shopifyGraphQL(ctx, query, variables = {}) {
  const url = `https://${ctx.shop.domain}/admin/api/${ctx.apiVersion}/graphql.json`;
  const opName = (query.match(/(?:query|mutation)\s+(\w+)/) || [])[1] || 'anonymous';
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Shopify-Access-Token': ctx.token },
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      log('shopify_network_error', { store: ctx.store, op: opName, attempt, error: String(err) });
      if (attempt === maxAttempts) throw new ShopifyError(`network error on ${opName}`);
      await runtime.sleep(Math.min(8000, 500 * 2 ** attempt));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get('Retry-After')) || 0;
      log('shopify_retry', { store: ctx.store, op: opName, attempt, status: res.status });
      if (attempt === maxAttempts) throw new ShopifyError(`${opName} HTTP ${res.status}`);
      await runtime.sleep(Math.min(10000, retryAfter ? retryAfter * 1000 : 500 * 2 ** attempt));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      log('shopify_http_error', { store: ctx.store, op: opName, status: res.status, body: text.slice(0, 500) });
      throw new ShopifyError(`${opName} HTTP ${res.status}`);
    }
    const json = await res.json();
    const errors = json.errors || [];
    if (errors.length) {
      const throttled = errors.some((e) => e && e.extensions && e.extensions.code === 'THROTTLED');
      if (throttled && attempt < maxAttempts) {
        const cost = (json.extensions && json.extensions.cost) || {};
        const ts = cost.throttleStatus || {};
        let waitMs = 1000 * 2 ** (attempt - 1);
        if (ts.restoreRate && cost.requestedQueryCost) {
          waitMs = Math.ceil(((cost.requestedQueryCost - (ts.currentlyAvailable || 0)) / ts.restoreRate) * 1000) + 250;
        }
        waitMs = Math.max(250, Math.min(10000, waitMs));
        log('shopify_throttled', { store: ctx.store, op: opName, attempt, wait_ms: waitMs });
        await runtime.sleep(waitMs);
        continue;
      }
      log('shopify_graphql_error', { store: ctx.store, op: opName, errors: errors.map((e) => e.message).slice(0, 5) });
      throw new ShopifyError(`${opName}: ${errors.map((e) => e.message).join('; ')}`);
    }
    return json.data;
  }
  throw new ShopifyError(`${opName}: retries exhausted`);
}

/** Collect every userErrors array anywhere at the top level of a mutation response (handles aliases). */
function collectUserErrors(data) {
  const out = [];
  for (const value of Object.values(data || {})) {
    if (value && Array.isArray(value.userErrors)) out.push(...value.userErrors);
  }
  return out;
}

/** Run a mutation, check userErrors, log. Never throws on userErrors; returns { ok, data, userErrors }. */
export async function mutate(ctx, action, query, variables, logFields = {}) {
  let data;
  try {
    data = await shopifyGraphQL(ctx, query, variables);
  } catch (err) {
    log('mutation_failed', { store: ctx.store, action, ...logFields, error: String(err.message || err) });
    return { ok: false, data: null, userErrors: [{ message: String(err.message || err) }] };
  }
  const userErrors = collectUserErrors(data);
  const ok = userErrors.length === 0;
  log(ok ? 'mutation_ok' : 'mutation_user_errors', {
    store: ctx.store,
    action,
    ...logFields,
    ...(ok ? {} : { user_errors: userErrors.map((e) => `${(e.field || []).join('.')}: ${e.message}`).slice(0, 5) }),
  });
  return { ok, data, userErrors };
}

/** Cursor pagination. getConnection(data) returns { nodes, pageInfo }. */
export async function paginate(ctx, query, variables, getConnection, { maxPages = 200, maxItems = Infinity } = {}) {
  const out = [];
  let after = null;
  for (let page = 0; page < maxPages; page++) {
    const data = await shopifyGraphQL(ctx, query, { ...variables, after });
    const conn = getConnection(data) || { nodes: [], pageInfo: {} };
    out.push(...(conn.nodes || []));
    if (out.length >= maxItems) return out.slice(0, maxItems);
    if (!conn.pageInfo || !conn.pageInfo.hasNextPage) return out;
    after = conn.pageInfo.endCursor;
  }
  log('paginate_page_cap', { store: ctx.store, pages: maxPages });
  return out;
}

// ---------------------------------------------------------------------------
// GraphQL documents
// ---------------------------------------------------------------------------

// VERIFY: ProductVariant.media (variant image) and Product.featuredMedia.preview.image.url on 2026-07.
const VARIANT_FIELDS = `
  id title displayName price inventoryQuantity inventoryPolicy
  inventoryItem { tracked }
  media(first: 1) { nodes { preview { image { url } } } }
  product { id title handle status featuredMedia { preview { image { url } } } }
  expectedDate: metafield(namespace: "falcon", key: "expected_date") { value }
  preorderLimit: metafield(namespace: "falcon", key: "preorder_limit") { value }
  delayReason: metafield(namespace: "falcon", key: "delay_reason") { value }
  notifiedDate: metafield(namespace: "falcon", key: "notified_date") { value }
  delayCount: metafield(namespace: "falcon", key: "delay_count") { value }
`;

const Q_VARIANT = `query FalconVariant($id: ID!) { productVariant(id: $id) { ${VARIANT_FIELDS} } }`;
const Q_VARIANTS = `query FalconVariants($after: String) {
  productVariants(first: 40, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${VARIANT_FIELDS} } }
}`;
const Q_SHOP = `query FalconShop { shop { currencyCode } }`;

// VERIFY: Customer.defaultEmailAddress { emailAddress marketingState } (replaces the deprecated email/emailMarketingConsent fields).
const CUSTOMER_FIELDS = `id firstName tags defaultEmailAddress { emailAddress marketingState }`;
const Q_FIND_CUSTOMER = `query FalconFindCustomer($q: String!) { customers(first: 10, query: $q) { nodes { ${CUSTOMER_FIELDS} } } }`;
const Q_CUSTOMER = `query FalconCustomer($id: ID!) { customer(id: $id) { ${CUSTOMER_FIELDS} } }`;
const Q_CUSTOMERS_BY_TAG = `query FalconCustomersByTag($q: String!, $after: String) {
  customers(first: 100, after: $after, query: $q) { pageInfo { hasNextPage endCursor } nodes { ${CUSTOMER_FIELDS} } }
}`;

// VERIFY: LineItem.unfulfilledQuantity, Order.statusPageUrl, Order.email on 2026-07.
const ORDER_CORE = `
  id name createdAt tags email cancelledAt closed statusPageUrl
  customer { id firstName }
  lineItems(first: 30) { nodes { id quantity unfulfilledQuantity title variantTitle variant { id title inventoryQuantity inventoryPolicy inventoryItem { tracked } } product { title } customAttributes { key value } } }
`;
// VERIFY: FulfillmentHold.handle (added 2025-01) and FulfillmentOrderLineItem.lineItem.
const FO_FIELDS = `
  fulfillmentOrders(first: 10) { nodes {
    id status
    fulfillmentHolds { id handle reason }
    lineItems(first: 20) { nodes { id remainingQuantity totalQuantity lineItem { id variant { id } } } }
  } }
`;
const Q_ORDER = `query FalconOrder($id: ID!) { order(id: $id) { ${ORDER_CORE} ${FO_FIELDS} } }`;
const Q_ORDER_FOS = `query FalconOrderFulfillmentOrders($id: ID!) { order(id: $id) { id ${FO_FIELDS} } }`;
const Q_ORDERS = `query FalconOrders($q: String!, $after: String) {
  orders(first: 5, after: $after, query: $q, sortKey: CREATED_AT) { pageInfo { hasNextPage endCursor } nodes { ${ORDER_CORE} } }
}`;

const M_TAGS_ADD = `mutation FalconTagsAdd($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } } }`;
const M_TAGS_REMOVE = `mutation FalconTagsRemove($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { node { id } userErrors { field message } } }`;
// Add first, then remove: root mutation fields run in order. If the remove fails, the
// fan-out sees both tags next time and only finishes the clean-up (no second email).
const M_WAITLIST_DONE = `mutation FalconWaitlistDone($id: ID!, $add: [String!]!, $remove: [String!]!) {
  added: tagsAdd(id: $id, tags: $add) { node { id } userErrors { field message } }
  removed: tagsRemove(id: $id, tags: $remove) { node { id } userErrors { field message } }
}`;
// VERIFY: CustomerInput.email + tags on customerCreate (2026-07); no account invite is sent.
const M_CUSTOMER_CREATE = `mutation FalconCustomerCreate($input: CustomerInput!) {
  customerCreate(input: $input) { customer { ${CUSTOMER_FIELDS} } userErrors { field message } }
}`;
// VERIFY: CustomerEmailMarketingConsentUpdateInput { customerId, emailMarketingConsent { marketingState, marketingOptInLevel, consentUpdatedAt } }.
const M_CONSENT = `mutation FalconConsent($input: CustomerEmailMarketingConsentUpdateInput!) {
  customerEmailMarketingConsentUpdate(input: $input) { customer { id } userErrors { field message } }
}`;
// VERIFY: FulfillmentOrderHoldInput.handle and .fulfillmentOrderLineItems, and the
// remainingFulfillmentOrder payload field, on 2026-07.
const M_HOLD = `mutation FalconHold($id: ID!, $fulfillmentHold: FulfillmentOrderHoldInput!) {
  fulfillmentOrderHold(id: $id, fulfillmentHold: $fulfillmentHold) {
    fulfillmentHold { id handle }
    fulfillmentOrder { id status }
    remainingFulfillmentOrder { id }
    userErrors { field message code }
  }
}`;
// VERIFY: fulfillmentOrderReleaseHold(holdIds:) argument (releases only the named holds).
const M_RELEASE = `mutation FalconRelease($id: ID!, $holdIds: [ID!]) {
  fulfillmentOrderReleaseHold(id: $id, holdIds: $holdIds) { fulfillmentOrder { id status } userErrors { field message code } }
}`;
const M_VARIANT_POLICY = `mutation FalconVariantPolicy($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) { productVariants { id inventoryPolicy } userErrors { field message } }
}`;
const M_METAFIELDS_SET = `mutation FalconMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) { metafields { key value } userErrors { field message code } }
}`;
// VERIFY: metafieldsDelete(metafields: [MetafieldIdentifierInput!]!) on 2026-07.
const M_METAFIELDS_DELETE = `mutation FalconMetafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
  metafieldsDelete(metafields: $metafields) { deletedMetafields { key } userErrors { field message } }
}`;

// ---------------------------------------------------------------------------
// Shopify helpers
// ---------------------------------------------------------------------------

export function normaliseVariant(node) {
  if (!node) return null;
  const mf = (k) => (node[k] && node[k].value !== undefined && node[k].value !== null ? String(node[k].value) : '');
  const media = node.media && node.media.nodes && node.media.nodes[0];
  const product = node.product || {};
  const featured = product.featuredMedia;
  return {
    gid: node.id,
    id: numericId(node.id),
    title: node.title || '',
    price: node.price !== undefined && node.price !== null ? String(typeof node.price === 'object' ? node.price.amount : node.price) : '',
    qty: Number(node.inventoryQuantity) || 0,
    policy: String(node.inventoryPolicy || '').toUpperCase(),
    tracked: !!(node.inventoryItem && node.inventoryItem.tracked),
    imageUrl: (media && media.preview && media.preview.image && media.preview.image.url) || (featured && featured.preview && featured.preview.image && featured.preview.image.url) || '',
    productGid: product.id || '',
    productTitle: product.title || '',
    handle: product.handle || '',
    productStatus: product.status || '',
    expectedDate: mf('expectedDate'),
    preorderLimit: mf('preorderLimit') === '' ? null : parseInt(mf('preorderLimit'), 10),
    delayReason: mf('delayReason'),
    notifiedDate: mf('notifiedDate'),
    delayCount: parseInt(mf('delayCount'), 10) || 0,
  };
}

async function getVariant(ctx, variantId) {
  const data = await shopifyGraphQL(ctx, Q_VARIANT, { id: toGid('ProductVariant', variantId) });
  return normaliseVariant(data && data.productVariant);
}

async function listAllVariants(ctx) {
  const nodes = await paginate(ctx, Q_VARIANTS, {}, (d) => d.productVariants);
  return nodes.map(normaliseVariant);
}

async function shopCurrency(ctx) {
  if (!ctx.cache.currency) {
    const data = await shopifyGraphQL(ctx, Q_SHOP, {});
    ctx.cache.currency = (data && data.shop && data.shop.currencyCode) || '';
  }
  return ctx.cache.currency;
}

export function formatPrice(amount, currency, store) {
  const n = Number(amount);
  if (!currency || !Number.isFinite(n)) return '';
  const locale = store === 'us' ? 'en-US' : store === 'eu' ? 'en-IE' : 'en-GB';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

async function addTags(ctx, gid, tags, logFields = {}) {
  return mutate(ctx, 'tagsAdd', M_TAGS_ADD, { id: gid, tags }, { id: gid, tags, ...logFields });
}

async function removeTags(ctx, gid, tags, logFields = {}) {
  return mutate(ctx, 'tagsRemove', M_TAGS_REMOVE, { id: gid, tags }, { id: gid, tags, ...logFields });
}

async function getOrder(ctx, orderGid) {
  const data = await shopifyGraphQL(ctx, Q_ORDER, { id: orderGid });
  return data && data.order;
}

async function getOrderFulfillmentOrders(ctx, orderGid) {
  const data = await shopifyGraphQL(ctx, Q_ORDER_FOS, { id: orderGid });
  return (data && data.order && data.order.fulfillmentOrders && data.order.fulfillmentOrders.nodes) || [];
}

/** Open orders matching a search, re-filtered in code for the exact tag (and not cancelled). */
async function listOpenOrdersWithTag(ctx, tag) {
  const nodes = await paginate(ctx, Q_ORDERS, { q: `tag:'${tag}' AND status:open` }, (d) => d.orders); // VERIFY: exactness of tag search with hyphens
  return nodes.filter((o) => hasExactTag(o.tags, tag) && !o.cancelledAt && !o.closed);
}

function ourHolds(fo) {
  return (fo.fulfillmentHolds || []).filter((h) => h && h.handle === HOLD_HANDLE);
}

function foLinesForVariant(fo, variantId) {
  return ((fo.lineItems && fo.lineItems.nodes) || []).filter(
    (l) => l.lineItem && l.lineItem.variant && numericId(l.lineItem.variant.id) === String(variantId) && Number(l.remainingQuantity) > 0,
  );
}

function foOtherLines(fo, variantId) {
  return ((fo.lineItems && fo.lineItems.nodes) || []).filter(
    (l) => Number(l.remainingQuantity) > 0 && !(l.lineItem && l.lineItem.variant && numericId(l.lineItem.variant.id) === String(variantId)),
  );
}

// ---------------------------------------------------------------------------
// Brevo
// ---------------------------------------------------------------------------

/**
 * Pure: build the Brevo request body. DRY_RUN sends customer mail to the
 * store's staff_email with a `dry_run_banner` param naming the real recipient.
 */
export async function buildBrevoPayload({ shop, store, template, to, params, idempotencyKey, dryRun }) {
  const templateId = shop.templates && shop.templates[template];
  if (!templateId) throw new Error(`No Brevo template id for ${store}.${template}`);
  let recipient = { email: to.email };
  if (to.name) recipient.name = String(to.name).slice(0, 70);
  const finalParams = { ...params };
  if (shop.logo_url && finalParams.logo_url === undefined) finalParams.logo_url = shop.logo_url;
  let key = idempotencyKey;
  if (dryRun && template !== 'staff') {
    if (!shop.staff_email) throw new Error(`DRY_RUN is on but ${store}.staff_email is not set`);
    finalParams.dry_run_banner = `DRY RUN: this email would have gone to ${to.email}. Links in it do not change anything.`;
    recipient = { email: shop.staff_email, name: 'Falcon staff (dry run)' };
    // Own idempotency namespace: otherwise the real send after DRY_RUN is
    // switched off (same key, inside Brevo's window) would be dropped as a
    // duplicate while the Worker records the customer as told.
    key = `dry|${idempotencyKey}`;
  }
  const body = {
    templateId: Number(templateId),
    sender: shop.sender,
    to: [recipient],
    params: finalParams,
    tags: ['falcon', store, template],
    headers: { idempotencyKey: await uuidV5(key) }, // VERIFY: Brevo header name idempotencyKey vs Idempotency-Key
  };
  if (shop.reply_to) body.replyTo = shop.reply_to;
  return body;
}

/** Send one Brevo transactional email. Retries 429 per x-sib-ratelimit-reset (cap 10 s), up to 3 retries. */
export async function sendEmail(ctx, { template, to, params, key }) {
  if (!to || !to.email) return { ok: false, error: 'no_recipient' };
  const body = await buildBrevoPayload({ shop: ctx.shop, store: ctx.store, template, to, params, idempotencyKey: key, dryRun: ctx.dryRun });
  const logBase = { store: ctx.store, template, key, to: maskEmail(to.email), dry_run: ctx.dryRun };
  for (let attempt = 0; attempt <= 3; attempt++) {
    let res;
    try {
      res = await fetch(BREVO_URL, {
        method: 'POST',
        headers: { 'api-key': ctx.env.BREVO_API_KEY || '', 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      log('email_network_error', { ...logBase, attempt, error: String(err) });
      if (attempt === 3) return { ok: false, error: 'network' };
      await runtime.sleep(1000 * (attempt + 1));
      continue;
    }
    if (res.status === 429 && attempt < 3) {
      const reset = Number(res.headers.get('x-sib-ratelimit-reset')) || 1;
      const waitMs = Math.min(10, Math.max(1, reset)) * 1000;
      log('email_rate_limited', { ...logBase, attempt, wait_ms: waitMs });
      await runtime.sleep(waitMs);
      continue;
    }
    if (res.status >= 500 && attempt < 2) {
      // Safe to retry: the idempotency key makes Brevo drop a duplicate within 30 minutes.
      log('email_server_error_retry', { ...logBase, attempt, status: res.status });
      await runtime.sleep(1000 * (attempt + 1));
      continue;
    }
    const text = await res.text().catch(() => '');
    if (res.ok) {
      let messageId = '';
      try {
        messageId = JSON.parse(text).messageId || '';
      } catch {}
      log('email_sent', { ...logBase, message_id: messageId });
      return { ok: true, messageId };
    }
    if (res.status === 400 && /duplicate_parameter/i.test(text)) {
      // Same idempotency key already accepted: the email went out already.
      log('email_duplicate_suppressed', logBase);
      return { ok: true, duplicate: true };
    }
    log('email_failed', { ...logBase, status: res.status, body: text.slice(0, 300) });
    return { ok: false, error: `brevo_${res.status}` };
  }
  return { ok: false, error: 'retries_exhausted' };
}

/** rows: [[cell, cell, ...], ...]; first row is the header. Every value is escaped. */
export function rowsToHtml(rows) {
  if (!rows || !rows.length) return '';
  const [head, ...body] = rows;
  const th = head.map((c) => `<th align="left">${escapeHtml(c)}</th>`).join('');
  const trs = body.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
  return `<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;"><tr>${th}</tr>${trs}</table>`;
}

/** Staff alert via the `staff` template. Never throws. */
export async function staffAlert(ctx, { subject, intro, rows, key }) {
  try {
    if (!ctx.shop.staff_email) {
      log('staff_alert_no_address', { store: ctx.store, subject });
      return { ok: false };
    }
    const label = ctx.store.toUpperCase();
    return await sendEmail(ctx, {
      template: 'staff',
      to: { email: ctx.shop.staff_email, name: 'Falcon staff' },
      params: { subject: `Falcon ${label} | ${subject}`, intro, rows_html: rowsToHtml(rows) },
      key: `staff|${ctx.store}|${key}`,
    });
  } catch (err) {
    log('staff_alert_failed', { store: ctx.store, subject, error: String(err.message || err) });
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

/**
 * Origins allowed to call /subscribe for one store: `SHOPS[store].origins`
 * (storefront domain, myshopify domain, any theme-preview origin), falling
 * back to `storefront` alone. Normalised to URL origins; junk is dropped.
 */
export function allowedOrigins(shop) {
  if (!shop) return [];
  const list = Array.isArray(shop.origins) && shop.origins.length ? shop.origins : [shop.storefront];
  const out = [];
  for (const o of list) {
    try {
      const origin = new URL(String(o)).origin;
      if (origin && origin !== 'null' && !out.includes(origin)) out.push(origin);
    } catch {}
  }
  return out;
}

/** True when `origin` is allowed for `store` (or, with no store, for any store). */
function originAllowed(env, origin, store = null) {
  if (!origin) return false;
  const shops = getShops(env);
  const stores = store ? [store] : STORES;
  return stores.some((s) => STORES.includes(s) && shops[s] && allowedOrigins(shops[s]).includes(origin));
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

async function readJson(request, maxBytes = 16384) {
  const text = await request.text();
  if (text.length > maxBytes) throw new Error('body too large');
  return JSON.parse(text || '{}');
}

function checkFlowKey(request, env) {
  const got = request.headers.get('X-Falcon-Key') || '';
  if (!env.FLOW_KEY) return false;
  return timingSafeEqual(got, env.FLOW_KEY);
}

// ---------------------------------------------------------------------------
// POST /subscribe
// ---------------------------------------------------------------------------

export async function verifyTurnstile(env, token, ip) {
  if (!token || typeof token !== 'string' || token.length > 2048) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET || '');
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetch(TURNSTILE_URL, { method: 'POST', body: form });
    const data = await res.json();
    if (!data.success) {
      log('turnstile_failed', { codes: data['error-codes'] || [] });
      return false;
    }
    if (data.action && data.action !== TURNSTILE_ACTION) {
      log('turnstile_wrong_action', { action: data.action });
      return false;
    }
    return true;
  } catch (err) {
    log('turnstile_error', { error: String(err) });
    return false;
  }
}

async function findCustomerByEmail(ctx, email) {
  const lower = email.toLowerCase();
  const data = await shopifyGraphQL(ctx, Q_FIND_CUSTOMER, { q: `email:"${email}"` });
  const nodes = (data && data.customers && data.customers.nodes) || [];
  return nodes.find((c) => c.defaultEmailAddress && String(c.defaultEmailAddress.emailAddress || '').toLowerCase() === lower) || null;
}

async function handleSubscribe(request, env) {
  const origin = request.headers.get('Origin') || '';
  let body;
  try {
    body = await readJson(request);
  } catch {
    return json({ ok: false, error: 'server' }, 400, originAllowed(env, origin) ? corsHeaders(origin) : {});
  }
  const store = String(body.store || '');
  // CORS: the request must come from one of this store's own origins.
  if (!originAllowed(env, origin, store)) {
    log('subscribe_bad_origin', { origin, store });
    return json({ ok: false, error: 'forbidden' }, 403);
  }
  const cors = corsHeaders(origin);
  const reply = (data, status = 200) => json(data, status, cors);

  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await verifyTurnstile(env, body.turnstile_token, ip))) return reply({ ok: false, error: 'bot' });

  const email = String(body.email || '').trim();
  if (!isValidEmail(email)) return reply({ ok: false, error: 'invalid_email' });

  // The theme sends a string of digits; accept a number too. Use the string form in tags.
  const variantId = body.variant_id === null || body.variant_id === undefined ? '' : String(body.variant_id).trim();
  if (!/^\d{1,20}$/.test(variantId)) return reply({ ok: false, error: 'unknown_variant' });

  let ctx;
  try {
    ctx = makeCtx(env, store);
    const variant = await getVariant(ctx, variantId);
    if (!variant) return reply({ ok: false, error: 'unknown_variant' });

    const waitTag = `restock-${variantId}`;
    let customer = await findCustomerByEmail(ctx, email);
    if (!customer) {
      const created = await mutate(ctx, 'customerCreate', M_CUSTOMER_CREATE, { input: { email, tags: ['restock-request', waitTag] } }, { email: maskEmail(email), variant_id: variantId });
      if (created.ok && created.data.customerCreate.customer) {
        customer = created.data.customerCreate.customer;
      } else {
        // Most likely a race ("email has already been taken"): look it up again.
        customer = await findCustomerByEmail(ctx, email);
        if (!customer) return reply({ ok: false, error: 'server' }, 500);
      }
    }
    // tagsAdd is idempotent, so run it even for a just-created customer.
    const tagged = await addTags(ctx, customer.id, ['restock-request', waitTag], { variant_id: variantId });
    if (!tagged.ok) return reply({ ok: false, error: 'server' }, 500);
    // A new sign-up after an earlier notification: clear the old marker so the
    // fan-out does not mistake this for an unfinished earlier send.
    if (hasExactTag(customer.tags, `restock-notified-${variantId}`)) {
      await removeTags(ctx, customer.id, [`restock-notified-${variantId}`], { variant_id: variantId });
    }

    // Consent: only ever upgrade to SUBSCRIBED when the box was ticked. Never downgrade.
    if (body.marketing === true) {
      const state = customer.defaultEmailAddress && customer.defaultEmailAddress.marketingState;
      if (state === 'SUBSCRIBED') {
        log('consent_already_subscribed', { store, customer: customer.id });
      } else if (state === 'INVALID' || state === 'REDACTED') {
        log('consent_skipped', { store, customer: customer.id, state });
      } else {
        await mutate(
          ctx,
          'customerEmailMarketingConsentUpdate',
          M_CONSENT,
          {
            input: {
              customerId: customer.id,
              emailMarketingConsent: { marketingState: 'SUBSCRIBED', marketingOptInLevel: 'SINGLE_OPT_IN', consentUpdatedAt: new Date(runtime.now()).toISOString() },
            },
          },
          { customer: customer.id, from: state || null },
        );
        // A consent failure does not fail the waitlist sign-up; it is logged above.
      }
    }
    log('subscribed', { store, customer: customer.id, variant_id: variantId, email: maskEmail(email), marketing: body.marketing === true });
    return reply({ ok: true });
  } catch (err) {
    log('subscribe_error', { store, error: String(err.message || err) });
    return reply({ ok: false, error: 'server' }, 500);
  }
}

// ---------------------------------------------------------------------------
// POST /hooks/order
// ---------------------------------------------------------------------------

/**
 * Hold specific order lines (by line item id, not by variant) on the
 * fulfillment orders that carry them. `want` maps line item GID -> units to
 * hold. Fulfillment orders already held by us are counted first, so a retry
 * never holds units that were meant to ship (an unlabelled line can be held
 * in part). Only when the whole fulfillment order is wanted is it held without
 * a line list; otherwise Shopify moves the rest to a new open fulfillment
 * order that ships now.
 */
async function holdOrderLines(ctx, order, variantId, fulfillmentOrders, want, notes) {
  const remaining = new Map(want);
  const results = [];
  const openLines = (fo) => ((fo.lineItems && fo.lineItems.nodes) || []).filter((l) => Number(l.remainingQuantity) > 0);
  const sorted = [...fulfillmentOrders].sort((a, b) => (ourHolds(b).length ? 1 : 0) - (ourHolds(a).length ? 1 : 0));
  for (const fo of sorted) {
    const lines = openLines(fo);
    const plan = lines
      .filter((l) => l.lineItem && (remaining.get(l.lineItem.id) || 0) > 0)
      .map((l) => ({ id: l.id, lineItemId: l.lineItem.id, quantity: Math.min(Number(l.remainingQuantity), remaining.get(l.lineItem.id)), remainingQuantity: Number(l.remainingQuantity) }));
    if (!plan.length) continue;
    const whole = plan.length === lines.length && plan.every((p) => p.quantity === p.remainingQuantity);
    const consume = () => {
      for (const p of plan) remaining.set(p.lineItemId, remaining.get(p.lineItemId) - p.quantity);
    };
    if (ourHolds(fo).length && whole) {
      consume();
      results.push({ fo: fo.id, ok: true, already: true });
      continue;
    }
    if (fo.status !== 'OPEN') {
      // ON_HOLD by someone else, IN_PROGRESS, SCHEDULED... do not guess: staff hold it by hand.
      // VERIFY: whether a partial hold is allowed on a fulfillment order already ON_HOLD by another app.
      results.push({ fo: fo.id, ok: false, reason: `fulfillment order status ${fo.status}` });
      continue;
    }
    const input = { reason: 'OTHER', reasonNotes: notes, handle: HOLD_HANDLE, notifyMerchant: false };
    if (!whole) input.fulfillmentOrderLineItems = plan.map((p) => ({ id: p.id, quantity: p.quantity }));
    const r = await mutate(ctx, 'fulfillmentOrderHold', M_HOLD, { id: fo.id, fulfillmentHold: input }, { order: order.name, fulfillment_order: fo.id, variant_id: variantId, lines: plan.length, partial: !whole });
    if (r.ok) consume();
    results.push({ fo: fo.id, ok: r.ok, reason: r.ok ? '' : r.userErrors.map((e) => e.message).join('; ') });
  }
  if (!results.length) results.push({ fo: null, ok: false, reason: 'no fulfillment order with unfulfilled preorder lines' });
  return results;
}

/** Same state rule as the theme, ignoring the cap (the cap check runs separately). */
export function hasValidPreorderSetup(variant, today) {
  if (!variant || !variant.tracked) return false;
  return (
    variantPreorderState(
      { tracked: true, inventory_policy: variant.policy, inventory_quantity: 0, available: true, expected_date: variant.expectedDate, preorder_limit: variant.preorderLimit },
      today,
    ).state === 'preorder'
  );
}

/**
 * POST /hooks/order. Flow calls this for EVERY order (no condition), so a
 * normal order costs one order query: exit early unless a line has
 * `_preorder_date` or a line's variant is at or below zero.
 *
 * Labelled preorder lines are held. Unlabelled oversell (see
 * unlabelledOversell) is held like a preorder when the variant has a valid
 * preorder setup (tagged `preorder-unlabelled`, staff told the customer was
 * shown no date), otherwise tagged `oversold-v{id}` and staff alerted.
 * `preorder` (the idempotency marker) goes on last, only after every hold
 * succeeded. A failed hold tags `preorder-hold-failed` (one staff alert, not
 * one per Flow retry); the daily job retries those orders.
 */
export async function handleOrderHook(ctx, body, { source = 'flow' } = {}) {
  const orderGid = toGid('Order', body.order_id);
  if (!orderGid) return { status: 400, body: { ok: false, error: 'bad_order_id' } };
  const order = await getOrder(ctx, orderGid);
  if (!order) {
    log('order_hook_not_found', { store: ctx.store, order: orderGid });
    return { status: 200, body: { ok: false, error: 'not_found' } };
  }
  if (hasExactTag(order.tags, 'preorder')) {
    log('order_hook_skip_done', { store: ctx.store, order: order.name });
    return { status: 200, body: { ok: true, skipped: 'already_processed' } };
  }
  if (order.cancelledAt) {
    log('order_hook_skip_cancelled', { store: ctx.store, order: order.name });
    return { status: 200, body: { ok: true, skipped: 'cancelled' } };
  }
  if (!orderNeedsPreorderCheck(order)) return { status: 200, body: { ok: true, preorder: false } };

  const lines = preorderLinesFromOrder(order);
  const problems = [];
  // variantId -> Map(lineItemGid -> units to hold)
  const holdSpec = new Map();
  const want = (vid, lineItemId, qty) => {
    if (!(qty > 0)) return;
    if (!holdSpec.has(vid)) holdSpec.set(vid, new Map());
    const m = holdSpec.get(vid);
    m.set(lineItemId, (m.get(lineItemId) || 0) + qty);
  };
  for (const l of lines) want(l.variantId, l.lineItemId, l.unfulfilledQuantity);
  const notesDates = new Map();
  for (const l of lines) {
    if (!notesDates.has(l.variantId)) notesDates.set(l.variantId, new Set());
    notesDates.get(l.variantId).add(formatDate(l.date, ctx.store) || l.date);
  }

  // Unlabelled oversell.
  const variantCache = new Map();
  const unlabelledVariants = [];
  const oversoldTags = [];
  for (const u of unlabelledOversell(order)) {
    let variant;
    try {
      variant = await getVariant(ctx, u.variantId);
    } catch (err) {
      problems.push(['Oversell check failed', `${order.name}, variant ${u.variantId}`, String(err.message || err)]);
      continue;
    }
    if (!variant || !variant.tracked) continue;
    variantCache.set(u.variantId, variant);
    const item = `${variant.productTitle} ${cleanVariantTitle(variant.title)} (${u.variantId})`.replace(/\s+/g, ' ');
    if (variant.policy !== 'DENY' && hasValidPreorderSetup(variant, ctx.today)) {
      for (const l of u.lines) want(u.variantId, l.lineItemId, l.holdQty);
      unlabelledVariants.push(u.variantId);
      if (!notesDates.has(u.variantId)) notesDates.set(u.variantId, new Set());
      notesDates.get(u.variantId).add(`${formatDate(variant.expectedDate, ctx.store)} (customer not shown a date)`);
      if (!hasExactTag(order.tags, 'preorder-unlabelled')) {
        problems.push([
          'Pre-order sold without a date shown',
          `${order.name}: ${item}, ${u.units} unit(s)`,
          `Held until stock arrives. The customer was NOT shown a dispatch date. Contact them: expected ${formatDate(variant.expectedDate, ctx.store)}; they may cancel for a full refund`,
        ]);
      }
    } else {
      oversoldTags.push(orderTags.oversold(u.variantId));
      if (!hasExactTag(order.tags, orderTags.oversold(u.variantId))) {
        problems.push(['Oversold, not held', `${order.name}: ${item}, ${u.units} unit(s)`, `Stock is now ${u.qty} and there is no valid pre-order setup (policy ${variant.policy}). Decide whether this order can be fulfilled and contact the customer`]);
      }
    }
  }

  const variantIds = [...holdSpec.keys()];
  if (!variantIds.length && !oversoldTags.length && !problems.length) return { status: 200, body: { ok: true, preorder: false } };

  // Tag per-variant first so the release and daily jobs can always find the order.
  const firstTags = [...variantIds.map((v) => `preorder-v${v}`), ...(unlabelledVariants.length ? ['preorder-unlabelled'] : []), ...oversoldTags];
  if (firstTags.length) {
    const vt = await addTags(ctx, order.id, firstTags, { order: order.name });
    if (!vt.ok) problems.push(['Tagging', order.name, vt.userErrors.map((e) => e.message).join('; ')]);
  }

  let fos = (order.fulfillmentOrders && order.fulfillmentOrders.nodes) || [];
  for (let i = 0; i < variantIds.length; i++) {
    const v = variantIds[i];
    if (i > 0) fos = await getOrderFulfillmentOrders(ctx, order.id); // earlier holds split fulfillment orders
    const notes = `Pre-order, expected ${[...(notesDates.get(v) || [])].join(', ')}`;
    const res = await holdOrderLines(ctx, order, v, fos, holdSpec.get(v), notes);
    for (const r of res) if (!r.ok) problems.push(['Hold failed', `${order.name}, variant ${v}`, r.reason || 'see logs']);
  }

  // Cap: at or past the limit, stop selling. Past it: flag the order.
  let overCap = false;
  for (const v of variantIds) {
    let variant = variantCache.get(v);
    try {
      if (!variant) variant = await getVariant(ctx, v);
    } catch (err) {
      problems.push(['Cap check failed', `variant ${v}`, String(err.message || err)]);
      continue;
    }
    if (!variant) continue;
    const limit = variant.preorderLimit || 0;
    if (limit <= 0) {
      problems.push(['Pre-order sold with no preorder_limit', `${variant.productTitle} ${cleanVariantTitle(variant.title)} (${v})`, 'Set preorder_limit or stop selling']);
      continue;
    }
    if (variant.qty <= -limit && variant.policy === 'CONTINUE') {
      const r = await mutate(ctx, 'productVariantsBulkUpdate', M_VARIANT_POLICY, { productId: variant.productGid, variants: [{ id: variant.gid, inventoryPolicy: 'DENY' }] }, { variant_id: v, qty: variant.qty, limit });
      if (!r.ok) problems.push(['Could not stop selling at cap', `variant ${v}`, 'Set inventory policy to Deny by hand']);
    }
    if (variant.qty < -limit) {
      overCap = true;
      problems.push(['Over cap', `${order.name}: ${variant.productTitle} ${cleanVariantTitle(variant.title)} (${v})`, `Stock ${variant.qty}, cap ${limit}. Decide whether this order can be fulfilled`]);
    }
  }
  if (overCap) {
    const r = await addTags(ctx, order.id, ['preorder-over-cap'], { order: order.name });
    if (!r.ok) problems.push(['Tagging', order.name, 'could not add preorder-over-cap']);
  }

  const holdFailed = problems.some((p) => p[0] === 'Hold failed' || p[0] === 'Tagging');
  const alreadyAlerted = holdFailed && hasExactTag(order.tags, 'preorder-hold-failed');
  if (problems.length && !alreadyAlerted) {
    await staffAlert(ctx, {
      subject: `Pre-order order ${order.name} needs attention`,
      intro: `The Worker processed order ${order.name} and found the items below. Admin: ${adminOrderUrl(ctx, order.id)}${holdFailed ? '. A hold failed: hold the pre-order line(s) by hand, or wait for the automatic retry (every Flow retry and the daily job try again; you will not be emailed again about this order).' : ''}`,
      rows: [['Issue', 'Item', 'Detail'], ...problems],
      key: `order|${numericId(order.id)}|${ctx.today}|${[...new Set(problems.map((p) => p[0]))].sort().join(',')}`,
    });
  } else if (alreadyAlerted) {
    log('order_hook_alert_deduped', { store: ctx.store, order: order.name, source });
  }
  if (holdFailed) {
    // No `preorder` tag: Flow's retry (non-2xx) and the daily job run the holds again.
    if (!hasExactTag(order.tags, 'preorder-hold-failed')) await addTags(ctx, order.id, ['preorder-hold-failed'], { order: order.name });
    return { status: 500, body: { ok: false, error: 'hold_failed', problems: problems.length } };
  }
  if (!variantIds.length) {
    log('order_hook_oversold', { store: ctx.store, order: order.name, tags: oversoldTags });
    return { status: 200, body: { ok: true, preorder: false, oversold: oversoldTags.map((t) => t.slice('oversold-v'.length)) } };
  }
  const done = await addTags(ctx, order.id, ['preorder'], { order: order.name });
  if (!done.ok) return { status: 500, body: { ok: false, error: 'tag_failed' } };
  if (hasExactTag(order.tags, 'preorder-hold-failed')) await removeTags(ctx, order.id, ['preorder-hold-failed'], { order: order.name });
  log('order_hook_done', { store: ctx.store, order: order.name, variants: variantIds, unlabelled: unlabelledVariants, over_cap: overCap, source });
  return { status: 200, body: { ok: true, preorder: true, variants: variantIds, unlabelled: unlabelledVariants, over_cap: overCap } };
}

// ---------------------------------------------------------------------------
// Release (oldest first)
// ---------------------------------------------------------------------------

/**
 * Release held preorder lines for a variant, oldest order first, as far as
 * stock_for_preorders = inventoryQuantity + held units covers whole orders.
 * `orders` may be passed in (daily job) to save a query.
 *
 * Safe when two runs overlap (a Flow retry, two inventory events, the daily
 * job): each order's fulfillment orders are re-read just before its release
 * and only holds still present are released, so a hold is never released
 * twice and an order released by another run is skipped. Released-but-
 * unshipped units stay committed in inventoryQuantity, so a run that starts
 * after another's release computes the same total.
 *
 * `deadline` (ms epoch, 0 = none): stop planning or releasing once passed.
 * Planning is oldest first, so a partial plan only ever releases orders the
 * full plan would also release; the daily job finishes the rest.
 */
export async function releaseForVariant(ctx, variantId, inventoryQuantity, orders = null, { deadline = 0 } = {}) {
  const vid = String(variantId);
  const releasedTag = `preorder-released-v${vid}`;
  const pastDeadline = () => deadline && runtime.now() > deadline;
  const candidates = (orders || (await listOpenOrdersWithTag(ctx, `preorder-v${vid}`)))
    .filter((o) => hasExactTag(o.tags, `preorder-v${vid}`) && !hasExactTag(o.tags, releasedTag) && !o.cancelledAt && !o.closed)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  if (!candidates.length) return { released: [], held_units: 0, incomplete: false };

  const heldFos = (fos) => fos.filter((fo) => fo.status === 'ON_HOLD' && ourHolds(fo).length && foLinesForVariant(fo, vid).length);
  const held = [];
  let incomplete = false;
  for (const o of candidates) {
    if (pastDeadline()) {
      incomplete = true;
      break;
    }
    const ours = heldFos(await getOrderFulfillmentOrders(ctx, o.id));
    const units = ours.reduce((sum, fo) => sum + foLinesForVariant(fo, vid).reduce((s, l) => s + Number(l.remainingQuantity), 0), 0);
    if (units > 0) held.push({ id: o.id, name: o.name, createdAt: o.createdAt, units });
    else log('release_no_hold_found', { store: ctx.store, order: o.name, variant_id: vid });
  }
  const heldUnits = held.reduce((s, o) => s + o.units, 0);
  const stockForPreorders = Number(inventoryQuantity) + heldUnits;
  const toRelease = allocateReleases(held, stockForPreorders);
  log('release_plan', { store: ctx.store, variant_id: vid, inventory_quantity: inventoryQuantity, held_units: heldUnits, stock_for_preorders: stockForPreorders, held_orders: held.length, releasing: toRelease.map((o) => o.name), incomplete });

  const released = [];
  const problems = [];
  for (const o of toRelease) {
    if (pastDeadline()) {
      incomplete = true;
      break;
    }
    // Re-read just before acting: another run may have released it meanwhile.
    const current = heldFos(await getOrderFulfillmentOrders(ctx, o.id));
    if (!current.length) {
      log('release_already_done', { store: ctx.store, order: o.name, variant_id: vid });
      continue;
    }
    let allOk = true;
    for (const fo of current) {
      if (foOtherLines(fo, vid).length) {
        // Should not happen (holds are per variant). Releasing would ship other lines early.
        allOk = false;
        problems.push(['Release skipped', `${o.name}`, `Held fulfillment order also holds other items; release by hand when all are in stock`]);
        continue;
      }
      const holdIds = ourHolds(fo).map((h) => h.id);
      const r = await mutate(ctx, 'fulfillmentOrderReleaseHold', M_RELEASE, { id: fo.id, holdIds }, { order: o.name, fulfillment_order: fo.id, variant_id: vid });
      if (!r.ok) {
        allOk = false;
        problems.push(['Release failed', o.name, r.userErrors.map((e) => e.message).join('; ')]);
      }
    }
    if (allOk) {
      const t = await addTags(ctx, o.id, [releasedTag], { order: o.name });
      if (!t.ok) problems.push(['Tagging', o.name, `released but could not tag ${releasedTag}`]);
      released.push(o.name);
    }
  }
  if (problems.length) {
    await staffAlert(ctx, {
      subject: `Pre-order release problems (variant ${vid})`,
      intro: 'Stock arrived for a pre-order item but some holds could not be released automatically.',
      rows: [['Issue', 'Order', 'Detail'], ...problems],
      key: `release|${vid}|${ctx.today}`,
    });
  }
  return { released, held_units: heldUnits, stock_for_preorders: stockForPreorders, problems: problems.length, incomplete };
}

// ---------------------------------------------------------------------------
// Waitlist fan-out
// ---------------------------------------------------------------------------

async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

/**
 * Email everyone waiting on a variant that is back in stock.
 * budget: { emails: remaining sends this invocation, deadline: ms epoch or 0 }.
 */
export async function fanOutWaitlist(ctx, variant, budget) {
  const vid = variant.id;
  const waitTag = `restock-${vid}`;
  const notifiedTag = `restock-notified-${vid}`;
  const stats = { variant_id: vid, sent: 0, cleaned: 0, skipped: 0, failed: 0, more: false };
  if (!(variant.qty > 0)) return stats;
  if (variant.productStatus && variant.productStatus !== 'ACTIVE') {
    // Draft or archived: the product link would 404. Keep everyone on the list.
    log('fanout_skip_inactive_product', { store: ctx.store, variant_id: vid, status: variant.productStatus });
    return stats;
  }
  if (budget.emails <= 0) {
    stats.more = true;
    return stats;
  }
  const cap = ctx.dryRun ? Math.min(budget.emails, DRY_RUN_MAX_PER_BATCH) : budget.emails;
  // Collect first, then act: removing tags while paging a tag search would shift the cursor.
  const all = await paginate(ctx, Q_CUSTOMERS_BY_TAG, { q: `tag:'${waitTag}'` }, (d) => d.customers, { maxItems: cap + 50 }); // VERIFY: exactness of tag search
  const waiting = all.filter((c) => hasExactTag(c.tags, waitTag));
  const batch = waiting.slice(0, cap);
  stats.more = waiting.length > batch.length || all.length >= cap + 50;
  if (!batch.length) return stats;

  const currency = await shopCurrency(ctx);
  const productUrl = `${String(ctx.shop.storefront).replace(/\/+$/, '')}/products/${variant.handle}?variant=${vid}`;
  const baseParams = {
    store: ctx.store,
    product_title: variant.productTitle,
    variant_title: cleanVariantTitle(variant.title),
    product_url: productUrl,
    image_url: variant.imageUrl || '',
    price: formatPrice(variant.price, currency, ctx.store),
  };

  await mapLimit(batch, 4, async (listed) => {
    let c = listed;
    if (budget.deadline && runtime.now() > budget.deadline) {
      stats.more = true;
      return;
    }
    const cid = numericId(c.id);
    // Re-read the customer just before acting: an overlapping run (a second
    // inventory event, the daily job) may already have emailed them.
    let current;
    try {
      const d = await shopifyGraphQL(ctx, Q_CUSTOMER, { id: c.id });
      current = d && d.customer;
    } catch (err) {
      stats.failed++;
      log('fanout_reread_failed', { store: ctx.store, customer: c.id, variant_id: vid, error: String(err.message || err) });
      return;
    }
    if (!current || !hasExactTag(current.tags, waitTag)) {
      stats.skipped++;
      log('fanout_no_longer_waiting', { store: ctx.store, customer: c.id, variant_id: vid });
      return;
    }
    c = current;
    if (hasExactTag(c.tags, notifiedTag)) {
      // Emailed already; an earlier run stopped before removing the wait tag. Finish up, no email.
      if (!ctx.dryRun) {
        const r = await removeTags(ctx, c.id, [waitTag], { variant_id: vid, reason: 'cleanup_after_send' });
        if (r.ok) stats.cleaned++;
        else stats.failed++;
      }
      return;
    }
    const email = c.defaultEmailAddress && c.defaultEmailAddress.emailAddress;
    if (!email) {
      stats.skipped++;
      log('fanout_no_email', { store: ctx.store, customer: c.id, variant_id: vid });
      return;
    }
    if (budget.emails <= 0) {
      stats.more = true;
      return;
    }
    budget.emails--;
    const removeToken = await linkToken(ctx, { s: ctx.store, a: 'u', c: cid });
    const sent = await sendEmail(ctx, {
      template: 'bis',
      to: { email, name: c.firstName || '' },
      params: { ...baseParams, remove_url: linkUrl(ctx, '/u', removeToken) },
      key: `bis|${ctx.store}|${vid}|${cid}|${ctx.today}`,
    });
    if (!sent.ok) {
      stats.failed++;
      return;
    }
    stats.sent++;
    if (ctx.dryRun) {
      // DRY_RUN: the real customer has not been told, so keep them on the list.
      log('dry_run_keep_waitlist_tags', { store: ctx.store, customer: c.id, variant_id: vid });
      return;
    }
    const r = await mutate(ctx, 'waitlistDone', M_WAITLIST_DONE, { id: c.id, add: [notifiedTag], remove: [waitTag] }, { customer: c.id, variant_id: vid });
    if (!r.ok) stats.failed++;
  });
  log('fanout_done', { store: ctx.store, ...stats });
  return stats;
}

// ---------------------------------------------------------------------------
// POST /hooks/inventory
// ---------------------------------------------------------------------------

/**
 * POST /hooks/inventory work. The router answers Flow 202 straight after
 * auth and validation and runs this in `waitUntil`, inside one total time
 * budget (release + fan-out); the daily job completes anything left.
 */
export async function handleInventoryHook(ctx, body, { deadlineMs = INVENTORY_BUDGET_MS } = {}) {
  const vid = numericId(body.variant_id);
  if (!vid) return { status: 400, body: { ok: false, error: 'bad_variant_id' } };
  const deadline = runtime.now() + deadlineMs;
  // Re-read the variant: the live quantity is the source of truth, not the Flow payload.
  const variant = await getVariant(ctx, vid);
  if (!variant) {
    log('inventory_hook_unknown_variant', { store: ctx.store, variant_id: vid });
    return { status: 200, body: { ok: false, error: 'unknown_variant' } };
  }
  log('inventory_hook', { store: ctx.store, variant_id: vid, flow_qty: body.inventory_quantity, flow_prior: body.inventory_quantity_prior, live_qty: variant.qty });
  const release = await releaseForVariant(ctx, vid, variant.qty, null, { deadline });
  let fanout = null;
  if (variant.qty > 0 && variant.tracked) {
    if (runtime.now() > deadline) fanout = { variant_id: vid, sent: 0, more: true };
    else fanout = await fanOutWaitlist(ctx, variant, { emails: FANOUT_MAX_PER_INVOCATION, deadline });
  }
  log('inventory_hook_done', { store: ctx.store, variant_id: vid, released: release.released, release_incomplete: !!release.incomplete, fanout });
  return { status: 200, body: { ok: true, released: release.released, release_incomplete: !!release.incomplete, fanout } };
}

// ---------------------------------------------------------------------------
// Daily job
// ---------------------------------------------------------------------------

function lineForVariant(order, vid) {
  return ((order.lineItems && order.lineItems.nodes) || []).find((li) => li.variant && numericId(li.variant.id) === String(vid) && Number(li.unfulfilledQuantity) > 0);
}

/** Order tag recording that one date-change notice for a variant was sent. */
export function changeMarker(variantId, delayCount, oldDate, newDate) {
  return `preorder-notice-v${variantId}-${delayCount}-${oldDate}-${newDate}`;
}

/** Orders still waiting on this variant: tagged, not released, line unfulfilled. */
function pendingOrdersForVariant(orders, vid) {
  return orders.filter(
    (o) => hasExactTag(o.tags, `preorder-v${vid}`) && !hasExactTag(o.tags, `preorder-released-v${vid}`) && !o.cancelledAt && !o.closed && lineForVariant(o, vid),
  );
}

/** The `_preorder_date` the customer saw at checkout for this variant ('' if none: unlabelled line). */
function promisedDate(order, vid) {
  const nodes = (order.lineItems && order.lineItems.nodes) || [];
  for (const li of nodes) {
    if (!li.variant || numericId(li.variant.id) !== String(vid)) continue;
    const a = (li.customAttributes || []).find((x) => x && x.key === '_preorder_date');
    if (a && isIsoDate(String(a.value || '').trim())) return String(a.value).trim();
  }
  return '';
}

function toldBeforeFor(order, vid) {
  return parseTags(order.tags).some((t) => t.toLowerCase().startsWith(`preorder-notice-v${vid}-`));
}

/**
 * Daily step 1 for one variant. `rows` collects digest rows.
 *
 * First setup (notified_date empty): customers may already have ordered at a
 * date that staff changed before this first run. Every open order whose own
 * checkout date differs from expected_date gets the normal date-change
 * notice (old date = its `_preorder_date`); only then is notified_date set.
 * With nobody to tell, notified_date is simply set (also in DRY_RUN: that
 * tells no one anything).
 */
export async function processDateChange(ctx, v, rows, orders = null) {
  if (!isIsoDate(v.expectedDate)) {
    rows.push(['Invalid expected_date', `${v.productTitle} ${cleanVariantTitle(v.title)} (${v.id})`, `Value "${v.expectedDate}"`]);
    return { changed: false };
  }
  const firstSetup = !v.notifiedDate;
  if (!firstSetup && v.notifiedDate === v.expectedDate) return { changed: false };
  const newDate = v.expectedDate;
  const item = `${v.productTitle} ${cleanVariantTitle(v.title)} (${v.id})`.replace(/\s+/g, ' ');

  // Query by the per-variant tag (not the `preorder` tag): an order whose hold
  // failed has no `preorder` tag yet, and its customer must still be told.
  const pending = pendingOrdersForVariant(orders || (await listOpenOrdersWithTag(ctx, `preorder-v${v.id}`)), v.id);

  let oldDate = v.notifiedDate;
  if (firstSetup) {
    // Only customers with a checkout date different from the new one need telling.
    const told = pending.map((o) => promisedDate(o, v.id)).filter((d) => d && d !== newDate).sort();
    if (!told.length) {
      const r = await mutate(ctx, 'metafieldsSet', M_METAFIELDS_SET, { metafields: [{ ownerId: v.gid, namespace: 'falcon', key: 'notified_date', type: 'date', value: newDate }] }, { variant_id: v.id, reason: 'initial' });
      if (!r.ok) rows.push(['Could not set notified_date', `${v.productTitle} (${v.id})`, 'See Worker logs']);
      return { changed: false };
    }
    oldDate = told[0]; // reference only (reason wait, delay_count, logs); each order uses its own date
    log('date_change_first_setup', { store: ctx.store, variant_id: v.id, new_date: newDate, orders_to_tell: told.length });
  }
  const later = newDate > oldDate;
  if (later && !v.delayReason.trim()) {
    const daysLeft = daysBetween(ctx.today, oldDate);
    if (daysLeft > 2) {
      rows.push(['Date moved later but no delay_reason', item, `Set falcon.delay_reason. Customers are emailed automatically 2 days before ${formatDate(oldDate, ctx.store)} if it is still empty`]);
      return { changed: true, waiting_for_reason: true };
    }
  }

  let failures = 0;
  let sent = 0;
  let dryRunCount = 0;
  for (const order of pending) {
    const line = lineForVariant(order, v.id);
    const promised = promisedDate(order, v.id);
    // The date this customer was last given: the checkout date, unless they
    // have since had a date-change email for this variant (then notified_date).
    // Comparing only the checkout date would skip a customer who was told an
    // earlier date and whose date then moved back to the checkout date.
    const toldBefore = toldBeforeFor(order, v.id);
    let orderOld;
    if (firstSetup) {
      if (!promised) continue; // unlabelled line: never shown a date (staff were told to contact them)
      orderOld = promised;
    } else {
      orderOld = !toldBefore && promised ? promised : oldDate;
    }
    if (orderOld === newDate) continue; // this customer already has this date
    // One marker per change event (variant, delay count, old date, new date):
    // never email the same change twice. The old date is part of it because an
    // earlier move and a later move back can share a delay count and new date
    // (B to C earlier, C to D earlier, D to C later), and the second is news.
    // First setup has no variant-level old date, so the order's own is used.
    const markerOld = firstSetup ? orderOld : oldDate;
    const marker = changeMarker(v.id, v.delayCount, markerOld, newDate);
    if (hasExactTag(order.tags, marker)) continue;
    if (!order.email) {
      // Permanent, so not a failure: counting it would block notified_date forever.
      rows.push(['Pre-order customer has no email', order.name, `Tell the customer by hand: ${item} now expected ${formatDate(newDate, ctx.store)}`]);
      continue;
    }
    if (ctx.dryRun && dryRunCount >= DRY_RUN_MAX_PER_BATCH) break;
    const orderLater = newDate > orderOld;
    const priorDelays = maxDelayNumber(order.tags, v.id);
    const cls = classifyDelay({ store: ctx.store, old_date: orderOld, new_date: newDate, delay_count_before: priorDelays, has_definite_date: true, today: ctx.today });
    const n = orderLater ? priorDelays + 1 : priorDelays;
    const oid = numericId(order.id);
    const cancelToken = await linkToken(ctx, { s: ctx.store, a: 'c', o: oid, v: v.id, n });
    const params = {
      order_name: order.name,
      order_status_url: order.statusPageUrl || '',
      product_title: (line.product && line.product.title) || v.productTitle,
      variant_title: cleanVariantTitle(line.variantTitle || v.title),
      old_date: formatDate(orderOld, ctx.store),
      new_date: formatDate(newDate, ctx.store),
      reason: v.delayReason || '',
      cancel_url: linkUrl(ctx, '/c', cancelToken),
    };
    if (cls.template === 'delay_uk') {
      params.withdrawal_url = ctx.store === 'eu' ? ctx.shop.withdrawal_url || '' : '';
      params.earlier = cls.earlier;
    } else if (cls.template === 'delay_us_notice') {
      params.earlier = cls.earlier;
    } else {
      const keepToken = await linkToken(ctx, { s: ctx.store, a: 'k', o: oid, v: v.id, n });
      params.keep_url = linkUrl(ctx, '/k', keepToken);
      params.keep_by_date = formatDate(cls.keep_by_date, ctx.store);
    }
    dryRunCount++;
    const res = await sendEmail(ctx, {
      template: cls.template,
      to: { email: order.email, name: (order.customer && order.customer.firstName) || '' },
      params,
      key: `delay|${ctx.store}|${v.id}|${oid}|${v.delayCount}|${markerOld}|${newDate}`,
    });
    if (!res.ok) {
      failures++;
      rows.push(['Date-change email failed', order.name, `${item}: ${res.error}`]);
      continue;
    }
    sent++;
    if (ctx.dryRun) continue; // the real customer was not told; record nothing
    const tags = [marker];
    if (orderLater) tags.push(orderTags.delay(v.id, n));
    if (cls.template === 'delay_us_consent') tags.push(orderTags.keepBy(v.id, cls.keep_by_date));
    let t = await addTags(ctx, order.id, tags, { order: order.name, variant_id: v.id, template: cls.template });
    if (!t.ok) t = await addTags(ctx, order.id, tags, { order: order.name, variant_id: v.id, retry: true });
    if (!t.ok) {
      failures++;
      rows.push(['Emailed but could not tag order', order.name, `Add tags by hand: ${tags.join(', ')} (otherwise the customer may be emailed again)`]);
    }
  }

  if (failures === 0 && !ctx.dryRun) {
    const metafields = [{ ownerId: v.gid, namespace: 'falcon', key: 'notified_date', type: 'date', value: newDate }];
    if (later) metafields.push({ ownerId: v.gid, namespace: 'falcon', key: 'delay_count', type: 'number_integer', value: String(v.delayCount + 1) });
    const r = await mutate(ctx, 'metafieldsSet', M_METAFIELDS_SET, { metafields }, { variant_id: v.id, old_date: oldDate, new_date: newDate, first_setup: firstSetup });
    if (!r.ok) rows.push(['Could not update notified_date', item, 'Emails were sent; the next run will not resend (orders are tagged)']);
    if (v.delayReason) {
      await mutate(ctx, 'metafieldsDelete', M_METAFIELDS_DELETE, { metafields: [{ ownerId: v.gid, namespace: 'falcon', key: 'delay_reason' }] }, { variant_id: v.id });
    }
  }
  log('date_change_done', { store: ctx.store, variant_id: v.id, old_date: oldDate, new_date: newDate, later, first_setup: firstSetup, orders: pending.length, sent, failures, dry_run: ctx.dryRun });
  return { changed: true, sent, failures };
}

/** "Pie Dish Grey (111)" from the order's own line, for staff emails. */
function orderItemLabel(order, vid) {
  const li = ((order.lineItems && order.lineItems.nodes) || []).find((x) => x.variant && numericId(x.variant.id) === String(vid));
  if (!li) return `variant ${vid}`;
  const title = (li.product && li.product.title) || li.title || '';
  return `${title} ${cleanVariantTitle(li.variantTitle || (li.variant && li.variant.title) || '')} (${vid})`.replace(/\s+/g, ' ').trim();
}

/**
 * Daily step 2: US consent deadlines, per (order, variant). A missed keep-by
 * for one item flags only that item (`preorder-cancel-due-v{id}`); other
 * pre-order items in the same order are unaffected.
 */
export async function checkConsentDeadlines(ctx, orders, rows) {
  for (const order of orders) {
    const variantIds = [...new Set(parseTags(order.tags).map((t) => t.match(/^preorder-keep-by-v(\d+)-\d{4}-\d{2}-\d{2}$/i)).filter(Boolean).map((m) => m[1]))];
    for (const vid of variantIds) {
      const dates = keepByDates(order.tags, vid);
      const latest = dates[dates.length - 1];
      if (!keepByPassed(latest, ctx.today)) continue;
      // Released for shipping (stock came in before the deadline), or the line
      // is no longer unfulfilled: nothing is left to cancel.
      if (hasExactTag(order.tags, `preorder-released-v${vid}`)) continue;
      if (order.lineItems && order.lineItems.nodes && !lineForVariant(order, vid)) continue;
      const n = maxDelayNumber(order.tags, vid);
      if (hasExactTag(order.tags, orderTags.kept(vid, n))) continue;
      const item = orderItemLabel(order, vid);
      const refundBy = formatDate(addWorkingDays(ctx.today, 7), ctx.store);
      if (hasExactTag(order.tags, orderTags.cancelDue(vid))) {
        rows.push(['Cancel due (still open)', `${order.name}: ${item}`, `No consent after delay ${n}. Cancel this item and refund it in full`]);
        continue;
      }
      const t = await addTags(ctx, order.id, [orderTags.cancelDue(vid)], { order: order.name, variant_id: vid, keep_by: latest });
      await staffAlert(ctx, {
        subject: `Cancel and refund ${order.name} (${item}) by ${refundBy}`,
        intro: `The customer did not confirm they want to keep the preorder item ${item} after delay ${n} (deadline ${formatDate(latest, ctx.store)}). Under the FTC rule this item must be canceled and refunded in full. Other items in the order are not affected. The Worker does not cancel or refund; please do it in Shopify admin.`,
        rows: [['Order', 'Item', 'Refund by', 'Admin'], [order.name, item, refundBy, adminOrderUrl(ctx, order.id)]],
        key: `cancel-due|${numericId(order.id)}|${vid}|${n}`,
      });
      rows.push(['Cancel due', `${order.name}: ${item}`, `Refund by ${refundBy}${t.ok ? '' : ` (could not tag ${orderTags.cancelDue(vid)})`}`]);
    }
  }
}

export async function runDailyForStore(ctx, { budget } = {}) {
  budget = budget || { emails: FANOUT_MAX_PER_INVOCATION, deadline: 0 };
  const rows = [];
  const summary = { store: ctx.store, date_changes: 0, released: 0, fanout_sent: 0 };
  const variants = await listAllVariants(ctx);
  const byId = new Map(variants.map((v) => [v.id, v]));

  // 0. Retry holds that failed (Flow retries may have given up). Done first
  // so an order that now succeeds is tagged `preorder` and seen below.
  try {
    const failed = await listOpenOrdersWithTag(ctx, 'preorder-hold-failed');
    for (const o of failed) {
      if (hasExactTag(o.tags, 'preorder')) continue;
      const r = await handleOrderHook(ctx, { order_id: o.id }, { source: 'daily' });
      if (r.status === 200) summary.holds_retried = (summary.holds_retried || 0) + 1;
      else rows.push(['Pre-order hold still failing', o.name, `Hold the pre-order line(s) by hand (Fulfillment > Hold), then remove the tag preorder-hold-failed. Admin: ${adminOrderUrl(ctx, o.id)}`]);
    }
  } catch (err) {
    rows.push(['Hold retry job error', '-', String(err.message || err)]);
  }

  const openOrders = await listOpenOrdersWithTag(ctx, 'preorder');

  // 1. Date changes
  for (const v of variants) {
    if (!v.expectedDate) continue;
    try {
      const r = await processDateChange(ctx, v, rows);
      if (r.changed) summary.date_changes++;
    } catch (err) {
      rows.push(['Date-change job error', `${v.productTitle} (${v.id})`, String(err.message || err)]);
      log('date_change_error', { store: ctx.store, variant_id: v.id, error: String(err.message || err) });
    }
  }

  // 2. US consent deadlines (tags only ever exist on the US store, but checking all is harmless)
  try {
    await checkConsentDeadlines(ctx, openOrders, rows);
  } catch (err) {
    rows.push(['Consent deadline job error', '-', String(err.message || err)]);
  }

  // 3. Waitlist leftovers
  try {
    const waiting = await paginate(ctx, Q_CUSTOMERS_BY_TAG, { q: "tag:'restock-request'" }, (d) => d.customers, { maxPages: 100 });
    const variantIds = new Set();
    for (const c of waiting) for (const id of restockVariantIds(c.tags)) variantIds.add(id);
    for (const id of variantIds) {
      const v = byId.get(id);
      if (!v || !v.tracked || !(v.qty > 0)) continue;
      if (budget.emails <= 0) {
        rows.push(['Waitlist not finished', `${v.productTitle} (${id})`, 'Hit the 400 email cap; continues next run']);
        continue;
      }
      const s = await fanOutWaitlist(ctx, v, budget);
      summary.fanout_sent += s.sent;
    }
  } catch (err) {
    rows.push(['Waitlist job error', '-', String(err.message || err)]);
  }

  // 4. Release re-check
  const heldVariantIds = new Set();
  for (const o of openOrders) {
    for (const t of parseTags(o.tags)) {
      const m = t.match(/^preorder-v(\d+)$/i);
      if (m && !hasExactTag(o.tags, `preorder-released-v${m[1]}`)) heldVariantIds.add(m[1]);
    }
  }
  for (const id of heldVariantIds) {
    const v = byId.get(id);
    if (!v) {
      rows.push(['Pre-orders for a deleted variant', id, 'Open orders are tagged for a variant that no longer exists']);
      continue;
    }
    try {
      const r = await releaseForVariant(ctx, id, v.qty, openOrders);
      summary.released += r.released.length;
    } catch (err) {
      rows.push(['Release job error', `${v.productTitle} (${id})`, String(err.message || err)]);
    }
  }

  // 5. Config alerts
  for (const v of variants) {
    const item = `${v.productTitle} ${cleanVariantTitle(v.title)} (${v.id})`.replace(/\s+/g, ' ');
    if (v.tracked && v.policy === 'CONTINUE' && (!v.expectedDate || !(v.preorderLimit > 0))) {
      rows.push(['Continue selling without pre-order setup', item, `Missing ${[!v.expectedDate && 'expected_date', !(v.preorderLimit > 0) && 'preorder_limit'].filter(Boolean).join(' and ')}. Other sales channels can still sell it`]);
    }
    const pending = heldVariantIds.has(v.id) ? pendingOrdersForVariant(openOrders, v.id) : [];
    if (pending.length && isIsoDate(v.expectedDate) && v.expectedDate < ctx.today) {
      rows.push(['Expected date has passed', item, `${pending.length} pre-order(s) still waiting. Update expected_date (customers are emailed) or ship`]);
    }
    if (pending.length && !v.expectedDate) {
      rows.push(['Pre-orders waiting with no expected_date', item, `${pending.length} order(s). Set expected_date so customers can be told`]);
    }
  }
  for (const o of openOrders) {
    // Cancel requests, per variant: still open after 3 days while that item is unfulfilled.
    const requested = new Map();
    for (const t of parseTags(o.tags)) {
      const m = t.match(/^preorder-cancel-requested-v(\d+)-on-(\d{4}-\d{2}-\d{2})$/i);
      if (m && (!requested.has(m[1]) || m[2] < requested.get(m[1]))) requested.set(m[1], m[2]);
      const p = t.match(/^preorder-cancel-requested-v(\d+)$/i);
      if (p && !requested.has(p[1])) requested.set(p[1], '');
    }
    for (const [vid, on] of requested) {
      if (!lineForVariant(o, vid)) continue; // cancelled/refunded or shipped: nothing left to chase
      if (!on || daysBetween(on, ctx.today) > 3) {
        rows.push(['Cancel request still open after 3 days', `${o.name}: ${orderItemLabel(o, vid)}`, `Requested ${on ? formatDate(on, ctx.store) : 'on an unknown date'}. Refund by ${on ? formatDate(refundDeadline(ctx.store, on), ctx.store) : 'as soon as possible'}`]);
      }
    }
  }

  if (rows.length) {
    await staffAlert(ctx, {
      subject: `Daily check: ${rows.length} item${rows.length === 1 ? '' : 's'} need attention`,
      intro: `The daily check on the ${ctx.store.toUpperCase()} store (${formatDate(ctx.today, ctx.store)}) found the items below.${ctx.dryRun ? ' DRY_RUN is on: customer emails went to this address instead.' : ''}`,
      rows: [['Issue', 'Item', 'Action'], ...rows],
      key: `digest|${ctx.today}`,
    });
  }
  summary.alerts = rows.length;
  log('daily_done', summary);
  return summary;
}

export async function runDaily(env, { store = null, baseUrl = '' } = {}) {
  const shops = getShops(env);
  const stores = store ? [store] : STORES.filter((s) => shops[s]);
  const results = [];
  for (const s of stores) {
    let ctx;
    try {
      ctx = makeCtx(env, s, { baseUrl });
      if (!ctx.baseUrl) throw new Error('WORKER_URL not set');
      results.push(await runDailyForStore(ctx));
    } catch (err) {
      log('daily_store_error', { store: s, error: String(err.message || err) });
      results.push({ store: s, error: String(err.message || err) });
      if (ctx) await staffAlert(ctx, { subject: 'Daily check failed', intro: `The daily job stopped with an error: ${String(err.message || err)}`, rows: [], key: `daily-error|${ctx.today}` });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Link pages: GET /u /k /c (read only) and POST (acts)
// ---------------------------------------------------------------------------

function copyFor(store) {
  const us = store === 'us';
  return {
    lang: us ? 'en-US' : store === 'eu' ? 'en-IE' : 'en-GB',
    preorder: us ? 'preorder' : 'pre-order',
    Preorder: us ? 'Preorder' : 'Pre-order',
    cancelled: us ? 'canceled' : 'cancelled',
  };
}

export function renderPage({ store, title, paragraphs = [], form = null, status = 200 }) {
  const c = copyFor(store);
  const paras = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n      ');
  const formHtml = form
    ? `<form method="post" action="${escapeHtml(form.action)}">
        <input type="hidden" name="t" value="${escapeHtml(form.token)}">
        <button type="submit">${escapeHtml(form.button)}</button>
      </form>`
    : '';
  const html = `<!doctype html>
<html lang="${c.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)} | Falcon Enamelware</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #f5f6fa; color: #1a1a1a; font: 17px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  header { background: ${BRAND_NAVY}; color: #fff; padding: 16px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; font-size: 15px; }
  main { max-width: 34rem; margin: 32px auto; padding: 0 16px; }
  .card { background: #fff; border: 1px solid #d9dcea; border-radius: 8px; padding: 24px; }
  h1 { color: ${BRAND_NAVY}; font-size: 1.5rem; line-height: 1.25; margin: 0 0 12px; }
  button { background: ${BRAND_NAVY}; color: #fff; border: 0; border-radius: 6px; padding: 14px 22px; font: inherit; font-weight: 600; cursor: pointer; min-height: 48px; }
  button:hover { background: #1b2868; }
  button:focus-visible { outline: 3px solid #f2b705; outline-offset: 3px; }
  a { color: ${BRAND_NAVY}; }
</style>
</head>
<body>
  <header>Falcon Enamelware</header>
  <main>
    <div class="card">
      <h1>${escapeHtml(title)}</h1>
      ${paras}
      ${formHtml}
    </div>
  </main>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

function invalidLinkPage(store, env) {
  let contact = '';
  try {
    const shop = getShops(env)[store];
    contact = shop && shop.sender && shop.sender.email ? ` If you need help, email ${shop.sender.email}.` : '';
  } catch {}
  return renderPage({ store: store || 'uk', title: 'This link has expired', paragraphs: [`This link is no longer valid. It may be out of date, or it may have been copied only in part.${contact}`], status: 400 });
}

async function handleLinkPage(request, env, action) {
  let token = '';
  if (request.method === 'GET') {
    token = new URL(request.url).searchParams.get('t') || '';
  } else {
    try {
      const form = await request.formData();
      token = String(form.get('t') || '');
    } catch {
      token = '';
    }
  }
  const payload = await verifyToken(token, env.LINK_SECRET);
  if (!payload || payload.a !== action || !STORES.includes(payload.s)) {
    log('link_invalid', { action, method: request.method });
    return invalidLinkPage(payload && payload.s, env);
  }
  const store = payload.s;
  const c = copyFor(store);
  if (payload.d && request.method !== 'GET') {
    // Link from a DRY_RUN email (sent to staff, built for a real customer or order): never act on it.
    log('link_dry_run_post', { action, store });
    return renderPage({ store, title: 'Test link: nothing changed', paragraphs: ['This link came from a DRY_RUN test email, so nothing was changed for the customer or order.'] });
  }
  const ctx = makeCtx(env, store, { baseUrl: new URL(request.url).origin });
  const contact = ctx.shop.sender && ctx.shop.sender.email ? ctx.shop.sender.email : '';
  const helpLine = contact ? `If you have any questions, email ${contact}.` : '';

  // ---- /u: leave every back-in-stock waiting list
  if (action === 'u') {
    const customerGid = toGid('Customer', payload.c);
    if (request.method === 'GET') {
      return renderPage({ store, title: 'Stop back-in-stock emails?', paragraphs: ['We will take you off every back-in-stock list you joined, so you will not get these emails from us.'], form: { action: '/u', token, button: 'Remove me' } });
    }
    const data = await shopifyGraphQL(ctx, Q_CUSTOMER, { id: customerGid });
    const customer = data && data.customer;
    const ids = customer ? restockVariantIds(customer.tags) : [];
    if (ids.length) {
      const r = await removeTags(ctx, customerGid, ids.map((id) => `restock-${id}`), { reason: 'customer_unsubscribe' });
      if (!r.ok) return renderPage({ store, title: 'Something went wrong', paragraphs: ['We could not update your details just now. Please try again in a few minutes.', helpLine], form: { action: '/u', token, button: 'Try again' }, status: 500 });
    }
    log('waitlist_removed', { store, customer: customerGid, lists: ids.length });
    return renderPage({ store, title: 'You have been removed', paragraphs: ['You will not get back-in-stock emails from us. This does not change any orders or newsletter settings.', helpLine] });
  }

  // ---- /k and /c: order actions, always for one variant of one order
  const vid = numericId(payload.v);
  if (!vid) {
    log('link_invalid', { action, method: request.method, reason: 'no_variant' });
    return invalidLinkPage(store, env);
  }
  const orderGid = toGid('Order', payload.o);
  const order = await getOrder(ctx, orderGid).catch(() => null);
  if (!order) return renderPage({ store, title: 'We could not find this order', paragraphs: [helpLine || 'Please contact us.'], status: 404 });
  const orderName = order.name;
  const n = Number(payload.n) || 0;
  const variantLines = ((order.lineItems && order.lineItems.nodes) || []).filter((li) => li.variant && numericId(li.variant.id) === vid);
  const openUnits = variantLines.reduce((sum, li) => sum + lineOpenQty(li), 0);
  const itemName = variantLines.length
    ? `${(variantLines[0].product && variantLines[0].product.title) || variantLines[0].title || ''} ${cleanVariantTitle(variantLines[0].variantTitle || '')}`.replace(/\s+/g, ' ').trim()
    : '';
  const theItem = itemName ? `${itemName} in ${orderName}` : `the ${c.preorder} in ${orderName}`;

  if (action === 'k') {
    if (hasExactTag(order.tags, orderTags.kept(vid, n))) {
      return renderPage({ store, title: 'Your order is kept', paragraphs: [`You have already told us to keep ${theItem}. Thank you.`, helpLine] });
    }
    const keepBy = keepByDates(order.tags, vid).pop();
    const tooLate = order.cancelledAt || hasExactTag(order.tags, orderTags.cancelDue(vid)) || keepByPassed(keepBy, ctx.today) || n !== maxDelayNumber(order.tags, vid);
    if (tooLate) {
      return renderPage({ store, title: 'This link can no longer be used', paragraphs: [`We could not record your answer for ${theItem} online, because the deadline has passed or there is a newer update about this order.`, helpLine || 'Please contact us.'] });
    }
    if (request.method === 'GET') {
      return renderPage({ store, title: `Keep your ${c.preorder}?`, paragraphs: [`Press the button to keep ${theItem} with the new date. You can still cancel for a full refund at any time before it ships.`], form: { action: '/k', token, button: 'Keep my order' } });
    }
    const r = await addTags(ctx, order.id, [orderTags.kept(vid, n)], { order: orderName, variant_id: vid, action: 'keep' });
    if (!r.ok) return renderPage({ store, title: 'Something went wrong', paragraphs: ['We could not record your answer just now. Please try again in a few minutes.', helpLine], form: { action: '/k', token, button: 'Try again' }, status: 500 });
    log('preorder_kept', { store, order: orderName, variant_id: vid, n });
    return renderPage({ store, title: 'Thank you, your order is kept', paragraphs: [`We will ship ${theItem} as soon as it arrives. You can still cancel for a full refund at any time before it ships.`, helpLine] });
  }

  // action === 'c'
  if (order.cancelledAt) {
    return renderPage({ store, title: `This order is already ${c.cancelled}`, paragraphs: [`${orderName} has already been ${c.cancelled}.`, helpLine] });
  }
  const refundText = store === 'us' ? 'within 7 business days' : 'within 14 days';
  if (hasExactTag(order.tags, orderTags.cancelRequested(vid))) {
    return renderPage({ store, title: 'We have your request', paragraphs: [`We already have your request to cancel ${theItem}. We will refund you in full ${refundText} and email you when it is done.`, helpLine] });
  }
  if (variantLines.length && openUnits === 0) {
    // Already dispatched: a cancellation is now a return.
    log('preorder_cancel_refused_fulfilled', { store, order: orderName, variant_id: vid, method: request.method });
    return renderPage({
      store,
      title: 'This item has already been dispatched',
      paragraphs: [`${itemName || `The ${c.preorder}`} in ${orderName} has already been dispatched, so it can no longer be ${c.cancelled} here. If you do not want it, please use our returns process once it arrives.`, helpLine],
    });
  }
  if (request.method === 'GET') {
    return renderPage({ store, title: `Cancel this ${c.preorder}?`, paragraphs: [`Press the button to cancel ${theItem}. We will refund you in full ${refundText}.`], form: { action: '/c', token, button: `Cancel this ${c.preorder}` } });
  }
  const r = await addTags(ctx, order.id, ['preorder-cancel-requested', orderTags.cancelRequested(vid), orderTags.cancelRequestedOn(vid, ctx.today)], { order: orderName, variant_id: vid, action: 'cancel_request' });
  if (!r.ok) return renderPage({ store, title: 'Something went wrong', paragraphs: ['We could not record your request just now. Please try again in a few minutes.', helpLine], form: { action: '/c', token, button: 'Try again' }, status: 500 });
  const refundBy = refundDeadline(store, ctx.today);
  let staffItem = itemName ? `${itemName} (${vid})` : '';
  if (!staffItem) {
    const variant = await getVariant(ctx, vid).catch(() => null);
    staffItem = variant ? `${variant.productTitle} ${cleanVariantTitle(variant.title)} (${vid})`.replace(/\s+/g, ' ') : `variant ${vid}`;
  }
  await staffAlert(ctx, {
    subject: `Cancel request: ${orderName}, ${staffItem}, refund by ${formatDate(refundBy, store)}`,
    intro: `The customer asked to cancel one ${c.preorder} item using the link in the date-change email. Cancel only this item (${openUnits} unfulfilled unit(s)); other items in the order are not affected. The Worker does not cancel or refund; please cancel it and refund it in full${store === 'us' ? '' : ', including delivery,'} by ${formatDate(refundBy, store)}.`,
    rows: [
      ['Order', 'Item', 'Quantity', 'Requested', 'Refund by', 'Admin'],
      [orderName, staffItem, String(openUnits), formatDate(ctx.today, store), formatDate(refundBy, store), adminOrderUrl(ctx, order.id)],
    ],
    key: `cancel|${numericId(order.id)}|${vid}`,
  });
  log('preorder_cancel_requested', { store, order: orderName, variant_id: vid, units: openUnits });
  return renderPage({
    store,
    title: 'We have your cancellation request',
    paragraphs: [`We received your request to cancel ${theItem} on ${formatDate(ctx.today, store)}. We will refund you in full ${refundText} and email you when it is done.`, helpLine],
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function handleHook(request, env, kind, execCtx = null) {
  if (!checkFlowKey(request, env)) {
    log('hook_unauthorised', { kind });
    return json({ ok: false, error: 'unauthorised' }, 401);
  }
  let body;
  try {
    body = await readJson(request);
  } catch {
    return json({ ok: false, error: 'bad_json' }, 400);
  }
  if (kind === 'daily') {
    if (body.store && !STORES.includes(body.store)) return json({ ok: false, error: 'unknown_store' }, 400);
    const results = await runDaily(env, { store: body.store || null, baseUrl: new URL(request.url).origin });
    return json({ ok: true, results });
  }
  const store = String(body.store || '');
  if (!STORES.includes(store) || !getShops(env)[store]) return json({ ok: false, error: 'unknown_store' }, 400);
  const ctx = makeCtx(env, store, { baseUrl: new URL(request.url).origin });
  if (kind === 'inventory') {
    // Answer Flow at once; release + fan-out run after the response within
    // one time budget. Flow never waits on (or retries because of) slow work.
    if (!numericId(body.variant_id)) return json({ ok: false, error: 'bad_variant_id' }, 400);
    const work = handleInventoryHook(ctx, body).catch((err) => {
      log('hook_error', { kind, store, error: String(err.message || err) });
      return { status: 500, body: { ok: false, error: 'server' } };
    });
    if (execCtx && typeof execCtx.waitUntil === 'function') {
      execCtx.waitUntil(work);
      return json({ ok: true, accepted: true }, 202);
    }
    const r = await work; // no execution context (local tools): run inline
    return json(r.body, r.status);
  }
  try {
    const r = await handleOrderHook(ctx, body);
    return json(r.body, r.status);
  } catch (err) {
    log('hook_error', { kind, store, error: String(err.message || err) });
    return json({ ok: false, error: 'server' }, 500);
  }
}

export async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;

  if (path === '/subscribe') {
    if (method === 'OPTIONS') {
      const origin = request.headers.get('Origin') || '';
      if (!originAllowed(env, origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (method === 'POST') return handleSubscribe(request, env);
    return json({ ok: false, error: 'method_not_allowed' }, 405, { Allow: 'POST, OPTIONS' });
  }
  if (path === '/hooks/order' || path === '/hooks/inventory' || path === '/hooks/daily') {
    if (method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    return handleHook(request, env, path.slice('/hooks/'.length), ctx);
  }
  if (path === '/u' || path === '/k' || path === '/c') {
    if (method !== 'GET' && method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } });
    try {
      return await handleLinkPage(request, env, path.slice(1));
    } catch (err) {
      log('link_page_error', { path, error: String(err.message || err) });
      return renderPage({ store: 'uk', title: 'Something went wrong', paragraphs: ['Please try again in a few minutes.'], status: 500 });
    }
  }
  if (path === '/' && method === 'GET') return new Response('falcon-stock ok', { headers: { 'content-type': 'text/plain' } });
  return new Response('Not found', { status: 404 });
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (err) {
      log('unhandled_error', { error: String((err && err.message) || err) });
      return json({ ok: false, error: 'server' }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    log('cron_start', { cron: event && event.cron });
    ctx.waitUntil(runDaily(env, {}).then((r) => log('cron_done', { results: r })));
  },
};
