// HeyGen — AI video suite (Phase 1): script + avatar/Digital Twin → captioned
// vertical reel. HeyGen renders async, so generate() submits and stores the
// heygen video id, and pollPending() (driven by the scheduler) checks status and
// fills in the finished video URL. PAYG; cost logged per completed reel.
//
// API: X-Api-Key header. v2/avatars, v2/voices, v2/video/generate; status via
// v1/video_status.get. https://docs.heygen.com/

const axios = require('axios');
const pool = require('../db');
const { getSetting } = require('../utils/settings');
const { recordApiCost } = require('./costLog');

const BASE = 'https://api.heygen.com';
const HEYGEN_USD_PER_MIN = 1.0; // standard avatar ~$1/min (approx; Avatar IV costs more)

async function apiKey() {
  return (await getSetting('HEYGEN_API_KEY')) || process.env.HEYGEN_API_KEY || null;
}
async function http() {
  const key = await apiKey();
  if (!key) { const e = new Error('HeyGen isn’t configured — add your HeyGen API key in Settings → AI.'); e.status = 400; throw e; }
  // 45s: the /v2/avatars list (stock + account avatars + talking photos) can be
  // a large, slow payload — voices and quota come back fast, avatars need room.
  const client = axios.create({ baseURL: BASE, headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' }, timeout: 45000 });
  // Translate HeyGen transport failures into clear, self-contained messages so
  // the UI doesn't surface a raw "timeout of NNNNms exceeded" (which wrongly
  // reads as a missing key when the key is actually set but HeyGen is slow).
  client.interceptors.response.use(r => r, (err) => {
    if (err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '') || !err.response) {
      const e = new Error('HeyGen didn’t respond in time. It may be busy — try again in a moment. If it keeps failing, check your HeyGen API key in Settings → AI.');
      e.status = 504; throw e;
    }
    if (err.response.status === 401 || err.response.status === 403) {
      const e = new Error('HeyGen rejected the API key. Update it in Settings → AI.');
      e.status = err.response.status; throw e;
    }
    // Any other error status — surface HeyGen's own message + the status code
    // so failures are diagnosable rather than a generic "Request failed".
    const body = err.response.data || {};
    const hg = body.error?.message || body.message || (typeof body.error === 'string' ? body.error : null) || err.response.statusText;
    const e = new Error(`HeyGen error ${err.response.status}${hg ? `: ${hg}` : ''}`);
    e.status = err.response.status; throw e;
  });
  return client;
}

// Avatars (incl. Digital Twins) + talking photos, simplified for the picker.
async function listAvatars() {
  const client = await http();
  const { data } = await client.get('/v2/avatars');
  const d = data.data || data || {};
  const avatars = (d.avatars || []).map(a => ({ id: a.avatar_id, name: a.avatar_name || a.avatar_id, type: 'avatar', preview: a.preview_image_url || null, gender: a.gender || null }));
  const photos = (d.talking_photos || []).map(p => ({ id: p.talking_photo_id, name: p.talking_photo_name || 'Talking photo', type: 'talking_photo', preview: p.preview_image_url || null, gender: null }));
  return [...avatars, ...photos];
}

async function listVoices() {
  const client = await http();
  const { data } = await client.get('/v2/voices');
  const voices = (data.data?.voices || data.voices || []).map(v => ({ id: v.voice_id, name: v.name || v.voice_id, language: v.language || v.locale || '', gender: v.gender || '' }));
  return voices;
}

async function remainingQuota() {
  const client = await http();
  const { data } = await client.get('/v2/user/remaining_quota').catch(() => ({ data: {} }));
  const d = data.data || data || {};
  // HeyGen returns remaining quota in API credits; surface what we get.
  const credits = d.remaining_quota ?? d.remaining ?? null;
  return credits != null ? Number(credits) : null;
}

async function list(clientId) {
  const { rows } = await pool.query('SELECT * FROM heygen_reels WHERE client_id = $1 ORDER BY created_at DESC', [clientId]);
  return rows;
}

async function remove(clientId, id) {
  await pool.query('DELETE FROM heygen_reels WHERE client_id = $1 AND id = $2', [clientId, id]);
}

// Submit a reel to HeyGen and store the job. Vertical 1080×1920, captions on.
async function generate(clientId, { title, script, avatar_id, avatar_type, avatar_name, voice_id, caption = true }, userId) {
  if (!String(script || '').trim()) { const e = new Error('Add a script for the avatar to say.'); e.status = 400; throw e; }
  if (!avatar_id || !voice_id) { const e = new Error('Pick an avatar and a voice.'); e.status = 400; throw e; }
  const type = avatar_type === 'talking_photo' ? 'talking_photo' : 'avatar';

  const { rows } = await pool.query(
    `INSERT INTO heygen_reels (client_id, title, script, avatar_id, avatar_type, avatar_name, voice_id, caption, status, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued',$9) RETURNING *`,
    [clientId, title || null, script.trim(), avatar_id, type, avatar_name || null, voice_id, !!caption, userId || null]
  );
  const reel = rows[0];

  try {
    const client = await http();
    const character = type === 'talking_photo'
      ? { type: 'talking_photo', talking_photo_id: avatar_id }
      : { type: 'avatar', avatar_id, avatar_style: 'normal' };
    const body = {
      video_inputs: [{ character, voice: { type: 'text', input_text: script.trim(), voice_id } }],
      dimension: { width: 1080, height: 1920 },
      caption: !!caption,
      title: title || undefined,
    };
    const { data } = await client.post('/v2/video/generate', body);
    if (data.error) throw new Error(typeof data.error === 'string' ? data.error : (data.error.message || 'HeyGen rejected the request'));
    const videoId = data.data?.video_id || data.video_id;
    if (!videoId) throw new Error('HeyGen did not return a video id');
    const upd = await pool.query(
      `UPDATE heygen_reels SET status = 'processing', heygen_video_id = $2 WHERE id = $1 RETURNING *`,
      [reel.id, videoId]
    );
    return upd.rows[0];
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
    await pool.query(`UPDATE heygen_reels SET status = 'failed', error = $2 WHERE id = $1`, [reel.id, String(msg).slice(0, 500)]);
    const e = new Error(msg); e.status = err.status || 502; throw e;
  }
}

async function retry(clientId, id, userId) {
  const { rows } = await pool.query('SELECT * FROM heygen_reels WHERE client_id = $1 AND id = $2', [clientId, id]);
  const r = rows[0];
  if (!r) { const e = new Error('Reel not found.'); e.status = 404; throw e; }
  return generate(clientId, { title: r.title, script: r.script, avatar_id: r.avatar_id, avatar_type: r.avatar_type, avatar_name: r.avatar_name, voice_id: r.voice_id, caption: r.caption }, userId)
    .then(async (created) => { await pool.query('DELETE FROM heygen_reels WHERE id = $1', [id]); return created; });
}

// Check one job's status against HeyGen and apply the result.
async function refreshOne(reel) {
  if (!reel.heygen_video_id) return reel;
  const client = await http();
  const { data } = await client.get('/v1/video_status.get', { params: { video_id: reel.heygen_video_id } });
  const d = data.data || data || {};
  const status = d.status;
  if (status === 'completed') {
    const dur = d.duration != null ? Number(d.duration) : null;
    await pool.query(
      `UPDATE heygen_reels SET status = 'completed', video_url = $2, duration_s = $3, error = NULL WHERE id = $1`,
      [reel.id, d.video_url || d.video_url_caption || null, dur]
    );
    if (dur) recordApiCost({ provider: 'heygen', feature: 'heygen_reel', costUsd: (dur / 60) * HEYGEN_USD_PER_MIN, clientId: reel.client_id, meta: { duration_s: Math.round(dur) } });
  } else if (status === 'failed') {
    const msg = d.error?.message || d.error?.detail || (typeof d.error === 'string' ? d.error : 'HeyGen failed to render this video');
    await pool.query(`UPDATE heygen_reels SET status = 'failed', error = $2 WHERE id = $1`, [reel.id, String(msg).slice(0, 500)]);
  }
  // pending/processing/waiting → leave as-is
  const { rows } = await pool.query('SELECT * FROM heygen_reels WHERE id = $1', [reel.id]);
  return rows[0];
}

async function refresh(clientId, id) {
  const { rows } = await pool.query('SELECT * FROM heygen_reels WHERE client_id = $1 AND id = $2', [clientId, id]);
  if (!rows[0]) { const e = new Error('Reel not found.'); e.status = 404; throw e; }
  return refreshOne(rows[0]);
}

// Scheduler: poll everything still processing. No-op without a key.
async function pollPending() {
  if (!(await apiKey())) return;
  const { rows } = await pool.query("SELECT * FROM heygen_reels WHERE status = 'processing' AND heygen_video_id IS NOT NULL LIMIT 25");
  for (const r of rows) {
    try { await refreshOne(r); } catch (e) { console.error('[heygen] poll', r.id, e.message); }
  }
}

// Avatars + voices for the picker, cached for an hour. /v2/avatars is a large,
// slow payload (the whole stock catalogue), so once it loads we hold it rather
// than re-fetching on every page view; a failed call falls back to any cache.
const _optsCache = { avatars: { data: null, at: 0 }, voices: { data: null, at: 0 } };
const OPTS_TTL = 60 * 60 * 1000;

async function listCached(kind) {
  const c = _optsCache[kind];
  if (c.data && Date.now() - c.at < OPTS_TTL) return c.data;
  const data = await (kind === 'avatars' ? listAvatars() : listVoices());
  c.data = data; c.at = Date.now();
  return data;
}

async function getOptions() {
  const [a, v] = await Promise.allSettled([listCached('avatars'), listCached('voices')]);
  const avatars = a.status === 'fulfilled' ? a.value : (_optsCache.avatars.data || []);
  const voices = v.status === 'fulfilled' ? v.value : (_optsCache.voices.data || []);
  const aOk = a.status === 'fulfilled' || !!_optsCache.avatars.data;
  const vOk = v.status === 'fulfilled' || !!_optsCache.voices.data;
  if (!aOk && !vOk) throw (a.reason || v.reason || Object.assign(new Error('Could not reach HeyGen.'), { status: 502 }));
  const partial_error = !aOk ? (a.reason?.message || null) : !vOk ? (v.reason?.message || null) : null;
  return { avatars, voices, partial: !aOk || !vOk, partial_error };
}

// Lightweight connectivity check for Settings → AI. Pings a cheap HeyGen
// endpoint and reports exactly what happened: ok / no key / bad key / timeout.
async function testConnection() {
  const key = await apiKey();
  if (!key) return { ok: false, reason: 'no_key', message: 'No HeyGen API key saved — add one above.' };
  try {
    const client = await http();
    await client.get('/v2/user/remaining_quota');
    return { ok: true, message: 'Connected to HeyGen — the key works.' };
  } catch (e) {
    const reason = e.status === 401 || e.status === 403 ? 'bad_key' : e.status === 504 ? 'timeout' : 'error';
    return { ok: false, reason, message: e.message };
  }
}

module.exports = { listAvatars, listVoices, getOptions, remainingQuota, list, generate, retry, refresh, remove, pollPending, testConnection };
