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
      params: { 'page[size]': 100 },
    }),
  ]);

  const campaigns = campaignsRes.data.data || [];
  const campaignName = {};
  campaigns.forEach(c => { campaignName[c.id] = c.attributes?.name; });

  // The Campaign Values report needs a conversion metric to attribute revenue —
  // "Placed Order" is the Shopify/ecommerce default.
  const metrics = metricsRes.data.data || [];
  const orderMetric = metrics.find(m => /^placed order$/i.test(m.attributes?.name || ''))
    || metrics.find(m => /placed order|ordered product|checkout/i.test(m.attributes?.name || ''));

  let performance = [];
  let note = null;
  if (!orderMetric) {
    note = 'No "Placed Order" conversion metric found in Klaviyo — campaign list returned without per-campaign performance.';
  } else if (campaigns.length) {
    try {
      const { data } = await axios.post(
        'https://a.klaviyo.com/api/campaign-values-reports/',
        {
          data: {
            type: 'campaign-values-report',
            attributes: {
              timeframe: { start: `${startDate}T00:00:00`, end: `${endDate}T23:59:59` },
              conversion_metric_id: orderMetric.id,
              statistics: [
                'recipients', 'delivered', 'opens_unique', 'open_rate',
                'clicks_unique', 'click_rate', 'conversions', 'conversion_value',
                'unsubscribes',
              ],
            },
          },
        },
        { headers }
      );
      const results = data.data?.attributes?.results || [];
      performance = results.map(r => ({
        campaign_id: r.groupings?.campaign_id,
        name: campaignName[r.groupings?.campaign_id] || r.groupings?.campaign_id,
        statistics: r.statistics,
      }));
    } catch (err) {
      const detail = err.response?.data?.errors?.[0]?.detail || err.message;
      note = `Per-campaign performance report unavailable: ${detail}`;
    }
  }

  const result = {
    period: { start: startDate, end: endDate },
    campaigns: campaigns.map(c => ({
      id: c.id,
      name: c.attributes.name,
      status: c.attributes.status,
      scheduled_at: c.attributes.scheduled_at,
    })),
    total_campaigns: campaigns.length,
    performance,
  };
  if (note) result.note = note;
  return result;
}

module.exports = { authType, checkTokenValidity, fetchData };
