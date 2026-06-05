const axios = require('axios');

const authType = 'apikey';

// Headers we send on every WooCommerce REST request. Some WP security
// layers (Imunify360, Solid Security, BBQ Firewall) serve a CAPTCHA
// challenge to anything they don't recognise as a real browser; the
// axios default User-Agent ("axios/1.x.x") trips them. Use a UA that
// both passes browser-style heuristics AND identifies the platform so
// site owners can choose to allow-list it.
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; OctoberMarketingIntelligence/1.0; +https://platform.octobercomms.com)',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Encoding': 'gzip, deflate',
  'Accept-Language': 'en-GB,en;q=0.9',
};

// Build the request URL — strip trailing slash on store_url so we don't
// end up with /wp-json//wc/v3.
function buildBase(credentials) {
  const { store_url } = credentials;
  if (!store_url) throw new Error('store_url required');
  return `${store_url.replace(/\/$/, '')}/wp-json/wc/v3`;
}

// HTTP Basic Auth client. This is the canonical WooCommerce auth on
// HTTPS — but it depends on the Authorization header making it from
// the load balancer to PHP. cPanel / WHM / some Nginx + FastCGI setups
// strip the header before it reaches WP, which gives a 401 even with
// correct keys.
function basicClient(credentials) {
  const { consumer_key, consumer_secret } = credentials;
  if (!consumer_key || !consumer_secret) {
    throw new Error('consumer_key and consumer_secret required');
  }
  return axios.create({
    baseURL: buildBase(credentials),
    auth: { username: consumer_key, password: consumer_secret },
    timeout: 30000,
    validateStatus: () => true,
    headers: DEFAULT_HEADERS,
  });
}

// Query-param fallback. WooCommerce also accepts ?consumer_key=…&
// consumer_secret=… as a documented fallback for hosts that strip
// Authorization headers. Less secure (keys end up in access logs) so
// we only use this when Basic Auth has already failed with 401.
function queryParamGet(credentials, path, extraParams = {}) {
  return axios.get(`${buildBase(credentials)}${path}`, {
    params: {
      consumer_key: credentials.consumer_key,
      consumer_secret: credentials.consumer_secret,
      ...extraParams,
    },
    timeout: 30000,
    validateStatus: () => true,
    headers: DEFAULT_HEADERS,
  });
}

// Translate the WordPress / WooCommerce error response into a
// human-readable diagnosis the AM can act on. WP returns an error
// `code` like `woocommerce_rest_cannot_view` or
// `rest_no_route` — each maps to a specific cause.
function explain401(body, headers = {}) {
  const code = body?.code;
  const message = body?.message;
  const hints = [];
  if (code === 'woocommerce_rest_authentication_error' || code === 'woocommerce_rest_cannot_view') {
    hints.push('Likely an invalid or revoked consumer_key / consumer_secret — regenerate the keys in WooCommerce → Settings → Advanced → REST API.');
  }
  if (code === 'woocommerce_rest_invalid_signature' || code === 'woocommerce_rest_invalid_oauth') {
    hints.push('Authorization header may be stripped by the host; try a different REST mode or regenerate keys.');
  }
  if (code === 'rest_no_route') {
    hints.push('REST API not enabled — check Permalinks (Settings → Permalinks → not "Plain") and that WooCommerce is installed.');
  }
  if (code === 'rest_forbidden') {
    hints.push('The API key user does not have Read access. Regenerate keys for an admin / Shop Manager user.');
  }
  // Body was HTML rather than JSON — usually means a security plugin
  // (Wordfence, Sucuri) or a WAF intercepted the request before
  // WordPress saw it.
  if (typeof body === 'string' && /<html|<!DOCTYPE/i.test(body)) {
    const m = body.match(/<title>([^<]+)<\/title>/i);
    const title = m ? m[1].trim() : null;
    // Title-based fingerprints
    if (title && /security verification|just a moment|attention required/i.test(title)) {
      hints.push(`Response was HTML ("${title}") — that title pattern is Cloudflare's Browser Integrity Check or Sucuri's WAF JavaScript challenge. Whitelist the platform IP at the firewall (Cloudflare → Security → WAF → IP Access Rules; Sucuri → Settings → IP Allowlist), or for Cloudflare add a Page Rule on /wp-json/* that disables Bot Fight Mode / Browser Integrity Check / Security Level → Essentially Off.`);
    } else if (title && /sucuri/i.test(title)) {
      hints.push(`Response was HTML ("${title}") — Sucuri WAF blocking. Allow the platform IP in the Sucuri dashboard → Settings → IP Allowlist.`);
    } else if (title && /wordfence/i.test(title)) {
      hints.push(`Response was HTML ("${title}") — Wordfence blocking. Allow the platform IP in Wordfence → Firewall → Allowlisted IPs.`);
    } else if (title) {
      hints.push(`Response was HTML ("${title}") — looks like a security plugin or WAF blocking REST API calls. Whitelist the platform IP in Wordfence / Sucuri / your firewall, or temporarily disable to confirm.`);
    } else {
      hints.push('Response was HTML rather than JSON — security plugin or WAF blocking REST API calls. Whitelist the platform IP in your security tooling.');
    }
  }
  // Server / firewall fingerprints in the response headers.
  const server = headers.server || '';
  const wafHints = [];
  if (/cloudflare/i.test(server) || headers['cf-ray']) wafHints.push('Cloudflare');
  if (headers['x-sucuri-id'] || headers['x-sucuri-cache']) wafHints.push('Sucuri');
  if (headers['x-wf-firewall']) wafHints.push('Wordfence');
  if (wafHints.length) {
    hints.push(`Detected: ${wafHints.join(' + ')}. Add the platform server's outbound IP to its allow-list.`);
  }
  return [
    message || `WooCommerce returned 401 Unauthorized${code ? ` (${code})` : ''}`,
    ...hints,
  ].join(' · ');
}

// Best-effort lookup of the egress IP this server uses to reach the
// public internet. Cached for the lifetime of the process — IPs
// don't change often and we don't want to hit an external service
// on every diagnose.
let CACHED_OUTBOUND_IP = null;
async function getOutboundIp() {
  if (CACHED_OUTBOUND_IP) return CACHED_OUTBOUND_IP;
  // Env var wins — set this in production to skip the network probe.
  if (process.env.PLATFORM_OUTBOUND_IP) {
    CACHED_OUTBOUND_IP = process.env.PLATFORM_OUTBOUND_IP;
    return CACHED_OUTBOUND_IP;
  }
  try {
    const { data } = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
    CACHED_OUTBOUND_IP = data?.ip || null;
  } catch { /* ignore */ }
  return CACHED_OUTBOUND_IP;
}

// Probe the bare WP REST root with no auth. If THIS 401s too, the
// blocker is server-side (security plugin / WAF), not WooCommerce
// credentials. Also resolves the origin's address family so the
// diagnose can flag IPv4 vs IPv6 quirks — 20i + a few other hosts
// answer differently per family.
async function probeWpRest(credentials) {
  const base = credentials.store_url.replace(/\/$/, '');
  let resolvedAddress = null;
  let resolvedFamily = null;
  try {
    const host = new URL(base).hostname;
    const dns = require('dns').promises;
    const addr = await dns.lookup(host);
    resolvedAddress = addr.address;
    resolvedFamily = addr.family;
  } catch { /* ignore */ }
  try {
    const res = await axios.get(`${base}/wp-json/`, {
      timeout: 15000,
      validateStatus: () => true,
      headers: DEFAULT_HEADERS,
    });
    return {
      status: res.status, headers: res.headers, body: res.data,
      resolvedAddress, resolvedFamily,
    };
  } catch (err) {
    return { status: 0, error: err.message, resolvedAddress, resolvedFamily };
  }
}

async function checkTokenValidity(credentials) {
  // Try Basic Auth first — the documented preferred method on HTTPS.
  const basic = basicClient(credentials);
  const res = await basic.get('/');
  if (res.status >= 200 && res.status < 300) return true;

  // 401 on Basic Auth: try query-param fallback. Many shared hosts
  // strip the Authorization header so this is the realistic recovery
  // path.
  if (res.status === 401) {
    const qp = await queryParamGet(credentials, '/');
    if (qp.status >= 200 && qp.status < 300) return true;
    if (qp.status === 401) {
      // Both auth modes failed — probe the bare WP REST root with no
      // auth at all to tell credentials problems apart from WAF /
      // security-plugin blocking.
      const probe = await probeWpRest(credentials);
      const hints = [];
      if (probe.status === 0) {
        hints.push(`Could not reach the site at all (${probe.error}).`);
      } else if (probe.status >= 200 && probe.status < 300) {
        hints.push('The unauthenticated WP REST root works, so the blocker is specifically the WooCommerce / authenticated REST path. Most likely an invalid consumer_key / consumer_secret — regenerate them in WooCommerce → Settings → Advanced → REST API (use an admin or Shop Manager user).');
      } else {
        hints.push(`Even unauthenticated /wp-json/ returns ${probe.status} — the blocker is the server, not credentials. Look for security plugins (Wordfence, Sucuri), a CDN / WAF (Cloudflare), or restrictive .htaccess rules that block the REST API.`);
      }
      // Surface the platform's outbound IP so the AM has the exact
      // value to whitelist on the WAF dashboard.
      const ip = await getOutboundIp();
      if (ip) hints.push(`Whitelist this platform IP: ${ip}`);
      // Flag IPv6-vs-IPv4 origin resolution so we can spot quirks
      // like 20i hosting answering bot challenges on v6 while v4
      // works fine.
      if (probe.resolvedAddress && probe.resolvedFamily) {
        hints.push(`Origin resolved to ${probe.resolvedAddress} (IPv${probe.resolvedFamily}).`);
      }
      const body = qp.data || res.data;
      const headers = qp.headers || res.headers || {};
      throw new Error(`401 Unauthorized — ${explain401(body, headers)}${hints.length ? ' · ' + hints.join(' ') : ''}`);
    }
    throw new Error(`Query-param fallback returned ${qp.status}: ${qp.data?.message || (typeof qp.data === 'string' ? qp.data.slice(0, 120) : 'unknown error')}`);
  }
  if (res.status === 404) {
    throw new Error('404 from /wp-json/wc/v3 — REST API not found. Check the store URL and that WooCommerce is installed + permalinks are not set to Plain.');
  }
  throw new Error(`WooCommerce returned ${res.status}: ${res.data?.message || (typeof res.data === 'string' ? res.data.slice(0, 120) : 'unknown error')}`);
}

// Like checkTokenValidity but resolves to the auth mode (`'basic'` or
// `'query'`) so the calling code in fetchData can reuse it without a
// second probe. Throws if neither works.
async function resolveAuthMode(credentials) {
  const basic = basicClient(credentials);
  const res = await basic.get('/');
  if (res.status >= 200 && res.status < 300) return 'basic';
  if (res.status === 401) {
    const qp = await queryParamGet(credentials, '/');
    if (qp.status >= 200 && qp.status < 300) return 'query';
    throw new Error(`401 Unauthorized — ${explain401(qp.data || res.data)}`);
  }
  throw new Error(`WooCommerce returned ${res.status}: ${res.data?.message || 'unknown'}`);
}

async function fetchData(credentials, params) {
  const { startDate, endDate } = params;
  const mode = await resolveAuthMode(credentials);
  const useQuery = mode === 'query';
  const basic = basicClient(credentials);

  async function wcGet(path, extra = {}) {
    if (useQuery) return queryParamGet(credentials, path, extra);
    return basic.get(path, { params: extra });
  }

  // WooCommerce's /orders endpoint caps per_page at 100 and silently
  // truncates without paginating. For a year-long range (used by the
  // yearly time-series rows) the result was always "exactly 100 orders"
  // regardless of true volume. Loop through pages — Woo returns
  // X-WP-TotalPages so we know when to stop. Hard cap at 50 pages /
  // 5,000 orders so a runaway query can't tie up the worker.
  // status: 'any' was including cancelled, refunded, failed and pending
  // orders alongside the real commercial ones — which inflated counts and
  // (because refunded orders keep their original `total`) inflated revenue
  // by the full pre-refund amount on top. Restrict to processing and
  // completed (the two Woo statuses for orders that actually contributed
  // revenue), then subtract any partial-refund amounts so the net is
  // accurate.
  const PER_PAGE = 100;
  const MAX_PAGES = 50;
  const orders = [];
  let totalPages = 0;
  let lastPageSize = PER_PAGE;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await wcGet('/orders', {
      after: `${startDate}T00:00:00`,
      before: `${endDate}T23:59:59`,
      per_page: PER_PAGE,
      page,
      status: 'processing,completed',
    });
    if (res.status >= 400) throw new Error(`WooCommerce orders fetch ${res.status}: ${res.data?.message || 'unknown'}`);
    orders.push(...res.data);
    lastPageSize = res.data.length;
    totalPages = parseInt(res.headers['x-wp-totalpages'] || '0', 10);
    if (lastPageSize < PER_PAGE) break;
    if (totalPages && page >= totalPages) break;
  }
  const truncated = totalPages > MAX_PAGES || (!totalPages && lastPageSize === PER_PAGE && orders.length === MAX_PAGES * PER_PAGE);

  const productsRes = await wcGet('/products', { per_page: 50, status: 'publish' });

  // Net revenue = sum of order totals minus any refund amounts already
  // recorded against those orders. Woo stores refunds as negative-total
  // child records in `order.refunds`, with `total` as a negative string
  // like "-25.00". Adding them sums to the net.
  const totalRevenue = orders.reduce((sum, o) => {
    const orderTotal = parseFloat(o.total || 0);
    const refundTotal = (o.refunds || []).reduce((r, ref) => r + parseFloat(ref.total || 0), 0);
    return sum + orderTotal + refundTotal;
  }, 0);

  // Per-day buckets — date_created is ISO in the site's timezone with no
  // offset, so slicing the first 10 chars gives the local-store date.
  // Used by the Sales & Traffic dashboard for the daily chart (GA4
  // undercounts transactions; ecom is the source of truth).
  const dailyMap = {};
  for (const o of orders) {
    const date = (o.date_created || '').slice(0, 10);
    if (!date) continue;
    const orderTotal = parseFloat(o.total || 0);
    const refundTotal = (o.refunds || []).reduce((r, ref) => r + parseFloat(ref.total || 0), 0);
    const d = dailyMap[date] || (dailyMap[date] = { date, revenue: 0, orders: 0 });
    d.revenue += orderTotal + refundTotal;
    d.orders += 1;
  }
  const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

  return {
    period: { start: startDate, end: endDate },
    summary: {
      total_orders: orders.length,
      total_revenue: totalRevenue.toFixed(2),
      avg_order_value: orders.length ? (totalRevenue / orders.length).toFixed(2) : '0.00',
      truncated: truncated || undefined,
      auth_mode: mode,
      daily,
    },
    orders: orders.slice(0, 50),
    top_products: productsRes.data.slice(0, 10),
  };
}

module.exports = { authType, checkTokenValidity, fetchData };
