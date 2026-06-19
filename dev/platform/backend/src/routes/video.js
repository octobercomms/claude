// Video Studio routes (platform side, slice 1). Create projects, take clip
// uploads, enqueue a pipeline run, poll status. The dedicated worker drains the
// queue (videoProjects worker contract). See docs/omi/video-autoedit-plan.md.

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess, assertClientAccess } = require('../middleware/clientAccess');
const pool = require('../db');
const videoProjects = require('../services/videoProjects');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);

// Raw clips live on disk; the worker pulls them via an authed endpoint (so a
// separate worker box doesn't need shared storage yet — S3 is the scale-up).
const CLIPS_DIR = path.join(__dirname, '../../video-clips');
try { fs.mkdirSync(CLIPS_DIR, { recursive: true }); } catch { /* ignore */ }

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, CLIPS_DIR),
    filename: (_req, file, cb) => {
      const safe = (file.originalname || 'clip').replace(/[^\w.\-]+/g, '-').slice(-80);
      cb(null, `${crypto.randomBytes(10).toString('hex')}-${safe}`);
    },
  }),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB/clip
});

// Resolve a project's client and enforce access for /projects/:id routes.
async function projectAccess(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT client_id FROM video_projects WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Project not found' });
    assertClientAccess(req, rows[0].client_id);
    next();
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
}

// ── Client-scoped ────────────────────────────────────────────────────────────
router.get('/clients/:clientId/projects', requireClientAccess({ paramNames: ['clientId'] }), async (req, res) => {
  try {
    const [projects, { rows }] = await Promise.all([
      videoProjects.listProjects(req.params.clientId),
      pool.query('SELECT video_drive_folder FROM clients WHERE id = $1', [req.params.clientId]),
    ]);
    res.json({ projects, drive_folder: rows[0]?.video_drive_folder || '' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clients/:clientId/projects', requireClientAccess({ paramNames: ['clientId'] }), async (req, res) => {
  const { name, style_preset, output_target } = req.body || {};
  try {
    const project = await videoProjects.createProject({
      clientId: req.params.clientId, name, stylePreset: style_preset, outputTarget: output_target,
    });
    res.status(201).json(project);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Project-scoped ───────────────────────────────────────────────────────────
router.get('/projects/:id', projectAccess, async (req, res) => {
  try {
    const project = await videoProjects.getProject(req.params.id);
    res.json(project);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/projects/:id/clips', projectAccess, upload.array('files', 20), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded' });
    const added = [];
    for (const f of req.files) {
      added.push(await videoProjects.addClip({
        projectId: req.params.id, filename: f.originalname, storedPath: path.basename(f.path),
        mime: f.mimetype, sizeBytes: f.size,
      }));
    }
    res.status(201).json({ clips: added });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/projects/:id/run', projectAccess, async (req, res) => {
  try {
    const project = await videoProjects.enqueueRun(req.params.id);
    res.status(202).json(project);
  } catch (err) {
    const status = /at least one clip/i.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Authed clip download — the worker (and the Studio preview) fetch raw clips
// here, so a separate worker box needs only DB + this endpoint, no shared disk.
router.get('/projects/:id/clips/:clipId/file', projectAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT stored_path, filename FROM video_clips WHERE id = $1 AND project_id = $2',
      [req.params.clipId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Clip not found' });
    const filePath = path.join(CLIPS_DIR, path.basename(rows[0].stored_path));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on disk' });
    res.sendFile(filePath);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Finished master download — the worker uploads it via the worker API; the AM
// downloads it here (session-authed). output_url on the project points here.
router.get('/projects/:id/output', projectAccess, async (req, res) => {
  try {
    const filePath = path.join(__dirname, '../../video-outputs', `${parseInt(req.params.id, 10)}-master.mp4`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'No finished video yet' });
    res.sendFile(filePath);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/projects/:id', projectAccess, async (req, res) => {
  try {
    // Best-effort clip cleanup, then cascade-delete the project.
    const { rows } = await pool.query('SELECT stored_path FROM video_clips WHERE project_id = $1', [req.params.id]);
    for (const r of rows) {
      const p = path.join(CLIPS_DIR, path.basename(r.stored_path));
      fs.unlink(p, () => {});
    }
    await pool.query('DELETE FROM video_projects WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
