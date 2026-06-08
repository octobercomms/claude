// Platform-level Google authentication.
//
// This is the ONLY place that touches the platform's Google service-account
// credentials. Connectors call into it for an access token; today it reads
// the service account from process.env (populated from the encrypted
// platform_settings store on boot). If/when the platform later supports
// multiple agency tenants, THIS function changes — to look up the service
// account by tenantId — and nothing else does.
//
// We deliberately mint the token here with a signed JWT rather than pulling
// in google-auth-library: the rest of the Google connector already talks to
// Google's OAuth endpoint with raw axios, there is no Google SDK in the
// dependency tree, and a service-account JWT grant is a few lines of the
// built-in crypto module. Keeping it dependency-free keeps the slice small.

const crypto = require('crypto');
const axios = require('axios');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWT_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

// Minted access tokens are valid for an hour. Cache them per scope-set so a
// report run that hits GA4 a dozen times doesn't mint a dozen tokens. Keyed
// by the sorted scope string; refreshed a minute before expiry.
const tokenCache = new Map();

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function getServiceAccount() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not configured in Settings — paste the service-account key file there to use service-account auth.');
  }
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON — paste the full service-account key file contents.');
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email / private_key — paste the full service-account key file.');
  }
  return parsed;
}

// The service-account email AMs paste into the client's GA4 property /
// Search Console / Merchant Center to grant access. Surfaced in the UI and
// connector diagnostics so the AM knows exactly which email to add.
function getServiceAccountEmail() {
  try {
    return getServiceAccount().client_email;
  } catch {
    return null;
  }
}

async function mintAccessToken(scopes) {
  const sa = getServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: scopes.join(' '),
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${claims}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(signingInput)
    .sign(sa.private_key);
  const assertion = `${signingInput}.${base64url(signature)}`;

  const { data } = await axios.post(TOKEN_URL, new URLSearchParams({
    grant_type: JWT_GRANT,
    assertion,
  }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

  return { access_token: data.access_token, expires_at: Date.now() + (data.expires_in || 3600) * 1000 };
}

// Single function the rest of the codebase uses for a platform-level Google
// access token. Pass the scopes the call needs; returns a bearer token.
async function getPlatformGoogleAccessToken(scopes) {
  const list = Array.isArray(scopes) ? scopes : [scopes];
  const key = [...list].sort().join(' ');
  const cached = tokenCache.get(key);
  if (cached && Date.now() < cached.expires_at - 60000) return cached.access_token;
  const minted = await mintAccessToken(list);
  tokenCache.set(key, minted);
  return minted.access_token;
}

function getPlatformAdsMccId() {
  return process.env.GOOGLE_ADS_MCC_ID;
}

// Google Ads is the one Google connector that can't use the service account
// directly (its API only accepts OAuth, or a service account via Workspace
// domain-wide delegation). The agency-standard alternative is a single
// manager-account (MCC) OAuth refresh token: the agency authorises the MCC
// once, the client accepts a link request in their Ads UI, and the platform
// reaches every linked account through login-customer-id = MCC. This mints an
// access token from that one manager refresh token, cached for its lifetime.
let adsTokenCache = null;
async function getPlatformAdsAccessToken() {
  const refreshToken = process.env.GOOGLE_ADS_MANAGER_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error('GOOGLE_ADS_MANAGER_REFRESH_TOKEN is not configured in Settings — authorise the manager (MCC) account once to obtain it.');
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET must be configured to mint the Google Ads manager token.');
  }
  if (adsTokenCache && Date.now() < adsTokenCache.expires_at - 60000) return adsTokenCache.access_token;
  const { data } = await axios.post(TOKEN_URL, new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  adsTokenCache = { access_token: data.access_token, expires_at: Date.now() + (data.expires_in || 3600) * 1000 };
  return adsTokenCache.access_token;
}

module.exports = {
  getPlatformGoogleAccessToken,
  getServiceAccountEmail,
  getPlatformAdsMccId,
  getPlatformAdsAccessToken,
};
