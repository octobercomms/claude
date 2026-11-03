// Audio cleanup — upload a recording, run ElevenLabs Audio Isolation to strip
// echo and background noise, then play back or download the cleaned version.
// Follows the same pattern as routes/transcripts.js: upload → background
// processing → poll status → serve result.

const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, assertClientAccess } = require('../middleware/clientAccess');
const pool = require('../db');
const mediaStore = require('../services/mediaStore');
const audioIsolation = require('../services/audioIsolation');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

function extFromName(name, mime) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  if (m) return m[1];
  const map = {
    'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
    'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm',
    'audio/ogg': 'ogg', 'audio/flac': 'flac',
  };
  return map[String(mime || '').toLowerCase()] || 'audio';
}

function present(r) {
  return {
    id: r.id,
    title: r.title,
    client_id: r.client_id,
    status: r.status,
    error: r.error || null,
    size_bytes: r.size_bytes != null ? Number(r.size_bytes) : null,
    cleaned_size: r.cleaned_size != null ? Number(r.cleaned_size) : null,
    has_cleaned: !!r.cleaned_key,
    created_at: r.created_at,
  };
}

// ── Upload audio + start cleanup ─────────────────────────────────────────────
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer?.length) return res.status(400).json({ error: 'No audio file uploaded.' });
    const title = String(req.body?.title || req.file.originalname || 'Untitled').slice(0, 200);
    let clientId = req.body?.client_id || null;
    if (clientId) assertClientAccess(req, clientId);

    const id = crypto.randomUUID();
    const ext = extFromName(req.file.originalname, req.file.mimetype);
    const key = mediaStore.keyFor(id, ext);
    await mediaStore.saveBuffer(key, req.file.buffer, req.file.mimetype);

    const { rows } = await pool.query(
      `INSERT INTO audio_cleanups (id, created_by, client_id, title, storage_key, mime, size_bytes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing') RETURNING *`,
      [id, req.user?.id || null, clientId, title, key, req.file.mimetype || null, req.file.buffer.length]
    );
    audioIsolation.processInBackground(id);
    res.status(201).json(present(rows[0]));
  } catch (err) {
    console.error('[audio] upload failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── List (optionally by client) ──────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const clientId = req.query.client_id || null;
    if (clientId) assertClientAccess(req, clientId);
    const { rows } = await pool.query(
      clientId
        ? 'SELECT * FROM audio_cleanups WHERE client_id = $1 ORDER BY created_at DESC LIMIT 100'
        : 'SELECT * FROM audio_cleanups WHERE created_by = $1 ORDER BY created_at DESC LIMIT 100',
      clientId ? [clientId] : [req.user?.id || null]
    );
    res.json({ items: rows.map(present) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── One record ───────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Bad id' });
    const { rows } = await pool.query('SELECT * FROM audio_cleanups WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].client_id) assertClientAccess(req, rows[0].client_id);
    res.json(present(rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Stream original audio ────────────────────────────────────────────────────
router.get('/:id/original', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Bad id' });
    const { rows } = await pool.query('SELECT client_id, storage_key, mime FROM audio_cleanups WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].client_id) assertClientAccess(req, rows[0].client_id);
    if (!rows[0].storage_key) return res.status(404).json({ error: 'Original audio not stored.' });

    const { stream, size, mime } = await mediaStore.openRead(rows[0].storage_key);
    res.set('Content-Type', mime || rows[0].mime || 'audio/mpeg');
    if (size) res.set('Content-Length', String(size));
    stream.pipe(res);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Stream cleaned audio ─────────────────────────────────────────────────────
router.get('/:id/cleaned', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Bad id' });
    const { rows } = await pool.query('SELECT client_id, cleaned_key FROM audio_cleanups WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].client_id) assertClientAccess(req, rows[0].client_id);
    if (!rows[0].cleaned_key) return res.status(404).json({ error: 'Cleaned audio not ready yet.' });

    const { stream, size, mime } = await mediaStore.openRead(rows[0].cleaned_key);
    res.set('Content-Type', mime || 'audio/mpeg');
    if (size) res.set('Content-Length', String(size));
    if (req.query.dl === '1') {
      const { rows: meta } = await pool.query('SELECT title FROM audio_cleanups WHERE id = $1', [req.params.id]);
      const name = (meta[0]?.title || 'cleaned').replace(/\.[a-z0-9]+$/i, '') + '-cleaned.mp3';
      res.set('Content-Disposition', `attachment; filename="${name}"`);
    }
    stream.pipe(res);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Retry a failed cleanup ───────────────────────────────────────────────────
router.post('/:id/retry', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Bad id' });
    const { rows } = await pool.query('SELECT client_id, storage_key FROM audio_cleanups WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].client_id) assertClientAccess(req, rows[0].client_id);
    if (!rows[0].storage_key) return res.status(400).json({ error: 'Original audio no longer stored.' });
    await pool.query(`UPDATE audio_cleanups SET status = 'processing', error = NULL WHERE id = $1`, [req.params.id]);
    audioIsolation.processInBackground(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Delete ───────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Bad id' });
    const { rows } = await pool.query('SELECT client_id, storage_key, cleaned_key FROM audio_cleanups WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].client_id) assertClientAccess(req, rows[0].client_id);
    if (rows[0].storage_key) await mediaStore.remove(rows[0].storage_key).catch(() => {});
    if (rows[0].cleaned_key) await mediaStore.remove(rows[0].cleaned_key).catch(() => {});
    await pool.query('DELETE FROM audio_cleanups WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
