const axios = require('axios');

const authType = 'oauth';

function getAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.ZOHO_CLIENT_ID,
    redirect_uri: process.env.ZOHO_REDIRECT_URI,
    response_type: 'code',
    scope: 'ZohoInventory.FullAccess.all',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.zoho.com/oauth/v2/auth?${params}`;
}

async function exchangeCode(code) {
  const { data } = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
    params: {
      code,
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      redirect_uri: process.env.ZOHO_REDIRECT_URI,
      grant_type: 'authorization_code',
    },
  });

  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    // api_domain tells us which region server to use (e.g. https://www.zohoapis.eu for EU)
    api_domain: data.api_domain || 'https://www.zohoapis.com',
  };

  // Fetch first org ID automatically so first-time setup needs fewer clicks
  try {
    const orgRes = await axios.get(`${tokens.api_domain}/inventory/v1/organizations`, {
      headers: { Authorization: `Zoho-oauthtoken ${tokens.access_token}` },
    });
    const orgs = orgRes.data.organizations || [];
    if (orgs.length > 0) tokens.organization_id = String(orgs[0].organization_id);
  } catch { /* optional — user can select from dropdown */ }

  return tokens;
}

async function refreshToken(credentials) {
  if (!credentials.refresh_token) throw new Error('No refresh token — please reconnect Zoho Inventory.');
  const { data } = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
    params: {
      refresh_token: credentials.refresh_token,
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      grant_type: 'refresh_token',
    },
  });
  return {
    ...credentials,
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
  };
}

async function getValidToken(credentials) {
  if (!credentials) throw new Error('No credentials configured');
  if (!credentials.expires_at || Date.now() > credentials.expires_at - 60000) {
    return refreshToken(credentials);
  }
  return credentials;
}

async function checkTokenValidity(credentials) {
  if (!credentials?.access_token) throw new Error('No credentials');
  return getValidToken(credentials);
}

async function listAccounts(credentials) {
  const creds = await getValidToken(credentials);
  const apiDomain = creds.api_domain || 'https://www.zohoapis.com';
  const { data } = await axios.get(`${apiDomain}/inventory/v1/organizations`, {
    headers: { Authorization: `Zoho-oauthtoken ${creds.access_token}` },
  });
  return (data.organizations || []).map(org => ({
    value: String(org.organization_id),
    label: org.name,
  }));
}

async function fetchData(credentials, params) {
  const creds = await getValidToken(credentials);
  const { organizationId, startDate, endDate } = params;
  const orgId = organizationId || creds.organization_id;
  if (!orgId) throw new Error('Zoho Inventory organisation not selected — open the connectors tab and choose one.');

  const apiDomain = creds.api_domain || 'https://www.zohoapis.com';
  const base = `${apiDomain}/inventory/v1`;
  const headers = { Authorization: `Zoho-oauthtoken ${creds.access_token}` };

  console.log(`[Zoho Inventory] fetching org=${orgId} via ${apiDomain} period=${startDate}→${endDate}`);

  const errors = [];

  let items = [];
  try {
    const res = await axios.get(`${base}/items`, {
      headers,
      params: { organization_id: orgId },
    });
    items = res.data.items || [];
    console.log(`[Zoho Inventory] items response: code=${res.data.code} count=${items.length} keys=${Object.keys(res.data).join(',')}`);
  } catch (err) {
    const detail = err.response?.data?.message || err.response?.status || err.message;
    errors.push(`items: ${detail}`);
    console.error('[Zoho Inventory] items fetch failed:', detail);
  }

  let orders = [];
  try {
    const res = await axios.get(`${base}/salesorders`, {
      headers,
      params: { organization_id: orgId, date_start: startDate, date_end: endDate },
    });
    orders = res.data.salesorders || [];
    console.log(`[Zoho Inventory] salesorders response: code=${res.data.code} count=${orders.length} keys=${Object.keys(res.data).join(',')}`);
  } catch (err) {
    const detail = err.response?.data?.message || err.response?.status || err.message;
    errors.push(`salesorders: ${detail}`);
    console.error('[Zoho Inventory] salesorders fetch failed:', detail);
  }

  return { items, orders, ...(errors.length ? { fetch_errors: errors } : {}) };
}

module.exports = { authType, getAuthUrl, exchangeCode, refreshToken, checkTokenValidity, fetchData, listAccounts };
