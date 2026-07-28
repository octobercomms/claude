// Edit studio routes — guided video editing (trim / clean audio / auto-caption).
// Agency-only (not read-only client logins; captions spend a little on Whisper).
// Source + rendered files served through /api/edit/file, client-scoped.

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess } = require('../middleware/clientAccess');
const editJobs = require('../services/editJobs');
const editProcessor = require('../services/editProcessor');
const stillsReel = require('../services/stillsReel');

const router = express.Router();

// Stills → Reel image uploads. Small (photos), so buffer to disk in the client's
// edit dir like clips; image filter only.
const uploadImages = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { try { cb(null, editJobs.clientDir(req.params.clientId)); } catch (e) { cb(e); } },
    filename: (req, file, cb) => {
      let ext = (path.extname(file.originalname || '').toLowerCase().replace(/[^a-z0-9.]/g, '')) || '.jpg';
      if (!ext.startsWith('.')) ext = '.' + ext;
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 40 * 1024 * 1024 },   // 40MB per still
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
});

const REEL_ASPECTS = ['9:16', '1:1', '4:5'];

// Stream uploads straight to the client's edit dir (never buffer a multi-GB
// clip in RAM). Files land pre-named; the route reads req.files[].filename.
const uploadDisk = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { try { cb(null, editJobs.clientDir(req.params.clientId)); } catch (e) { cb(e); } },
    filename: (req, file, cb) => {
      let ext = (path.extname(file.originalname || '').toLowerCase().replace(/[^a-z0-9.]/g, '')) || '.mp4';
      if (!ext.startsWith('.')) ext = '.' + ext;
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },   // 2GB — long source clips
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('video/')),
});

router.use(authenticate);
// Agency/admin only — a read-only client login can't run edits.
router.use((req, res, next) => {
  if (req.user?.role === 'client') return res.status(403).json({ error: 'Editing isn’t available on a read-only account.' });
  next();
});
router.use(loadVisibleClientIds);

// Create an edit job from one or several uploaded clips + chosen operations.
// Several clips → combined into one video (in upload order) before editing.
router.post('/clients/:clientId/edit', requireClientAccess({ paramNames: ['clientId'] }),
  uploadDisk.fields([{ name: 'files', maxCount: 20 }, { name: 'file', maxCount: 1 }]), async (req, res) => {
  try {
    const files = [...(req.files?.files || []), ...(req.files?.file || [])];
    if (!files.length) return res.status(400).json({ error: 'Upload a video file.' });
    let ops = req.body?.ops;
    if (typeof ops === 'string') { try { ops = JSON.parse(ops); } catch { ops = {}; } }
    ops = ops || {};
    const isDraft = String(req.body?.draft) === 'true';
    const combining = files.length > 1;
    const hasCuts = Array.isArray(ops.segments) ? ops.segments.length > 0 : (ops.trim && (ops.trim.start > 0 || ops.trim.end > 0));
    const wantsSomething = combining || (ops.aspect && ops.aspect !== 'original') || hasCuts || ops.clean_audio || ops.captions;
    if (!isDraft && !wantsSomething) return res.status(400).json({ error: 'Pick at least one edit (trim, clean audio, or captions).' });

    // Files are already on disk (streamed); reference them by served URL.
    const clips = files.map(f => ({ url: editJobs.servedUrl(req.params.clientId, f.filename), name: f.originalname }));
    const sourceMeta = {};
    if (req.body?.duration) sourceMeta.duration = Number(req.body.duration) || null;

    const job = await editJobs.create(req.params.clientId, {
      sourceName: files[0].originalname, sourceUrl: clips[0].url, sourceMeta, ops, clips,
      name: req.body?.name || null, status: isDraft ? 'draft' : 'queued', createdBy: req.user.id,
    });
    if (!isDraft) editProcessor.kick();
    res.status(201).json(job);
  } catch (err) {
    console.error('[edit] create failed:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Motion vibes + a per-clip price estimate for the Stills → Reel panel.
router.get('/stills-reel/options', (req, res) => {
  res.json({ motions: stillsReel.motionOptions(), aspects: REEL_ASPECTS, price_per_clip: stillsReel.priceFor(stillsReel.DEFAULT_MODEL) });
});

// Stills → Reel — animate 2–12 still images into short cinematic clips and
// stitch them into one vertical reel. Runs on the edit queue like any job;
// the frontend polls status and shows the finished reel in history.
router.post('/clients/:clientId/stills-reel', requireClientAccess({ paramNames: ['clientId'] }),
  uploadImages.array('images', 12), async (req, res) => {
  try {
    const files = req.files || [];
    if (files.length < 2) return res.status(400).json({ error: 'Add at least 2 images to build a reel.' });
    const motion = stillsReel.motionOptions().includes(req.body?.motion) ? req.body.motion : 'push-in';
    const aspect = REEL_ASPECTS.includes(req.body?.aspect) ? req.body.aspect : '9:16';
    const perClip = Math.min(4, Math.max(0.6, Number(req.body?.per_clip_seconds) || 1.2));

    const stills = files.map(f => ({ url: editJobs.servedUrl(req.params.clientId, f.filename), name: f.originalname, motion }));
    const job = await editJobs.create(req.params.clientId, {
      sourceName: `Stills reel · ${files.length} images`,
      sourceUrl: stills[0].url,
      sourceMeta: { kind: 'stills_reel', still_count: files.length },
      ops: { stills_reel: { motion, aspect, per_clip_seconds: perClip } },
      clips: stills,
      name: req.body?.name || null,
      status: 'queued',
      createdBy: req.user.id,
    });
    editProcessor.kick();
    res.status(201).json(job);
  } catch (err) {
    console.error('[edit] stills-reel failed:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Re-open a saved edit with (possibly changed) ops — reuses the stored source,
// no re-upload.
router.post('/clients/:clientId/edit/:id/reopen', requireClientAccess({ paramNames: ['clientId'] }), async (req, res) => {
  try {
    let ops = req.body?.ops || {};
    const job = await editJobs.reopen(req.params.clientId, req.params.id, { ops, name: req.body?.name || null, createdBy: req.user.id });
    editProcessor.kick();
    res.status(201).json(job);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Render a saved draft (in place).
router.post('/clients/:clientId/edit/:id/render', requireClientAccess({ paramNames: ['clientId'] }), async (req, res) => {
  try { const job = await editJobs.queueDraft(req.params.clientId, req.params.id); editProcessor.kick(); res.json(job); }
  catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});

// Rename a saved edit.
router.patch('/clients/:clientId/edit/:id', requireClientAccess({ paramNames: ['clientId'] }), async (req, res) => {
  try { res.json(await editJobs.rename(req.params.clientId, req.params.id, req.body?.name)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.get('/clients/:clientId/edit', requireClientAccess({ paramNames: ['clientId'] }), async (req, res) => {
  try { res.json(await editJobs.list(req.params.clientId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/clients/:clientId/edit/:id', requireClientAccess({ paramNames: ['clientId'] }), async (req, res) => {
  try {
    const job = await editJobs.get(req.params.clientId, req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    res.json(job);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clients/:clientId/edit/:id/retry', requireClientAccess({ paramNames: ['clientId'] }), async (req, res) => {
  try { const job = await editJobs.retry(req.params.clientId, req.params.id); editProcessor.kick(); res.json(job); }
  catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});

router.delete('/clients/:clientId/edit/:id', requireClientAccess({ paramNames: ['clientId'] }), async (req, res) => {
  try { await editJobs.remove(req.params.clientId, req.params.id); res.status(204).end(); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Serve a source / rendered file. Client-scoped; nosniff.
router.get('/file/:clientId/:filename', requireClientAccess({ paramNames: ['clientId'] }), (req, res) => {
  const p = editJobs.serveFilePath(req.params.clientId, req.params.filename);
  if (!p) return res.status(400).end();
  if (!fs.existsSync(p)) return res.status(404).end();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(p);
});

module.exports = router;
