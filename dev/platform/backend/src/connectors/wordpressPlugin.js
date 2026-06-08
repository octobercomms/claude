// WordPress plugin connector (push model).
//
// Unlike the REST connectors, this one holds no live HTTP client: the client's
// WP site pushes signed events to /api/wp-connect/* (see routes/wpConnect.js),
// which stores them in wp_connect_events. fetchData aggregates those stored
// events for the requested period and returns the SAME shape as the
// woocommerce connector, so reports, the Sales & Traffic dashboard and the
// chat tools treat plugin-sourced stores identically to REST-polled ones.

const pool = require('../db');

const authType = 'plugin';

// Paired connectors carry { client_id, refresh_secret, site_url, site_name }.
async function checkTokenValidity(credentials) {
  if (!credentials || !credentials.refresh_secret || !credentials.client_id) {
    throw new Error('WordPress site not paired — generate a pairing token in the dashboard and connect the plugin.');
  }
  return true;
}

// Latest payload per resource id wins. Events are append-only and ordered
// newest-first by the caller, so the first id we see is the current state.
function latestById(rows, key) {
  const map = new Map();
  for (const { payload } of rows) {
    const obj = payload && payload[key];
    if (!obj || obj.id == null) continue;
    if (!map.has(obj.id)) map.set(obj.id, obj);
  }
  return map;
}

async function fetchData(credentials, params) {
  const clientId = credentials && credentials.client_id;
  if (!clientId) throw new Error('WordPress connector not paired.');
  const { startDate, endDate } = params;

  // Period bounds as Unix seconds (orders carry date_created in seconds).
  const startTs = Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000);
  const endTs = Math.floor(new Date(`${endDate}T23:59:59Z`).getTime() / 1000);

  const [orderRes, productRes] = await Promise.all([
    pool.query(
      `SELECT payload FROM wp_connect_events
        WHERE client_id = $1 AND event_type IN ('order.upserted','order.refunded','order')
        ORDER BY received_at DESC`,
      [clientId]
    ),
    pool.query(
      `SELECT payload FROM wp_connect_events
        WHERE client_id = $1 AND event_type IN ('product.upserted','product')
        ORDER BY received_at DESC`,
      [clientId]
    ),
  ]);

  // Collapse to the latest version of each order, then keep those whose
  // creation date falls in the reporting window and that count as revenue.
  const ordersById = latestById(orderRes.rows, 'order');
  const EXCLUDED = new Set(['refunded', 'cancelled', 'failed', 'trash']);
  const orders = [...ordersById.values()].filter(o => {
    const created = Number(o.date_created || 0);
    return created >= startTs && created <= endTs && !EXCLUDED.has((o.status || '').toLowerCase());
  });

  let totalRevenue = 0;
  const dailyMap = {};
  for (const o of orders) {
    const total = parseFloat(o.total || 0) || 0;
    totalRevenue += total;
    const date = new Date(Number(o.date_created || 0) * 1000).toISOString().slice(0, 10);
    const d = dailyMap[date] || (dailyMap[date] = { date, revenue: 0, orders: 0 });
    d.revenue += total;
    d.orders += 1;
  }
  const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

  const products = [...latestById(productRes.rows, 'product').values()];

  return {
    period: { start: startDate, end: endDate },
    summary: {
      total_orders: orders.length,
      total_revenue: totalRevenue.toFixed(2),
      avg_order_value: orders.length ? (totalRevenue / orders.length).toFixed(2) : '0.00',
      auth_mode: 'wordpress_plugin',
      daily,
    },
    orders: orders.slice(0, 50),
    top_products: products.slice(0, 10),
  };
}

module.exports = { authType, checkTokenValidity, fetchData };
