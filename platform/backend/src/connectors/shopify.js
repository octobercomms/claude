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

  let url = `https://${shop_domain}/admin/api/2024-01/orders.json`;
  let params = {
    status: 'any',
    created_at_min: `${startDate}T00:00:00Z`,
    created_at_max: `${endDate}T23:59:59Z`,
    limit: 250,
    fields: 'id,created_at,total_price,subtotal_price,financial_status,fulfillment_status,line_items,customer',
  };

  const orders = [];
  // Shopify caps a page at 250 orders and paginates via a cursor in the
  // Link header — follow rel="next" until exhausted (50-page safety cap).
  for (let page = 0; page < 50 && url; page++) {
    const res = await axios.get(url, { headers, params });
    orders.push(...(res.data.orders || []));
    const link = res.headers.link || res.headers.Link || '';
    const next = link.split(',').find(s => s.includes('rel="next"'));
    const match = next && next.match(/<([^>]+)>/);
    url = match ? match[1] : null;
    params = undefined; // the next-page URL already carries limit + page_info
  }

  return orders;
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
  const { shop_domain, access_token } = credentials;
  const headers = { 'X-Shopify-Access-Token': access_token };

  const errors = [];

  // Marketing Events API — captures email sends, open/click metrics (requires read_marketing_events scope)
  let marketingEvents = [];
  try {
    const { data } = await axios.get(
      `https://${shop_domain}/admin/api/2024-01/marketing_events.json`,
      {
        headers,
        params: {
          limit: 250,
          started_at_min: `${startDate}T00:00:00Z`,
          started_at_max: `${endDate}T23:59:59Z`,
        },
      }
    );
    marketingEvents = data.marketing_events || [];
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.errors || err.message;
    errors.push(`marketing_events (${status}): ${JSON.stringify(msg)}`);
    console.error('[Shopify Email] marketing_events fetch failed:', status, msg);
  }

  // Reports API — custom report list (requires read_reports scope)
  let reports = [];
  try {
    const { data } = await axios.get(
      `https://${shop_domain}/admin/api/2024-01/reports.json`,
      { headers, params: { limit: 50 } }
    );
    reports = data.reports || [];
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.errors || err.message;
    errors.push(`reports (${status}): ${JSON.stringify(msg)}`);
    console.error('[Shopify Email] reports fetch failed:', status, msg);
  }

  const result = { marketing_events: marketingEvents, reports };
  if (errors.length) result.fetch_errors = errors;
  return result;
}

async function fetchData(credentials, params) {
  const { connectorType, startDate, endDate } = params;
  if (connectorType === 'shopify_email') {
    return fetchEmailData(credentials, startDate, endDate);
  }
  return fetchAnalyticsData(credentials, startDate, endDate);
}

module.exports = { authType, checkTokenValidity, fetchData };
