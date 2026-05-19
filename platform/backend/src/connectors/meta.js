const axios = require('axios');

const authType = 'oauth';
const API_VERSION = 'v22.0';
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

function getAuthUrl(state) {
  const scopes = [
    'ads_read', 'ads_management', 'read_insights',
    'instagram_basic', 'instagram_insights', 'pages_read_engagement',
    'business_management',
  ].join(',');
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: process.env.META_REDIRECT_URI,
    scope: scopes,
    response_type: 'code',
    state,
  });
  return `https://www.facebook.com/dialog/oauth?${params}`;
}

async function exchangeCode(code) {
  const { data: shortLived } = await axios.get(`${BASE_URL}/oauth/access_token`, {
    params: {
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      redirect_uri: process.env.META_REDIRECT_URI,
      code,
    },
  });

  // Exchange for long-lived token
  const { data: longLived } = await axios.get(`${BASE_URL}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      fb_exchange_token: shortLived.access_token,
    },
  });

  return {
    access_token: longLived.access_token,
    token_type: longLived.token_type,
    expires_at: longLived.expires_in ? Date.now() + longLived.expires_in * 1000 : null,
  };
}

async function refreshToken(credentials) {
  // Meta long-lived tokens don't have a refresh mechanism — re-auth required
  throw new Error('Meta tokens require re-authentication via OAuth');
}

async function checkTokenValidity(credentials) {
  if (!credentials || !credentials.access_token) throw new Error('No credentials');
  try {
    const { data } = await axios.get(`${BASE_URL}/me`, {
      params: { access_token: credentials.access_token, fields: 'id,name' },
    });
    if (data.error) throw new Error(data.error.message);
    return true;
  } catch (err) {
    if (err.response?.data?.error) {
      throw new Error(err.response.data.error.message);
    }
    throw err;
  }
}

async function fetchAdsData(credentials, params) {
  const { adAccountId, startDate, endDate } = params;

  const fields = [
    'campaign_name', 'impressions', 'clicks', 'spend',
    'reach', 'cpc', 'cpm', 'ctr', 'actions', 'action_values',
  ].join(',');

  const { data } = await axios.get(`${BASE_URL}/act_${adAccountId}/insights`, {
    params: {
      access_token: credentials.access_token,
      fields,
      time_range: JSON.stringify({ since: startDate, until: endDate }),
      level: 'campaign',
      limit: 100,
    },
  });

  return data;
}

async function fetchInstagramData(credentials, params) {
  const { accountId, startDate, endDate } = params;

  const { data: igAccount } = await axios.get(`${BASE_URL}/${accountId}/instagram_accounts`, {
    params: { access_token: credentials.access_token, fields: 'id,username' },
  });

  if (!igAccount.data || !igAccount.data.length) {
    return { note: 'No Instagram account connected' };
  }

  const igId = igAccount.data[0].id;
  const { data: insights } = await axios.get(`${BASE_URL}/${igId}/insights`, {
    params: {
      access_token: credentials.access_token,
      metric: 'impressions,reach,profile_views,follower_count',
      period: 'day',
      since: Math.floor(new Date(startDate).getTime() / 1000),
      until: Math.floor(new Date(endDate).getTime() / 1000),
    },
  });

  return insights;
}

async function listAdAccounts(credentials) {
  const { data } = await axios.get(`${BASE_URL}/me/adaccounts`, {
    params: { access_token: credentials.access_token, fields: 'id,name,account_id', limit: 100 },
  });
  return (data.data || []).map(acc => ({
    value: acc.account_id,
    label: `${acc.name} (${acc.account_id})`,
  }));
}

async function listInstagramAccounts(credentials) {
  const { data: pages } = await axios.get(`${BASE_URL}/me/accounts`, {
    params: { access_token: credentials.access_token, fields: 'id,name,instagram_business_account', limit: 100 },
  });
  const accounts = [];
  for (const page of (pages.data || [])) {
    if (page.instagram_business_account) {
      const igId = page.instagram_business_account.id;
      try {
        const { data: ig } = await axios.get(`${BASE_URL}/${igId}`, {
          params: { access_token: credentials.access_token, fields: 'id,username,name' },
        });
        accounts.push({ value: igId, label: `@${ig.username} (${page.name})` });
      } catch {
        accounts.push({ value: igId, label: `${page.name} Instagram` });
      }
    }
  }
  return accounts;
}

async function listAccounts(credentials, connectorType) {
  switch (connectorType) {
    case 'meta_ads': return listAdAccounts(credentials);
    case 'instagram_insights': return listInstagramAccounts(credentials);
    default: return [];
  }
}

async function fetchData(credentials, params) {
  const { connectorType, ...rest } = params;
  switch (connectorType) {
    case 'meta_ads': return fetchAdsData(credentials, rest);
    case 'instagram_insights': return fetchInstagramData(credentials, rest);
    default: throw new Error(`Unknown Meta connector type: ${connectorType}`);
  }
}

module.exports = { authType, getAuthUrl, exchangeCode, refreshToken, checkTokenValidity, fetchData, listAccounts };
