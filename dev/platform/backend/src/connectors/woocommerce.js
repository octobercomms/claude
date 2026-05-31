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

  const [ordersRes, productsRes] = await Promise.all([
    client.get('/orders', {
      params: {
        after: `${startDate}T00:00:00`,
        before: `${endDate}T23:59:59`,
        per_page: 100,
        status: 'any',
      },
    }),
    client.get('/products', { params: { per_page: 50, status: 'publish' } }),
  ]);

  const orders = ordersRes.data;
  const totalRevenue = orders.reduce((sum, o) => sum + parseFloat(o.total || 0), 0);

  return {
    period: { start: startDate, end: endDate },
    summary: {
      total_orders: orders.length,
      total_revenue: totalRevenue.toFixed(2),
      avg_order_value: orders.length ? (totalRevenue / orders.length).toFixed(2) : '0.00',
    },
    orders: orders.slice(0, 50),
    top_products: productsRes.data.slice(0, 10),
  };
}

module.exports = { authType, checkTokenValidity, fetchData };
