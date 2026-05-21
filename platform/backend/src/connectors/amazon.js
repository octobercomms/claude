const axios = require('axios');

const authType = 'oauth';

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
  const { data } = await axios.post('https://api.amazon.com/auth/o2/token', {
    grant_type: 'authorization_code',
    code,
    client_id: process.env.AMAZON_CLIENT_ID,
    client_secret: process.env.AMAZON_CLIENT_SECRET,
  }, {
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
  // Accept seller_id-based credentials (manual entry) without requiring OAuth tokens
  if (credentials.seller_id) return true;
  if (!credentials.access_token) throw new Error('No credentials — enter your Seller ID to save this connector');
  if (credentials.expires_at && Date.now() > credentials.expires_at - 60000) {
    return refreshToken(credentials);
  }
  return true;
}

async function fetchData(credentials, params) {
  const { marketplace, startDate, endDate } = params;

  const marketplaceIds = {
    uk: 'A1F83G8C2ARO7P',
    us: 'ATVPDKIKX0DER',
    eu: 'A1PA6795UKMFR9', // Germany as EU default
  };

  const marketplaceId = marketplaceIds[marketplace] || marketplaceIds.uk;
  let creds = credentials;
  if (creds.expires_at && Date.now() > creds.expires_at - 60000) {
    creds = await refreshToken(creds);
  }

  // SP-API Sales and Traffic report
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
}

module.exports = { authType, getAuthUrl, exchangeCode, refreshToken, checkTokenValidity, fetchData };
