// In-OMI screen recorder — authed API (staff only). Create a recording, upload
// the recorded blob, finalize, list "my recordings", and delete. Public playback
// + view analytics live in routes/watchPublic.js. Storage goes through
// services/mediaStore (disk today, Cloudflare R2 once configured).
// See docs/omi/loom-replacement-plan.md.

const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, assertClientAccess } = require('../middleware/clientAccess');
const pool = require('../db');
const assets = require('../services/assets');
const mediaStore = require('../services/mediaStore');
const loomFetch = require('../services/loomFetch');
const transcribe = require('../services/recordingTranscribe');
const recordingExport = require('../services/recordingExport');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Uploads stream to a temp file, never into memory.
//
// This used to be memoryStorage() with a 512MB cap, which had two failure
// modes. A 30-minute screen recording runs to roughly 700MB at the bitrate the
// browser produces, so it was refused outright. And anything under the cap was
// buffered whole in the box's RAM, so raising the limit alone would have traded
// a clean error for an out-of-memory kill that takes the whole platform down
// mid-upload. Streaming to disk fixes both: memory stays flat whatever the
// size, and mediaStore.saveFile moves the finished file into the store by
// rename.
//
// 2GB matches the nginx client_max_body_size on /api/recordings/. Keep the two
// in step: a limit here that is higher than nginx's just moves the rejection
// earlier in the request and loses the clearer message.
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, mediaStore.tmpDir()),
    filename: (req, file, cb) => cb(null, `up-${crypto.randomBytes(12).toString('hex')}`),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

// multer leaves the spooled file behind on any error path, and a few hundred MB
// per abandoned upload adds up. Every handler that takes a file calls this in a
// finally.
async function cleanupUpload(req) {
  const p = req.file && req.file.path;
  if (!p) return;
  try { await require('fs').promises.unlink(p); } catch { /* already moved or gone */ }
}

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
    has_mp4: !!r.mp4_key,
    has_gif: !!r.gif_key,
    export_status: r.export_status || null,
    public_token: r.public_token,
    share_path: `/share/${r.public_token}`,
    imported_views: r.imported_views || 0,
    source: r.source || 'recorder',
    client_ids: Array.isArray(r.client_ids) ? r.client_ids.filter(Boolean) : [],
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
    let clientId = req.body?.client_id || null;
    if (clientId) assertClientAccess(req, clientId); // can only file under a visible client
    const token = newToken();
    const { rows } = await pool.query(
      `INSERT INTO recordings (created_by, client_id, title, mime, public_token, status)
       VALUES ($1, $2, $3, $4, $5, 'uploading') RETURNING *`,
      [req.user?.id || null, clientId, title, mime, token]
    );
    const rec = rows[0];
    if (clientId) {
      await pool.query('INSERT INTO recording_clients (recording_id, client_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [rec.id, clientId]);
    }
    const key = mediaStore.keyFor(rec.id, mime);
    await pool.query('UPDATE recordings SET storage_key = $1 WHERE id = $2', [key, rec.id]);
    res.json({ id: rec.id, upload: mediaStore.uploadDescriptor(key, mime), share_path: `/share/${token}` });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
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
    const { size } = await mediaStore.saveFile(key, req.file.path, rows[0].mime);
    await pool.query('UPDATE recordings SET size_bytes = $1 WHERE id = $2', [size, rows[0].id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await cleanupUpload(req);
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
    // Into the library, but only a recording about a client: a general one
    // belongs to nobody's library and would clutter every client's.
    const r = rows[0];
    if (r.client_id) {
      await assets.record({
        client_id: r.client_id, source: 'recording', source_id: r.id,
        title: r.title || 'Untitled recording', storage_key: r.storage_key,
        mime: r.mime, duration_s: r.duration_s, bytes: r.size_bytes,
        created_by: r.created_by,
      });
    }
    // Kick transcription in the background (no-ops without OPENAI_API_KEY).
    transcribe.transcribeInBackground(rows[0].id);
    res.json(present(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Recordings library ────────────────────────────────────────────────────────
// Default: my own recordings (agency library). With ?client_id=<id>: every
// recording attached to that client — this is how a client's Video tab (and a
// read-only client login) sees their videos.
router.get('/', async (req, res) => {
  try {
    const clientId = req.query.client_id || null;
    let where, params;
    if (clientId) {
      assertClientAccess(req, clientId);
      where = `r.id IN (SELECT recording_id FROM recording_clients WHERE client_id = $1)`;
      params = [clientId];
    } else {
      where = `r.created_by IS NOT DISTINCT FROM $1`;
      params = [req.user?.id || null];
    }
    const { rows } = await pool.query(
      `SELECT r.*,
              COUNT(DISTINCT v.id)::int AS view_count,
              COALESCE(MAX(v.watch_seconds), 0)::int AS max_watch_seconds,
              COALESCE(ARRAY_AGG(DISTINCT rc.client_id) FILTER (WHERE rc.client_id IS NOT NULL), '{}') AS client_ids
         FROM recordings r
         LEFT JOIN recording_views v ON v.recording_id = r.id
         LEFT JOIN recording_clients rc ON rc.recording_id = r.id
        WHERE ${where}
        GROUP BY r.id
        ORDER BY r.created_at DESC
        LIMIT 200`,
      params
    );
    res.json(rows.map(r => present(r, { view_count: r.view_count, max_watch_seconds: r.max_watch_seconds })));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
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
    const { rows: crows } = await pool.query(
      'SELECT client_id FROM recording_clients WHERE recording_id = $1', [req.params.id]);
    res.json({ ...present({ ...rows[0], client_ids: crows.map(c => c.client_id) }, vrows[0]), transcript: rows[0].transcript || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Attach / move a recording across clients (many-to-many) ───────────────────
// Replaces the recording's whole client set — covers "add to several clients"
// and "move from one to another". Only the owner (or an admin) can reassign, and
// only to clients the caller can see.
router.put('/:id/clients', express.json(), async (req, res) => {
  try {
    const ids = (Array.isArray(req.body?.client_ids) ? req.body.client_ids : [])
      .map(String).filter(id => UUID_RE.test(id));
    const owned = await pool.query(
      'SELECT id FROM recordings WHERE id = $1 AND (created_by IS NOT DISTINCT FROM $2 OR $3)',
      [req.params.id, req.user?.id || null, req.user?.role === 'admin']
    );
    if (!owned.rows.length) return res.status(404).json({ error: 'Recording not found' });
    for (const cid of ids) assertClientAccess(req, cid);

    await pool.query('DELETE FROM recording_clients WHERE recording_id = $1', [req.params.id]);
    for (const cid of ids) {
      await pool.query('INSERT INTO recording_clients (recording_id, client_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, cid]);
    }
    // Keep the legacy single client_id roughly in sync (first attached, or null).
    await pool.query('UPDATE recordings SET client_id = $1 WHERE id = $2', [ids[0] || null, req.params.id]);
    res.json({ ok: true, client_ids: ids });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── Rename ────────────────────────────────────────────────────────────────────
// A title was only settable at save time, so a recording saved in a hurry (or
// one that failed to save and came back as "Untitled recording") kept the wrong
// name for good. Same ownership rule as the clients endpoint: yours, or admin.
router.patch('/:id', express.json(), async (req, res) => {
  try {
    const title = String(req.body?.title ?? '').trim().slice(0, 200);
    if (!title) return res.status(400).json({ error: 'Give it a title.' });
    const { rows } = await pool.query(
      `UPDATE recordings SET title = $1
        WHERE id = $2 AND (created_by IS NOT DISTINCT FROM $3 OR $4)
        RETURNING *`,
      [title, req.params.id, req.user?.id || null, req.user?.role === 'admin']
    );
    if (!rows.length) return res.status(404).json({ error: 'Recording not found' });
    res.json(present(rows[0]));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
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

// ── Export a recording to MP4 / GIF (rendered server-side with ffmpeg) ────────
// The browser records WebM; this produces a shareable H.264 MP4 or a short GIF.
// Fire-and-forget: the UI polls the recording until export_status flips to
// 'ready' and has_mp4/has_gif is set, then downloads via GET /:id/download.
router.post('/:id/export', express.json(), async (req, res) => {
  try {
    const format = req.body?.format === 'gif' ? 'gif' : 'mp4';
    const { rows } = await pool.query(
      `SELECT id FROM recordings WHERE id = $1 AND created_by IS NOT DISTINCT FROM $2`,
      [req.params.id, req.user?.id || null]
    );
    if (!rows.length) return res.status(404).json({ error: 'Recording not found' });
    await pool.query(`UPDATE recordings SET export_status = 'processing' WHERE id = $1`, [req.params.id]);
    recordingExport.exportInBackground(req.params.id, format);
    res.json({ ok: true, queued: true, format });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Download a rendered export (authed staff download) ────────────────────────
router.get('/:id/download', async (req, res) => {
  try {
    const format = req.query.format === 'gif' ? 'gif' : 'mp4';
    const { rows } = await pool.query(
      `SELECT title, mp4_key, gif_key FROM recordings WHERE id = $1 AND created_by IS NOT DISTINCT FROM $2`,
      [req.params.id, req.user?.id || null]
    );
    if (!rows.length) return res.status(404).json({ error: 'Recording not found' });
    const key = format === 'gif' ? rows[0].gif_key : rows[0].mp4_key;
    if (!key) return res.status(404).json({ error: `No ${format.toUpperCase()} export yet` });
    const mime = format === 'gif' ? 'image/gif' : 'video/mp4';
    const safe = String(rows[0].title || 'recording').replace(/[^\w.\- ]+/g, '').trim().slice(0, 80) || 'recording';
    const filename = `${safe}.${format}`;

    // R2 redirects to a signed URL; disk streams the bytes.
    const signed = await mediaStore.signedGetUrl(key, 3600).catch(() => null);
    if (signed) return res.redirect(signed);
    const { stream, size } = await mediaStore.openRead(key);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', size);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    stream.pipe(res);
  } catch (err) {
    res.status(err.code === 'ENOENT' ? 404 : 500).json({ error: err.message });
  }
});

// ── Bulk delete (clear out migrated / dead recordings) ────────────────────────
router.post('/bulk-delete', express.json(), async (req, res) => {
  try {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
      .map(String).filter(id => UUID_RE.test(id));
    if (!ids.length) return res.status(400).json({ error: 'No valid ids' });
    const { rows } = await pool.query(
      `DELETE FROM recordings WHERE id = ANY($1::uuid[]) AND created_by IS NOT DISTINCT FROM $2 RETURNING storage_key, mp4_key, gif_key`,
      [ids, req.user?.id || null]
    );
    await Promise.all(rows.flatMap(r => [r.storage_key, r.mp4_key, r.gif_key].filter(Boolean).map(k => mediaStore.remove(k).catch(() => {}))));
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
    // Optionally attach to a client (e.g. imported from within a client's Video
    // tab). Only to a client the caller can see.
    const clientId = b.client_id || null;
    if (clientId) {
      assertClientAccess(req, clientId);
      await pool.query('INSERT INTO recording_clients (recording_id, client_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [rec.id, clientId]);
      await pool.query('UPDATE recordings SET client_id = $1 WHERE id = $2', [clientId, rec.id]);
    }
    const key = mediaStore.keyFor(rec.id, mime);
    // saveFile, not saveBuffer: multer now hands us a path. req.file.buffer is
    // undefined under diskStorage and would have written an empty file.
    await mediaStore.saveFile(key, req.file.path, mime);
    await pool.query('UPDATE recordings SET storage_key = $1 WHERE id = $2', [key, rec.id]);
    transcribe.transcribeInBackground(rec.id);
    res.json(present({ ...rec, storage_key: key }));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    await cleanupUpload(req);
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
    const clientId = req.body?.client_id || null;
    if (clientId) assertClientAccess(req, clientId);

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
        if (clientId) {
          await pool.query('INSERT INTO recording_clients (recording_id, client_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [recId, clientId]);
          await pool.query('UPDATE recordings SET client_id = $1 WHERE id = $2', [clientId, recId]);
        }
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
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── Delete recording + stored object ──────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM recordings WHERE id = $1 AND created_by IS NOT DISTINCT FROM $2 RETURNING storage_key, mp4_key, gif_key`,
      [req.params.id, req.user?.id || null]
    );
    if (!rows.length) return res.status(404).json({ error: 'Recording not found' });
    for (const k of [rows[0].storage_key, rows[0].mp4_key, rows[0].gif_key]) {
      if (k) await mediaStore.remove(k).catch(() => {});
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
