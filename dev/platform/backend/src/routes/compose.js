const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess, assertClientAccess } = require('../middleware/clientAccess');
const compositions = require('../services/compositions');
const assets = require('../services/assets');
const { FFMPEG, FFPROBE } = require('../services/ffmpegBin');
const { getSetting } = require('../utils/settings');
const { recordApiCost } = require('../services/costLog');
const { whisperWords } = require('../services/whisper');
// One caption compiler, two callers. This route has its own queue and spawn
// loop rather than calling renderComposition, and because the only code that
// compiled caption ASS lived on that other path, every caption the editor
// produced was silently dropped from the output.
// One copy of assetFilePath, in the renderer service. There were two
// identical ones, here and there, which is how the route and the service
// drifted apart over caption handling in the first place.
const { assetFilePath } = require('../services/compositionRenderer');
// The audio measurement half of the silence plan. The arithmetic is pure and
// lives in shared/silenceCut.mjs; this is the part that needs a file.
const silenceService = require('../services/silenceCut');

const { pathToFileURL } = require('url');
const multer = require('multer');

const UPLOAD_ROOT = path.join(__dirname, '../../uploads');
const WHISPER_PER_MIN = 0.006;

const clipStore = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_ROOT, String(req.composition.client_id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
    cb(null, `comp-${Date.now()}-${crypto.randomBytes(3).toString('hex')}${ext}`);
  },
});
const clipUpload = multer({
  storage: clipStore,
  limits: { fileSize: 500 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (/^video\//.test(String(file.mimetype || ''))) return cb(null, true);
    cb(new Error('Only video files are accepted.'));
  },
});
const audioUpload = multer({
  storage: clipStore,
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (/^audio\//.test(String(file.mimetype || ''))) return cb(null, true);
    cb(new Error('Only audio files are accepted.'));
  },
});

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);

// ── CRUD ────────────────────────────────────────────────────────────

router.post('/clients/:clientId/compositions',
  requireClientAccess({ paramNames: ['clientId'] }),
  async (req, res) => {
    try {
      const { title, data } = req.body || {};
      const row = await compositions.create({
        clientId: req.params.clientId,
        createdBy: req.user?.id,
        title,
        data,
      });
      res.status(201).json(row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

router.get('/clients/:clientId/compositions',
  requireClientAccess({ paramNames: ['clientId'] }),
  async (req, res) => {
    try {
      res.json(await compositions.list(req.params.clientId));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

async function loadComposition(req, res, next) {
  try {
    const row = await compositions.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    assertClientAccess(req, row.client_id);
    req.composition = row;
    next();
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
}

router.get('/compositions/:id', loadComposition, (req, res) => res.json(req.composition));

router.put('/compositions/:id', loadComposition, async (req, res) => {
  try {
    const { title, data, sourceAssets, transcripts, status } = req.body || {};
    const row = await compositions.update(req.params.id, {
      title, data, sourceAssets, transcripts, status,
    });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/compositions/:id', loadComposition, async (req, res) => {
  try {
    await compositions.remove(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Clip upload ────────────────────────────────────────────────────

function parseFraction(str) {
  const parts = String(str).split('/');
  if (parts.length === 2) {
    const n = parseFloat(parts[0]);
    const d = parseFloat(parts[1]);
    if (d > 0 && Number.isFinite(n)) return Math.round(n / d);
  }
  const n = parseFloat(str);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 30;
}

function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    const ff = spawn(FFPROBE, [
      '-v', 'quiet', '-print_format', 'json',
      '-show_format', '-show_streams', filePath,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    ff.stdout.on('data', d => { out += d; });
    ff.on('error', reject);
    ff.on('close', code => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}`));
      try {
        const info = JSON.parse(out);
        const vs = (info.streams || []).find(s => s.codec_type === 'video');
        resolve({
          duration: parseFloat(info.format?.duration) || 0,
          width: vs ? parseInt(vs.width, 10) : 0,
          height: vs ? parseInt(vs.height, 10) : 0,
          fps: vs?.r_frame_rate ? parseFraction(vs.r_frame_rate) : 30,
        });
      } catch { resolve({ duration: 0, width: 0, height: 0, fps: 30 }); }
    });
  });
}

router.post('/compositions/:id/clip', loadComposition, (req, res, next) => {
  clipUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  try {
    const comp = req.composition;
    const clientId = comp.client_id;
    const f = req.file;
    if (!f) return res.status(400).json({ error: 'No file sent.' });

    const filePath = path.join(UPLOAD_ROOT, String(clientId), f.filename);
    const probe = await probeVideo(filePath);

    const asset = await assets.record({
      client_id: clientId, source: 'upload', source_id: f.filename,
      title: f.originalname || f.filename,
      url: `/api/brand/file/${clientId}/${f.filename}`,
      mime: f.mimetype, bytes: f.size, created_by: req.user?.id || null,
      width: probe.width || null, height: probe.height || null,
      duration_s: probe.duration || null,
      metadata: { uploaded: true, original_name: f.originalname, composition_id: comp.id },
    });
    if (!asset) return res.status(500).json({ error: 'Failed to record asset.' });

    res.status(201).json({
      assetId: asset.id,
      url: asset.url,
      mime: asset.mime,
      originalName: f.originalname,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
    });
  } catch (err) {
    console.error('[compose] clip upload failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Audio upload ──────────────────────────────────────────────────

function probeAudio(filePath) {
  return new Promise((resolve, reject) => {
    const ff = spawn(FFPROBE, [
      '-v', 'quiet', '-print_format', 'json',
      '-show_format', '-show_streams', filePath,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    ff.stdout.on('data', d => { out += d; });
    ff.on('error', reject);
    ff.on('close', code => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}`));
      try {
        const info = JSON.parse(out);
        resolve({ duration: parseFloat(info.format?.duration) || 0 });
      } catch { resolve({ duration: 0 }); }
    });
  });
}

router.post('/compositions/:id/audio', loadComposition, (req, res, next) => {
  audioUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  try {
    const comp = req.composition;
    const clientId = comp.client_id;
    const f = req.file;
    if (!f) return res.status(400).json({ error: 'No file sent.' });

    const filePath = path.join(UPLOAD_ROOT, String(clientId), f.filename);
    const probe = await probeAudio(filePath);

    const asset = await assets.record({
      client_id: clientId, source: 'upload', source_id: f.filename,
      title: f.originalname || f.filename,
      url: `/api/brand/file/${clientId}/${f.filename}`,
      mime: f.mimetype, bytes: f.size, created_by: req.user?.id || null,
      duration_s: probe.duration || null,
      metadata: { uploaded: true, original_name: f.originalname, composition_id: comp.id, audio: true },
    });
    if (!asset) return res.status(500).json({ error: 'Failed to record asset.' });

    res.status(201).json({
      assetId: asset.id,
      url: asset.url,
      mime: asset.mime,
      originalName: f.originalname,
      duration: probe.duration,
    });
  } catch (err) {
    console.error('[compose] audio upload failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Transcription ───────────────────────────────────────────────────

function extractAudio(inPath) {
  const outPath = path.join(os.tmpdir(), `comp-${crypto.randomBytes(8).toString('hex')}.mp3`);
  return new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG, [
      '-y', '-i', inPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', outPath,
    ], { stdio: 'ignore' });
    ff.on('error', reject);
    ff.on('close', code => {
      if (code === 0) resolve(outPath);
      else reject(new Error(`ffmpeg exited ${code}`));
    });
  });
}


router.post('/compositions/:id/transcribe', loadComposition, async (req, res) => {
  const { sourceId } = req.body || {};
  if (!sourceId) return res.status(400).json({ error: 'sourceId is required' });

  const comp = req.composition;
  const sourceAssets = comp.source_assets || {};
  const assetId = sourceAssets[sourceId];
  if (!assetId) return res.status(400).json({ error: 'No asset mapped for that source' });

  const asset = await assets.get(assetId);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });

  const filePath = assetFilePath(asset);
  if (!filePath) return res.status(400).json({ error: 'Asset file not found on disk' });

  const apiKey = process.env.OPENAI_API_KEY || await getSetting('OPENAI_API_KEY');
  if (!apiKey) return res.status(400).json({ error: 'No OpenAI API key configured. Set it in Settings > AI.' });

  let audioPath;
  try {
    audioPath = await extractAudio(filePath);
    const words = await whisperWords(audioPath, apiKey);

    // Saved BEFORE the cost is logged, which is the order that matters.
    //
    // It used to be the other way round, and the cost call was wrong twice:
    // `recordApiCost` takes `{ provider, feature, costUsd }` and returns
    // nothing, and this passed `purpose` and `cost` and then called `.catch()`
    // on the undefined it returned. So OpenAI was called and billed, the next
    // line threw `Cannot read properties of undefined (reading 'catch')`, the
    // words were discarded, and the route answered 500. Every click of
    // Transcribe paid for a transcript nobody received, and clicking again
    // paid again.
    //
    // Two orderings follow from that. The words are persisted first, because
    // they are what was paid for and nothing about bookkeeping should be able
    // to lose them. And the cost is recorded last, fire and forget, because
    // `recordApiCost` already swallows its own failures and returns no promise
    // to wait on.
    const transcripts = { ...(comp.transcripts || {}), [sourceId]: words };
    await compositions.update(comp.id, { transcripts });

    const durationS = words.length ? words[words.length - 1].end : 0;
    recordApiCost({
      provider: 'openai',
      // The feature name the `video_batch` task budget sums over. Without a
      // `feature` the call returned early and wrote nothing, so composition
      // transcription has never appeared in the cost log, the cost chip or
      // any budget.
      feature: 'composition_transcribe',
      costUsd: Math.max(0.01, (durationS / 60) * WHISPER_PER_MIN),
      clientId: comp.client_id,
      meta: {
        model: 'whisper-1',
        composition_id: comp.id,
        source: sourceId,
        duration_s: Math.round(durationS),
      },
    });

    res.json({ sourceId, words });
  } catch (err) {
    console.error('[compose] transcribe failed:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (audioPath) fs.promises.unlink(audioPath).catch(() => {});
  }
});

// ── Tighten: propose silence/filler cuts ───────────────────────────

const SILENCE_CUT_PATH = path.join(__dirname, '..', '..', '..', 'shared', 'silenceCut.mjs');
let _silenceMod = null;
async function silenceMod() {
  if (!_silenceMod) _silenceMod = await import(pathToFileURL(SILENCE_CUT_PATH).href);
  return _silenceMod;
}

router.post('/compositions/:id/tighten', loadComposition, async (req, res) => {
  try {
    const { sourceId, options } = req.body || {};
    if (!sourceId) return res.status(400).json({ error: 'sourceId is required' });

    const comp = req.composition;
    const words = (comp.transcripts || {})[sourceId];
    if (!words?.length) return res.status(400).json({ error: 'No transcript for that source. Transcribe first.' });

    const sc = await silenceMod();

    // Two things this route used to leave out, both of which made the plan
    // quietly wrong rather than visibly broken.
    //
    // `media_s`: without the file's own length the plan truncates at the last
    // word Whisper heard, so anything said after it is dropped and the edit
    // looks successful. The clip's duration was probed on upload and is on
    // the source, so this needs no disk read.
    //
    // `envelope`: word timings cannot tell dead air from a cough, a door or
    // room tone. The measurement confirms a nominated gap is actually empty.
    // It is best-effort by design: if the file cannot be measured the plan
    // falls back to timings alone, which is what it always did, rather than
    // failing the request.
    const src = (comp.data?.sources || {})[sourceId];
    let envelope = null;
    try {
      const assetId = (comp.source_assets || {})[sourceId];
      const asset = assetId ? await assets.get(assetId) : null;
      const filePath = asset ? assetFilePath(asset) : null;
      if (filePath) envelope = await silenceService.measureEnvelope(filePath);
    } catch (err) {
      console.warn('[compose] tighten: could not measure audio, '
        + `falling back to timings only: ${err.message}`);
    }

    const plan = sc.planCuts(words, {
      media_s: src?.duration ?? null,
      envelope,
      ...(options || {}),
    });
    res.json(plan);
  } catch (err) {
    console.error('[compose] tighten failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── B-roll: propose cutaway moments ──────────────────────────────

const BROLL_PLAN_PATH = path.join(__dirname, '..', '..', '..', 'shared', 'brollPlan.mjs');
let _brollMod = null;
async function brollMod() {
  if (!_brollMod) _brollMod = await import(pathToFileURL(BROLL_PLAN_PATH).href);
  return _brollMod;
}

router.post('/compositions/:id/broll-plan', loadComposition, async (req, res) => {
  try {
    const { sourceId, options } = req.body || {};
    if (!sourceId) return res.status(400).json({ error: 'sourceId is required' });

    const comp = req.composition;
    const words = (comp.transcripts || {})[sourceId];
    if (!words?.length) return res.status(400).json({ error: 'No transcript for that source. Transcribe first.' });

    const bp = await brollMod();
    const plan = bp.planBroll(words, options || {});
    res.json(plan);
  } catch (err) {
    console.error('[compose] broll-plan failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Render: start a background ffmpeg encode ────────────────────────

const renderQueue = require('../services/compositionRenderQueue');
const runner = require('../services/compositionRenderRunner');



// ── Render: enqueue, and let the runner do it ───────────────────────
//
// What was here was two module-level variables holding start closures. See
// services/compositionRenderQueue.js for the four faults that caused and
// services/compositionRenderRunner.js for why a render is now derived from a
// composition id rather than captured from a request.

router.post('/compositions/:id/render', loadComposition, async (req, res) => {
  const comp = req.composition;
  try {
    // A pre-flight, so somebody pressing Export gets told now rather than
    // being queued and failing later. It is the real preparation, discarded
    // immediately: the runner does it again at render time, because after a
    // restart there is no request to have done it in.
    let prepared;
    try {
      prepared = await runner.prepare(comp.id);
    } catch (err) {
      // Recorded as well as answered. The route used to return 400 with no
      // row behind it, which is fine for one interactive export and the worst
      // possible shape for a batch: the failed items simply did not exist, so
      // a runner watching the table saw twenty-six rows and no record of what
      // happened to the other four.
      const row = await renderQueue.recordPreflightFailure(comp.id, err.message)
        .catch(() => null);
      return res.status(400).json({ error: err.message, renderId: row?.id || null });
    }
    runner.discard(prepared);

    const job = await renderQueue.enqueue(comp.id);
    const position = await renderQueue.positionOf(job.id);

    // Reply first, then start. The request is not kept alive by the render.
    res.json({
      renderId: job.id,
      status: position === 1 ? 'rendering' : 'queued',
      position,
    });
    runner.kick();
  } catch (err) {
    console.error('[compose] render start failed:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

router.get('/compositions/:id/render-status', loadComposition, async (req, res) => {
  try {
    // `renderId` reads one attempt by its own id, which is what a batch
    // watches. Without it this returns the newest, which made an earlier
    // attempt unobservable the moment a re-run existed.
    const job = req.query.renderId
      ? await renderQueue.get(Number(req.query.renderId))
      : await renderQueue.latestFor(req.composition.id);
    if (!job || job.composition_id !== req.composition.id) {
      return res.json({ status: 'none' });
    }

    const out = { renderId: job.id, status: job.status, progress: job.progress };
    if (job.status === 'queued') {
      const pos = await renderQueue.positionOf(job.id);
      if (pos != null) out.position = pos;
    }
    if (job.status === 'done' && job.output_url) out.outputUrl = job.output_url;
    if (job.status === 'failed' && job.error) out.error = job.error;
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/compositions/:id/render-download', loadComposition, async (req, res) => {
  try {
    const job = req.query.renderId
      ? await renderQueue.get(Number(req.query.renderId))
      : await renderQueue.latestFor(req.composition.id);
    if (!job || job.composition_id !== req.composition.id
        || job.status !== 'done' || !job.output_path) {
      return res.status(404).json({ error: 'No completed render available.' });
    }
    if (!fs.existsSync(job.output_path)) {
      return res.status(404).json({ error: 'Rendered file no longer on disk.' });
    }
    res.download(job.output_path);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Design pages available as composition sources ─────────────────

router.get('/designs/:clientId',
  requireClientAccess({ paramNames: ['clientId'] }),
  async (req, res) => {
    try {
      const rows = await assets.list(req.params.clientId, { source: 'design', limit: 200 });
      res.json(rows.map(r => ({
        id: r.id,
        title: r.title,
        url: r.url,
        width: r.width,
        height: r.height,
        metadata: r.metadata,
      })));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

// ── Caption templates (read from the shared library) ────────────────

router.get('/caption-templates', (req, res) => {
  try {
    const captions = require('../services/captions');
    res.json(captions.templates());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Video templates (the eight shipped shapes) ──────────────────────

/**
 * Summaries for the picker. `?full=1` returns the whole templates, which is
 * what the batch runner needs to bind against.
 */
router.get('/templates', (req, res) => {
  try {
    const templates = require('../services/compositionTemplates');
    const payload = req.query.full ? templates.all() : templates.list();
    const broken = templates.problems();
    // Surfaced rather than hidden: a template file that stopped validating is
    // a shape the operator can no longer use, and silence would read as the
    // template never having existed.
    res.json(broken.length ? { templates: payload, broken } : { templates: payload });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
