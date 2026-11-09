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
 * Resolve an asset's URL to a file path on disk. Null when it cannot be.
 *
 * `([^/]+)` for the client segment, not `(\d+)`. **A client id is a UUID**, so
 * the digits-only pattern this used matched nothing a real asset has ever
 * carried, and `assetFilePath` returned null for every asset in the system.
 * Every composition render therefore answered `Source "sX" has no file on
 * disk.` — the editor's Export has never resolved a single file. Nothing
 * caught it because the render guards all work on the graph, which is built
 * from paths rather than from assets, and the pixel tests hand the graph file
 * paths directly.
 *
 * TWO traversal guards, because they catch different things and each one
 * alone leaves the other open. The original checked only UPLOAD_ROOT, which
 * lets a filename climb out of one client's folder and into another's work.
 * Checking only the client folder — which is what
 * `generatedMedia.localPathFor` and `adResize.diskPathForOutput` do — lets the
 * CLIENT segment climb instead: `/api/brand/file/../x` resolves a base
 * outside uploads entirely, and `x` sits happily inside it. Swapping one for
 * the other is a trade, not a fix, so both are here.
 */
function assetFilePath(asset) {
  const m = String(asset?.url || '').match(/^\/api\/brand\/file\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  const base = path.join(UPLOAD_ROOT, m[1]);
  // The client segment stays inside uploads.
  if (!base.startsWith(UPLOAD_ROOT + path.sep)) return null;
  const filePath = path.join(base, m[2]);
  // And the filename stays inside that client's folder.
  if (!filePath.startsWith(base + path.sep)) return null;
  return fs.existsSync(filePath) ? filePath : null;
}

// ── Caption ASS generation ───────────────────────────────────────────

/**
 * A caption source's words, from either shape its `transcript` may hold.
 *
 * An array is the words themselves. A string is the id of the source whose
 * words to use, looked up in the composition row's `transcripts` column.
 */
function resolveTranscript(transcript, transcripts) {
  if (Array.isArray(transcript)) return transcript;
  if (typeof transcript === 'string' && transcript) {
    return (transcripts || {})[transcript] || null;
  }
  return null;
}

/** For an error message, so the reader can see which shape arrived. */
function describeTranscript(transcript) {
  if (Array.isArray(transcript)) return `an empty array`;
  if (typeof transcript === 'string') return `a reference to source "${transcript}"`;
  if (transcript == null) return 'absent';
  return `a ${typeof transcript}`;
}

/**
 * If the composition has caption sources, compile the ASS string and
 * write it to a temp file. Returns the path, or null when there are no
 * captions.
 *
 * `transcripts` is the composition row's word map, keyed by source id.
 *
 * A caption source's `transcript` is EITHER a literal array of words OR the
 * id of the clip source whose words to use. The editor writes the id
 * (`CompositionEditorPage.addCaptions`) because the words live in their own
 * column and a composition carrying two copies of them would drift. Only the
 * array form was ever handled here, so every caption the editor produced
 * resolved to nothing.
 *
 * NOTHING HERE MAY FAIL QUIETLY. A composition that asked for captions and
 * renders without them is the page lying about its output, which is the
 * fault the whole composition model exists to remove. So an unresolvable
 * caption throws, and the caller surfaces it rather than shipping a clean
 * video with a success message.
 */
async function buildCaptionAss(comp, compId, transcripts = {}) {
  const captionSources = Object.entries(comp.sources || {})
    .filter(([, src]) => src.kind === 'captions');
  if (!captionSources.length) return null;

  // One ASS file, one style block, so a second caption source has nowhere to
  // go. It used to be dropped here without a word: `captionSources[0]` and
  // the rest discarded, which is the page lying about its output in the one
  // function whose comment forbids exactly that. Nothing produced two until
  // templates did, so say so instead of choosing one silently.
  if (captionSources.length > 1) {
    throw new Error(
      `This composition has ${captionSources.length} caption sources `
      + `(${captionSources.map(([id]) => id).join(', ')}) and the renderer burns `
      + 'one ASS track, so only the first would appear. Put every line in one '
      + 'caption source, or render the extra type as a design page.'
    );
  }

  const [capId, capSrc] = captionSources[0];
  const words = resolveTranscript(capSrc.transcript, transcripts);
  if (!Array.isArray(words) || !words.length) {
    throw new Error(
      `Caption source "${capId}" has no words to render. Its transcript is `
      + `${describeTranscript(capSrc.transcript)}, and the composition's `
      + `transcripts hold ${Object.keys(transcripts || {}).length} entries `
      + `(${Object.keys(transcripts || {}).join(', ') || 'none'}). Transcribe `
      + `the clip before rendering captions.`
    );
  }

  const compiler = await captionCompiler();
  const presets = JSON.parse(fs.readFileSync(CAPTIONS_PRESETS_PATH, 'utf8'));

  const templateId = capSrc.template || Object.keys(presets.styles)[0];
  const preset = presets.styles[templateId];
  if (!preset) {
    throw new Error(
      `Caption template "${templateId}" is not in shared/captions/presets.json. `
      + `Known templates: ${Object.keys(presets.styles).join(', ')}.`
    );
  }

  const formatId = capSrc.format || 'vertical';
  const format = presets.outputFormats[formatId] || presets.outputFormats.vertical || {
    width: comp.size?.width || 1080,
    height: comp.size?.height || 1920,
  };

  const ass = compiler.compile({
    words,
    preset,
    format,
    // The source may override the preset's grouping. A template's on-screen
    // type is written as whole lines ("Grade II listed, reimagined") in one
    // cue each, and regrouping those into threes would break a title at
    // whatever word fell third. Spoken captions keep the preset's value.
    perLine: capSrc.perLine || preset.wordsPerLine || 3,
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
    // An fx source has no file either: ffmpeg generates it from a
    // filtergraph. Demanding an asset for it answered "has no mapped asset"
    // before the graph was ever built.
    if (src.kind === 'fx') continue;

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

  // 3. Handle captions: compile ASS if needed.
  //
  // This used to catch and log, on the reasoning that captions are
  // optional. They are not optional once somebody has asked for them: a
  // render that drops them and reports success is indistinguishable from
  // one that never had them, and that is how captions came to be silently
  // absent from every composition render. A composition with no caption
  // source still returns null here and renders as before.
  const captionAssPath = await buildCaptionAss(comp, compositionId, row.transcripts || {});

  // 4. Build the ffmpeg filter graph
  const mod = await renderMod();
  const graphResult = mod.renderGraph(comp, { sourcePaths, captionAssPath });

  if (!graphResult.inputs.length) {
    throw new Error('Composition has no renderable inputs');
  }

  // Resolve input paths in order
  const resolvedPaths = graphResult.inputs.map((input) => {
    // A generated input keeps its place in the array so the indices ffmpeg
    // numbers by position stay aligned; `ffmpegArgs` reads its filtergraph
    // off the input rather than this slot.
    if (input.generated) return null;
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

// buildCaptionAss and resolveTranscript are exported because the shipped
// render route in routes/compose.js has its own queue and spawn loop and
// does not call renderComposition. That split is why captions never
// reached the output: the only code that compiled them lived on a path
// nothing called. One implementation, two callers, rather than two.
module.exports = {
  renderComposition,
  assetFilePath,
  parseProgress,
  buildCaptionAss,
  resolveTranscript,
};
