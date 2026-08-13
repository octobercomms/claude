// In-OMI screen recorder — authed API (staff only). Create a recording, upload
// the recorded blob, finalize, list "my recordings", and delete. Public playback
// + view analytics live in routes/watchPublic.js. Storage goes through
// services/mediaStore (disk today, Cloudflare R2 once configured).
// See docs/omi/loom-replacement-plan.md.

const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const pool = require('../db');
const mediaStore = require('../services/mediaStore');
const loomFetch = require('../services/loomFetch');
const transcribe = require('../services/recordingTranscribe');

const router = express.Router();
router.use(authenticate);

// Recorded blobs are held in memory only long enough to write them to the store.
// Internal walkthroughs are small; the cap is a guard, not a target.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 512 * 1024 * 1024 } });

function newToken() {
  return crypto.randomBytes(16).toString('base64url');
}

// Shape a recording row for the client. Never leak storage_key.
function present(r, views) {
  return {
    id: r.id,
    title: r.title,
    client_id: r.client_id,
    mime: r.mime,
    duration_s: r.duration_s,
    size_bytes: r.size_bytes != null ? Number(r.size_bytes) : null,
    status: r.status,
    has_transcript: !!r.transcript,
    public_token: r.public_token,
    share_path: `/share/${r.public_token}`,
    imported_views: r.imported_views || 0,
    source: r.source || 'recorder',
    created_at: r.created_at,
    ...(views !== undefined ? views : {}),
  };
}

// ── Create a recording (before the bytes exist) ───────────────────────────────
// Returns the id + how the browser should deliver the video. For the disk store
// that's our own upload endpoint; for R2 it will be a presigned PUT.
router.post('/', express.json(), async (req, res) => {
  try {
    const title = String(req.body?.title || 'Untitled recording').slice(0, 200);
    const mime = String(req.body?.mime || 'video/webm').slice(0, 60);
    const clientId = req.body?.client_id || null;
    const token = newToken();
    const { rows } = await pool.query(
      `INSERT INTO recordings (created_by, client_id, title, mime, public_token, status)
       VALUES ($1, $2, $3, $4, $5, 'uploading') RETURNING *`,
      [req.user?.id || null, clientId, title, mime, token]
    );
    const rec = rows[0];
    const key = mediaStore.keyFor(rec.id, mime);
    await pool.query('UPDATE recordings SET storage_key = $1 WHERE id = $2', [key, rec.id]);
    res.json({ id: rec.id, upload: mediaStore.uploadDescriptor(key, mime), share_path: `/share/${token}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Receive the recorded blob (disk store: 'app' upload mode) ─────────────────
// Keyed by storage_key so the URL the browser was handed maps straight to a row.
router.post('/:key/blob', upload.single('file'), async (req, res) => {
  try {
    const key = req.params.key;
    const { rows } = await pool.query('SELECT id, mime FROM recordings WHERE storage_key = $1', [key]);
    if (!rows.length) return res.status(404).json({ error: 'Recording not found' });
    if (!req.file) return res.status(400).json({ error: 'No file' });
    await mediaStore.saveBuffer(key, req.file.buffer, rows[0].mime);
    await pool.query('UPDATE recordings SET size_bytes = $1 WHERE id = $2', [req.file.size, rows[0].id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Finalize — mark ready, record duration ────────────────────────────────────
router.post('/:id/finalize', express.json(), async (req, res) => {
  try {
    const duration = Number.isFinite(Number(req.body?.duration_s)) ? Math.round(Number(req.body.duration_s)) : null;
    const { rows } = await pool.query(
      `UPDATE recordings SET status = 'ready', duration_s = COALESCE($1, duration_s)
       WHERE id = $2 AND created_by IS NOT DISTINCT FROM $3 RETURNING *`,
      [duration, req.params.id, req.user?.id || null]
    );
    if (!rows.length) return res.status(404).json({ error: 'Recording not found' });
    // Kick transcription in the background (no-ops without OPENAI_API_KEY).
    transcribe.transcribeInBackground(rows[0].id);
    res.json(present(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── My recordings library ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*,
              COUNT(v.id)::int AS view_count,
              COALESCE(MAX(v.watch_seconds), 0)::int AS max_watch_seconds
         FROM recordings r
         LEFT JOIN recording_views v ON v.recording_id = r.id
        WHERE r.created_by IS NOT DISTINCT FROM $1
        GROUP BY r.id
        ORDER BY r.created_at DESC
        LIMIT 200`,
      [req.user?.id || null]
    );
    res.json(rows.map(r => present(r, { view_count: r.view_count, max_watch_seconds: r.max_watch_seconds })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── One recording, with view detail ───────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM recordings WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Recording not found' });
    const { rows: vrows } = await pool.query(
      `SELECT COUNT(*)::int AS view_count, COALESCE(MAX(watch_seconds),0)::int AS max_watch_seconds
         FROM recording_views WHERE recording_id = $1`, [req.params.id]);
    res.json({ ...present(rows[0], vrows[0]), transcript: rows[0].transcript || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Transcribe on demand (retry, or backfill a migrated video) ────────────────
router.post('/:id/transcribe', async (req, res) => {
  if (!transcribe.enabled) return res.status(503).json({ error: 'Transcription is not configured (no OPENAI_API_KEY).' });
  const { rows } = await pool.query('SELECT id FROM recordings WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Recording not found' });
  transcribe.transcribeInBackground(req.params.id);
  res.json({ ok: true, queued: true });
});

// ── Bulk delete (clear out migrated / dead recordings) ────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.post('/bulk-delete', express.json(), async (req, res) => {
  try {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
      .map(String).filter(id => UUID_RE.test(id));
    if (!ids.length) return res.status(400).json({ error: 'No valid ids' });
    const { rows } = await pool.query(
      `DELETE FROM recordings WHERE id = ANY($1::uuid[]) AND created_by IS NOT DISTINCT FROM $2 RETURNING storage_key`,
      [ids, req.user?.id || null]
    );
    await Promise.all(rows.filter(r => r.storage_key).map(r => mediaStore.remove(r.storage_key).catch(() => {})));
    res.json({ ok: true, deleted: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Import an existing video (e.g. migrated from Loom) ────────────────────────
// A file plus metadata. share_id (the original Loom id) becomes the public_token
// so the /share/<id> URL matches the old Loom link; created_at preserves the
// original date; imported_views seeds the analytics baseline (prior Loom views).
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const b = req.body || {};
    const title = String(b.title || 'Imported recording').slice(0, 200);
    const mime = (req.file.mimetype || '').startsWith('video/') ? req.file.mimetype : 'video/mp4';
    const importedViews = Math.max(0, parseInt(b.imported_views, 10) || 0);
    const sourceUrl = b.source_url ? String(b.source_url).slice(0, 500) : null;
    const createdAt = b.created_at && !isNaN(Date.parse(b.created_at)) ? new Date(b.created_at) : new Date();

    // Preferred share id = the original Loom id, so the old link maps across.
    // Must be URL-safe and unused; otherwise fall back to a random token so an
    // import never collides or fails silently.
    let token = String(b.share_id || '').trim();
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(token)) {
      token = newToken();
    } else {
      const clash = await pool.query('SELECT 1 FROM recordings WHERE public_token = $1', [token]);
      if (clash.rows.length) token = newToken();
    }

    const { rows } = await pool.query(
      `INSERT INTO recordings
         (created_by, title, mime, public_token, status, source, source_url, imported_views, size_bytes, created_at)
       VALUES ($1,$2,$3,$4,'ready','loom_import',$5,$6,$7,$8) RETURNING *`,
      [req.user?.id || null, title, mime, token, sourceUrl, importedViews, req.file.size, createdAt]
    );
    const rec = rows[0];
    const key = mediaStore.keyFor(rec.id, mime);
    await mediaStore.saveBuffer(key, req.file.buffer, mime);
    await pool.query('UPDATE recordings SET storage_key = $1 WHERE id = $2', [key, rec.id]);
    transcribe.transcribeInBackground(rec.id);
    res.json(present({ ...rec, storage_key: key }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Import from Loom by share link (best-effort auto-fetch) ───────────────────
// Body: { items: [{ url, views?, date?, title? }] }. For each link OMI fetches
// the video + title from Loom, stores it, and creates a recording whose share id
// IS the Loom id (so the old /share/<id> link maps across). Per-item results are
// returned so links that can't be pulled (private/downloads-off) can fall back
// to a manual upload. Sequential + capped: this is a one-time migration, not a
// hot path, and each item downloads then re-uploads a whole video.
router.post('/import-loom', express.json(), async (req, res) => {
  try {
    const items = (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, 20);
    if (!items.length) return res.status(400).json({ error: 'No links provided (max 20 per batch).' });

    const results = [];
    for (const it of items) {
      const url = String(it?.url || '').trim();
      try {
        const v = await loomFetch.fetchLoomVideo(url);
        // The Loom id is the share id — skip if we already imported it.
        const exists = await pool.query('SELECT id FROM recordings WHERE public_token = $1', [v.loomId]);
        if (exists.rows.length) { results.push({ url, ok: false, error: 'Already imported.' }); continue; }

        const createdAt = it.date && !isNaN(Date.parse(it.date)) ? new Date(it.date) : new Date();
        const views = Math.max(0, parseInt(it.views, 10) || 0);
        const title = String(it.title || v.title || 'Imported from Loom').slice(0, 200);

        const ins = await pool.query(
          `INSERT INTO recordings
             (created_by, title, mime, public_token, status, source, source_url, imported_views, size_bytes, created_at)
           VALUES ($1,$2,$3,$4,'ready','loom_import',$5,$6,$7,$8) RETURNING id`,
          [req.user?.id || null, title, v.mime, v.loomId, url, views, v.buffer.length, createdAt]
        );
        const recId = ins.rows[0].id;
        const key = mediaStore.keyFor(recId, v.mime);
        await mediaStore.saveBuffer(key, v.buffer, v.mime);
        await pool.query('UPDATE recordings SET storage_key = $1 WHERE id = $2', [key, recId]);
        transcribe.transcribeInBackground(recId);
        results.push({ url, ok: true, id: recId, title, share_path: `/share/${v.loomId}` });
      } catch (err) {
        results.push({ url, ok: false, error: err.message || 'Import failed.' });
      }
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete recording + stored object ──────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM recordings WHERE id = $1 AND created_by IS NOT DISTINCT FROM $2 RETURNING storage_key`,
      [req.params.id, req.user?.id || null]
    );
    if (!rows.length) return res.status(404).json({ error: 'Recording not found' });
    if (rows[0].storage_key) await mediaStore.remove(rows[0].storage_key).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
