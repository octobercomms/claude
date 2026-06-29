// ffmpeg / ffprobe helpers. Thin wrappers around child_process with the binary
// paths from config. Stages compose these; nothing here knows about the queue.

const { spawn } = require('child_process');
const { config } = require('./config');

// Run a binary, capture stderr (ffmpeg writes progress there), resolve on exit 0.
function run(bin, args, { capture = 'stderr' } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => {
      if (code === 0) resolve(capture === 'stdout' ? out : err);
      else reject(new Error(`${bin} exited ${code}: ${(err || out).slice(-800)}`));
    });
  });
}

const ffmpeg = (args) => run(config.ffmpeg, ['-hide_banner', '-y', ...args]);

// ffprobe → { duration, width, height }.
async function probe(file) {
  const json = await run(config.ffprobe, [
    '-v', 'error', '-print_format', 'json',
    '-show_entries', 'format=duration:stream=width,height,codec_type',
    file,
  ], { capture: 'stdout' });
  const data = JSON.parse(json);
  const v = (data.streams || []).find(s => s.codec_type === 'video') || {};
  return {
    duration_s: data.format?.duration ? Number(data.format.duration) : null,
    width: v.width || null,
    height: v.height || null,
  };
}

// Detect silent spans via the silencedetect filter → [{start, end}].
async function detectSilence(file, db = config.silenceDb, minS = config.silenceMinS) {
  const log = await ffmpeg(['-i', file, '-af', `silencedetect=noise=${db}dB:d=${minS}`, '-f', 'null', '-']);
  const spans = [];
  let start = null;
  for (const line of log.split('\n')) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    const e = line.match(/silence_end:\s*(-?[\d.]+)/);
    if (s) start = Number(s[1]);
    if (e && start != null) { spans.push({ start: Math.max(0, start), end: Number(e[1]) }); start = null; }
  }
  return spans;
}

// Detect black spans via the blackdetect filter → [{start, end}]. Used by the
// post-render QC gate to catch broken/blank masters before delivery.
async function detectBlack(file, minS = 0.1, pixTh = 0.10) {
  const log = await ffmpeg(['-i', file, '-vf', `blackdetect=d=${minS}:pix_th=${pixTh}`, '-an', '-f', 'null', '-']);
  const spans = [];
  for (const line of log.split('\n')) {
    const m = line.match(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/);
    if (m) spans.push({ start: Number(m[1]), end: Number(m[2]) });
  }
  return spans;
}

// Invert silent spans into the spoken/kept segments to retain. `aggressive`
// shrinks the kept windows a touch (used by the grade re-edit loop to tighten).
function keptSegments(duration, silences, aggressive = 0) {
  const pad = 0.08 - aggressive * 0.04; // smaller pad = tighter cut on re-edits
  const kept = [];
  let cursor = 0;
  for (const s of silences) {
    const segEnd = Math.max(cursor, s.start + pad);
    if (segEnd - cursor > 0.25) kept.push({ start: cursor, end: segEnd });
    cursor = Math.max(cursor, s.end - pad);
  }
  if (duration - cursor > 0.25) kept.push({ start: cursor, end: duration });
  return kept;
}

module.exports = { run, ffmpeg, probe, detectSilence, detectBlack, keptSegments };
