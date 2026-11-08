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
const { buildCaptionAss } = require('../services/compositionRenderer');
const db = require('../db');

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

function assetFilePath(asset) {
  if (!asset?.url) return null;
  const m = asset.url.match(/^\/api\/brand\/file\/(\d+)\/(.+)$/);
  if (!m) return null;
  const filePath = path.join(UPLOAD_ROOT, m[1], m[2]);
  if (!filePath.startsWith(UPLOAD_ROOT + path.sep)) return null;
  return fs.existsSync(filePath) ? filePath : null;
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

    const durationS = words.length ? words[words.length - 1].end : 0;
    recordApiCost({
      clientId: comp.client_id, provider: 'openai', model: 'whisper-1',
      purpose: 'composition-transcribe',
      cost: Math.max(0.01, (durationS / 60) * WHISPER_PER_MIN),
    }).catch(() => {});

    const transcripts = { ...(comp.transcripts || {}), [sourceId]: words };
    await compositions.update(comp.id, { transcripts });

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
    const plan = sc.planCuts(words, options || {});
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

const RENDER_PATH = path.join(__dirname, '..', '..', '..', 'shared', 'compositionRender.mjs');
let _renderMod = null;
async function renderMod() {
  if (!_renderMod) _renderMod = await import(pathToFileURL(RENDER_PATH).href);
  return _renderMod;
}

function parseFFmpegTime(str) {
  const m = str.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
}

// ── Render queue: one ffmpeg at a time, state persisted to DB ──────

let _activeRender = null;
const _renderQueue = [];

async function getRenderJob(compositionId) {
  const { rows } = await db.query(
    `SELECT * FROM composition_renders WHERE composition_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [compositionId]
  );
  return rows[0] || null;
}

async function createRenderJob(compositionId) {
  const { rows } = await db.query(
    `INSERT INTO composition_renders (composition_id, status) VALUES ($1, 'queued') RETURNING *`,
    [compositionId]
  );
  return rows[0];
}

async function updateRenderJob(id, updates) {
  const sets = [];
  const vals = [];
  let i = 1;
  for (const [k, v] of Object.entries(updates)) {
    sets.push(`${k} = $${i}`);
    vals.push(v);
    i++;
  }
  sets.push('updated_at = now()');
  vals.push(id);
  await db.query(
    `UPDATE composition_renders SET ${sets.join(', ')} WHERE id = $${i}`,
    vals
  );
}

function processQueue() {
  if (_activeRender || !_renderQueue.length) return;
  const next = _renderQueue.shift();
  _activeRender = next.jobId;
  next.start();
}

router.post('/compositions/:id/render', loadComposition, async (req, res) => {
  try {
    const comp = req.composition;
    const compId = comp.id;
    const clientId = comp.client_id;
    const data = comp.data;

    if (!data || !data.tracks || !data.sources) {
      return res.status(400).json({ error: 'Composition has no timeline data.' });
    }

    const sourceAssets = comp.source_assets || {};
    const sourcePaths = {};
    for (const [sourceId, assetId] of Object.entries(sourceAssets)) {
      const asset = await assets.get(assetId);
      if (!asset) continue;
      const fp = assetFilePath(asset);
      if (fp) sourcePaths[sourceId] = fp;
    }

    // Captions are compiled to an ASS file and handed to the graph as a
    // subtitles filter. An unresolvable caption fails the request here,
    // before a job exists, rather than producing a caption-free video that
    // reports success.
    let captionAssPath = null;
    try {
      captionAssPath = await buildCaptionAss(data, compId, comp.transcripts || {});
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const rm = await renderMod();
    const graph = rm.renderGraph(data, { sourcePaths, captionAssPath });

    if (!graph.inputs.length) {
      return res.status(400).json({ error: 'No resolvable sources in the composition.' });
    }

    const resolvedPaths = [];
    for (const inp of graph.inputs) {
      const p = sourcePaths[inp.sourceId];
      if (!p) {
        return res.status(400).json({ error: `Source "${inp.sourceId}" has no file on disk.` });
      }
      resolvedPaths.push(p);
    }

    const outDir = path.join(UPLOAD_ROOT, String(clientId));
    fs.mkdirSync(outDir, { recursive: true });
    const timestamp = Date.now();
    const outputPath = path.join(outDir, `render-${compId}-${timestamp}.mp4`);
    const args = rm.ffmpegArgs(graph, resolvedPaths, outputPath);

    const job = await createRenderJob(compId);

    function startRender() {
      updateRenderJob(job.id, { status: 'rendering', started_at: new Date().toISOString(), output_path: outputPath }).catch(() => {});

      const ff = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });

      // The compiled ASS lives in the temp directory and is only needed for
      // the life of this process. Attached to the process rather than to each
      // of the three exit paths, so a path added later cannot leak it: a
      // batch of thirty renders would otherwise leave thirty files behind.
      if (captionAssPath) {
        const release = () => { fs.promises.unlink(captionAssPath).catch(() => {}); };
        ff.once('close', release);
        ff.once('error', release);
      }

      let stderr = '';
      let lastProgressWrite = 0;

      ff.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
        const lines = stderr.split('\r');
        for (let i = lines.length - 1; i >= 0; i--) {
          const t = parseFFmpegTime(lines[i]);
          if (t != null && graph.duration > 0) {
            const pct = Math.min(100, Math.round((t / graph.duration) * 100));
            const now = Date.now();
            if (now - lastProgressWrite > 5000) {
              lastProgressWrite = now;
              updateRenderJob(job.id, { progress: pct }).catch(() => {});
            }
            break;
          }
        }
      });

      ff.on('error', (err) => {
        console.error('[compose] render spawn error:', err.message);
        updateRenderJob(job.id, { status: 'failed', error: err.message, finished_at: new Date().toISOString() }).catch(() => {});
        _activeRender = null;
        processQueue();
      });

      ff.on('close', async (code) => {
        if (code !== 0) {
          const tail = stderr.split('\n').slice(-5).join('\n').trim();
          console.error(`[compose] render failed (exit ${code}):`, tail);
          await updateRenderJob(job.id, { status: 'failed', error: tail || `ffmpeg exited ${code}`, finished_at: new Date().toISOString() }).catch(() => {});
          _activeRender = null;
          processQueue();
          return;
        }

        const outputFilename = path.basename(outputPath);
        const stat = fs.statSync(outputPath);
        const outputUrl = `/api/brand/file/${clientId}/${outputFilename}`;

        assets.record({
          client_id: clientId,
          source: 'scene_render',
          source_id: `render-${compId}-${timestamp}`,
          title: (comp.title || 'Composition') + ' (render)',
          url: outputUrl,
          mime: 'video/mp4',
          bytes: stat.size,
          created_by: req.user?.id || null,
          duration_s: graph.duration || null,
          metadata: { composition_id: compId, rendered_at: new Date().toISOString() },
        }).catch(() => {});

        await updateRenderJob(job.id, {
          status: 'done', progress: 100,
          output_path: outputPath, output_url: outputUrl,
          finished_at: new Date().toISOString(),
        }).catch(() => {});

        _activeRender = null;
        processQueue();
      });
    }

    if (_activeRender) {
      _renderQueue.push({ jobId: job.id, start: startRender });
      res.json({ status: 'queued', position: _renderQueue.length });
    } else {
      _activeRender = job.id;
      startRender();
      res.json({ status: 'rendering' });
    }
  } catch (err) {
    console.error('[compose] render start failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/compositions/:id/render-status', loadComposition, async (req, res) => {
  try {
    const compId = req.composition.id;
    const job = await getRenderJob(compId);
    if (!job) return res.json({ status: 'none' });

    const out = { status: job.status, progress: job.progress };
    if (job.status === 'queued') {
      const pos = _renderQueue.findIndex(q => q.jobId === job.id);
      if (pos >= 0) out.position = pos + 1;
    }
    if (job.status === 'done' && job.output_url) out.outputUrl = job.output_url;
    if (job.status === 'failed' && job.error) out.error = job.error;
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/compositions/:id/render-download', loadComposition, async (req, res) => {
  try {
    const job = await getRenderJob(req.composition.id);
    if (!job || job.status !== 'done' || !job.output_path) {
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

module.exports = router;
