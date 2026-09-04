// Audio transcription with speaker separation. Staff upload an audio file
// (Produce → Transcribe), we store it, run ElevenLabs Scribe in the background,
// then let the AM name each detected voice before reading the final transcript.
// Storage goes through services/mediaStore (disk today, R2 once configured).

const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, assertClientAccess } = require('../middleware/clientAccess');
const pool = require('../db');
const mediaStore = require('../services/mediaStore');
const scribe = require('../services/elevenScribe');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Audio is held in memory only long enough to write it to the store. 200 MB is a
// generous guard for a long interview (a 34 MB m4a is a couple of hours of talk).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

function extFromName(name, mime) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  if (m) return m[1];
  const map = { 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/flac': 'flac' };
  return map[String(mime || '').toLowerCase()] || 'audio';
}

// A short sample line for each speaker so the AM has context when naming voices.
function speakerSamples(segments) {
  const out = {};
  for (const s of segments || []) {
    if (!out[s.speaker] && s.text) out[s.speaker] = s.text.slice(0, 160);
  }
  return out;
}

function present(r, { full = false } = {}) {
  const segments = Array.isArray(r.segments) ? r.segments : [];
  const speakers = [];
  for (const s of segments) if (!speakers.includes(s.speaker)) speakers.push(s.speaker);
  const base = {
    id: r.id,
    title: r.title,
    client_id: r.client_id,
    status: r.status,
    language: r.language,
    error: r.error || null,
    size_bytes: r.size_bytes != null ? Number(r.size_bytes) : null,
    speakers,
    speaker_names: r.speaker_names || {},
    speaker_samples: speakerSamples(segments),
    named: speakers.length > 0 && speakers.every((s) => (r.speaker_names || {})[s]),
    created_at: r.created_at,
  };
  if (full) base.segments = segments;
  return base;
}

// ── Upload an audio file + start transcription ────────────────────────────────
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer?.length) return res.status(400).json({ error: 'No audio file uploaded.' });
    const title = String(req.body?.title || req.file.originalname || 'Untitled transcript').slice(0, 200);
    let clientId = req.body?.client_id || null;
    if (clientId) assertClientAccess(req, clientId);

    const id = crypto.randomUUID();
    const ext = extFromName(req.file.originalname, req.file.mimetype);
    const key = mediaStore.keyFor(id, ext);
    await mediaStore.saveBuffer(key, req.file.buffer, req.file.mimetype);

    const { rows } = await pool.query(
      `INSERT INTO transcripts (id, created_by, client_id, title, storage_key, mime, size_bytes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing') RETURNING *`,
      [id, req.user?.id || null, clientId, title, key, req.file.mimetype || null, req.file.buffer.length]
    );
    scribe.processInBackground(id); // fire-and-forget; UI polls status
    res.status(201).json(present(rows[0]));
  } catch (err) {
    console.error('[transcripts] upload failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── List (optionally by client) ───────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const clientId = req.query.client_id || null;
    if (clientId) assertClientAccess(req, clientId);
    const { rows } = await pool.query(
      clientId
        ? `SELECT * FROM transcripts WHERE client_id = $1 ORDER BY created_at DESC LIMIT 100`
        : `SELECT * FROM transcripts WHERE created_by = $1 ORDER BY created_at DESC LIMIT 100`,
      clientId ? [clientId] : [req.user?.id || null]
    );
    res.json({ items: rows.map((r) => present(r)) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── One transcript (with segments) ────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Bad id' });
    const { rows } = await pool.query('SELECT * FROM transcripts WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].client_id) assertClientAccess(req, rows[0].client_id);
    res.json(present(rows[0], { full: true }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Name the voices ───────────────────────────────────────────────────────────
router.patch('/:id/speakers', express.json(), async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Bad id' });
    const { rows } = await pool.query('SELECT client_id FROM transcripts WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].client_id) assertClientAccess(req, rows[0].client_id);
    const names = {};
    for (const [k, v] of Object.entries(req.body?.names || {})) {
      if (/^speaker_\d+$/.test(k)) names[k] = String(v || '').slice(0, 80);
    }
    const { rows: upd } = await pool.query(
      `UPDATE transcripts SET speaker_names = $2::jsonb WHERE id = $1 RETURNING *`,
      [req.params.id, JSON.stringify(names)]
    );
    res.json(present(upd[0], { full: true }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Retry a failed transcription ──────────────────────────────────────────────
router.post('/:id/retry', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Bad id' });
    const { rows } = await pool.query('SELECT client_id, storage_key FROM transcripts WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].client_id) assertClientAccess(req, rows[0].client_id);
    if (!rows[0].storage_key) return res.status(400).json({ error: 'Original audio is no longer stored.' });
    await pool.query(`UPDATE transcripts SET status = 'processing', error = NULL WHERE id = $1`, [req.params.id]);
    scribe.processInBackground(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Delete ────────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Bad id' });
    const { rows } = await pool.query('SELECT client_id, storage_key FROM transcripts WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].client_id) assertClientAccess(req, rows[0].client_id);
    if (rows[0].storage_key) await mediaStore.remove(rows[0].storage_key).catch(() => {});
    await pool.query('DELETE FROM transcripts WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
