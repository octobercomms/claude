// Ideogram — pay-per-call image generation, best when on-image text matters
// (headlines, quotes, sale callouts). ~$0.08/image for v3.

const axios = require('axios');
const { getSetting } = require('../utils/settings');

async function client() {
  const key = await getSetting('IDEOGRAM_API_KEY');
  if (!key) throw new Error('IDEOGRAM_API_KEY not set in Settings');
  return axios.create({
    baseURL: 'https://api.ideogram.ai',
    headers: { 'Api-Key': key, 'Content-Type': 'application/json' },
  });
}

const ASPECT_MAP = {
  '1:1': 'ASPECT_1_1',
  '4:5': 'ASPECT_4_5',
  '9:16': 'ASPECT_9_16',
  '16:9': 'ASPECT_16_9',
};

async function generate({ prompt, aspect_ratio = '1:1', style = 'AUTO', seed }) {
  const api = await client();
  const { data } = await api.post('/generate', {
    image_request: {
      prompt,
      aspect_ratio: ASPECT_MAP[aspect_ratio] || ASPECT_MAP['1:1'],
      model: 'V_2',
      style_type: style,
      ...(seed != null ? { seed } : {}),
    },
  });
  const out = data.data?.[0];
  if (!out?.url) throw new Error('Ideogram returned no image URL');
  require('../services/costLog').recordApiCost({ provider: 'ideogram', feature: 'image_gen', costUsd: 0.08, meta: { aspect_ratio } });
  return { url: out.url, model: 'V_2', request_id: data.created };
}

async function testCredentials() {
  // Ideogram doesn't expose an account info endpoint; do a tiny dry-run
  // generate against a stub prompt to verify the key works.
  try {
    await generate({ prompt: 'a tiny grey dot on white', aspect_ratio: '1:1' });
    return { ok: true, message: 'Connected (test generation succeeded).' };
  } catch (err) {
    return { ok: false, message: err.response?.data?.error?.message || err.message };
  }
}

module.exports = { generate, testCredentials };
