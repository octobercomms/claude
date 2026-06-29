// Video Studio — WORKER API (slice 2). The dedicated worker box talks to the
// platform only over HTTPS, authenticated with a shared WORKER_TOKEN (no DB
// networking, no shared disk). It claims jobs, pulls clips + the brand kit,
// reports stage results, and uploads the finished master here.
//
// Mounted at /api/video/worker BEFORE the global rate limiter and BEFORE the
// session-authenticated /api/video router, so worker polling isn't throttled
// and doesn't need a user session.

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const pool = require('../db');
const videoProjects = require('../services/videoProjects');
const swipeFile = require('../services/swipeFile');

const router = express.Router();

const CLIPS_DIR = path.join(__dirname, '../../video-clips');
const OUTPUTS_DIR = path.join(__dirname, '../../video-outputs');
const UPLOAD_ROOT = path.join(__dirname, '../../uploads'); // brand assets live here
for (const d of [CLIPS_DIR, OUTPUTS_DIR]) { try { fs.mkdirSync(d, { recursive: true }); } catch { /* ignore */ } }

// Shared-secret auth. Constant-time compare; refuses if WORKER_TOKEN is unset
// so a misconfigured deploy can't accidentally expose the worker API.
function requireWorkerToken(req, res, next) {
  const expected = process.env.WORKER_TOKEN || '';
  if (!expected) return res.status(503).json({ error: 'Worker API not configured (WORKER_TOKEN unset).' });
  const got = req.get('X-Worker-Token') || '';
  const a = Buffer.from(got), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Bad worker token' });
  }
  next();
}
router.use(requireWorkerToken);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, OUTPUTS_DIR),
    filename: (req, _file, cb) => cb(null, `${parseInt(req.params.id, 10)}-master.mp4`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB master
});

// Claim the next queued job and return everything needed to run it.
router.post('/claim', async (req, res) => {
  try {
    const job = await videoProjects.claimNextJob(req.body?.worker_id || 'worker');
    if (!job) return res.json({ job: null });
    const ctx = await videoProjects.getJobContext(job.project_id);
    res.json({ job, ...ctx });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Stream a raw clip by id (worker is trusted via the token).
router.get('/clips/:clipId', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT stored_path FROM video_clips WHERE id = $1', [req.params.clipId]);
    if (!rows.length) return res.status(404).json({ error: 'Clip not found' });
    const filePath = path.join(CLIPS_DIR, path.basename(rows[0].stored_path));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on disk' });
    res.sendFile(filePath);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// The brand kit for a project's client — fonts (with their usage role) and the
// palette. Typography MUST be deterministic from this, never model-chosen.
router.get('/projects/:id/brandkit', async (req, res) => {
  try {
    const { rows: p } = await pool.query('SELECT client_id, style_preset FROM video_projects WHERE id = $1', [req.params.id]);
    if (!p.length) return res.status(404).json({ error: 'Project not found' });
    const { rows: assets } = await pool.query(
      `SELECT id, kind, name, url, metadata FROM brand_assets WHERE client_id = $1 AND kind IN ('font', 'palette')`,
      [p[0].client_id]
    );
    const fonts = assets.filter(a => a.kind === 'font').map(a => ({
      id: a.id, name: a.name, role: a.metadata?.role || null,
      file_url: `/api/video/worker/brand-asset/${a.id}/file`,
    }));
    const palette = (assets.find(a => a.kind === 'palette')?.metadata?.colors) || [];
    res.json({ style_preset: p[0].style_preset || 'clean', fonts, palette });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Stream a brand asset file (font/image) for the worker to render with.
router.get('/brand-asset/:assetId/file', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT url FROM brand_assets WHERE id = $1', [req.params.assetId]);
    if (!rows.length) return res.status(404).json({ error: 'Asset not found' });
    const m = String(rows[0].url || '').match(/^\/api\/brand\/file\/([^/]+)\/(.+)$/);
    if (!m) return res.status(404).json({ error: 'Asset is not a file' });
    const filePath = path.join(UPLOAD_ROOT, m[1], path.basename(m[2]));
    if (!filePath.startsWith(UPLOAD_ROOT + path.sep) || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File missing' });
    }
    res.sendFile(filePath);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Report ffprobe results from the ingest stage.
router.post('/clips/:clipId/probe', async (req, res) => {
  try { await videoProjects.applyClipProbe(req.params.clipId, req.body || {}); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Complete a job. For 'grade', the body carries the QA score and the backend
// decides whether to loop back to roughcut or advance to export. For other
// stages, optional patch fields (score / output_url) are applied, then the
// queue advances to the next stage.
router.post('/jobs/:id/complete', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.stage === 'grade') {
      const r = await videoProjects.submitGrade(req.params.id, Math.max(0, Math.min(100, Math.round(Number(body.score) || 0))), body.feedback || null);
      return res.json({ ok: true, ...r });
    }
    if (body.project_patch) await videoProjects.patchProject(body.project_id, body.project_patch);
    await videoProjects.completeJob(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/jobs/:id/fail', async (req, res) => {
  try { await videoProjects.failJob(req.params.id, req.body?.error); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Upload the finished vertical master. Stores it and points the project's
// output_url at the user-facing (authed) download route.
router.post('/projects/:id/output', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const output_url = `/api/video/projects/${parseInt(req.params.id, 10)}/output`;
    await videoProjects.patchProject(req.params.id, { output_url });
    res.json({ ok: true, output_url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Swipe file (reel → ideas) ──
// The worker polls this when there's no video job. It downloads + transcribes
// the reel; the platform then generates the Claude idea card + emails it.
router.post('/swipe/claim', async (req, res) => {
  try { res.json({ item: await swipeFile.claimNext(req.body?.worker_id || 'worker') }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/swipe/:id/transcript', async (req, res) => {
  try { await swipeFile.saveTranscript(parseInt(req.params.id, 10), req.body || {}); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/swipe/:id/fail', async (req, res) => {
  try { await swipeFile.failItem(parseInt(req.params.id, 10), req.body?.error); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
