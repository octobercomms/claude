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
async function create(clientId, { sourceName, sourceUrl, sourceMeta = {}, ops = {}, clips = [], name = null, status = 'queued', createdBy = null }) {
  const list = (clips && clips.length) ? clips : [{ url: sourceUrl, name: sourceName }];
  const { rows } = await pool.query(
    `INSERT INTO edit_jobs (client_id, created_by, source_name, source_url, source_meta, ops, clips, name, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [clientId, createdBy, sourceName || null, sourceUrl, JSON.stringify(sourceMeta || {}), JSON.stringify(ops || {}), JSON.stringify(list), name || null, status]
  );
  return rows[0];
}

// Queue a saved draft for rendering (in place).
async function queueDraft(clientId, id) {
  const { rows } = await pool.query(
    `UPDATE edit_jobs SET status = 'queued', error = NULL WHERE client_id = $1 AND id = $2 AND status = 'draft' RETURNING *`,
    [clientId, id]
  );
  if (!rows[0]) { const e = new Error('Only a draft can be rendered this way.'); e.status = 400; throw e; }
  return rows[0];
}

// Re-open a saved edit: copy its source clip(s) to fresh files and queue a new
// job with (possibly changed) ops — so a tweak needs no re-upload, and deleting
// the original later can't break the new one.
async function reopen(clientId, jobId, { ops = {}, name = null, createdBy = null }) {
  const job = await get(clientId, jobId);
  if (!job) { const e = new Error('Edit not found.'); e.status = 404; throw e; }
  const srcClips = (Array.isArray(job.clips) && job.clips.length) ? job.clips : [{ url: job.source_url, name: job.source_name }];
  const copied = [];
  for (const c of srcClips) {
    const disk = c.url && diskPathForUrl(c.url);
    if (!disk || !fs.existsSync(disk)) { const e = new Error('The original clip is no longer available — re-upload it.'); e.status = 409; throw e; }
    copied.push({ url: adoptFile(clientId, disk, path.extname(disk) || '.mp4'), name: c.name || null });
  }
  return create(clientId, {
    sourceName: job.source_name, sourceUrl: copied[0].url, sourceMeta: job.source_meta || {},
    ops, clips: copied, name: name || job.name, createdBy,
  });
}

async function rename(clientId, id, name) {
  const { rows } = await pool.query(
    `UPDATE edit_jobs SET name = $3 WHERE client_id = $1 AND id = $2 RETURNING *`,
    [clientId, id, name ? String(name).trim().slice(0, 200) : null]
  );
  if (!rows[0]) { const e = new Error('Edit not found.'); e.status = 404; throw e; }
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
  const { rows } = await pool.query('DELETE FROM edit_jobs WHERE client_id = $1 AND id = $2 RETURNING source_url, output_url, srt_url, clips', [clientId, id]);
  const urls = [rows[0]?.source_url, rows[0]?.output_url, rows[0]?.srt_url, ...((rows[0]?.clips || []).map(c => c?.url))];
  for (const url of urls) {
    const p = url && diskPathForUrl(url);
    if (p) fs.promises.unlink(p).catch(() => {});
  }
  // The library row goes with it. client_assets has no foreign key to this
  // table (source_id is text, because the producing tables disagree about key
  // types), so nothing cascades: without this, deleting an edit leaves the
  // library offering a row whose file was just unlinked.
  if (rows[0]) {
    await require('./assets').archiveBySource('edit_job', id).catch(() => {});
  }
}

/**
 * Queue a failed or cancelled edit again.
 *
 * Cancelled counts: you stop a render because you spotted something, fix the
 * timeline, and run it again. Without this a cancel strands the edit with no
 * way back, which makes Cancel a button nobody presses.
 */
async function retry(clientId, id) {
  const { rows } = await pool.query(
    `UPDATE edit_jobs SET status = 'queued', error = NULL, output_url = NULL, srt_url = NULL,
            claimed_by = NULL, claimed_at = NULL, progress = 0, stage = NULL
       WHERE client_id = $1 AND id = $2 AND status IN ('failed', 'cancelled') RETURNING *`,
    [clientId, id]
  );
  if (!rows[0]) {
    const e = new Error('Only failed or cancelled edits can be run again.');
    e.status = 400;
    throw e;
  }
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

/**
 * Mark a job done, and index its output in the client's asset library.
 *
 * One call site rather than one per branch of the renderer: every edit that
 * finishes goes through here, the stills reels included, so there is no path
 * that produces a video and forgets to say so. Before this, an edit existed
 * only as a row in edit_jobs and was reachable by opening the Edit tab and
 * nowhere else, which is exactly the invisibility client_assets was built to
 * end.
 *
 * The library write never fails the job: assets.record returns null and logs
 * rather than throwing, and the job is already marked done before it runs. An
 * edit that rendered for two minutes must not be lost because an index row
 * could not be written.
 */
async function complete(id, { outputUrl, srtUrl = null, costUsd = 0, durationS = null,
  width = null, height = null, bytes = null } = {}) {
  await pool.query(
    `UPDATE edit_jobs SET status = 'done', output_url = $2, srt_url = $3, cost_usd = $4, error = NULL WHERE id = $1`,
    [id, outputUrl, srtUrl, costUsd]
  );

  const { rows } = await pool.query(
    'SELECT id, client_id, name, source_name, ops, created_by FROM edit_jobs WHERE id = $1', [id]);
  const job = rows[0];
  if (!job || !outputUrl) return;

  const ops = job.ops || {};
  // Wrapped here as well as inside assets.record. record's own guarantee is
  // that it does not throw, but this call site is the one where throwing would
  // cost a two-minute render that has already succeeded, so the guarantee is
  // made locally rather than inherited from another file's promise.
  try {
    const assets = require('./assets');
    await assets.record({
      client_id: job.client_id, kind: 'video',
      source: 'edit_job', source_id: job.id,
      // The operator's own name first. "Edit" in a grid of thirty is no use to
      // anyone, and the source filename is at least theirs.
      title: job.name || job.source_name || 'Edit',
      url: outputUrl, mime: 'video/mp4',
      duration_s: durationS, width, height, bytes,
      created_by: job.created_by || null,
      metadata: {
        aspect: ops.aspect || null,
        caption_template: ops.caption_template || null,
        captions: !!ops.captions,
        clean_audio: !!ops.clean_audio,
        stills_reel: !!ops.stills_reel,
        srt_url: srtUrl,
      },
    });
  } catch (err) {
    console.error('[edit] could not index a finished edit:', err.message);
  }
}

/**
 * Mark a job failed.
 *
 * Scoped to `status = 'processing'` so it cannot overwrite a cancellation. A
 * cancel kills ffmpeg, ffmpeg exits non-zero, and without this scope the
 * operator who pressed Cancel is then told their edit broke.
 */
async function fail(id, error) {
  await pool.query(
    `UPDATE edit_jobs SET status = 'failed', error = $2, progress = 0, stage = NULL
      WHERE id = $1 AND status = 'processing'`,
    [id, String(error || 'Processing failed').slice(0, 1900)]);
}

/**
 * Render progress, 0 to 100, with the stage that produced it.
 *
 * Scoped to `processing` for the same reason as `fail`: a progress write
 * arriving after a cancel, from an ffmpeg callback already in flight, must not
 * revive the row or leave a stale stage on a job that has stopped.
 */
async function setProgress(id, progress, stage = null) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
  await pool.query(
    `UPDATE edit_jobs SET progress = $2, stage = $3 WHERE id = $1 AND status = 'processing'`,
    [id, pct, stage ? String(stage).slice(0, 120) : null]);
}

async function markCancelled(id) {
  await pool.query(
    `UPDATE edit_jobs SET status = 'cancelled', progress = 0, stage = NULL, error = NULL
      WHERE id = $1 AND status IN ('processing', 'queued')`,
    [id]);
}

/**
 * Stop an edit, whether it is waiting or already rendering.
 *
 * A queued job is cancelled here and never claimed, because the queue index
 * only covers `status = 'queued'`. A job already rendering needs its ffmpeg
 * killed as well, which is the processor's business, so this reports which
 * case it was and the route asks the processor for the second one. Returns
 * null when there is nothing to cancel, so the route can say so rather than
 * reporting success for a job that had already finished.
 */
async function cancel(clientId, id) {
  // Two statements in one transaction rather than a subquery in RETURNING,
  // which would depend on exactly when a subquery sees its snapshot. What the
  // caller needs is plain: was this one already rendering?
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query(
      `SELECT status FROM edit_jobs WHERE client_id = $1 AND id = $2 FOR UPDATE`,
      [clientId, id]);
    const was = before.rows[0]?.status || null;
    if (was !== 'queued' && was !== 'processing') {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query(
      `UPDATE edit_jobs SET status = 'cancelled', progress = 0, stage = NULL, error = NULL
        WHERE id = $1`, [id]);
    await client.query('COMMIT');
    return { id, was };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  create, list, get, getById, remove, retry, reopen, rename, queueDraft,
  claimNext, complete, fail, setProgress, markCancelled, cancel,
  saveBuffer, adoptFile, servedUrl, serveFilePath, diskPathForUrl, clientDir,
  UPLOAD_ROOT,
};
