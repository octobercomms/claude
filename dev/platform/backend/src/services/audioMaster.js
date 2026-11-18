// Mastering for cleaned speech — the stage after ElevenLabs Audio Isolation.
//
// Isolation removes what should not be there: room reverb, background noise,
// the echo off a hard wall. It does nothing about what is there. A recording
// comes back clean and still too quiet, still jumping between a loud sentence
// and a mumbled one, still with desk rumble under it and sibilance on top.
// Daniel, 17 November: "clean it up, normalise loudness, and just make my
// voice sound better... all in one click."
//
// So this runs straight after isolation, in the same job, and the operator
// sees one action.
//
// The chain, in this order, and the order is the point:
//
//   highpass=f=80       Below 80Hz a voice has nothing but desk knocks,
//                       traffic and mains hum. Cutting it first means the
//                       compressor is not reacting to rumble it cannot hear.
//   acompressor         Evens out the gap between a leaned-in sentence and a
//                       quiet one. threshold -18dB, ratio 3:1 — gentle, the
//                       point is consistency rather than density.
//   deesser             Compression lifts quiet detail, and sibilance is
//                       quiet detail, so a compressed voice hisses on every
//                       s. This has to come after the compressor that caused
//                       it, not before.
//   loudnorm            EBU R128, last. Normalising before the compressor
//                       would be pointless: the compressor changes the
//                       loudness it just set.
//
// Why two passes. loudnorm in one pass guesses, using a running estimate, and
// lands a decibel or two off. Given measured values it is accurate. So pass
// one runs the whole chain and prints its measurement, and pass two runs the
// same chain with those numbers. Measuring through the chain rather than over
// the raw file matters: the filters change the loudness, so a measurement
// taken before them describes a signal that no longer exists.
//
// Verified on 18 November against ffmpeg 6.1.1, a deliberately quiet test
// signal at -53.5 LUFS: out at -16.2 LUFS measured independently with
// ebur128, against a -16 target.

const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { FFMPEG } = require('./ffmpegBin');

// -16 LUFS is the usual target for spoken content and what the social
// platforms normalise towards anyway. -14 is the YouTube figure; if that ever
// needs to differ per destination this is the one number to lift into a
// setting.
const TARGET_LUFS = -16;
const TRUE_PEAK = -1.5;
const LOUDNESS_RANGE = 11;

// Everything before loudnorm. Shared by both passes on purpose — if the two
// ever drift apart the measurement describes a different signal from the one
// being normalised, and the output lands off target with nothing to show why.
const VOICE_CHAIN = [
  'highpass=f=80',
  'acompressor=threshold=-18dB:ratio=3:attack=10:release=200:makeup=2',
  'deesser=i=0.4',
].join(',');

function run(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 1 << 26 }, (err, stdout, stderr) => {
      // ffmpeg writes its measurement to stderr, and exits 0 either way, so
      // both streams come back and the caller decides what it wanted.
      if (err) reject(new Error(`ffmpeg: ${String(stderr || err.message).slice(-500)}`));
      else resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

// loudnorm prints a JSON object at the end of stderr, after everything else
// ffmpeg has to say. Taking the last {...} block rather than the first avoids
// catching anything a future ffmpeg decides to print earlier.
function parseLoudnorm(stderr) {
  const matches = String(stderr).match(/\{[\s\S]*?\}/g);
  if (!matches || !matches.length) return null;
  try {
    const parsed = JSON.parse(matches[matches.length - 1]);
    if (parsed.input_i == null) return null;
    return parsed;
  } catch { return null; }
}

function loudnormFilter(measured) {
  const base = `loudnorm=I=${TARGET_LUFS}:TP=${TRUE_PEAK}:LRA=${LOUDNESS_RANGE}`;
  if (!measured) return `${base}:print_format=json`;
  return `${base}`
    + `:measured_I=${measured.input_i}`
    + `:measured_TP=${measured.input_tp}`
    + `:measured_LRA=${measured.input_lra}`
    + `:measured_thresh=${measured.input_thresh}`
    + `:offset=${measured.target_offset || 0}`
    + ':linear=true';
}

/**
 * Master a speech buffer. Returns { buffer, mastering } on success.
 *
 * Throws only on something the caller should know about. The caller is
 * expected to fall back to the unmastered audio rather than fail the job:
 * a clean but quiet file is worth delivering, an error is not.
 */
async function master(inputBuffer, { ext = 'mp3' } = {}) {
  const stamp = crypto.randomBytes(8).toString('hex');
  const dir = os.tmpdir();
  const inFile = path.join(dir, `omi-master-${stamp}-in.${ext}`);
  const outFile = path.join(dir, `omi-master-${stamp}-out.mp3`);

  try {
    await fs.writeFile(inFile, inputBuffer);

    // Pass one: run the chain, normalise nothing, print what it measured.
    const probe = await run(FFMPEG, [
      '-hide_banner', '-nostats', '-i', inFile,
      '-af', `${VOICE_CHAIN},${loudnormFilter(null)}`,
      '-f', 'null', '-',
    ]);
    const measured = parseLoudnorm(probe.stderr);
    if (!measured) throw new Error('loudnorm did not report a measurement');

    // Pass two: same chain, now with the numbers.
    await run(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-i', inFile,
      '-af', `${VOICE_CHAIN},${loudnormFilter(measured)}`,
      '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '192k',
      outFile, '-y',
    ]);

    const buffer = await fs.readFile(outFile);
    return {
      buffer,
      mastering: {
        // What it was, so the screen can say "was -23.4, now -16" rather than
        // claiming an improvement nobody can check.
        input_lufs: Number(measured.input_i),
        input_true_peak: Number(measured.input_tp),
        target_lufs: TARGET_LUFS,
        true_peak_ceiling: TRUE_PEAK,
        chain: VOICE_CHAIN,
        at: new Date().toISOString(),
      },
    };
  } finally {
    await fs.unlink(inFile).catch(() => {});
    await fs.unlink(outFile).catch(() => {});
  }
}

module.exports = {
  master,
  // Exported for the guard, which checks the two passes cannot drift apart
  // and that a real measurement parses.
  _internals: { VOICE_CHAIN, TARGET_LUFS, TRUE_PEAK, parseLoudnorm, loudnormFilter },
};
