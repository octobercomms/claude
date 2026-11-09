/**
 * Measuring somebody else's finished video, so a template can be proposed
 * from it.
 *
 * Daniel's ask was a "claude video analyser": point it at a reel and get a
 * template. This is the half that reads the file. The half that decides what
 * the numbers mean is `shared/referenceAnalysis.mjs`, which is pure.
 *
 * MOST OF THIS ALREADY EXISTED. The QC gate's measurement service already
 * probes a file and takes a per-shot motion figure with the frame's own detail
 * alongside it, which is exactly what deciding "did this shot move" needs. So
 * the only new measurement here is scene detection: where the cuts are. Doing
 * it any other way would mean a second implementation of the same ffmpeg pass,
 * and this repo has paid for a duplicated helper before.
 *
 * WHERE THE LINE IS. Reading pacing, cut rhythm and caption style off a
 * competitor is ordinary competitive analysis, and the proposal this feeds
 * only ever offers OUR own motions, transitions and caption presets. It does
 * not reproduce a distinctive look closely enough that somebody's own audience
 * would mistake it, and matching to a shipped preset rather than generating an
 * approximation is what keeps it on that side of the line.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { FFMPEG } = require('./ffmpegBin');
const renderQc = require('./renderQc');

/**
 * How different two frames must be to count as a cut.
 *
 * ffmpeg's `scene` score is 0..1. 0.3 is the usual starting point: below it a
 * whip pan or a caption appearing fires as a cut, above it a soft dissolve
 * between two similar shots is missed. The pure half drops anything shorter
 * than 0.4s anyway, which cleans up most of what a low threshold adds.
 */
const SCENE_THRESHOLD = 0.3;

function run(bin, args, { timeoutMs = 240000, maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer }, (err, stdout, stderr) => {
      resolve({ err: err || null, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

/**
 * Where the cuts are, in seconds.
 *
 * `select` keeps only frames whose scene score clears the threshold, and
 * `showinfo` logs each one with its presentation time. Nothing is encoded:
 * `-f null -` throws the frames away and the answer comes out of the log.
 */
async function cuts(file, { threshold = SCENE_THRESHOLD } = {}) {
  const { stderr } = await run(FFMPEG, [
    '-hide_banner', '-nostats',
    '-i', file,
    '-vf', `select='gt(scene,${threshold})',showinfo`,
    '-f', 'null', '-',
  ]);
  const out = [];
  const re = /pts_time:([\d.]+)/g;
  let m = re.exec(stderr);
  while (m) {
    const t = Number(m[1]);
    if (Number.isFinite(t) && t > 0) out.push(t);
    m = re.exec(stderr);
  }
  // Ascending and de-duplicated: showinfo can log the same time twice when a
  // filter graph re-times frames.
  return [...new Set(out)].sort((a, b) => a - b);
}

let _refMod = null;
async function refMod() {
  if (!_refMod) {
    _refMod = await import(pathToFileURL(
      path.join(__dirname, '..', '..', '..', 'shared', 'referenceAnalysis.mjs')
    ).href);
  }
  return _refMod;
}

/**
 * Measure a reference video.
 *
 * Reuses the QC gate's own probe and motion pass rather than re-implementing
 * them. The loudness comes from the same place; what a reference was mastered
 * at is worth recording even though a template cannot ask for a level, because
 * nothing in this pipeline normalises loudness.
 */
async function measure(file) {
  const [base, cutList] = await Promise.all([
    renderQc.measure(file),
    cuts(file),
  ]);
  return {
    width: base.width,
    height: base.height,
    fps: base.fps,
    duration: base.videoDuration,
    cuts: cutList,
    motion: base.motion,
    loudnessLufs: base.loudnessLufs,
    truePeakDb: base.truePeakDb,
  };
}

/**
 * Measure a reference and propose a template from it.
 *
 * Never throws: a reference that cannot be read is a thing to say, and the
 * operator still has the video. The proposal always comes back with its
 * per-field confidence, so "I could not read this" is part of the answer
 * rather than an error.
 */
async function analyse(file, opts = {}) {
  const ref = await refMod();
  try {
    const m = await measure(file);

    // THE CAPTION TREATMENT, which is the half the file cannot answer. Opt-in
    // rather than automatic, because it is the only part of this that costs
    // anything and the button that triggers it shows the figure.
    //
    // A failure here never fails the analysis. Every other field was measured
    // off the file and is still worth having, and the proposal's own job is to
    // say what it could not read: `captionFor` with no observations returns
    // the same null and reason it always did.
    let caption = null;
    let captionSays = null;
    if (opts.readCaptions) {
      try {
        const vision = require('./referenceVision');
        const seen = await vision.observe(file, { clientId: opts.clientId || null });
        caption = seen.observations;
        captionSays = seen.says;
      } catch (err) {
        captionSays = `the caption pass failed: ${err.message}`;
      }
    }

    // THE SPOKEN SHAPE. Two calls behind it, Whisper and a labelling pass, so
    // it is opt-in beside the caption read and carries its own figure. A
    // failure here never fails the analysis either.
    let structure = null;
    let structureSays = null;
    if (opts.readStructure) {
      try {
        const reader = require('./referenceStructure');
        const got = await reader.read(file, { clientId: opts.clientId || null });
        structure = got.structure;
        structureSays = got.says;
      } catch (err) {
        structureSays = `the structure pass failed: ${err.message}`;
      }
    }

    const cm = await matchMod();
    const out = ref.propose(
      { ...m, ...(caption ? { caption } : {}), ...(structure ? { structure } : {}) },
      {
        ...opts,
        styles: opts.styles || presetStyles(),
        matchPreset: cm.matchPreset,
        marginVFor: cm.marginVFor,
      }
    );
    return { ...out, measured: m, captionSays, structureSays };
  } catch (err) {
    return {
      template: null,
      fields: {},
      confidence: 0,
      shots: [],
      says: `Could not be read: ${err.message}`,
      measured: null,
    };
  }
}

/**
 * The shipped caption presets, read once.
 *
 * Passed into the pure half rather than imported by it, because
 * `referenceAnalysis.mjs` imports nothing but `composition.mjs` and a
 * 31-entry JSON file is the backend's to read. It also means a caller can
 * match against a subset: the measured four for an architecture practice.
 */
let _styles = null;
function presetStyles() {
  if (!_styles) {
    const file = path.join(__dirname, '..', '..', '..', 'shared', 'captions', 'presets.json');
    _styles = JSON.parse(fs.readFileSync(file, 'utf8')).styles;
  }
  return _styles;
}

let _match = null;
async function matchMod() {
  if (!_match) {
    _match = await import(pathToFileURL(
      path.join(__dirname, '..', '..', '..', 'shared', 'captionMatch.mjs')
    ).href);
  }
  return _match;
}

module.exports = {
  analyse,
  measure,
  cuts,
  presetStyles,
  SCENE_THRESHOLD,
};
