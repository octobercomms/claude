/**
 * Cut the dead air and the fillers out of a talking head.
 *
 * The plan is worked out in shared/silenceCut.mjs, which is pure and therefore
 * testable; this is the half that needs a file and a transcript. Nothing here
 * decides to cut on its own: `propose` returns what it would do, the operator
 * reads it, and `apply` renders only what they approved.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');
const { getSetting } = require('../utils/settings');
const { FFMPEG, FFPROBE } = require('./ffmpegBin');

const SHARED = path.join(__dirname, '..', '..', '..', 'shared', 'silenceCut.mjs');

let _mod = null;
async function mod() {
  if (!_mod) _mod = await import(pathToFileURL(SHARED).href);
  return _mod;
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${path.basename(bin)}: ${String(stderr || err.message).slice(-500)}`));
      else resolve(String(stdout || ''));
    });
  });
}

/**
 * An RMS level envelope for a file, in dBFS, in the file's own timebase.
 *
 * `planCuts` uses this to confirm that a gap the word timings nominated is
 * actually empty. Word timings alone cannot tell dead air from a cough, a
 * door, a chair or room tone, and cutting one of those removes a sound the
 * viewer heard.
 *
 * One decode, 50ms windows: `asetnsamples=800` at 16kHz. Measured at about
 * three seconds for a ten-minute file, so it is affordable per request.
 *
 * Taking the whole envelope rather than running `silencedetect` per candidate
 * threshold is deliberate. With the envelope in memory, the per-file
 * threshold sweep and the quiet-fraction test are arithmetic; with
 * `silencedetect` each threshold is another decode, and parallel instances
 * collide on the same `lavfi.silence_start` metadata key.
 *
 * `hop` is read back from the reported `pts_time` rather than assumed from
 * the filter arguments, so a resample that lands differently is visible
 * instead of silently shifting every measurement against the word timings.
 */
async function measureEnvelope(file) {
  const out = await run(FFMPEG, [
    '-v', 'error', '-i', file, '-vn',
    '-af', 'aresample=16000,asetnsamples=800,astats=metadata=1:reset=1,'
      + 'ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
    '-f', 'null', '-',
  ]);

  const times = [];
  const dbs = [];
  let pending = null;
  for (const line of out.split('\n')) {
    const t = line.match(/pts_time:([\d.]+)/);
    if (t) { pending = Number(t[1]); continue; }
    const v = line.match(/lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-?inf)/);
    if (v && pending != null) {
      // A fully digital-silent window reports -inf. Treat it as the floor
      // rather than dropping it: a dropped window is "no measurement", and
      // the quiet test must be able to tell that from "measured, and empty".
      const n = v[1] === '-inf' ? -120 : Number(v[1]);
      if (Number.isFinite(n)) { times.push(pending); dbs.push(n); }
      pending = null;
    }
  }

  if (dbs.length < 2) return null;
  // The median step, so one odd frame cannot set the hop for the whole file.
  const steps = times.slice(1).map((t, i) => t - times[i]).filter((d) => d > 0).sort((a, b) => a - b);
  const hop = steps.length ? steps[Math.floor(steps.length / 2)] : 0.05;
  return { hop, dbs };
}

async function durationOf(file) {
  const out = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', file]);
  return Number(out.trim()) || 0;
}

/** Word timings for a clip, transcribing only when the caller has none. */
async function wordsFor(source, supplied = null) {
  if (Array.isArray(supplied) && supplied.length) return supplied;
  const key = (await getSetting('OPENAI_API_KEY')) || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('No OpenAI key, so this clip cannot be transcribed. Add one under Settings → AI.');
  const audio = path.join(path.dirname(source), `cut-${crypto.randomBytes(4).toString('hex')}.mp3`);
  try {
    await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', source,
      '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', audio]);
    const { whisperWords } = require('./whisper');
    return await whisperWords(audio, key);
  } finally { fs.existsSync(audio) && fs.unlinkSync(audio); }
}

/**
 * What would come out, without touching the file.
 *
 * The words come back with it so applying the plan costs no second
 * transcription, and so the panel can show the operator the actual sentence
 * each cut sits in rather than a timestamp.
 */
async function propose({ source, words = null, options = {} }) {
  if (!fs.existsSync(source)) throw new Error('That clip could not be found on disk.');
  const m = await mod();
  const timed = await wordsFor(source, words);
  // The file's own length goes INTO the plan, not just alongside it: without
  // it the plan ends at the last word Whisper heard and silently drops
  // whatever follows.
  const fileSeconds = await durationOf(source);
  const plan = m.planCuts(timed, { media_s: fileSeconds, ...options });
  return { ...plan, file_s: +fileSeconds.toFixed(2), words: timed };
}

/**
 * Render the approved plan.
 *
 * `keep` comes from the caller, not from a fresh planCuts, so what renders is
 * exactly what was on screen when they pressed go. Recomputing here would let
 * a default change between the proposal and the render, which is the kind of
 * difference nobody looks for.
 */
async function apply({ source, keep, outPath }) {
  if (!fs.existsSync(source)) throw new Error('That clip could not be found on disk.');
  const m = await mod();
  const spans = (Array.isArray(keep) ? keep : [])
    .map(([a, b]) => [Number(a), Number(b)])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((x, y) => x[0] - y[0]);
  if (!spans.length) throw new Error('Nothing to keep: the plan would remove the whole clip.');

  const expr = m.selectExpr(spans);
  // select/aselect with one expression rather than a trim-and-concat chain: a
  // forty-cut edit would otherwise build a hundred and twenty filter nodes and
  // a command line long enough to hit ffmpeg's limit.
  //
  // setpts/asetpts renumber what survives, or the output carries the original
  // timestamps and every player shows a clip full of frozen gaps.
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', source,
    '-vf', `select='${expr}',setpts=N/FRAME_RATE/TB`,
    '-af', `aselect='${expr}',asetpts=N/SR/TB`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '128k',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outPath]);

  return {
    outPath,
    seconds: +(await durationOf(outPath)).toFixed(2),
    spans: spans.length,
    bytes: fs.statSync(outPath).size,
  };
}

module.exports = { propose, apply, wordsFor, durationOf, measureEnvelope };
