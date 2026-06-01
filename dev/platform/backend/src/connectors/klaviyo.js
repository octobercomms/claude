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

  // Klaviyo's filter language compares datetime fields like scheduled_at
  // against ISO 8601 timestamps with a Z (UTC) suffix. Passing a bare
  // YYYY-MM-DD returns HTTP 400 — the API treats date-only literals as
  // an invalid type for datetime comparison.
  const startIso = `${startDate}T00:00:00Z`;
  const endIso = `${endDate}T23:59:59Z`;

  const [campaignsRes, metricsRes] = await Promise.all([
    axios.get('https://a.klaviyo.com/api/campaigns/', {
      headers,
      params: {
        'filter': `and(equals(messages.channel,'email'),greater-or-equal(scheduled_at,${startIso}),less-or-equal(scheduled_at,${endIso}))`,
        'fields[campaign]': 'name,status,scheduled_at',
        'page[size]': 50,
      },
    }).catch(e => { throw klaviyoError('GET /campaigns/', e, { startIso, endIso }); }),
    axios.get('https://a.klaviyo.com/api/metrics/', {
      headers,
      params: { 'page[size]': 100 },
    }).catch(e => { throw klaviyoError('GET /metrics/', e); }),
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
              timeframe: { start: startIso, end: endIso },
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

// Pull the actual error detail out of Klaviyo's response body and rethrow
// with it. Axios's default err.message is just "Request failed with status
// code 400" — useless for diagnosing which filter the API choked on.
// Klaviyo's body shape: { errors: [{ status, code, title, detail, source }] }
function klaviyoError(endpoint, err, ctx) {
  const status = err.response?.status;
  const body = err.response?.data;
  const detail = body?.errors?.[0]?.detail
    || body?.errors?.[0]?.title
    || (typeof body === 'string' ? body : null)
    || err.message;
  const code = body?.errors?.[0]?.code ? ` [${body.errors[0].code}]` : '';
  const ctxStr = ctx ? ` (${Object.entries(ctx).map(([k, v]) => `${k}=${v}`).join(', ')})` : '';
  const wrapped = new Error(`Klaviyo ${endpoint} ${status || 'request'} failed${code}: ${detail}${ctxStr}`);
  wrapped.response = err.response;
  return wrapped;
}

module.exports = { authType, checkTokenValidity, fetchData };
