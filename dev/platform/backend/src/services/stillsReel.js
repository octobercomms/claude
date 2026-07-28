// Stills → Reel — animate a client's still images into short cinematic clips
// (fal image-to-video), which the Edit worker then stitches into one vertical
// reel via the existing combineClips path. This module owns only the "animate
// one still" step; the download + beat-trim + combine happen in editProcessor,
// on the same ffmpeg rails as every other edit.
//
// The image is passed to fal as a base64 data URI (same trick as Visualise), so
// an auth-behind upload never needs a public URL. The model slug is data, not
// code: it defaults to a Kling image-to-video model but can be overridden with
// the FAL_I2V_MODEL setting if fal renames/retires a model.

const fs = require('fs');
const path = require('path');
const fal = require('../connectors/fal');
const { getSetting } = require('../utils/settings');

const DEFAULT_MODEL = 'fal-ai/kling-video/v1.6/standard/image-to-video';

// Rough per-clip prices (USD) for the models we're likely to route to. Used for
// the pre-flight estimate and the logged cost. Unknown slugs fall back to a
// conservative estimate so a new model never logs as free.
const FAL_I2V_PRICES = {
  'fal-ai/kling-video/v1.6/standard/image-to-video': 0.25,
  'fal-ai/kling-video/v2/master/image-to-video': 0.45,
  'fal-ai/minimax/hailuo-02/standard/image-to-video': 0.28,
  'fal-ai/luma-dream-machine': 0.20,
  'fal-ai/wan-i2v': 0.20,
};
function priceFor(slug) { return FAL_I2V_PRICES[slug] != null ? FAL_I2V_PRICES[slug] : 0.30; }

// Motion vibe → a short prompt telling the model how the camera should move.
// Deliberately restrained — subtle, cinematic moves montage far better than
// wild motion, and keep the subject recognisable.
const MOTIONS = {
  'push-in': 'Slow cinematic push-in towards the subject, subtle parallax, steady and filmic, natural depth.',
  'drift': 'Slow lateral camera drift across the scene, smooth and cinematic, gentle parallax.',
  'reveal': 'Slow zoom-out reveal, smooth cinematic camera pull-back, elegant.',
  'orbit': 'Gentle arcing camera move around the subject, cinematic depth of field, smooth.',
  'rise': 'Slow upward tilt / crane, cinematic and graceful, steady motion.',
  'subtle': 'Very subtle breathing zoom, mostly static, premium and understated, minimal motion.',
};
function motionPrompt(key) { return MOTIONS[key] || MOTIONS['push-in']; }
function motionOptions() { return Object.keys(MOTIONS); }

function fileToDataUri(diskPath) {
  const ext = (path.extname(diskPath) || '.jpg').slice(1).toLowerCase();
  const mime = ext === 'png' ? 'png' : ext === 'webp' ? 'webp' : ext === 'gif' ? 'gif' : 'jpeg';
  return `data:image/${mime};base64,${fs.readFileSync(diskPath).toString('base64')}`;
}

async function resolveModel(model) {
  if (model) return model;
  return (await getSetting('FAL_I2V_MODEL')) || DEFAULT_MODEL;
}

// Pull a video URL out of fal's result, tolerant of the shapes i2v models use
// ({video:{url}}, {video:"url"}, {output:{video:{url}}}, {output:[{url}]}).
function videoUrl(raw) {
  if (!raw) return null;
  if (raw.video?.url) return raw.video.url;
  if (typeof raw.video === 'string') return raw.video;
  if (raw.output?.video?.url) return raw.output.video.url;
  if (typeof raw.output === 'string') return raw.output;
  if (Array.isArray(raw.output)) { const u = raw.output.map(o => (typeof o === 'string' ? o : o?.url)).find(Boolean); if (u) return u; }
  if (raw.url) return raw.url;
  return null;
}

// Animate one still → returns { url, model, cost }. url is a public fal CDN link
// the caller downloads. Longer timeout than image gen — i2v renders run ~1–3min.
async function animate({ diskPath, motion, model, clientId = null }) {
  const slug = await resolveModel(model);
  const input = {
    image_url: fileToDataUri(diskPath),
    prompt: motionPrompt(motion),
    duration: '5',   // most i2v models' floor; the reel trims each clip to a beat
  };
  const cost = priceFor(slug);
  const res = await fal.run(slug, input, { feature: 'edit_stills_reel', clientId, costUsd: cost, timeoutMs: 300_000 });
  const url = videoUrl(res.raw) || res.url || null;
  if (!url) throw new Error('fal returned no video for a still.');
  return { url, model: slug, cost };
}

module.exports = { animate, motionPrompt, motionOptions, priceFor, resolveModel, MOTIONS, DEFAULT_MODEL };
