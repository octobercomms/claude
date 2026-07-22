// Edit studio routes — guided video editing (trim / clean audio / auto-caption).
// Agency-only (not read-only client logins; captions spend a little on Whisper).
// Source + rendered files served through /api/edit/file, client-scoped.

const express = require('express');
const fs = require('fs');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess } = require('../middleware/clientAccess');
const editJobs = require('../services/editJobs');
const editProcessor = require('../services/editProcessor');

const router = express.Router();

const uploadMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },   // 500MB — raw phone clips are big
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
  uploadMem.fields([{ name: 'files', maxCount: 20 }, { name: 'file', maxCount: 1 }]), async (req, res) => {
  try {
    const files = [...(req.files?.files || []), ...(req.files?.file || [])];
    if (!files.length) return res.status(400).json({ error: 'Upload a video file.' });
    let ops = req.body?.ops;
    if (typeof ops === 'string') { try { ops = JSON.parse(ops); } catch { ops = {}; } }
    ops = ops || {};
    const combining = files.length > 1;
    const wantsSomething = combining || (ops.trim && (ops.trim.start > 0 || ops.trim.end > 0)) || ops.clean_audio || ops.captions;
    if (!wantsSomething) return res.status(400).json({ error: 'Pick at least one edit (trim, clean audio, or captions).' });

    const clips = files.map(f => ({ url: editJobs.saveBuffer(req.params.clientId, f.buffer, f.originalname, '.mp4'), name: f.originalname }));
    const sourceMeta = {};
    if (req.body?.duration) sourceMeta.duration = Number(req.body.duration) || null;

    const job = await editJobs.create(req.params.clientId, {
      sourceName: files[0].originalname, sourceUrl: clips[0].url, sourceMeta, ops, clips,
      name: req.body?.name || null, createdBy: req.user.id,
    });
    editProcessor.kick();
    res.status(201).json(job);
  } catch (err) {
    console.error('[edit] create failed:', err.message);
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
