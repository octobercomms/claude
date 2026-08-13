// Public watch endpoints for the in-OMI recorder — unauthenticated, reached via
// an unguessable public_token share link. Metadata, video streaming (HTTP range
// so the player can seek), and a view/progress ping for "did they watch it".
// Mounted before auth like the other public portals. See routes/recordings.js
// and docs/omi/loom-replacement-plan.md.

const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const mediaStore = require('../services/mediaStore');

const router = express.Router();

function ipHash(req) {
  const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = fwd || req.ip || '';
  if (!ip) return null;
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

async function loadReady(token) {
  const { rows } = await pool.query(
    `SELECT * FROM recordings WHERE public_token = $1 AND status = 'ready'`, [token]);
  return rows[0] || null;
}

// ── Metadata for the player page ──────────────────────────────────────────────
router.get('/:token', async (req, res) => {
  try {
    const rec = await loadReady(req.params.token);
    if (!rec) return res.status(404).json({ error: 'Recording not found' });
    res.json({
      title: rec.title,
      mime: rec.mime,
      duration_s: rec.duration_s,
      transcript: rec.transcript || null,
      created_at: rec.created_at,
      stream_url: `/api/public/watch/${encodeURIComponent(req.params.token)}/stream`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Video stream (range-aware) ────────────────────────────────────────────────
router.get('/:token/stream', async (req, res) => {
  try {
    const rec = await loadReady(req.params.token);
    if (!rec || !rec.storage_key) return res.status(404).send('Not found');

    // R2 (once configured) hands back a short-lived signed URL — redirect the
    // player straight to the CDN. Disk returns null → we stream it ourselves.
    const signed = await mediaStore.signedGetUrl(rec.storage_key, 3600);
    if (signed) return res.redirect(302, signed);

    let range = null;
    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
      if (m) range = { start: m[1] ? parseInt(m[1], 10) : 0, end: m[2] ? parseInt(m[2], 10) : null };
    }

    let out;
    try {
      out = await mediaStore.openRead(rec.storage_key, range);
    } catch (e) {
      if (e.code === 'RANGE') { res.setHeader('Content-Range', `bytes */0`); return res.status(416).end(); }
      return res.status(404).send('Not found');
    }

    res.setHeader('Content-Type', rec.mime || 'video/webm');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    if (rangeHeader && (out.start !== 0 || out.end !== out.size - 1)) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${out.start}-${out.end}/${out.size}`);
      res.setHeader('Content-Length', out.end - out.start + 1);
    } else {
      res.setHeader('Content-Length', out.size);
    }
    out.stream.on('error', () => { if (!res.headersSent) res.status(500); res.end(); });
    out.stream.pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(500).send('Error');
  }
});

// ── View / progress ping ──────────────────────────────────────────────────────
// First ping (no view_id) records a view and returns its id; later pings update
// that row's watch depth. Keeps view_count honest and captures how much watched.
router.post('/:token/view', express.json(), async (req, res) => {
  try {
    const rec = await loadReady(req.params.token);
    if (!rec) return res.status(404).json({ error: 'Recording not found' });
    const watch = Math.max(0, Math.round(Number(req.body?.watch_seconds) || 0));
    const viewId = req.body?.view_id;

    if (viewId) {
      const { rows } = await pool.query(
        `UPDATE recording_views SET watch_seconds = GREATEST(watch_seconds, $1)
         WHERE id = $2 AND recording_id = $3 RETURNING id`,
        [watch, viewId, rec.id]);
      if (rows.length) return res.json({ view_id: rows[0].id });
      // Fall through to insert if the id didn't match this recording.
    }
    const { rows } = await pool.query(
      `INSERT INTO recording_views (recording_id, watch_seconds, ip_hash, referrer)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [rec.id, watch, ipHash(req), String(req.get('referer') || '').slice(0, 300) || null]);
    res.json({ view_id: rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
