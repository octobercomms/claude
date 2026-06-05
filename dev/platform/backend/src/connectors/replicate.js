// Replicate — pay-per-call image generation. We use Flux 1.1 Pro by default
// because the price/quality balance is strong for design-style social posts
// (about $0.04 per image at writing).
//
// The API is "create a prediction → poll until done", so we wrap that as a
// single async call that resolves with the output URL(s).

const axios = require('axios');
const { getSetting } = require('../utils/settings');

const FLUX_MODEL = 'black-forest-labs/flux-1.1-pro';

// Video models. Seedance is the cheap / fast default for text-to-video
// (~$0.40 per 5s 480p clip). Wan 2.2 I2V is the image-to-video path so
// we can animate a Flux still that already matches the brand. Both are
// hosted on Replicate under the same prediction API as Flux.
const VIDEO_T2V_MODEL = 'bytedance/seedance-1-pro';
const VIDEO_I2V_MODEL = 'wavespeedai/wan-2.2-i2v-a14b';

async function client() {
  const token = await getSetting('REPLICATE_API_TOKEN');
  if (!token) throw new Error('REPLICATE_API_TOKEN not set in Settings');
  return axios.create({
    baseURL: 'https://api.replicate.com/v1',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

// Create a prediction and poll until the run finishes (or fails). Replicate
// supports a "Prefer: wait" header that blocks for up to 60s, which covers
// most Flux generations in one round-trip — we fall back to polling if the
// response comes back still running.
async function generate({ prompt, reference_image, aspect_ratio = '1:1', seed }) {
  const api = await client();
  const input = {
    prompt,
    aspect_ratio,
    output_format: 'png',
    safety_tolerance: 5,
    ...(seed != null ? { seed } : {}),
    ...(reference_image ? { image_prompt: reference_image } : {}),
  };

  // First request — wait inline for up to 60s.
  let { data } = await api.post(`/models/${FLUX_MODEL}/predictions`, { input },
    { headers: { Prefer: 'wait=60' } });

  // If still running, poll for up to another 60s in 2s ticks.
  const deadline = Date.now() + 60_000;
  while (data.status === 'starting' || data.status === 'processing') {
    if (Date.now() > deadline) throw new Error('Replicate generation timed out');
    await new Promise(r => setTimeout(r, 2000));
    ({ data } = await api.get(`/predictions/${data.id}`));
  }
  if (data.status !== 'succeeded') {
    throw new Error(`Replicate generation failed: ${data.error || data.status}`);
  }
  const out = Array.isArray(data.output) ? data.output[0] : data.output;
  return { url: out, model: FLUX_MODEL, prediction_id: data.id };
}

// Generate a short video clip. If `reference_image` is supplied we use
// the image-to-video model so the still composition carries through;
// otherwise pure text-to-video. Same poll-the-prediction shape as
// `generate`, but with a longer ceiling — Seedance / Wan typically
// finish 5s clips in 30-90s, so we wait up to 5 minutes total.
async function generateVideo({ prompt, reference_image, aspect_ratio = '16:9', duration = 5, seed }) {
  const api = await client();
  const useI2V = !!reference_image;
  const model = useI2V ? VIDEO_I2V_MODEL : VIDEO_T2V_MODEL;
  const input = useI2V
    ? { prompt, image: reference_image, num_frames: Math.round(duration * 16), ...(seed != null ? { seed } : {}) }
    : { prompt, aspect_ratio, duration, resolution: '480p', ...(seed != null ? { seed } : {}) };

  let { data } = await api.post(`/models/${model}/predictions`, { input },
    { headers: { Prefer: 'wait=60' } });

  const deadline = Date.now() + 4 * 60_000;
  while (data.status === 'starting' || data.status === 'processing') {
    if (Date.now() > deadline) throw new Error('Replicate video generation timed out');
    await new Promise(r => setTimeout(r, 3000));
    ({ data } = await api.get(`/predictions/${data.id}`));
  }
  if (data.status !== 'succeeded') {
    throw new Error(`Replicate video generation failed: ${data.error || data.status}`);
  }
  const out = Array.isArray(data.output) ? data.output[0] : data.output;
  return { url: out, model, prediction_id: data.id, duration };
}

async function testCredentials() {
  try {
    const api = await client();
    const { data } = await api.get('/account');
    return { ok: true, message: `Connected as ${data.username || data.type}.` };
  } catch (err) {
    return { ok: false, message: err.response?.data?.detail || err.message };
  }
}

module.exports = { generate, generateVideo, testCredentials };
