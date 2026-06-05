const axios = require('axios');

const authType = 'apikey';

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
  });
}

// Translate the WordPress / WooCommerce error response into a
// human-readable diagnosis the AM can act on. WP returns an error
// `code` like `woocommerce_rest_cannot_view` or
// `rest_no_route` — each maps to a specific cause.
function explain401(body) {
  const code = body?.code;
  const message = body?.message;
  const hints = [];
  if (code === 'woocommerce_rest_authentication_error' || code === 'woocommerce_rest_cannot_view') {
    hints.push('Likely an invalid or revoked consumer_key / consumer_secret.');
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
  return [
    message || 'WooCommerce returned 401 Unauthorized',
    ...hints,
  ].join(' · ');
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
    if (qp.status >= 200 && qp.status < 300) {
      // Stamp this on the credentials so fetchData uses query-param
      // auth too without re-discovering — but we can't write to
      // credentials from here. The fetchData path will discover the
      // same fallback path the same way.
      return true;
    }
    if (qp.status === 401) {
      throw new Error(`401 Unauthorized — ${explain401(qp.data || res.data)}`);
    }
    throw new Error(`Query-param fallback returned ${qp.status}: ${qp.data?.message || 'unknown error'}`);
  }
  if (res.status === 404) {
    throw new Error('404 from /wp-json/wc/v3 — REST API not found. Check the store URL and that WooCommerce is installed + permalinks are not set to Plain.');
  }
  throw new Error(`WooCommerce returned ${res.status}: ${res.data?.message || 'unknown error'}`);
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

  return {
    period: { start: startDate, end: endDate },
    summary: {
      total_orders: orders.length,
      total_revenue: totalRevenue.toFixed(2),
      avg_order_value: orders.length ? (totalRevenue / orders.length).toFixed(2) : '0.00',
      truncated: truncated || undefined,
      auth_mode: mode,
    },
    orders: orders.slice(0, 50),
    top_products: productsRes.data.slice(0, 10),
  };
}

module.exports = { authType, checkTokenValidity, fetchData };
