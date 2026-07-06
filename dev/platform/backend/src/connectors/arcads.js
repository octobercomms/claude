// Arcads — AI UGC video generation. Submit a script + actor preference,
// the API returns a job id; poll until the video URL is ready. Roughly
// $2 per minute of finished video.
//
// API surface as of writing (developer.arcads.ai):
//   POST /videos                  — create job
//   GET  /videos/{id}             — poll job

const axios = require('axios');
const { getSetting } = require('../utils/settings');

const BASE_URL = 'https://api.arcads.ai/v1';

async function client() {
  const key = await getSetting('ARCADS_API_KEY');
  if (!key) throw new Error('ARCADS_API_KEY not set in Settings');
  return axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  });
}

// Generate a UGC video for a script. Actor defaults to a UK/US-neutral
// female voice unless overridden — Arcads has dozens of actors so the
// AM can experiment, but a sensible default keeps the happy path one
// click.
async function generateVideo({ script, actor_id, aspect_ratio = '9:16', language = 'en-GB' }) {
  const api = await client();
  const { data: created } = await api.post('/videos', {
    script,
    actor_id: actor_id || undefined,
    language,
    aspect_ratio,
  });
  const jobId = created.id || created.video_id;
  if (!jobId) throw new Error('Arcads: no job id returned');

  // Poll with a generous deadline — UGC renders can take a couple of
  // minutes. We stop hitting the API every 5s after the first minute.
  const start = Date.now();
  const deadline = start + 6 * 60_000;     // 6 minutes
  while (Date.now() < deadline) {
    const age = Date.now() - start;
    await new Promise(r => setTimeout(r, age < 60_000 ? 5_000 : 10_000));
    const { data: job } = await api.get(`/videos/${jobId}`);
    if (job.status === 'completed' || job.status === 'ready') {
      require('../services/costLog').recordApiCost({ provider: 'arcads', feature: 'ugc_video', costUsd: 1.5, meta: { actor_id: actor_id || null } });
      return {
        url: job.video_url || job.output_url,
        duration_sec: job.duration || null,
        actor_id: job.actor_id || actor_id || null,
        job_id: jobId,
      };
    }
    if (job.status === 'failed') throw new Error(`Arcads job failed: ${job.error || 'unknown'}`);
  }
  throw new Error('Arcads job timed out after 6 minutes');
}

async function listActors() {
  try {
    const api = await client();
    const { data } = await api.get('/actors');
    return data.actors || data.data || data || [];
  } catch (err) {
    // Endpoint may be subject to change — never block the happy path.
    return [];
  }
}

async function testCredentials() {
  try {
    const api = await client();
    await api.get('/actors');     // cheapest authenticated call
    return { ok: true, message: 'Connected to Arcads.' };
  } catch (err) {
    return { ok: false, message: err.response?.data?.message || err.message };
  }
}

module.exports = { generateVideo, listActors, testCredentials };
