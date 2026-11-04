/**
 * Composition renderer: takes a saved composition, resolves its assets,
 * builds the ffmpeg filter graph via the shared render-graph generator,
 * spawns ffmpeg, tracks progress, and hands back the output file.
 *
 * This is a pure backend module — no Express, no routes. The route layer
 * calls renderComposition() and streams progress to the client however it
 * likes.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const compositions = require('./compositions');
const assets = require('./assets');
const { FFMPEG } = require('./ffmpegBin');

const UPLOAD_ROOT = path.join(__dirname, '../../uploads');

// The shared modules are ESM; we dynamic-import them once and cache.
const RENDER_PATH = path.join(__dirname, '..', '..', '..', 'shared', 'compositionRender.mjs');
const CAPTIONS_COMPILE_PATH = path.join(__dirname, '..', '..', '..', 'shared', 'captions', 'compile.mjs');
const CAPTIONS_PRESETS_PATH = path.join(__dirname, '..', '..', '..', 'shared', 'captions', 'presets.json');

let _renderMod = null;
async function renderMod() {
  if (!_renderMod) _renderMod = await import(pathToFileURL(RENDER_PATH).href);
  return _renderMod;
}

let _captionCompiler = null;
async function captionCompiler() {
  if (!_captionCompiler) _captionCompiler = await import(pathToFileURL(CAPTIONS_COMPILE_PATH).href);
  return _captionCompiler;
}

// ── Asset resolution ─────────────────────────────────────────────────

/**
 * Resolve an asset's URL to a file path on disk, matching the pattern
 * used throughout compose.js. Returns null when the file cannot be found.
 */
function assetFilePath(asset) {
  if (!asset?.url) return null;
  const m = asset.url.match(/^\/api\/brand\/file\/(\d+)\/(.+)$/);
  if (!m) return null;
  const filePath = path.join(UPLOAD_ROOT, m[1], m[2]);
  if (!filePath.startsWith(UPLOAD_ROOT + path.sep)) return null;
  return fs.existsSync(filePath) ? filePath : null;
}

// ── Caption ASS generation ───────────────────────────────────────────

/**
 * If the composition has caption sources, compile the ASS string and
 * write it to a temp file. Returns the path, or null when there are no
 * captions.
 */
async function buildCaptionAss(comp, compId) {
  const captionSources = Object.entries(comp.sources || {})
    .filter(([, src]) => src.kind === 'captions');
  if (!captionSources.length) return null;

  // Take the first caption source. It must have a transcript (words array).
  const [, capSrc] = captionSources[0];
  const words = capSrc.transcript;
  if (!Array.isArray(words) || !words.length) return null;

  const compiler = await captionCompiler();
  const presets = JSON.parse(fs.readFileSync(CAPTIONS_PRESETS_PATH, 'utf8'));

  const templateId = capSrc.template || Object.keys(presets.styles)[0];
  const preset = presets.styles[templateId];
  if (!preset) return null;

  const formatId = capSrc.format || 'vertical';
  const format = presets.outputFormats[formatId] || presets.outputFormats.vertical || {
    width: comp.size?.width || 1080,
    height: comp.size?.height || 1920,
  };

  const ass = compiler.compile({
    words,
    preset,
    format,
    perLine: preset.wordsPerLine || 3,
    marginV: Math.round(format.height * 0.17),
  });

  const assPath = path.join(
    os.tmpdir(),
    `comp-captions-${compId}-${crypto.randomBytes(4).toString('hex')}.ass`,
  );
  fs.writeFileSync(assPath, ass);
  return assPath;
}

// ── Progress parsing ─────────────────────────────────────────────────

/**
 * Parse ffmpeg stderr for progress information.
 *
 * ffmpeg writes lines like:
 *   frame=  120 fps= 30 ... time=00:00:04.00 ...
 *
 * We extract the time value and compute a percentage against the expected
 * total duration.
 */
function parseProgress(line, totalDuration) {
  if (!totalDuration || totalDuration <= 0) return null;
  const m = line.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d+)/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const s = parseInt(m[3], 10);
  const frac = parseFloat(`0.${m[4]}`);
  const elapsed = h * 3600 + min * 60 + s + frac;
  return Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
}

// ── Main entry point ─────────────────────────────────────────────────

/**
 * Render a composition to an MP4 file.
 *
 * @param {number|string} compositionId  The DB id of the composition row.
 * @param {object}        [options]
 * @param {function}      [options.onProgress]  Called with (percent) 0..100.
 * @param {string}        [options.preset]      x264 preset, default 'veryfast'.
 * @param {number}        [options.crf]         Quality, default 20.
 * @param {string}        [options.audioBitrate] Default '160k'.
 * @returns {Promise<{ outputPath: string, duration: number }>}
 */
async function renderComposition(compositionId, options = {}) {
  const {
    onProgress = () => {},
    preset = 'veryfast',
    crf = 20,
    audioBitrate = '160k',
  } = options;

  // 1. Load the composition from the database
  const row = await compositions.get(compositionId);
  if (!row) throw new Error(`Composition ${compositionId} not found`);

  const comp = row.data;
  if (!comp || !comp.tracks) {
    throw new Error(`Composition ${compositionId} has no data`);
  }

  // 2. Resolve each source's asset to a disk path
  const sourceAssets = row.source_assets || {};
  const sourcePaths = {};

  for (const [sourceId, src] of Object.entries(comp.sources || {})) {
    // Caption sources have no file on disk; they produce an ASS string
    if (src.kind === 'captions') continue;

    const assetId = sourceAssets[sourceId] || src.asset;
    if (!assetId) {
      throw new Error(`Source "${sourceId}" has no mapped asset`);
    }

    const asset = await assets.get(assetId);
    if (!asset) {
      throw new Error(`Asset ${assetId} for source "${sourceId}" not found`);
    }

    const filePath = assetFilePath(asset);
    if (!filePath) {
      throw new Error(`File not found on disk for asset ${assetId} (source "${sourceId}")`);
    }

    sourcePaths[sourceId] = filePath;
  }

  // 3. Handle captions: compile ASS if needed
  let captionAssPath = null;
  try {
    captionAssPath = await buildCaptionAss(comp, compositionId);
  } catch (err) {
    // Captions are optional; log but do not fail the render
    console.error('[compositionRenderer] caption compilation failed:', err.message);
  }

  // 4. Build the ffmpeg filter graph
  const mod = await renderMod();
  const graphResult = mod.renderGraph(comp, { sourcePaths, captionAssPath });

  if (!graphResult.inputs.length) {
    throw new Error('Composition has no renderable inputs');
  }

  // Resolve input paths in order
  const resolvedPaths = graphResult.inputs.map((input) => {
    const p = sourcePaths[input.sourceId];
    if (!p) throw new Error(`No resolved path for source "${input.sourceId}"`);
    return p;
  });

  // Build the ffmpeg arguments
  const outputPath = path.join(
    os.tmpdir(),
    `comp-render-${compositionId}-${crypto.randomBytes(6).toString('hex')}.mp4`,
  );

  const args = mod.ffmpegArgs(graphResult, resolvedPaths, outputPath, {
    preset,
    crf,
    audioBitrate,
  });

  // 5. Spawn ffmpeg
  const totalDuration = graphResult.duration;

  await new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;

      // Parse progress from each line
      const lines = text.split(/\r?\n|\r/);
      for (const line of lines) {
        const pct = parseProgress(line, totalDuration);
        if (pct != null) {
          try { onProgress(pct); } catch (_) { /* caller error is not our problem */ }
        }
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn ffmpeg: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        // Extract the last few lines of stderr for the error message
        const tail = stderr.split('\n').filter(Boolean).slice(-5).join('\n');
        reject(new Error(`ffmpeg exited with code ${code}: ${tail}`));
      }
    });
  });

  // Clean up the temporary ASS file
  if (captionAssPath) {
    fs.promises.unlink(captionAssPath).catch(() => {});
  }

  return { outputPath, duration: totalDuration };
}

module.exports = { renderComposition, assetFilePath, parseProgress };
