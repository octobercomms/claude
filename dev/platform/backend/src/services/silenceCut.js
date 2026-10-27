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

async function durationOf(file) {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
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
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', source,
      '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', audio]);
    const { whisperWords } = require('./editProcessor');
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
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', source,
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

module.exports = { propose, apply, wordsFor, durationOf };
