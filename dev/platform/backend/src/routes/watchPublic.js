// Public watch endpoints for the in-OMI recorder — unauthenticated, reached via
// an unguessable public_token share link. Metadata, video streaming (HTTP range
// so the player can seek), and a view/progress ping for "did they watch it".
// Mounted before auth like the other public portals. See routes/recordings.js
// and docs/omi/loom-replacement-plan.md.

const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const mediaStore = require('../services/mediaStore');
const watchStream = require('../services/watchStream');

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
// The decisions this makes — which object to serve, what to type it as, what a
// viewer may cache — live in services/watchStream.js so they can be tested.
router.get('/:token/stream', async (req, res) => {
  try {
    const rec = await loadReady(req.params.token);
    const keys = watchStream.playbackKeys(rec);
    if (!keys.length) return res.status(404).send('Not found');

    // R2 (once configured) hands back a short-lived signed URL — redirect the
    // player straight to the CDN. Disk returns null → we stream it ourselves.
    const signed = await mediaStore.signedGetUrl(keys[0], watchStream.SIGNED_TTL_SEC);
    if (signed) {
      res.set(watchStream.redirectHeaders());
      return res.redirect(302, signed);
    }

    const rangeHeader = req.headers.range;
    const range = watchStream.parseRange(rangeHeader);

    let out = null, served = null, lastErr = null;
    for (const key of keys) {
      try { out = await mediaStore.openRead(key, range); served = key; break; }
      catch (e) { lastErr = e; if (e.code === 'RANGE') break; }
    }
    if (!out) {
      if (lastErr && lastErr.code === 'RANGE') { res.setHeader('Content-Range', `bytes */0`); return res.status(416).end(); }
      return res.status(404).send('Not found');
    }

    const { status, headers } = watchStream.streamHeaders({
      key: served,
      mime: rec.mime,
      size: out.size,
      start: out.start,
      end: out.end,
      hasRange: !!rangeHeader,
      contentTypeFor: mediaStore.contentTypeFor,
    });
    res.status(status).set(headers);

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
