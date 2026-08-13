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
    share_path: `/watch/${r.public_token}`,
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
    res.json({ id: rec.id, upload: mediaStore.uploadDescriptor(key, mime), share_path: `/watch/${token}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Receive the recorded blob (disk store: 'app' upload mode) ─────────────────
// Keyed by storage_key so the URL the browser was handed maps straight to a row.
router.post('/:key/blob', upload.single('file'), async (req, res) => {
  try {
    const key = req.params.key;
    const { rows } = await pool.query('SELECT id FROM recordings WHERE storage_key = $1', [key]);
    if (!rows.length) return res.status(404).json({ error: 'Recording not found' });
    if (!req.file) return res.status(400).json({ error: 'No file' });
    await mediaStore.saveBuffer(key, req.file.buffer);
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
