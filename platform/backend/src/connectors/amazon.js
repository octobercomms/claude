const axios = require('axios');

const authType = 'apikey';

// Amazon SP-API requires a registered developer app
// See: https://developer-docs.amazon.com/sp-api/docs/registering-your-application

function getAuthUrl(state) {
  const params = new URLSearchParams({
    application_id: process.env.AMAZON_CLIENT_ID,
    state,
    version: 'beta',
  });
  return `https://sellercentral.amazon.co.uk/apps/authorize/consent?${params}`;
}

async function exchangeCode(code) {
  const { data } = await axios.post('https://api.amazon.com/auth/o2/token', new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: process.env.AMAZON_CLIENT_ID,
    client_secret: process.env.AMAZON_CLIENT_SECRET,
    redirect_uri: process.env.AMAZON_REDIRECT_URI || '',
  }), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
}

async function refreshToken(credentials) {
  const { data } = await axios.post('https://api.amazon.com/auth/o2/token', {
    grant_type: 'refresh_token',
    refresh_token: credentials.refresh_token,
    client_id: process.env.AMAZON_CLIENT_ID,
    client_secret: process.env.AMAZON_CLIENT_SECRET,
  }, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  return {
    ...credentials,
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
}

async function checkTokenValidity(credentials) {
  if (!credentials) throw new Error('No credentials');
  if (!credentials.refresh_token) {
    throw new Error('Amazon SP-API requires a Refresh Token — generate one via the Solution Provider Portal → Manage Authorizations → Authorize app');
  }
  // Exchange refresh token for access token to verify it works
  try {
    const refreshed = await refreshToken(credentials);
    return refreshed;
  } catch (err) {
    throw new Error(`Amazon token exchange failed: ${err.message}`);
  }
}

async function fetchData(credentials, params) {
  if (!credentials.refresh_token) {
    throw new Error('Amazon SP-API requires a Refresh Token — generate one via the Solution Provider Portal → Manage Authorizations → Authorize app');
  }

  const { marketplace, startDate, endDate } = params;

  const marketplaceIds = {
    uk: 'A1F83G8C2ARO7P',
    us: 'ATVPDKIKX0DER',
    fr: 'A13V1IB3VIYZZH',
    de: 'A1PA6795UKMFR9',
    eu: 'A1PA6795UKMFR9',
  };

  const marketplaceId = marketplaceIds[marketplace] || marketplaceIds.uk;
  let creds = credentials;
  if (!creds.access_token || (creds.expires_at && Date.now() > creds.expires_at - 60000)) {
    creds = await refreshToken(creds);
  }

  // SP-API Sales and Traffic report
  try {
  const { data } = await axios.get(
    'https://sellingpartnerapi-eu.amazon.com/sales/v1/orderMetrics',
    {
      headers: {
        Authorization: `Bearer ${creds.access_token}`,
        'x-amz-access-token': creds.access_token,
      },
      params: {
        marketplaceIds: marketplaceId,
        interval: `${startDate}T00:00:00+00:00--${endDate}T23:59:59+00:00`,
        granularity: 'Total',
      },
    }
  );
  return data;
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.errors?.[0]?.message || err.response?.data || err.message;
    if (status === 403) throw new Error(`Amazon SP-API 403: App does not have permission to access this data. Ensure your Amazon Developer app has been granted the required SP-API roles (Selling Partner Insights) and that the seller has authorised the app.`);
    throw new Error(`Amazon SP-API error (${status}): ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
}

module.exports = { authType, getAuthUrl, exchangeCode, refreshToken, checkTokenValidity, fetchData };
