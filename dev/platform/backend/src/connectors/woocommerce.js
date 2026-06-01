const axios = require('axios');

const authType = 'apikey';

function getClient(credentials) {
  const { store_url, consumer_key, consumer_secret } = credentials;
  if (!store_url || !consumer_key || !consumer_secret) {
    throw new Error('store_url, consumer_key, and consumer_secret required');
  }
  return axios.create({
    baseURL: `${store_url.replace(/\/$/, '')}/wp-json/wc/v3`,
    auth: { username: consumer_key, password: consumer_secret },
  });
}

async function checkTokenValidity(credentials) {
  const client = getClient(credentials);
  const { data } = await client.get('/');
  if (!data) throw new Error('Invalid WooCommerce credentials');
  return true;
}

async function fetchData(credentials, params) {
  const { startDate, endDate } = params;
  const client = getClient(credentials);

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
    const res = await client.get('/orders', {
      params: {
        after: `${startDate}T00:00:00`,
        before: `${endDate}T23:59:59`,
        per_page: PER_PAGE,
        page,
        status: 'processing,completed',
      },
    });
    orders.push(...res.data);
    lastPageSize = res.data.length;
    totalPages = parseInt(res.headers['x-wp-totalpages'] || '0', 10);
    if (lastPageSize < PER_PAGE) break;
    if (totalPages && page >= totalPages) break;
  }
  const truncated = totalPages > MAX_PAGES || (!totalPages && lastPageSize === PER_PAGE && orders.length === MAX_PAGES * PER_PAGE);

  const productsRes = await client.get('/products', { params: { per_page: 50, status: 'publish' } });

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
    },
    orders: orders.slice(0, 50),
    top_products: productsRes.data.slice(0, 10),
  };
}

module.exports = { authType, checkTokenValidity, fetchData };
