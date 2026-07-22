// Edit studio — data access + work queue + on-disk storage.
//
// Files (source + rendered mp4 + .srt) live under uploads/<client_id>/edit/ and
// are served through an authed route (routes/edit.js), same as Visualise. Rows
// hold the served URLs. The table doubles as the queue drained by editProcessor.

const fs = require('fs');
const path = require('path');
const pool = require('../db');

const UPLOAD_ROOT = path.join(__dirname, '../../uploads');

// ── Storage helpers ───────────────────────────────────────────────────────────
function clientDir(clientId) {
  const dir = path.join(UPLOAD_ROOT, clientId, 'edit');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function servedUrl(clientId, filename) {
  return `/api/edit/file/${clientId}/${filename}`;
}
function randName(ext = '.mp4') {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
}
function cleanExt(name, fallback) {
  let ext = (path.extname(name || '').toLowerCase().replace(/[^a-z0-9.]/g, '')) || fallback;
  if (!ext.startsWith('.')) ext = '.' + ext;
  return ext;
}
// Save a buffer (an upload) into the client's edit dir; return its served URL.
function saveBuffer(clientId, buffer, originalname, fallbackExt = '.mp4') {
  const filename = randName(cleanExt(originalname, fallbackExt));
  fs.writeFileSync(path.join(clientDir(clientId), filename), buffer);
  return servedUrl(clientId, filename);
}
// Move a rendered file on disk into the client's edit dir; return its served URL.
function adoptFile(clientId, srcPath, ext = '.mp4') {
  const filename = randName(ext);
  fs.copyFileSync(srcPath, path.join(clientDir(clientId), filename));
  return servedUrl(clientId, filename);
}
// Resolve a served edit URL back to disk, with a traversal guard.
function diskPathForUrl(url) {
  const m = String(url || '').match(/^\/api\/edit\/file\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  const dir = clientDir(m[1]);
  const p = path.join(dir, m[2]);
  return p.startsWith(dir + path.sep) ? p : null;
}
function serveFilePath(clientId, filename) {
  if (!filename || filename.includes('..') || filename.includes('/')) return null;
  const dir = clientDir(clientId);
  const p = path.join(dir, filename);
  return p.startsWith(dir + path.sep) ? p : null;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
async function create(clientId, { sourceName, sourceUrl, sourceMeta = {}, ops = {}, createdBy = null }) {
  const { rows } = await pool.query(
    `INSERT INTO edit_jobs (client_id, created_by, source_name, source_url, source_meta, ops, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'queued') RETURNING *`,
    [clientId, createdBy, sourceName || null, sourceUrl, JSON.stringify(sourceMeta || {}), JSON.stringify(ops || {})]
  );
  return rows[0];
}

async function list(clientId) {
  const { rows } = await pool.query(
    `SELECT j.*, u.username AS created_by_name
       FROM edit_jobs j LEFT JOIN users u ON u.id = j.created_by
      WHERE j.client_id = $1 ORDER BY j.created_at DESC LIMIT 200`,
    [clientId]
  );
  return rows;
}

async function get(clientId, id) {
  const { rows } = await pool.query('SELECT * FROM edit_jobs WHERE client_id = $1 AND id = $2', [clientId, id]);
  return rows[0] || null;
}

async function getById(id) {
  const { rows } = await pool.query('SELECT * FROM edit_jobs WHERE id = $1', [id]);
  return rows[0] || null;
}

async function remove(clientId, id) {
  const { rows } = await pool.query('DELETE FROM edit_jobs WHERE client_id = $1 AND id = $2 RETURNING source_url, output_url, srt_url', [clientId, id]);
  for (const url of [rows[0]?.source_url, rows[0]?.output_url, rows[0]?.srt_url]) {
    const p = url && diskPathForUrl(url);
    if (p) fs.promises.unlink(p).catch(() => {});
  }
}

async function retry(clientId, id) {
  const { rows } = await pool.query(
    `UPDATE edit_jobs SET status = 'queued', error = NULL, output_url = NULL, srt_url = NULL,
            claimed_by = NULL, claimed_at = NULL
       WHERE client_id = $1 AND id = $2 AND status = 'failed' RETURNING *`,
    [clientId, id]
  );
  if (!rows[0]) { const e = new Error('Only failed edits can be retried.'); e.status = 400; throw e; }
  return rows[0];
}

// ── Queue ─────────────────────────────────────────────────────────────────────
async function claimNext(workerId) {
  const { rows } = await pool.query(
    `UPDATE edit_jobs SET status = 'processing', claimed_by = $1, claimed_at = NOW()
       WHERE id = (SELECT id FROM edit_jobs WHERE status = 'queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING *`,
    [workerId]
  );
  return rows[0] || null;
}

async function complete(id, { outputUrl, srtUrl = null, costUsd = 0 }) {
  await pool.query(
    `UPDATE edit_jobs SET status = 'done', output_url = $2, srt_url = $3, cost_usd = $4, error = NULL WHERE id = $1`,
    [id, outputUrl, srtUrl, costUsd]
  );
}

async function fail(id, error) {
  await pool.query(`UPDATE edit_jobs SET status = 'failed', error = $2 WHERE id = $1`,
    [id, String(error || 'Processing failed').slice(0, 1900)]);
}

module.exports = {
  create, list, get, getById, remove, retry,
  claimNext, complete, fail,
  saveBuffer, adoptFile, servedUrl, serveFilePath, diskPathForUrl, clientDir,
  UPLOAD_ROOT,
};
