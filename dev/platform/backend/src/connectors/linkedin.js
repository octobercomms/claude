// LinkedIn organic posting — the connector for the social autopilot
// (Phase 4). We post on behalf of a member, not a company page, because
// w_member_social is part of the default LinkedIn API product and ships
// the day the AM authorises. Company-page posting (w_organization_social)
// requires LinkedIn's Marketing Developer Platform review — once a
// client needs that we'll add an Organization mode.
//
// Tokens are NOT auto-refreshable on the default product — LinkedIn
// gives a 60-day access token only. We surface "expired" status in
// connector health so the AM knows to re-auth before posts back up.

const axios = require('axios');
const { getSetting } = require('../utils/settings');

const authType = 'oauth';
const BASE_URL = 'https://api.linkedin.com';
const OAUTH_BASE = 'https://www.linkedin.com/oauth/v2';

async function resolveRedirectUri() {
  const fromSetting = await getSetting('LINKEDIN_REDIRECT_URI');
  if (fromSetting) return fromSetting;
  if (process.env.LINKEDIN_REDIRECT_URI) return process.env.LINKEDIN_REDIRECT_URI;
  const base = (await getSetting('PLATFORM_URL')) || process.env.PLATFORM_URL;
  return base ? `${base.replace(/\/$/, '')}/auth/linkedin/callback` : '';
}

async function getCredentials() {
  const clientId = (await getSetting('LINKEDIN_CLIENT_ID')) || process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = (await getSetting('LINKEDIN_CLIENT_SECRET')) || process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('LinkedIn app credentials not set — add LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in Settings.');
  return { clientId, clientSecret };
}

async function getAuthUrl(state) {
  const { clientId } = await getCredentials();
  const redirectUri = await resolveRedirectUri();
  if (!redirectUri) throw new Error('LINKEDIN_REDIRECT_URI is not configured — set it in Settings.');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    // OpenID Connect scopes give us the member URN via /v2/userinfo;
    // w_member_social is the write scope needed to publish posts.
    scope: 'openid profile email w_member_social',
  });
  return `${OAUTH_BASE}/authorization?${params}`;
}

async function exchangeCode(code) {
  const { clientId, clientSecret } = await getCredentials();
  const redirectUri = await resolveRedirectUri();
  const { data } = await axios.post(`${OAUTH_BASE}/accessToken`,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  const expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : null;

  // Resolve the member URN at token-exchange time so the publisher
  // doesn't have to look it up on every post. /v2/userinfo (OpenID
  // Connect) returns { sub, name, email, ... } where sub is the
  // LinkedIn member id.
  let memberUrn = null, memberName = null;
  try {
    const { data: ui } = await axios.get(`${BASE_URL}/v2/userinfo`, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (ui?.sub) memberUrn = `urn:li:person:${ui.sub}`;
    memberName = ui?.name || null;
  } catch (err) {
    // Non-fatal — the publisher will fall back to /v2/userinfo at post time.
  }

  return {
    access_token: data.access_token,
    token_type: data.token_type || 'Bearer',
    expires_at: expiresAt,
    member_urn: memberUrn,
    member_name: memberName,
  };
}

async function refreshToken(credentials) {
  // Default LinkedIn API product does not issue refresh tokens.
  // The 60-day access token must be replaced by re-auth.
  throw new Error('LinkedIn tokens require re-authentication every 60 days.');
}

async function checkTokenValidity(credentials) {
  if (!credentials?.access_token) throw new Error('No credentials');
  try {
    await axios.get(`${BASE_URL}/v2/userinfo`, {
      headers: { Authorization: `Bearer ${credentials.access_token}` },
    });
    return true;
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.error_description || err.message;
    throw new Error(msg);
  }
}

async function getMemberUrn(credentials) {
  if (credentials.member_urn) return credentials.member_urn;
  const { data } = await axios.get(`${BASE_URL}/v2/userinfo`, {
    headers: { Authorization: `Bearer ${credentials.access_token}` },
  });
  if (!data?.sub) throw new Error('Could not resolve LinkedIn member URN');
  return `urn:li:person:${data.sub}`;
}

async function listAccounts(credentials) {
  // We only support member posting today, so the "account" list is just
  // the connected member.
  try {
    const { data } = await axios.get(`${BASE_URL}/v2/userinfo`, {
      headers: { Authorization: `Bearer ${credentials.access_token}` },
    });
    return [{ value: data.sub, label: `${data.name || 'LinkedIn'} (${data.email || data.sub})` }];
  } catch {
    return [];
  }
}

async function getAccessReport(credentials) {
  try {
    await checkTokenValidity(credentials);
    return {
      granted: ['Member profile', 'Publish to feed (member)'],
      missing: ['Publish to Company Page (requires LinkedIn Marketing Developer Platform approval)'],
      limitations: [],
    };
  } catch (err) {
    return {
      granted: [],
      missing: ['Member profile', 'Publish to feed'],
      limitations: [`LinkedIn token invalid or expired: ${err.message}. Reauthorise via the connector.`],
    };
  }
}

// ─── Publishing ───────────────────────────────────────────────────────
//
// LinkedIn's UGC Posts API ("/v2/ugcPosts") is the working publish endpoint
// for member-level posts under the default API product. For media we use
// the two-step assets API: registerUpload to reserve an asset URN +
// upload URL, then PUT the bytes, then reference the URN in the post.

// Register an upload slot for one media file. Returns { assetUrn, uploadUrl }.
async function registerMediaUpload({ accessToken, memberUrn, kind }) {
  const recipe = kind === 'video'
    ? 'urn:li:digitalmediaRecipe:feedshare-video'
    : 'urn:li:digitalmediaRecipe:feedshare-image';
  const { data } = await axios.post(`${BASE_URL}/v2/assets?action=registerUpload`, {
    registerUploadRequest: {
      owner: memberUrn,
      recipes: [recipe],
      serviceRelationships: [{
        relationshipType: 'OWNER',
        identifier: 'urn:li:userGeneratedContent',
      }],
    },
  }, { headers: { Authorization: `Bearer ${accessToken}` } });
  const v = data?.value || {};
  const uploadUrl = v.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
  if (!uploadUrl || !v.asset) throw new Error('LinkedIn registerUpload did not return an upload URL.');
  return { assetUrn: v.asset, uploadUrl };
}

// Upload bytes from a stream (from socialDrive.downloadFile) to the
// LinkedIn upload URL. Single-shot — fine up to LinkedIn's 200MB ceiling
// for the feedshare recipes; larger reels would need the multipart
// upload flow which we'll add when a client hits it.
async function uploadMediaBytes({ uploadUrl, accessToken, stream, contentType, contentLength }) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  if (contentType) headers['Content-Type'] = contentType;
  if (contentLength) headers['Content-Length'] = contentLength;
  await axios.put(uploadUrl, stream, { headers, maxContentLength: Infinity, maxBodyLength: Infinity });
}

// Create the UGC post. Returns { id (URN), posted_url }.
async function createUgcPost({ accessToken, memberUrn, caption, mediaCategory, mediaAssets }) {
  const body = {
    author: memberUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: caption || '' },
        shareMediaCategory: mediaCategory || 'NONE',
        ...(mediaAssets?.length ? { media: mediaAssets.map(a => ({ status: 'READY', media: a })) } : {}),
      },
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  };
  const { data } = await axios.post(`${BASE_URL}/v2/ugcPosts`, body, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json',
    },
  });
  const urn = data?.id;
  // The UGC URN can be plugged straight into the feed update permalink.
  const posted_url = urn ? `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}/` : null;
  return { id: urn, posted_url };
}

// Top-level publish: register + upload + post in one call. Caller passes
// a node Readable stream for the media (from socialDrive.downloadFile).
async function publishToLinkedIn({ credentials, caption, mediaStream, mediaContentType, mediaContentLength, mediaKind }) {
  const accessToken = credentials.access_token;
  const memberUrn = await getMemberUrn(credentials);

  // Text-only post — skip the asset flow entirely.
  if (!mediaStream) {
    return createUgcPost({ accessToken, memberUrn, caption, mediaCategory: 'NONE', mediaAssets: [] });
  }
  const kind = mediaKind === 'video' ? 'video' : 'image';
  const { assetUrn, uploadUrl } = await registerMediaUpload({ accessToken, memberUrn, kind });
  await uploadMediaBytes({
    uploadUrl, accessToken,
    stream: mediaStream, contentType: mediaContentType, contentLength: mediaContentLength,
  });
  return createUgcPost({
    accessToken, memberUrn,
    caption,
    mediaCategory: kind === 'video' ? 'VIDEO' : 'IMAGE',
    mediaAssets: [assetUrn],
  });
}

// Multi-image post. LinkedIn's ugcPosts API accepts multiple media URNs
// under shareMediaCategory=IMAGE — they render as a swipeable carousel
// in the feed. Caller supplies one stream per image; we register +
// upload each, then create the post referencing all asset URNs.
async function publishCarouselToLinkedIn({ credentials, caption, images }) {
  if (!images?.length) throw new Error('LinkedIn carousel requires at least 1 image.');
  const accessToken = credentials.access_token;
  const memberUrn = await getMemberUrn(credentials);
  const assetUrns = [];
  for (const img of images) {
    const { assetUrn, uploadUrl } = await registerMediaUpload({ accessToken, memberUrn, kind: 'image' });
    await uploadMediaBytes({
      uploadUrl, accessToken,
      stream: img.stream, contentType: img.contentType, contentLength: img.contentLength,
    });
    assetUrns.push(assetUrn);
  }
  return createUgcPost({
    accessToken, memberUrn, caption,
    mediaCategory: 'IMAGE', mediaAssets: assetUrns,
  });
}

async function fetchData() {
  // No reporting today — the social autopilot uses LinkedIn write-only.
  // Adding read-side metrics is a future task.
  return { note: 'LinkedIn read-side metrics not implemented.' };
}

// Engagement counts for a published UGC post. /v2/socialActions surfaces
// like + comment counts for member-level posts under the default API
// product. Impressions / reach require organization-level scopes
// (rw_organization_admin + LMDP approval) so those stay null — the AM
// can read them off LinkedIn's native post analytics if needed.
async function fetchPostEngagement(credentials, ugcUrn) {
  if (!ugcUrn) throw new Error('LinkedIn engagement fetch needs the ugcPost URN.');
  try {
    const { data } = await axios.get(`${BASE_URL}/v2/socialActions/${encodeURIComponent(ugcUrn)}`, {
      headers: { Authorization: `Bearer ${credentials.access_token}`, 'X-Restli-Protocol-Version': '2.0.0' },
    });
    return {
      impressions: null,
      reach: null,
      likes: data?.likesSummary?.totalLikes ?? null,
      comments: data?.commentsSummary?.aggregatedTotalComments ?? null,
      shares: null,
      raw: data,
    };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    throw new Error(`LinkedIn engagement fetch failed: ${msg}`);
  }
}

module.exports = {
  authType, getAuthUrl, exchangeCode, refreshToken, checkTokenValidity,
  listAccounts, getAccessReport, fetchData, fetchPostEngagement,
  publishToLinkedIn, publishCarouselToLinkedIn, getMemberUrn,
};
