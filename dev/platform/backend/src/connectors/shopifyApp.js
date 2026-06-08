// Shopify app connector (push model).
//
// The public Shopify app forwards HMAC-verified webhooks to
// /api/shopify-app/webhook (see routes/shopifyApp.js), stored in
// shopify_app_events. fetchData aggregates the stored order events for the
// period and returns the SAME shape as the custom-OAuth shopify connector, so
// reports, the Sales & Traffic dashboard and chat treat app-sourced stores
// identically.

const pool = require('../db');

const authType = 'shopify_app';

async function checkTokenValidity(credentials) {
  if (!credentials || !credentials.shop_domain) {
    throw new Error('Shopify store not paired — install the app and enter a pairing token.');
  }
  return true;
}

// Latest version of each order wins (events are append-only, newest-first).
function latestOrders(rows) {
  const map = new Map();
  for (const { payload } of rows) {
    const o = payload || {};
    if (o.id == null) continue;
    if (!map.has(o.id)) map.set(o.id, o);
  }
  return [...map.values()];
}

async function fetchData(credentials, params) {
  const shopDomain = credentials && credentials.shop_domain;
  if (!shopDomain) throw new Error('Shopify app connector not paired.');
  const { startDate, endDate } = params;
  const startTs = new Date(`${startDate}T00:00:00Z`).getTime();
  const endTs = new Date(`${endDate}T23:59:59Z`).getTime();

  const { rows } = await pool.query(
    `SELECT payload FROM shopify_app_events
      WHERE shop_domain = $1 AND topic IN ('ORDERS_CREATE','ORDERS_UPDATED','ORDERS_FULFILLED','ORDERS_CANCELLED')
      ORDER BY received_at DESC`,
    [shopDomain]
  );

  const orders = latestOrders(rows).filter(o => {
    const created = Date.parse(o.created_at || '');
    return Number.isFinite(created) && created >= startTs && created <= endTs;
  });

  let totalRevenue = 0;
  let refundTotal = 0;
  let refundedOrders = 0;
  const financialBreakdown = {};
  const dailyMap = {};
  const products = {};

  for (const o of orders) {
    const total = parseFloat(o.total_price || 0) || 0;
    totalRevenue += total;

    const status = (o.financial_status || 'unknown').toLowerCase();
    financialBreakdown[status] = (financialBreakdown[status] || 0) + 1;

    const refunded = (o.refunds || []).reduce((sum, r) => {
      const lineRefund = (r.refund_line_items || []).reduce((s, li) => s + parseFloat(li.subtotal || 0), 0);
      const txRefund = (r.transactions || []).reduce((s, t) => s + parseFloat(t.amount || 0), 0);
      return sum + (txRefund || lineRefund);
    }, 0);
    if (refunded > 0) { refundTotal += refunded; refundedOrders += 1; }

    const date = (o.created_at || '').slice(0, 10);
    if (date) {
      const d = dailyMap[date] || (dailyMap[date] = { date, revenue: 0, orders: 0 });
      d.revenue += total;
      d.orders += 1;
    }

    for (const li of (o.line_items || [])) {
      const key = li.product_id ? `${li.product_id}` : (li.title || li.name || 'unknown');
      if (!products[key]) products[key] = { title: li.title || li.name || key, units: 0, revenue: 0 };
      const qty = parseInt(li.quantity || 0) || 0;
      products[key].units += qty;
      products[key].revenue += parseFloat(li.price || 0) * qty;
    }
  }

  const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
  const topProducts = Object.values(products).sort((a, b) => b.revenue - a.revenue).slice(0, 15);
  const totalOrders = orders.length;
  const avgOrderValue = totalOrders ? totalRevenue / totalOrders : 0;

  return {
    period: { start: startDate, end: endDate },
    summary: {
      total_revenue: totalRevenue.toFixed(2),
      total_orders: totalOrders,
      avg_order_value: avgOrderValue.toFixed(2),
      total_refunds: refundTotal.toFixed(2),
      refunded_orders: refundedOrders,
      net_revenue: (totalRevenue - refundTotal).toFixed(2),
      financial_status_breakdown: financialBreakdown,
      daily,
    },
    top_products: topProducts,
    orders: orders.slice(0, 50),
  };
}

module.exports = { authType, checkTokenValidity, fetchData };
