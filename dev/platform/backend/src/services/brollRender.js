/**
 * Lay chosen b-roll over a talking head.
 *
 * The plan is worked out in shared/brollPlan.mjs, which is pure; this is the
 * half that needs files. It renders exactly the placements it is handed and
 * never re-plans, for the same reason the tighten path does not: a default
 * that changed between the proposal and the render would put a shot somewhere
 * the operator never saw listed.
 *
 * One pass, overlay per placement, base audio untouched. The speaker keeps
 * talking under the cutaway, which is the whole point of b-roll and the thing
 * a naive cut-and-concat gets wrong.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { FFMPEG, FFPROBE } = require('./ffmpegBin');

/**
 * More than this and the filter graph gets long enough to be worth refusing
 * rather than debugging at 2am. Eight cutaways in one reel is already a lot.
 */
const MAX_PLACEMENTS = 8;

function run(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${path.basename(bin)}: ${String(stderr || err.message).slice(-600)}`));
      else resolve(String(stdout || ''));
    });
  });
}

async function probe(file) {
  const out = await run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', file]);
  const [w, h, d] = out.trim().split('\n');
  return { width: Number(w) || null, height: Number(h) || null, duration: Number(d) || 0 };
}

/**
 * @param {object} input
 *   source      the talking head on disk
 *   placements  [{ from, to, file }] in seconds, already approved
 *   outPath     where to write
 *
 * Each placement is clamped to the clip it uses: a three-second cutaway cannot
 * cover five seconds of speech, and looping it would read as a glitch rather
 * than as an edit. The returned placements say what was actually used, so the
 * screen can show the operator where it differed from what they asked for.
 */
async function overlay({ source, placements, outPath }) {
  if (!fs.existsSync(source)) throw new Error('That clip could not be found on disk.');
  const list = (Array.isArray(placements) ? placements : [])
    .map((p) => ({ from: Number(p.from), to: Number(p.to), file: p.file }))
    .filter((p) => p.file && Number.isFinite(p.from) && Number.isFinite(p.to) && p.to > p.from)
    .sort((a, b) => a.from - b.from);
  if (!list.length) throw new Error('No b-roll was chosen, so there is nothing to lay over.');
  if (list.length > MAX_PLACEMENTS) {
    throw new Error(`That is ${list.length} cutaways. ${MAX_PLACEMENTS} is the most this renders in one pass.`);
  }

  const base = await probe(source);
  const W = base.width || 1080;
  const H = base.height || 1920;

  const used = [];
  const inputs = ['-i', source];
  const filters = [];
  let chain = '[0:v]';

  for (let i = 0; i < list.length; i += 1) {
    const p = list[i];
    if (!fs.existsSync(p.file)) throw new Error('One of the chosen clips is no longer on disk.');
    const clip = await probe(p.file);
    // Clamped, never looped. The operator sees what was actually used.
    const span = Math.min(p.to - p.from, clip.duration || (p.to - p.from));
    if (span < 0.3) continue;
    const to = p.from + span;

    inputs.push('-i', p.file);
    const n = inputs.filter((a) => a === '-i').length - 1;   // this input's index
    // Fill the frame rather than letterbox, the same way the editor reframes,
    // then shift the clip's timeline so it starts when the cutaway starts.
    filters.push(
      `[${n}:v]trim=duration=${span.toFixed(3)},setpts=PTS-STARTPTS,`
      + `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,`
      + `setpts=PTS+${p.from.toFixed(3)}/TB[b${i}]`);
    const out = `v${i}`;
    filters.push(
      `${chain}[b${i}]overlay=enable='between(t,${p.from.toFixed(3)},${to.toFixed(3)})':`
      // eof_action=pass is belt and braces: the span is already clamped to the
      // clip's own length, so the overlay should never outlive its input. It
      // costs nothing and decides the boundary frame if it ever does.
      + `eof_action=pass:shortest=0[${out}]`);
    chain = `[${out}]`;
    used.push({ from: +p.from.toFixed(2), to: +to.toFixed(2),
      requested_to: +p.to.toFixed(2), clipped: to < p.to - 0.05 });
  }
  if (!used.length) throw new Error('None of the chosen clips are long enough to use.');

  await run(FFMPEG, ['-y', '-loglevel', 'error', ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', chain, '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'copy', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outPath]);

  const out = await probe(outPath);
  return { outPath, seconds: +out.duration.toFixed(2), placements: used,
    bytes: fs.statSync(outPath).size };
}

module.exports = { overlay, probe, MAX_PLACEMENTS };
