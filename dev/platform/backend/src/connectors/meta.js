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
  // "Invalid Scope" from the consent dialog. We request read-only scopes
  // for Ads + insights, plus the two write scopes the social autopilot
  // needs to publish (pages_manage_posts for FB Pages, instagram_content_publish
  // for IG Business). pages_show_list lets us enumerate the AM's Pages so
  // the publisher can pick the right Page access token per client.
  const scopes = [
    'ads_read', 'read_insights',
    'instagram_basic', 'instagram_manage_insights',
    'pages_read_engagement', 'business_management',
    'pages_show_list', 'pages_manage_posts', 'instagram_content_publish',
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
    pages_show_list: 'Page list (autopilot)',
    pages_manage_posts: 'Publish to Facebook (autopilot)',
    instagram_content_publish: 'Publish to Instagram (autopilot)',
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

// ─── Publishing (social autopilot) ────────────────────────────────────────
//
// IG Business + FB Page publishing both go through the Graph API. The Page
// access token (not the user token) is what the publish endpoints need, so
// we always look up the Page first and use its scoped token.

// Find the first Page accessible to this user that owns an IG Business
// account. For multi-Page clients we'd let the AM pick; for now the
// MVP picks the first match. Returns { pageId, pageName, pageAccessToken,
// igBusinessId, igUsername }.
async function pickPublishingTargets(credentials) {
  const { data } = await axios.get(`${BASE_URL}/me/accounts`, {
    params: {
      access_token: credentials.access_token,
      fields: 'id,name,access_token,instagram_business_account',
      limit: 100,
    },
  });
  const pages = data.data || [];
  if (!pages.length) throw new Error('No Facebook Pages found on this Meta connection — the user must be an admin of at least one Page.');
  // Prefer the first Page that has IG attached; fall back to the first Page.
  const withIg = pages.find(p => p.instagram_business_account?.id);
  const page = withIg || pages[0];
  return {
    pageId: page.id,
    pageName: page.name,
    pageAccessToken: page.access_token,
    igBusinessId: page.instagram_business_account?.id || null,
  };
}

// Publish to a Facebook Page. The Graph API has separate /photos and
// /videos endpoints; we choose by mime type. Returns { id, posted_url }.
async function publishToFacebookPage({ pageId, pageAccessToken, caption, mediaUrl, mediaKind }) {
  if (!mediaUrl) {
    // Text-only post. FB allows /feed with a message, no media.
    const { data } = await axios.post(`${BASE_URL}/${pageId}/feed`, null, {
      params: { access_token: pageAccessToken, message: caption || '' },
    });
    return { id: data.id, posted_url: `https://www.facebook.com/${data.id}` };
  }
  if (mediaKind === 'video') {
    const { data } = await axios.post(`${BASE_URL}/${pageId}/videos`, null, {
      params: { access_token: pageAccessToken, file_url: mediaUrl, description: caption || '' },
    });
    return { id: data.id, posted_url: `https://www.facebook.com/${data.id}` };
  }
  // Default to photo for image/*.
  const { data } = await axios.post(`${BASE_URL}/${pageId}/photos`, null, {
    params: { access_token: pageAccessToken, url: mediaUrl, caption: caption || '' },
  });
  return { id: data.post_id || data.id, posted_url: `https://www.facebook.com/${data.post_id || data.id}` };
}

// Publish to an Instagram Business account. Two-step: create a container,
// then publish. Video containers report a "status_code" while transcoding
// and must be polled to FINISHED before publish_media can be called.
async function publishToInstagram({ igBusinessId, pageAccessToken, caption, mediaUrl, mediaKind }) {
  if (!igBusinessId) throw new Error('No Instagram Business account attached to this Page.');
  if (!mediaUrl) throw new Error('Instagram posts require media — text-only is not supported by the Graph API.');

  const isVideo = mediaKind === 'video';
  const containerParams = isVideo
    ? { access_token: pageAccessToken, media_type: 'REELS', video_url: mediaUrl, caption: caption || '' }
    : { access_token: pageAccessToken, image_url: mediaUrl, caption: caption || '' };

  const { data: container } = await axios.post(`${BASE_URL}/${igBusinessId}/media`, null, { params: containerParams });
  const containerId = container.id;

  // For videos, poll the container until FINISHED (Meta transcodes for ~10-60s).
  if (isVideo) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5 * 60_000) {
      const { data: status } = await axios.get(`${BASE_URL}/${containerId}`, {
        params: { access_token: pageAccessToken, fields: 'status_code,status' },
      });
      if (status.status_code === 'FINISHED') break;
      if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
        throw new Error(`Instagram container failed: ${status.status || status.status_code}`);
      }
      await new Promise(r => setTimeout(r, 5_000));
    }
  }

  const { data: published } = await axios.post(`${BASE_URL}/${igBusinessId}/media_publish`, null, {
    params: { access_token: pageAccessToken, creation_id: containerId },
  });
  const mediaId = published.id;

  // Resolve the permalink so we can store a clickable URL.
  let permalink = null;
  try {
    const { data: m } = await axios.get(`${BASE_URL}/${mediaId}`, {
      params: { access_token: pageAccessToken, fields: 'permalink' },
    });
    permalink = m.permalink || null;
  } catch (err) {
    // Non-fatal — the post is up, we just don't have the link yet.
  }
  return { id: mediaId, posted_url: permalink };
}

module.exports = {
  authType, getAuthUrl, exchangeCode, refreshToken, checkTokenValidity,
  fetchData, listAccounts, getAccessReport, fetchInstagramMediaInsights,
  parseSocialUrl, shortcodeToMediaId,
  pickPublishingTargets, publishToFacebookPage, publishToInstagram,
};
