const axios = require('axios');
const { getSetting } = require('../utils/settings');

const authType = 'oauth';
const API_VERSION = 'v22.0';
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

// Resolve the Meta OAuth callback URL at request time so the platform Settings
// value is picked up without a server restart. Falls back to env, then to a
// PLATFORM_URL-derived URL so the connector still works on a fresh install.
async function resolveRedirectUri() {
  const fromSetting = await getSetting('META_REDIRECT_URI');
  if (fromSetting) return fromSetting;
  if (process.env.META_REDIRECT_URI) return process.env.META_REDIRECT_URI;
  const base = (await getSetting('PLATFORM_URL')) || process.env.PLATFORM_URL;
  return base ? `${base.replace(/\/$/, '')}/auth/meta/callback` : '';
}

async function getAuthUrl(state) {
  // Meta renamed `instagram_insights` to `instagram_manage_insights` on the
  // Facebook Login / Graph API flow — the old name now returns
  // "Invalid Scope" from the consent dialog. We only read Ads / Instagram
  // data so we request the read-only scopes (no ads_management).
  const scopes = [
    'ads_read', 'read_insights',
    'instagram_basic', 'instagram_manage_insights',
    'pages_read_engagement', 'business_management',
  ].join(',');
  const appId = (await getSetting('META_APP_ID')) || process.env.META_APP_ID;
  const redirectUri = await resolveRedirectUri();
  if (!redirectUri) throw new Error('META_REDIRECT_URI is not configured — set it in Settings → Ad Platforms → Meta.');
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: scopes,
    response_type: 'code',
    state,
  });
  return `https://www.facebook.com/dialog/oauth?${params}`;
}

async function exchangeCode(code) {
  const appId = (await getSetting('META_APP_ID')) || process.env.META_APP_ID;
  const appSecret = (await getSetting('META_APP_SECRET')) || process.env.META_APP_SECRET;
  const redirectUri = await resolveRedirectUri();
  const { data: shortLived } = await axios.get(`${BASE_URL}/oauth/access_token`, {
    params: {
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code,
    },
  });

  // Exchange for long-lived token
  const { data: longLived } = await axios.get(`${BASE_URL}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
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

  // Fetch insights + the ad account's currency in parallel. Currency
  // tagging lets the report renderer normalise multi-market Meta Ads
  // sections (e.g. US ad account in USD + UK in GBP) to a single GBP
  // total via fxRates, instead of summing raw numbers as if they shared
  // a unit. Currency call is best-effort — if it fails we fall back to
  // GBP (which is also the no-op default in sumAcrossSources).
  const [insightsRes, accountRes] = await Promise.all([
    axios.get(`${BASE_URL}/act_${adAccountId}/insights`, {
      params: {
        access_token: credentials.access_token,
        fields,
        time_range: JSON.stringify({ since: startDate, until: endDate }),
        level: 'campaign',
        limit: 100,
      },
    }),
    axios.get(`${BASE_URL}/act_${adAccountId}`, {
      params: { access_token: credentials.access_token, fields: 'currency' },
    }).catch(err => {
      console.warn('[Meta Ads] currency fetch failed:', err.response?.data?.error?.message || err.message);
      return { data: {} };
    }),
  ]);

  return { ...insightsRes.data, currency: accountRes.data?.currency || null };
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

// Single-media insights — used by the Social performance loop to track a
// published post's engagement over time. Available metrics vary by media
// type, so we request a broad union and discard the ones the API rejects.
async function fetchInstagramMediaInsights(credentials, mediaId) {
  // Two metric sets: feed/carousel and reels. We try the richer reel set
  // first; the API returns a generic error if a metric doesn't apply, so
  // we fall back on whichever subset the API accepts.
  const tryMetrics = async (metricList) => {
    const { data } = await axios.get(`${BASE_URL}/${mediaId}/insights`, {
      params: { access_token: credentials.access_token, metric: metricList.join(',') },
    });
    const out = {};
    for (const entry of (data.data || [])) {
      const v = entry.values?.[0]?.value;
      out[entry.name] = typeof v === 'number' ? v : v;
    }
    return out;
  };

  try {
    return await tryMetrics(['plays', 'reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'ig_reels_video_view_total_time']);
  } catch {
    return await tryMetrics(['impressions', 'reach', 'likes', 'comments', 'saved', 'shares']);
  }
}

// IG / TT URLs encode the media id in a base64-ish shortcode. Decoding
// is well-known but undocumented. Used so the AM can paste an Instagram
// post URL and we resolve the media id without round-tripping the API.
function shortcodeToMediaId(shortcode) {
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  if (!shortcode || !/^[A-Za-z0-9_-]+$/.test(shortcode)) return null;
  let id = 0n;
  for (const ch of shortcode) {
    const idx = ALPHA.indexOf(ch);
    if (idx < 0) return null;
    id = id * 64n + BigInt(idx);
  }
  return id.toString();
}

function parseSocialUrl(url) {
  if (!url) return null;
  // Instagram: https://www.instagram.com/p/<code>/, /reel/<code>/, /tv/<code>/
  const igMatch = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  if (igMatch) {
    const mediaId = shortcodeToMediaId(igMatch[1]);
    return mediaId ? { platform: 'instagram', external_id: mediaId, shortcode: igMatch[1] } : null;
  }
  // TikTok: https://www.tiktok.com/@user/video/<numeric_id>
  const ttMatch = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i);
  if (ttMatch) return { platform: 'tiktok', external_id: ttMatch[1] };
  // LinkedIn URN is in the URL too sometimes
  const liMatch = url.match(/linkedin\.com\/.*?(?:activity|posts)[:-](\d+)/i);
  if (liMatch) return { platform: 'linkedin', external_id: liMatch[1] };
  return null;
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

// Report which Meta permissions the access token actually holds.
async function getAccessReport(credentials) {
  if (!credentials?.access_token) throw new Error('No credentials');
  const NEEDED = {
    ads_read: 'Ads insights',
    read_insights: 'Page & IG insights',
    instagram_basic: 'Instagram basic',
    instagram_insights: 'Instagram insights',
    pages_read_engagement: 'Page engagement',
    business_management: 'Business assets',
  };
  const { data } = await axios.get(`${BASE_URL}/me/permissions`, {
    params: { access_token: credentials.access_token },
  });
  const granted = (data.data || []).filter(p => p.status === 'granted').map(p => p.permission);
  const entries = Object.entries(NEEDED);
  return {
    granted: entries.filter(([k]) => granted.includes(k)).map(([, v]) => v),
    missing: entries.filter(([k]) => !granted.includes(k)).map(([, v]) => v),
    limitations: entries
      .filter(([k]) => !granted.includes(k))
      .map(([, v]) => `${v} unavailable — permission not granted. Reauthorise Meta to add it.`),
  };
}

module.exports = { authType, getAuthUrl, exchangeCode, refreshToken, checkTokenValidity, fetchData, listAccounts, getAccessReport, fetchInstagramMediaInsights, parseSocialUrl, shortcodeToMediaId };
