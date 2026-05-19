const axios = require('axios');

const authType = 'oauth';

const SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/content',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

function getAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function exchangeCode(code) {
  const { data } = await axios.post('https://oauth2.googleapis.com/token', {
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    grant_type: 'authorization_code',
  });
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    scope: data.scope,
  };
}

async function refreshToken(credentials) {
  if (!credentials.refresh_token) throw new Error('No refresh token available');
  const { data } = await axios.post('https://oauth2.googleapis.com/token', {
    refresh_token: credentials.refresh_token,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  return {
    ...credentials,
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
}

async function checkTokenValidity(credentials) {
  if (!credentials || !credentials.access_token) throw new Error('No credentials');
  // Refresh if expired
  if (credentials.expires_at && Date.now() > credentials.expires_at - 60000) {
    return refreshToken(credentials);
  }
  const { data } = await axios.get(
    `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${credentials.access_token}`
  );
  if (data.error) throw new Error(data.error);
  return true;
}

async function getValidToken(credentials) {
  if (!credentials) throw new Error('No credentials configured');
  if (!credentials.expires_at || Date.now() > credentials.expires_at - 60000) {
    return refreshToken(credentials);
  }
  return credentials;
}

// GA4 data fetch
async function fetchGA4Data(credentials, params) {
  const creds = await getValidToken(credentials);
  const { propertyId, startDate, endDate } = params;
  if (!propertyId) throw new Error('GA4 property not selected — open the client connectors tab and choose a property.');

  const { data } = await axios.post(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      dateRanges: [
        { startDate, endDate },
        { startDate: getPreviousPeriodStart(startDate, endDate), endDate: getPreviousPeriodEnd(startDate, endDate) },
      ],
      metrics: [
        { name: 'sessions' }, { name: 'activeUsers' }, { name: 'screenPageViews' },
        { name: 'bounceRate' }, { name: 'averageSessionDuration' }, { name: 'conversions' },
        { name: 'totalRevenue' },
      ],
      dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }],
    },
    { headers: { Authorization: `Bearer ${creds.access_token}` } }
  );
  return data;
}

// Search Console data fetch
async function fetchSearchConsoleData(credentials, params) {
  const creds = await getValidToken(credentials);
  const { siteUrl, startDate, endDate } = params;
  if (!siteUrl) throw new Error('Search Console site not selected — open the client connectors tab and choose a site.');

  const { data } = await axios.post(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      startDate, endDate,
      dimensions: ['query', 'page', 'device', 'country'],
      rowLimit: 100,
    },
    { headers: { Authorization: `Bearer ${creds.access_token}` } }
  );
  return data;
}

// Google Ads data fetch
async function fetchGoogleAdsData(credentials, params) {
  const creds = await getValidToken(credentials);
  const { customerId, startDate, endDate } = params;

  const query = `
    SELECT campaign.name, metrics.clicks, metrics.impressions, metrics.ctr,
           metrics.average_cpc, metrics.conversions, metrics.cost_micros,
           metrics.conversion_value
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    ORDER BY metrics.cost_micros DESC
    LIMIT 50
  `;

  const { data } = await axios.post(
    `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:searchStream`,
    { query },
    {
      headers: {
        Authorization: `Bearer ${creds.access_token}`,
        'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
      },
    }
  );
  return data;
}

async function listGA4Properties(credentials) {
  const creds = await getValidToken(credentials);
  const { data } = await axios.get(
    'https://analyticsadmin.googleapis.com/v1beta/accountSummaries',
    { headers: { Authorization: `Bearer ${creds.access_token}` } }
  );
  const options = [];
  for (const account of (data.accountSummaries || [])) {
    for (const property of (account.propertySummaries || [])) {
      options.push({
        value: property.property.replace('properties/', ''),
        label: `${property.displayName} — ${account.displayName}`,
      });
    }
  }
  return options;
}

async function listSearchConsoleSites(credentials) {
  const creds = await getValidToken(credentials);
  const { data } = await axios.get(
    'https://www.googleapis.com/webmasters/v3/sites',
    { headers: { Authorization: `Bearer ${creds.access_token}` } }
  );
  return (data.siteEntry || []).map(site => ({
    value: site.siteUrl,
    label: site.siteUrl,
  }));
}

async function listGoogleAdsAccounts(credentials) {
  const creds = await getValidToken(credentials);
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!devToken) return [];
  try {
    const { data } = await axios.get(
      'https://googleads.googleapis.com/v17/customers:listAccessibleCustomers',
      { headers: { Authorization: `Bearer ${creds.access_token}`, 'developer-token': devToken } }
    );
    return (data.resourceNames || []).map(name => ({
      value: name.replace('customers/', ''),
      label: name.replace('customers/', ''),
    }));
  } catch {
    return [];
  }
}

async function listMerchantAccounts(credentials) {
  const creds = await getValidToken(credentials);
  try {
    const { data } = await axios.get(
      'https://shoppingcontent.googleapis.com/content/v2.1/accounts/authinfo',
      { headers: { Authorization: `Bearer ${creds.access_token}` } }
    );
    return (data.accountIdentifiers || []).map(acc => ({
      value: String(acc.merchantId || acc.aggregatorId),
      label: `Merchant ${acc.merchantId || acc.aggregatorId}`,
    }));
  } catch {
    return [];
  }
}

async function listAccounts(credentials, connectorType) {
  switch (connectorType) {
    case 'ga4': return listGA4Properties(credentials);
    case 'google_search_console': return listSearchConsoleSites(credentials);
    case 'google_ads': return listGoogleAdsAccounts(credentials);
    case 'google_merchant_center': return listMerchantAccounts(credentials);
    default: return [];
  }
}

async function fetchData(credentials, params) {
  const { connectorType, ...rest } = params;
  switch (connectorType) {
    case 'ga4': return fetchGA4Data(credentials, rest);
    case 'google_search_console': return fetchSearchConsoleData(credentials, rest);
    case 'google_ads': return fetchGoogleAdsData(credentials, rest);
    case 'google_merchant_center': return { note: 'Merchant Center data via Content API' };
    default: throw new Error(`Unknown Google connector type: ${connectorType}`);
  }
}

function getPreviousPeriodStart(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  const duration = e - s;
  const prevEnd = new Date(s - 1);
  const prevStart = new Date(prevEnd - duration);
  return prevStart.toISOString().split('T')[0];
}

function getPreviousPeriodEnd(start, end) {
  const s = new Date(start);
  const prevEnd = new Date(s - 1);
  return prevEnd.toISOString().split('T')[0];
}

module.exports = { authType, getAuthUrl, exchangeCode, refreshToken, checkTokenValidity, fetchData, listAccounts };
