// Adobe Firefly Services + Photoshop API. Two endpoints, one auth.
//
// IMS (Identity Management Service) issues an access token from a
// client_id + client_secret credentials pair. We cache it in-process
// until it expires (defaults to 24h) to avoid an extra hop per call.
//
// Two surfaces exposed:
//   - generate({ prompt, aspect_ratio })       — Firefly text-to-image
//   - generativeResize({ image_url, w, h })    — Photoshop API smart resize
//                                                (one source → any aspect
//                                                ratio without re-prompting)

const axios = require('axios');
const { getSetting } = require('../utils/settings');

const IMS_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';
const FIREFLY_BASE = 'https://firefly-api.adobe.io';
const PSD_BASE = 'https://image.adobe.io/pie/psdService';

const FIREFLY_SCOPE = 'openid,AdobeID,read_organizations,firefly_api,ff_apis';
const PSD_SCOPE = 'openid,AdobeID,read_organizations,creative_sdk';

let tokenCache = { value: null, expires: 0, scope: null };

async function ensureCredentials() {
  const clientId = await getSetting('ADOBE_CLIENT_ID');
  const clientSecret = await getSetting('ADOBE_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    throw new Error('ADOBE_CLIENT_ID and ADOBE_CLIENT_SECRET must be set in Settings');
  }
  return { clientId, clientSecret };
}

async function getAccessToken(scope = FIREFLY_SCOPE) {
  if (tokenCache.value && tokenCache.scope === scope && tokenCache.expires - 60 > Date.now() / 1000) {
    return tokenCache.value;
  }
  const { clientId, clientSecret } = await ensureCredentials();
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope });
  const { data } = await axios.post(IMS_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  tokenCache = {
    value: data.access_token,
    expires: Math.floor(Date.now() / 1000) + (data.expires_in || 86400),
    scope,
  };
  return tokenCache.value;
}

// Map our standard aspect ratio strings to the pixel sizes Firefly accepts.
// Firefly's v3 endpoint takes explicit width + height, so we use generous
// presets that work for social + ad placements.
const FIREFLY_SIZES = {
  '1:1':  { width: 1024, height: 1024 },
  '4:5':  { width: 1024, height: 1280 },
  '9:16': { width: 1024, height: 1820 },
  '16:9': { width: 1792, height: 1024 },
};

async function generate({ prompt, aspect_ratio = '1:1', seed, reference_image }) {
  const { clientId } = await ensureCredentials();
  const token = await getAccessToken(FIREFLY_SCOPE);
  const size = FIREFLY_SIZES[aspect_ratio] || FIREFLY_SIZES['1:1'];
  const body = {
    prompt,
    numVariations: 1,
    size,
    ...(seed != null ? { seeds: [seed] } : {}),
    ...(reference_image ? { styleReference: { source: { url: reference_image } } } : {}),
  };
  const { data } = await axios.post(`${FIREFLY_BASE}/v3/images/generate`, body, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Api-Key': clientId,
      'Content-Type': 'application/json',
    },
  });
  const out = data.outputs?.[0];
  if (!out?.image?.url) throw new Error('Firefly returned no image URL');
  require('../services/costLog').recordApiCost({ provider: 'adobe', feature: 'image_gen', costUsd: 0.05, meta: { aspect_ratio } });
  return { url: out.image.url, model: 'firefly-v3', seed: out.seed };
}

// Photoshop API smart resize — takes one source image URL and outputs
// resized versions at requested dimensions, expanding canvas with
// generative fill when the aspect ratio differs from the source.
//
// The Photoshop API is async (submit a job, poll the status URL until
// it returns the output href).
async function generativeResize({ image_url, width, height }) {
  const { clientId } = await ensureCredentials();
  const token = await getAccessToken(PSD_SCOPE);
  // Submit the resize job. The API uses inputs/outputs URLs for files —
  // for inputs we can pass an external URL directly; outputs need a
  // writable storage URL. Adobe also offers a temporary presigned URL
  // endpoint we can use as the output target.
  const presign = await axios.post('https://platform-cs-vali.adobe.io/api/v1/cs-assets/presigned-url',
    { type: 'application/octet-stream' },
    { headers: { Authorization: `Bearer ${token}`, 'X-Api-Key': clientId } }
  ).catch(() => null);
  const outputHref = presign?.data?.url || `${image_url}?adobe-resize-out`;

  const submit = await axios.post(`${PSD_BASE}/smartObject`, {
    inputs: [{ href: image_url, storage: 'external' }],
    options: { resize: { width, height, fit: 'expand' } },
    outputs: [{ href: outputHref, storage: 'external', type: 'image/png' }],
  }, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Api-Key': clientId,
      'Content-Type': 'application/json',
    },
  });
  const statusUrl = submit.data?._links?.self?.href;
  if (!statusUrl) throw new Error('Photoshop API: no status URL returned');

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    const { data: status } = await axios.get(statusUrl, {
      headers: { Authorization: `Bearer ${token}`, 'X-Api-Key': clientId },
    });
    if (status.status === 'succeeded') {
      const out = status.outputs?.[0]?.href || outputHref;
      return { url: out, width, height };
    }
    if (status.status === 'failed') throw new Error(`Photoshop API failed: ${status.errors?.[0]?.title || 'unknown'}`);
  }
  throw new Error('Photoshop API resize timed out');
}

async function testCredentials() {
  try {
    await getAccessToken(FIREFLY_SCOPE);
    return { ok: true, message: 'Adobe IMS auth succeeded.' };
  } catch (err) {
    return { ok: false, message: err.response?.data?.error_description || err.message };
  }
}

module.exports = { generate, generativeResize, testCredentials };
