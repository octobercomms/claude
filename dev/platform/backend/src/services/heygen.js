// HeyGen — AI video suite. Pick an avatar look / Digital Twin + voice, type a
// script, and HeyGen renders a captioned reel. Renders async, so generate()
// submits and stores the video id, and pollPending() (driven by the scheduler)
// checks status and fills in the finished video URL. PAYG; cost logged per reel.
//
// v3 API (migrated from the legacy v2 pipeline):
//   POST /v3/videos                       — create (Avatar IV default / V opt-in)
//   GET  /v3/videos/{video_id}            — status
//   GET  /v3/avatars/looks?ownership=…    — the avatar picker (look ids)
//   GET  /v3/voices                       — voices (+ support_pause)
// Avatar IV is the default engine (the same modern lip-sync the HeyGen web app
// uses); `fit: cover` fills the requested aspect_ratio so a reel isn't
// letterboxed. https://docs.heygen.com/

const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pool = require('../db');
const { getSetting } = require('../utils/settings');
const { recordApiCost } = require('./costLog');

// Stream a remote video (a HeyGen reel URL) to a local temp file.
async function downloadToTemp(url, filename) {
  const dest = path.join(os.tmpdir(), filename);
  const res = await axios.get(url, { responseType: 'stream', timeout: 120000, maxContentLength: Infinity, maxBodyLength: Infinity });
  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(dest);
    res.data.pipe(w);
    w.on('finish', resolve);
    w.on('error', reject);
    res.data.on('error', reject);
  });
  return dest;
}

const BASE = 'https://api.heygen.com';
const HEYGEN_USD_PER_MIN = 1.0; // Avatar IV ~$1/min (approx; Avatar V costs more)

// Aspect ratios v3 accepts. 'auto' matches the source; the rest are short-edge
// anchored to the resolution (e.g. 1080p 9:16 → 1080×1920).
const ASPECTS = new Set(['16:9', '9:16', '4:5', '5:4', '1:1', 'auto']);

async function apiKey() {
  return (await getSetting('HEYGEN_API_KEY')) || process.env.HEYGEN_API_KEY || null;
}
async function http() {
  const key = await apiKey();
  if (!key) { const e = new Error('HeyGen isn’t configured — add your HeyGen API key in Settings → AI.'); e.status = 400; throw e; }
  // 45s: the avatar-looks list can be a large, slow payload; voices come back fast.
  const client = axios.create({ baseURL: BASE, headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' }, timeout: 45000 });
  // Translate HeyGen transport failures into clear, self-contained messages so
  // the UI doesn't surface a raw "timeout of NNNNms exceeded".
  client.interceptors.response.use(r => r, (err) => {
    if (err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '') || !err.response) {
      const e = new Error('HeyGen didn’t respond in time. It may be busy — try again in a moment. If it keeps failing, check your HeyGen API key in Settings → AI.');
      e.status = 504; throw e;
    }
    if (err.response.status === 401 || err.response.status === 403) {
      const e = new Error('HeyGen rejected the API key. Update it in Settings → AI.');
      e.status = err.response.status; throw e;
    }
    // v3 errors come back as { error: { code, message, param } }. Surface the
    // message + status so failures are diagnosable rather than "Request failed".
    const body = err.response.data || {};
    const hg = body.error?.message || body.message || (typeof body.error === 'string' ? body.error : null) || err.response.statusText;
    const e = new Error(`HeyGen error ${err.response.status}${hg ? `: ${hg}` : ''}`);
    e.status = err.response.status; throw e;
  });
  return client;
}

// The account's own avatar looks (Digital Twins, photo avatars, studio avatars).
// v3 returns concrete, directly-usable look ids — no group→look resolution like
// v2. Paginated; we walk up to a few pages so a large roster still loads.
async function listAvatars() {
  const client = await http();
  const out = [];
  let token = null;
  for (let page = 0; page < 6; page++) {
    const params = { ownership: 'private', limit: 50 };
    if (token) params.token = token;
    const { data } = await client.get('/v3/avatars/looks', { params });
    for (const lk of (data.data || [])) {
      if (!lk.id) continue;
      // Skip looks still training — they can't render yet.
      if (lk.status && lk.status !== 'completed') continue;
      out.push({
        id: lk.id,
        // v3 avatar_type (studio_avatar | digital_twin | photo_avatar) drives
        // which extras are legal (expressiveness/motion = photo avatars only).
        type: lk.avatar_type || 'avatar',
        name: lk.name || 'Avatar',
        preview: lk.preview_image_url || lk.preview_video_url || null,
        engines: lk.supported_api_engines || [],
        default_voice_id: lk.default_voice_id || null,
      });
    }
    if (data.has_more && data.next_token) token = data.next_token; else break;
  }
  return out;
}

async function listVoices() {
  const client = await http();
  const out = [];
  const seen = new Set();
  // v3 /v3/voices defaults to type=public — that excludes the account's own
  // cloned voices. Pull `private` first (so the AM's own voice sits at the top
  // and becomes the default selection), then the public library.
  const pull = async (type) => {
    let token = null;
    for (let page = 0; page < 3; page++) {
      const params = { limit: 100, type };
      if (token) params.token = token;
      let data;
      try { ({ data } = await client.get('/v3/voices', { params })); }
      catch { break; } // a missing/empty private list must not sink the whole picker
      for (const v of (data.data || [])) {
        if (!v.voice_id || seen.has(v.voice_id)) continue;
        seen.add(v.voice_id);
        out.push({
          id: v.voice_id, name: v.name || v.voice_id,
          language: v.language || '', gender: v.gender || '',
          // v3 reports SSML pause/break support per voice — gates the pacing UI.
          supportsPause: !!v.support_pause,
          isPrivate: type === 'private',
        });
      }
      if (data.has_more && data.next_token) token = data.next_token; else break;
    }
  };
  await pull('private');
  await pull('public');
  return out;
}

async function remainingQuota() {
  const client = await http();
  const { data } = await client.get('/v2/user/remaining_quota').catch(() => ({ data: {} }));
  const d = data.data || data || {};
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

// Turn our lightweight pacing markers into SSML for voices whose support_pause
// is true. Returns null when the script has no markers, so the plain-text path
// (the common case) is used unchanged and can never be affected.
//   [pause 0.5s] / [pause 500ms] → <break time="0.5s"/>
//   *emphasised words*           → <emphasis>emphasised words</emphasis>
function toSsml(text) {
  let touched = false;
  let s = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  s = s.replace(/\[pause\s+([0-9.]+)\s*(ms|s)?\]/gi, (_, n, unit) => { touched = true; return `<break time="${n}${unit || 's'}"/>`; });
  s = s.replace(/\*([^*\n]+)\*/g, (_, w) => { touched = true; return `<emphasis>${w}</emphasis>`; });
  return touched ? `<speak>${s}</speak>` : null;
}

// Fallback duration (seconds) from the script when the status response omits it,
// so cost logging still works. ~150 wpm ≈ 2.5 words/sec; floor at 3s.
function estimateDurationFromScript(script) {
  const words = String(script || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(3, Math.round(words / 2.5));
}

async function generate(clientId, { title, script, avatar_id, avatar_type, avatar_name, voice_id, caption = true, aspect, fit, engine, expressiveness, speed }, userId) {
  if (!String(script || '').trim()) { const e = new Error('Add a script for the avatar to say.'); e.status = 400; throw e; }
  if (!avatar_id || !voice_id) { const e = new Error('Pick an avatar and a voice.'); e.status = 400; throw e; }
  const aspectRatio = ASPECTS.has(aspect) ? aspect : '9:16';
  const fitMode = fit === 'contain' ? 'contain' : 'cover';
  const type = avatar_type || 'avatar';
  const isPhoto = type === 'photo_avatar';
  // Avatar V is an opt-in, eligibility-gated engine (digital twins). Everything
  // else uses the Avatar IV default (engine omitted).
  const useEngine = engine === 'avatar_v' ? 'avatar_v' : null;
  // expressiveness is an Avatar IV-only knob — HeyGen 400s if it's sent with
  // engine avatar_v, so only include it on the default (Avatar IV) engine.
  const useExpr = isPhoto && !useEngine && ['low', 'medium', 'high'].includes(expressiveness) ? expressiveness : null;
  // Voice speed (v3 voice_settings.speed). Clamp to the API's 0.5–1.5; null
  // (or exactly 1) means leave HeyGen's default pace untouched.
  const spd = Number(speed);
  const useSpeed = Number.isFinite(spd) && spd !== 1 ? Math.min(1.5, Math.max(0.5, spd)) : null;

  const { rows } = await pool.query(
    `INSERT INTO heygen_reels (client_id, title, script, avatar_id, avatar_type, avatar_name, voice_id, caption, aspect_ratio, fit, engine, expressiveness, speed, status, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'queued',$14) RETURNING *`,
    [clientId, title || null, script.trim(), avatar_id, type, avatar_name || null, voice_id, !!caption, aspectRatio, fitMode, useEngine, useExpr, useSpeed, userId || null]
  );
  const reel = rows[0];

  try {
    const client = await http();
    const scriptText = script.trim();
    const ssml = toSsml(scriptText);
    const body = {
      type: 'avatar',
      avatar_id,
      script: ssml || scriptText,
      voice_id,
      aspect_ratio: aspectRatio,
      resolution: '1080p',
      fit: fitMode,
      title: title || undefined,
    };
    // Burn captions into the render (a sidecar .srt is always returned too).
    if (caption) body.caption = { style: 'default' };
    if (useEngine) body.engine = { type: useEngine };
    if (useExpr) body.expressiveness = useExpr;
    if (useSpeed) body.voice_settings = { speed: useSpeed };

    const { data } = await client.post('/v3/videos', body);
    if (data.error) throw new Error(data.error.message || (typeof data.error === 'string' ? data.error : 'HeyGen rejected the request'));
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

// "Continue → schedule": turn a finished reel into a pre-filled draft social
// post plan and hand it to the factory's Plan step. The reel (its public
// video URL + heygen id) is carried on the plan so the publish step can use
// it; the AM sets the date + platforms in Plan. Creates a DRAFT — nothing
// publishes until the AM schedules it.
async function scheduleAsPlan(clientId, id, userId) {
  const { rows } = await pool.query('SELECT * FROM heygen_reels WHERE client_id = $1 AND id = $2', [clientId, id]);
  const r = rows[0];
  if (!r) { const e = new Error('Reel not found.'); e.status = 404; throw e; }
  if (r.status !== 'completed' || !r.video_url) { const e = new Error('This reel isn’t finished rendering yet.'); e.status = 400; throw e; }

  const script = (r.script || '').trim();
  const title = (r.title || script.slice(0, 60) || 'Avatar reel').trim();
  // Vertical reels default to reels-capable placements; the AM adjusts in Plan.
  const platforms = ['9:16', '4:5', '1:1'].includes(r.aspect_ratio)
    ? ['instagram_reels', 'tiktok']
    : ['instagram_feed'];
  const plan = {
    version: 1,
    title,
    platforms,
    framework: 'Avatar reel (HeyGen)',
    hook: { text: script.split(/[.!?\n]/)[0].slice(0, 120) },
    scenes: [],
    caption: script,
    // Pre-produced media the publish step should use rather than a Drive file.
    source: 'heygen_reel',
    reel: {
      reel_id: r.id,
      video_url: r.video_url,
      heygen_video_id: r.heygen_video_id,
      duration_s: r.duration_s,
      aspect_ratio: r.aspect_ratio,
      avatar_name: r.avatar_name,
    },
  };
  const { rows: planRows } = await pool.query(
    `INSERT INTO social_post_plans (client_id, title, plan, status, created_by)
     VALUES ($1, $2, $3, 'draft', $4) RETURNING id, title, status`,
    [clientId, title, JSON.stringify(plan), userId || null]
  );
  const created = planRows[0];

  // Persist the reel into a Drive folder for this plan so the autopilot
  // publisher sources it the normal way (a HeyGen URL is presigned and can
  // expire; a Drive copy can't). Best-effort: if the client has no Google
  // Drive connected, or the copy fails, the plan still stands as a draft —
  // we just report why the video didn't attach.
  let drive_warning = null;
  let tmp = null;
  try {
    const socialDrive = require('./socialDrive');
    const folder = await socialDrive.createFolder(clientId, `Reel — ${title}`);
    if (!folder.id) throw new Error('Drive folder was not created.');
    tmp = await downloadToTemp(r.video_url, `reel-${r.id}-${r.heygen_video_id || 'v'}.mp4`);
    await socialDrive.uploadFile(clientId, {
      name: `${title}.mp4`.replace(/[\/\\]/g, '-').slice(0, 140),
      mimeType: 'video/mp4', filePath: tmp, folderInput: folder.id,
    });
    await pool.query('UPDATE social_post_plans SET drive_folder_url = $2 WHERE id = $1',
      [created.id, folder.webViewLink || folder.id]);
    created.drive_folder_url = folder.webViewLink || folder.id;
  } catch (err) {
    drive_warning = err.message;
    console.warn(`[heygen schedule] Drive attach failed for reel ${r.id}: ${err.message}`);
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
  }
  return { ...created, drive_warning };
}

async function retry(clientId, id, userId) {
  const { rows } = await pool.query('SELECT * FROM heygen_reels WHERE client_id = $1 AND id = $2', [clientId, id]);
  const r = rows[0];
  if (!r) { const e = new Error('Reel not found.'); e.status = 404; throw e; }
  return generate(clientId, {
    title: r.title, script: r.script, avatar_id: r.avatar_id, avatar_type: r.avatar_type,
    avatar_name: r.avatar_name, voice_id: r.voice_id, caption: r.caption, aspect: r.aspect_ratio,
    fit: r.fit, engine: r.engine, expressiveness: r.expressiveness, speed: r.speed,
  }, userId)
    .then(async (created) => { await pool.query('DELETE FROM heygen_reels WHERE id = $1', [id]); return created; });
}

// Check one job's status against HeyGen (v3) and apply the result.
async function refreshOne(reel) {
  if (!reel.heygen_video_id) return reel;
  const client = await http();
  const { data } = await client.get(`/v3/videos/${reel.heygen_video_id}`);
  const d = data.data || data || {};
  const status = d.status;
  if (status === 'completed') {
    const dur = (d.duration != null && Number.isFinite(Number(d.duration)))
      ? Number(d.duration)
      : estimateDurationFromScript(reel.script);
    await pool.query(
      `UPDATE heygen_reels SET status = 'completed', video_url = $2, duration_s = $3, error = NULL WHERE id = $1`,
      [reel.id, d.video_url || null, dur]
    );
    if (dur) recordApiCost({ provider: 'heygen', feature: 'heygen_reel', costUsd: (dur / 60) * HEYGEN_USD_PER_MIN, clientId: reel.client_id, meta: { duration_s: Math.round(dur), engine: reel.engine || 'avatar_iv' } });
  } else if (status === 'failed') {
    const msg = d.failure_message || d.error?.message || (typeof d.error === 'string' ? d.error : 'HeyGen failed to render this video');
    await pool.query(`UPDATE heygen_reels SET status = 'failed', error = $2 WHERE id = $1`, [reel.id, String(msg).slice(0, 500)]);
  }
  // pending / processing / waiting → leave as-is
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

// Avatars + voices for the picker, cached for an hour. The looks/voices lists
// are paginated network walks, so once loaded we hold them rather than
// re-fetching on every page view; a failed call falls back to any cache.
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

// Lightweight connectivity check for Settings → AI. Pings a cheap v3 endpoint
// and reports exactly what happened: ok / no key / bad key / timeout.
async function testConnection() {
  const key = await apiKey();
  if (!key) return { ok: false, reason: 'no_key', message: 'No HeyGen API key saved — add one above.' };
  try {
    const client = await http();
    await client.get('/v3/voices', { params: { limit: 1 } });
    return { ok: true, message: 'Connected to HeyGen — the key works.' };
  } catch (e) {
    const reason = e.status === 401 || e.status === 403 ? 'bad_key' : e.status === 504 ? 'timeout' : 'error';
    return { ok: false, reason, message: e.message };
  }
}

module.exports = { listAvatars, listVoices, getOptions, remainingQuota, list, generate, scheduleAsPlan, retry, refresh, remove, pollPending, testConnection };
