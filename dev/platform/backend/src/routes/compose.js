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

async function whisperWords(audioPath, apiKey) {
  const buf = fs.readFileSync(audioPath);
  const form = new FormData();
  form.append('file', new Blob([buf]), 'audio.mp3');
  form.append('model', process.env.WHISPER_MODEL || 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Whisper ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const words = Array.isArray(body.words) ? body.words : [];
  if (!words.length) throw new Error('Whisper returned no word timings.');
  return words
    .map(w => ({ word: String(w.word ?? '').trim(), start: Number(w.start), end: Number(w.end) }))
    .filter(w => w.word && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start);
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

// ── Caption templates (read from the shared library) ────────────────

router.get('/caption-templates', (req, res) => {
  try {
    const captions = require('../services/captions');
    res.json(captions.templates());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
