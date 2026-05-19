const axios = require('axios');

const authType = 'apikey';

function getHeaders(credentials) {
  if (!credentials.api_key) throw new Error('api_key required');
  return {
    Authorization: `Klaviyo-API-Key ${credentials.api_key}`,
    revision: '2024-10-15',
    Accept: 'application/json',
  };
}

async function checkTokenValidity(credentials) {
  const headers = getHeaders(credentials);
  const { data } = await axios.get('https://a.klaviyo.com/api/accounts/', { headers });
  if (!data.data) throw new Error('Invalid Klaviyo API key');
  return true;
}

async function fetchData(credentials, params) {
  const { startDate, endDate } = params;
  const headers = getHeaders(credentials);

  const [campaignsRes, metricsRes] = await Promise.all([
    axios.get('https://a.klaviyo.com/api/campaigns/', {
      headers,
      params: {
        'filter': `and(equals(messages.channel,'email'),greater-or-equal(scheduled_at,${startDate}),less-or-equal(scheduled_at,${endDate}))`,
        'fields[campaign]': 'name,status,scheduled_at',
        'page[size]': 50,
      },
    }),
    axios.get('https://a.klaviyo.com/api/metrics/', {
      headers,
      params: { 'page[size]': 20 },
    }),
  ]);

  // Aggregate campaign stats
  const campaigns = campaignsRes.data.data || [];

  return {
    period: { start: startDate, end: endDate },
    campaigns: campaigns.map(c => ({
      name: c.attributes.name,
      status: c.attributes.status,
      scheduled_at: c.attributes.scheduled_at,
    })),
    total_campaigns: campaigns.length,
    note: 'Full open/click rates available via campaign metrics API',
  };
}

module.exports = { authType, checkTokenValidity, fetchData };
