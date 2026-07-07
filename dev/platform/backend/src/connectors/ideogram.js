// Ideogram — pay-per-call image generation, best when on-image text matters
// (headlines, quotes, sale callouts). ~$0.08/image.
//
// Uses the Ideogram 3.0 endpoint (POST /v1/ideogram-v3/generate,
// multipart/form-data). The old /generate + image_request JSON body with the
// V_2 model was the v1/v2 API — Ideogram deprecated it with 3.0, which is why
// a valid key started returning errors. Aspect ratios also changed shape
// (ASPECT_1_1 → 1x1).

const axios = require('axios');
const { getSetting } = require('../utils/settings');

const BASE = 'https://api.ideogram.ai';

async function apiKey() {
  const key = await getSetting('IDEOGRAM_API_KEY');
  if (!key) throw new Error('IDEOGRAM_API_KEY not set in Settings');
  return key;
}

// Ideogram v3 aspect-ratio tokens.
const ASPECT_MAP = {
  '1:1': '1x1',
  '4:5': '4x5',
  '9:16': '9x16',
  '16:9': '16x9',
};

// v3 style tokens (AUTO is the default and shouldn't be sent explicitly).
const STYLE_MAP = { AUTO: 'AUTO', GENERAL: 'GENERAL', REALISTIC: 'REALISTIC', DESIGN: 'DESIGN' };

// Pull the useful detail out of an Ideogram error response so the AM sees
// *why* it failed (bad key, quota, moderation) instead of a bare
// "Request failed with status code 4XX".
function ideogramError(err) {
  const d = err.response?.data;
  const detail = d?.error?.message || d?.error || d?.message
    || (typeof d === 'string' ? d : (d ? JSON.stringify(d).slice(0, 300) : null));
  const status = err.response?.status;
  return new Error(`Ideogram${status ? ` ${status}` : ''}: ${detail || err.message}`);
}

async function generate({ prompt, aspect_ratio = '1:1', style = 'AUTO', seed }) {
  const key = await apiKey();
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('aspect_ratio', ASPECT_MAP[aspect_ratio] || ASPECT_MAP['1:1']);
  form.append('rendering_speed', 'DEFAULT');
  const styleTok = STYLE_MAP[String(style || 'AUTO').toUpperCase()];
  if (styleTok && styleTok !== 'AUTO') form.append('style_type', styleTok);
  if (seed != null) form.append('seed', String(seed));

  let data;
  try {
    // Let axios set the multipart Content-Type (with boundary) from the
    // FormData; only the Api-Key header is ours.
    ({ data } = await axios.post(`${BASE}/v1/ideogram-v3/generate`, form, {
      headers: { 'Api-Key': key },
      timeout: 120000,
    }));
  } catch (err) {
    throw ideogramError(err);
  }

  const out = data?.data?.[0];
  if (!out?.url) throw new Error('Ideogram returned no image URL');
  require('../services/costLog').recordApiCost({ provider: 'ideogram', feature: 'image_gen', costUsd: 0.08, meta: { aspect_ratio } });
  return { url: out.url, model: 'V_3', request_id: data.created };
}

async function testCredentials() {
  // Ideogram doesn't expose an account-info endpoint; do a tiny dry-run
  // generate against a stub prompt to verify the key works.
  try {
    await generate({ prompt: 'a tiny grey dot on white', aspect_ratio: '1:1' });
    return { ok: true, message: 'Connected (test generation succeeded).' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

module.exports = { generate, testCredentials };
