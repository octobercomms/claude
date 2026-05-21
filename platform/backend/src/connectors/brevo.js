const axios = require('axios');

const authType = 'apikey';

function getHeaders(credentials) {
  if (!credentials.api_key) throw new Error('api_key required');
  return { 'api-key': credentials.api_key.trim(), Accept: 'application/json' };
}

async function checkTokenValidity(credentials) {
  const headers = getHeaders(credentials);
  try {
    const { data } = await axios.get('https://api.brevo.com/v3/account', { headers });
    if (!data.email) throw new Error('Invalid Brevo API key — no account returned');
    return true;
  } catch (err) {
    const detail = err.response?.data?.message || err.response?.data?.error || err.message;
    const status = err.response?.status;
    if (status === 401) throw new Error('Brevo API key is invalid or unauthorised (401) — make sure you\'re using a v3 API key from Brevo → Settings → API Keys, not an SMTP key');
    throw new Error(`Brevo error (${status || 'network'}): ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
}

async function fetchData(credentials, params) {
  const { startDate, endDate } = params;
  const headers = getHeaders(credentials);

  const [campaignsRes, statsRes] = await Promise.all([
    axios.get('https://api.brevo.com/v3/emailCampaigns', {
      headers,
      params: {
        status: 'sent',
        startDate,
        endDate,
        limit: 50,
        offset: 0,
        sort: 'desc',
      },
    }),
    axios.get('https://api.brevo.com/v3/smtp/statistics/aggregatedReport', {
      headers,
      params: { startDate, endDate, days: 30 },
    }),
  ]);

  const campaigns = campaignsRes.data.campaigns || [];

  return {
    period: { start: startDate, end: endDate },
    campaigns: campaigns.map(c => ({
      name: c.name,
      subject: c.subject,
      sent_date: c.sentDate,
      statistics: c.statistics,
    })),
    aggregated_stats: statsRes.data,
    total_campaigns: campaigns.length,
  };
}

module.exports = { authType, checkTokenValidity, fetchData };
