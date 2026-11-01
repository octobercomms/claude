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
const pool = require('../db');
const mediaStore = require('../services/mediaStore');

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
// An edit decision list arrives from the browser, so it is checked here before
// it is stored: each block becomes its own ffmpeg process at render time, and
// an edit claiming ten thousand blocks would occupy the box for an afternoon.
// The arithmetic itself is re-checked in the processor against the real clip
// durations (shared/edl.mjs `normalise`), which is the only place that knows
// them; this is the resource limit, not the correctness check.
const MAX_EDL_BLOCKS = 200;

function edlProblem(edl, clipCount) {
  if (edl == null) return null;
  if (typeof edl !== 'object' || !Array.isArray(edl.items)) return 'The edit is malformed.';
  if (edl.items.length > MAX_EDL_BLOCKS) {
    return `An edit can hold up to ${MAX_EDL_BLOCKS} blocks; this one has ${edl.items.length}.`;
  }
  for (const it of edl.items) {
    // `Number(null)` is 0 and `Number.isInteger(0)` is true, so null would
    // pass as "clip 0" and quietly render the wrong footage. Absent is absent.
    const clip = it?.clip == null ? NaN : Number(it.clip);
    if (!Number.isInteger(clip) || clip < 0 || (clipCount != null && clip >= clipCount)) {
      return 'The edit refers to a clip that is not part of this job.';
    }
    const a = Number(it?.in);
    if (!Number.isFinite(a) || a < 0) return 'A block has an invalid start point.';
    if (it?.out != null) {
      const b = Number(it.out);
      if (!Number.isFinite(b) || !(b > a)) return 'A block ends before it begins.';
    }
  }
  return null;
}

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
    // An EDL is itself an edit: a trim or a reorder on one clip changes the
    // output, and without this a timeline-only edit is refused as "nothing
    // chosen" even though the timeline plainly shows the change.
    const hasEdl = !!(ops.edl && Array.isArray(ops.edl.items) && ops.edl.items.length);
    const hasCuts = hasEdl
      || (Array.isArray(ops.segments) ? ops.segments.length > 0 : (ops.trim && (ops.trim.start > 0 || ops.trim.end > 0)));
    const wantsSomething = combining || (ops.aspect && ops.aspect !== 'original') || hasCuts || ops.clean_audio || ops.captions;
    const edlErr = edlProblem(ops.edl, files.length);
    if (edlErr) return res.status(400).json({ error: edlErr });
    // Refuse an unknown caption template here rather than at render time. The
    // renderer refuses it too, but by then the operator has waited for a job
    // to reach the front of the queue to be told a name was wrong.
    if (ops.caption_template) {
      try { require('../services/captions').preset(ops.caption_template); }
      catch { return res.status(400).json({ error: 'That caption template does not exist.' }); }
    }
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

// Send an existing recording (from the Video library) into the editor as a
// draft job — no re-upload. Copies the recording's stored file into the client's
// edit dir and creates a draft the user then configures (trim/captions/etc).
router.post('/clients/:clientId/edit/from-recording', requireClientAccess({ paramNames: ['clientId'] }), express.json(), async (req, res) => {
  try {
    const recId = req.body?.recording_id;
    if (!recId) return res.status(400).json({ error: 'recording_id required' });
    const { rows } = await pool.query(
      'SELECT id, title, storage_key, mime, duration_s FROM recordings WHERE id = $1', [recId]);
    const rec = rows[0];
    if (!rec || !rec.storage_key) return res.status(404).json({ error: 'Recording not found' });

    const ext = rec.mime === 'video/webm' ? '.webm' : '.mp4';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    // Stream the copy rather than reading the whole recording into memory to
    // write it straight back out: a long screen capture is hundreds of
    // megabytes, and this runs inside a request handler.
    const src = await mediaStore.localFile(rec.storage_key);
    try {
      await fs.promises.copyFile(src.path, path.join(editJobs.clientDir(req.params.clientId), filename));
    } finally {
      await src.release();
    }

    const clips = [{ url: editJobs.servedUrl(req.params.clientId, filename), name: rec.title || 'Recording' }];
    const job = await editJobs.create(req.params.clientId, {
      sourceName: rec.title || 'Recording', sourceUrl: clips[0].url,
      sourceMeta: { duration: rec.duration_s || null, from_recording: rec.id },
      ops: {}, clips, name: rec.title || null, status: 'draft', createdBy: req.user.id,
    });
    res.status(201).json(job);
  } catch (err) {
    console.error('[edit] from-recording failed:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * Send a library asset into the editor as a draft.
 *
 * The same shape as from-recording, and for the same reason: the editor works
 * on files in its own directory, so anything coming from elsewhere is copied
 * in rather than referenced across stores. Without this, the only way into the
 * editor was a fresh upload, which meant re-uploading footage October already
 * had on the same disk.
 */
router.post('/clients/:clientId/edit/from-asset', requireClientAccess({ paramNames: ['clientId'] }),
  express.json(), async (req, res) => {
    try {
      const assetId = req.body?.asset_id;
      if (!assetId) return res.status(400).json({ error: 'asset_id required' });
      const assets = require('../services/assets');
      const socialCaptionRender = require('../services/socialCaptionRender');
      const asset = await assets.get(assetId);
      if (!asset || asset.client_id !== req.params.clientId) {
        return res.status(404).json({ error: 'No such asset for this client.' });
      }
      if (asset.kind !== 'video') return res.status(400).json({ error: 'That asset is not a video.' });

      // localPath hands an external URL straight back, on purpose: ffmpeg
      // reads https directly and a download step would be waste. The test
      // below used to be fs.existsSync on that result, which a URL always
      // fails, so Edit refused every CDN-hosted clip in the library —
      // including the ones whose link still worked. That is the "not on this
      // server any more" the 31 Oct review reported.
      const resolved = socialCaptionRender.localPath(req.params.clientId, asset);
      const onDisk = resolved && !/^https?:\/\//i.test(resolved) && fs.existsSync(resolved);
      let disk = onDisk ? resolved : null;

      if (!disk) {
        // Not here. If there is a link, keep the bytes rather than stream from
        // the provider every time: the second click then costs nothing, and
        // the clip stops depending on a URL nobody controls. Same fix as ad
        // creative and the avatar reels, through the same service.
        const assetsSvc = require('../services/assets');
        const generatedMedia = require('../services/generatedMedia');
        const link = /^https?:\/\//i.test(String(resolved || '')) ? resolved
          : (asset.source_url || asset.url);
        if (!/^https?:\/\//i.test(String(link || ''))) {
          // The honest version of the old message: there is no file and no
          // link, so this row describes something that no longer exists.
          return res.status(409).json({
            error: 'That clip has no file on this server and no link to fetch it from. '
                 + 'The library row is stale — archive it and re-upload the footage.' });
        }
        try {
          const kept = await assetsSvc.keepRemote({ ...asset, source_url: asset.source_url || link });
          disk = generatedMedia.localPathFor(kept.url);
        } catch (err) {
          return res.status(409).json({
            error: `That clip is not on this server, and its original link did not work either (${err.message}).` });
        }
        if (!disk || !fs.existsSync(disk)) {
          return res.status(409).json({ error: 'That clip was fetched but could not be read back.' });
        }
      }

      const url = editJobs.adoptFile(req.params.clientId, disk, path.extname(disk) || '.mp4');
      const job = await editJobs.create(req.params.clientId, {
        sourceName: asset.title || 'Clip', sourceUrl: url,
        sourceMeta: { duration: asset.duration_s || null, from_asset: asset.id },
        ops: {}, clips: [{ url, name: asset.title || 'Clip' }],
        name: asset.title || null, status: 'draft', createdBy: req.user.id,
      });
      res.status(201).json(job);
    } catch (err) {
      console.error('[edit] from-asset failed:', err.message);
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
    // The clip count is not known here without reading the job, and reopen
    // reads it anyway; the processor drops a block pointing past the clips it
    // has. This still catches a malformed or oversized edit before it queues.
    const edlErr = edlProblem(ops.edl, null);
    if (edlErr) return res.status(400).json({ error: edlErr });
    const job = await editJobs.reopen(req.params.clientId, req.params.id, { ops, name: req.body?.name || null, createdBy: req.user.id });
    editProcessor.kick();
    res.status(201).json(job);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

/**
 * Stop a render, whether it is queued or already running.
 *
 * The database row changes first, then the processor is asked to kill ffmpeg.
 * That order matters: the processor checks the cancel flag between passes, so
 * a job that slips past the kill (because it was between invocations) still
 * stops at the next check rather than running to completion and appearing in
 * the library after the operator asked for it not to.
 */
router.post('/clients/:clientId/edit/:id/cancel', requireClientAccess({ paramNames: ['clientId'] }), async (req, res) => {
  try {
    const out = await editJobs.cancel(req.params.clientId, req.params.id);
    if (!out) {
      // Already finished, failed, or a draft that was never queued. Said
      // plainly rather than reported as a successful cancel, because "it
      // stopped" and "it had already finished" lead somewhere different.
      return res.status(409).json({ error: 'That edit is not running, so there is nothing to stop.' });
    }
    const killed = out.was === 'processing' ? editProcessor.cancel(req.params.id) : false;
    res.json({ ok: true, was: out.was, killed });
  } catch (err) {
    console.error('[edit] cancel failed:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
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
