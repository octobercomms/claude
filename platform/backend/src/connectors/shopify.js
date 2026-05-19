const axios = require('axios');

const authType = 'apikey';

async function checkTokenValidity(credentials) {
  const { shop_domain, access_token } = credentials;
  if (!shop_domain || !access_token) throw new Error('shop_domain and access_token required');

  const { data } = await axios.get(
    `https://${shop_domain}/admin/api/2024-01/shop.json`,
    { headers: { 'X-Shopify-Access-Token': access_token } }
  );
  if (!data.shop) throw new Error('Invalid Shopify credentials');
  return true;
}

async function fetchOrderData(credentials, startDate, endDate) {
  const { shop_domain, access_token } = credentials;
  const headers = { 'X-Shopify-Access-Token': access_token };

  const { data } = await axios.get(
    `https://${shop_domain}/admin/api/2024-01/orders.json`,
    {
      headers,
      params: {
        status: 'any',
        created_at_min: `${startDate}T00:00:00Z`,
        created_at_max: `${endDate}T23:59:59Z`,
        limit: 250,
        fields: 'id,created_at,total_price,subtotal_price,financial_status,fulfillment_status,line_items,customer',
      },
    }
  );

  return data.orders || [];
}

async function fetchProductData(credentials) {
  const { shop_domain, access_token } = credentials;
  const { data } = await axios.get(
    `https://${shop_domain}/admin/api/2024-01/products.json`,
    {
      headers: { 'X-Shopify-Access-Token': access_token },
      params: { limit: 250, fields: 'id,title,status,variants,product_type' },
    }
  );
  return data.products || [];
}

async function fetchAnalyticsData(credentials, startDate, endDate) {
  const orders = await fetchOrderData(credentials, startDate, endDate);

  const totalRevenue = orders.reduce((sum, o) => sum + parseFloat(o.total_price || 0), 0);
  const totalOrders = orders.length;
  const avgOrderValue = totalOrders ? totalRevenue / totalOrders : 0;

  const financialBreakdown = orders.reduce((acc, o) => {
    acc[o.financial_status] = (acc[o.financial_status] || 0) + 1;
    return acc;
  }, {});

  return {
    period: { start: startDate, end: endDate },
    summary: {
      total_revenue: totalRevenue.toFixed(2),
      total_orders: totalOrders,
      avg_order_value: avgOrderValue.toFixed(2),
      financial_status_breakdown: financialBreakdown,
    },
    orders: orders.slice(0, 50), // Include first 50 for detail
  };
}

async function fetchEmailData(credentials, startDate, endDate) {
  // Shopify Email data via Analytics API
  const { shop_domain, access_token } = credentials;
  const headers = { 'X-Shopify-Access-Token': access_token };

  try {
    const { data } = await axios.get(
      `https://${shop_domain}/admin/api/2024-01/reports.json`,
      { headers, params: { since_id: 0, limit: 50 } }
    );
    return { reports: data.reports || [], note: 'Shopify Email analytics via Reports API' };
  } catch {
    return { note: 'Shopify Email detailed analytics require Shopify Plus Reports API access' };
  }
}

async function fetchData(credentials, params) {
  const { connectorType, startDate, endDate } = params;
  if (connectorType === 'shopify_email') {
    return fetchEmailData(credentials, startDate, endDate);
  }
  return fetchAnalyticsData(credentials, startDate, endDate);
}

module.exports = { authType, checkTokenValidity, fetchData };
