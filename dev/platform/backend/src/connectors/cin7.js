const axios = require('axios');

const authType = 'apikey';

function getHeaders(credentials) {
  return {
    'api-auth-accountid': credentials.account_id,
    'api-auth-applicationkey': credentials.api_key,
  };
}

async function checkTokenValidity(credentials) {
  const { account_id, api_key } = credentials;
  if (!account_id || !api_key) throw new Error('account_id and api_key required');
  const { data } = await axios.get('https://api.cin7.com/api/v1/products?rows=1', {
    headers: getHeaders(credentials),
  });
  if (!Array.isArray(data)) throw new Error('Unexpected Cin7 API response');
  return true;
}

async function fetchData(credentials, params) {
  const { startDate, endDate } = params;
  const headers = getHeaders(credentials);

  const [stockResult, ordersResult] = await Promise.allSettled([
    axios.get('https://api.cin7.com/api/v1/stockOnHand?rows=250', { headers }),
    axios.get(
      `https://api.cin7.com/api/v1/SaleOrders?rows=250&StartCreatedDate=${startDate}&EndCreatedDate=${endDate}`,
      { headers }
    ),
  ]);

  const stock = stockResult.status === 'fulfilled' ? (stockResult.value.data || []) : [];
  const orders = ordersResult.status === 'fulfilled' ? (ordersResult.value.data || []) : [];

  return { stock, orders };
}

module.exports = { authType, checkTokenValidity, fetchData };
