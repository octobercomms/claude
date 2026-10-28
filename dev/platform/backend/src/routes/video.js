// Video Studio routes (platform side, slice 1). Create projects, take clip
// uploads, enqueue a pipeline run, poll status. The dedicated worker drains the
// queue (videoProjects worker contract). See docs/omi/video-autoedit-plan.md.

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess, assertClientAccess, requireAdmin } = require('../middleware/clientAccess');
const pool = require('../db');
const videoProjects = require('../services/videoProjects');
const captions = require('../services/captions');

const router = express.Router();

// Public, signed master URL — defined BEFORE the auth middleware so an external
// fetcher (Instagram's Reel publisher) can pull the otherwise-private master.
// The HMAC signature + short expiry are the access control.
router.get('/public/:id/master.mp4', (req, res) => {
  if (!videoProjects.verifyMasterSig(req.params.id, req.query.exp, req.query.sig)) {
    return res.status(403).send('Invalid or expired link');
  }
  const filePath = path.join(__dirname, '../../video-outputs', `${parseInt(req.params.id, 10)}-master.mp4`);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.sendFile(filePath);
});

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

// Set (or clear) the caption template a project renders with. Its own route
// rather than a field on the run call, so changing the look does not re-run a
// pipeline that has already produced a master.
router.put('/projects/:id/caption-template', projectAccess, async (req, res) => {
  try {
    const id = req.body?.template_id ?? null;
    // A template that is not in the library would render as nothing at all, so
    // it is refused here rather than at the point of render.
    if (id !== null) captions.preset(id);
    await pool.query('UPDATE video_projects SET caption_template = $1 WHERE id = $2',
      [id, req.params.id]);
    res.json({ caption_template: id });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── Caption templates ────────────────────────────────────────────────────────
//
// The library and the client's reading of it. Both are cheap and neither
// renders anything: the picker paints its own swatches from the rows, and the
// preview below is one still frame rather than a clip, because changes are free
// until something is rendered and this is the screen where that is true.

router.get('/caption-templates', (req, res) => {
  try {
    res.json({ templates: captions.templates(), formats: captions.formats() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// What a given client's brand kit makes of the library. Returns the kit itself
// so the screen shows which colour was taken and, when one was refused for
// being unreadable over footage, which one and why.
router.get('/clients/:clientId/caption-kit',
  requireClientAccess({ paramNames: ['clientId'] }), async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT kind, name, metadata FROM brand_assets
          WHERE client_id = $1 AND kind IN ('font', 'palette')`, [req.params.clientId]);
      const kit = captions.kitFromAssets(rows);
      res.json({
        kit,
        // The typeface is a family name, not a file. libass needs the file on
        // disk and a client's webfont licence does not always permit that, so
        // the screen has to be able to say "we have the name, not the font".
        font_available: !kit.font ? null : false,
        note: kit.rejected_accent
          ? `${kit.rejected_accent} was left out: it cannot be read against a dark outline over footage.`
          : null,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

// One still frame of a template, with this client's kit applied. No project and
// no upload needed, so the picker previews against sample words before anyone
// commits a video.
// A GET, so the screen renders it with an ordinary <img src> and the browser
// caches it. Nothing is stored and nothing is charged, so it is safely idempotent.
router.get('/clients/:clientId/caption-preview',
  requireClientAccess({ paramNames: ['clientId'] }), async (req, res) => {
    const out = path.join(CLIPS_DIR, `preview-${crypto.randomBytes(8).toString('hex')}.png`);
    try {
      const templateId = req.query.template_id;
      const formatId = req.query.format_id || 'vertical';
      if (!templateId) return res.status(400).json({ error: 'template_id is required' });
      const list = SAMPLE_WORDS;
      const { rows } = await pool.query(
        `SELECT kind, name, metadata FROM brand_assets
          WHERE client_id = $1 AND kind IN ('font', 'palette')`, [req.params.clientId]);
      const kit = req.query.skip_kit === '1' ? null : captions.kitFromAssets(rows);
      await captions.previewFrame({ words: list, templateId, kit, formatId, outPath: out });
      res.sendFile(out, (err) => {
        fs.unlink(out, () => {});
        if (err && !res.headersSent) res.status(500).end();
      });
    } catch (err) {
      fs.unlink(out, () => {});
      res.status(500).json({ error: err.message });
    }
  });

// Nine words with plausible timings, so a preview shows the motion rather than
// a single word sitting still.
const SAMPLE_WORDS = [
  { word: 'Fifteen', start: 0.00, end: 0.42 }, { word: 'years', start: 0.42, end: 0.78 },
  { word: 'later', start: 0.78, end: 1.12 }, { word: 'the', start: 1.12, end: 1.26 },
  { word: 'company', start: 1.26, end: 1.80 }, { word: 'creates', start: 1.80, end: 2.22 },
  { word: 'custom', start: 2.22, end: 2.64 }, { word: 'art', start: 2.64, end: 2.88 },
  { word: 'programs', start: 2.88, end: 3.42 },
];

// ── The sample gallery ───────────────────────────────────────────────────────
//
// What a template does to real footage, which a colour swatch cannot show.
// Every template over the same four seconds, so the comparison is fair.

// The house clip itself, so the screen can say whether one has been uploaded
// and show the operator what the examples are rendered over.
router.get('/caption-sample-clip', (req, res) => {
  const clip = captions.houseClip();
  if (!clip) return res.status(404).json({ error: 'No sample clip uploaded yet.' });
  res.sendFile(clip);
});

router.get('/caption-sample-status', (req, res) => res.json(captions.sampleStatus()));

/**
 * The worked example: one finished reel, so what the studio does is visible
 * before anybody commits footage to it.
 *
 * Status first, which is cheap and tells the screen whether to offer the
 * player at all. The video itself builds on first request and is cached, the
 * same way the caption examples are.
 */
router.get('/example-reel-status', async (req, res) => {
  try {
    const exampleReel = require('../services/exampleReel');
    res.json(exampleReel.status());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * The same reel in several styles.
 *
 * Six renders on a cold cache, so this is slow exactly once and instant after.
 * The videos themselves are fetched one per style, because a browser plays six
 * small files side by side and cannot play one file six ways.
 */
router.get('/example-reel.json', async (req, res) => {
  try {
    const exampleReel = require('../services/exampleReel');
    // The paths never leave the server: the screen asks for each video by url.
    // Lazy: the grid appears after one render and each tile builds itself as
    // its video is requested.
    res.json(await exampleReel.buildSet({ lazy: req.query.eager !== '1' }));
  } catch (err) {
    console.error('[example] build failed:', err.message);
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.get('/example-reel.mp4', async (req, res) => {
  try {
    const exampleReel = require('../services/exampleReel');
    const templateId = req.query.style || undefined;
    const r = await exampleReel.build(templateId ? { templateId } : {});
    res.sendFile(r.path);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// Transcribe the clip that is already there. Separate from the upload because
// a clip can land before a key does, and re-uploading a video to fix captions
// nobody could transcribe at the time is a silly thing to ask of anyone.
router.post('/caption-sample-transcribe', requireAdmin, async (req, res) => {
  try {
    if (!captions.houseClip()) return res.status(400).json({ error: 'No sample clip yet.' });
    const words = await captions.transcribeHouseClip();
    captions.clearSampleCache();
    res.json({ ok: true, words: words.length });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

/**
 * One template's example. `client_id` applies that client's kit; without it the
 * template renders as its author drew it.
 *
 * A GET so the gallery is a plain <video src>, and cached on disk, so the first
 * open of the page pays for the renders and nobody pays again.
 */
router.get('/caption-sample/:templateId.mp4', async (req, res) => {
  try {
    let kit = null;
    if (req.query.client_id) {
      assertClientAccess(req, req.query.client_id);
      const { rows } = await pool.query(
        `SELECT kind, name, metadata FROM brand_assets
          WHERE client_id = $1 AND kind IN ('font', 'palette')`, [req.query.client_id]);
      kit = captions.kitFromAssets(rows);
    }
    const file = await captions.sampleClip({ templateId: req.params.templateId, kit });
    res.sendFile(file);
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});

// Replace the clip every example is rendered over. Admin-only: it changes what
// every operator sees on every client.
router.post('/caption-sample-clip', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file.' });
  try {
    await captions.setHouseClip(req.file.path);
    res.json({ ok: true, cleared: true });
  } catch (err) {
    res.status(400).json({ error: `That file could not be read as video: ${err.message}` });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

module.exports = router;
