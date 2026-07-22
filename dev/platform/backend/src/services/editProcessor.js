// Edit studio processor — runs the guided edits with ffmpeg (+ Whisper for
// captions). Drains edit_jobs inline, like swipeProcessor. All three jobs the AM
// uses:
//   • trim        — cut to [start,end]
//   • clean audio — ffmpeg denoise (afftdn) + rumble highpass + loudness normalise
//   • captions    — Whisper → .srt, burned onto the video and offered as a file
//
// Everything runs server-side with ffmpeg; no footage leaves October's box.
// Gated on ffmpeg being installed (+ an OpenAI key only when captions are asked).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const editJobs = require('./editJobs');
const { recordApiCost } = require('./costLog');
const { getSetting } = require('../utils/settings');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const WHISPER_USD_PER_MIN = 0.006;
let _running = false;

function run(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    let p;
    try { p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts }); }
    catch (e) { return reject(e); }
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve(out) : reject(new Error(`${path.basename(bin)} exited ${code}: ${(err || out).trim().slice(-400)}`)));
  });
}

// Probe duration (s) + dimensions. Best-effort — returns nulls on failure.
async function probe(file) {
  try {
    const out = await run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'format=duration:stream=width,height', '-of', 'json', file]);
    const j = JSON.parse(out);
    return {
      duration: j.format?.duration ? Number(j.format.duration) : null,
      width: j.streams?.[0]?.width || null,
      height: j.streams?.[0]?.height || null,
    };
  } catch { return { duration: null, width: null, height: null }; }
}

// ASS style string for the burned-in captions. Big, bold, white with a black
// outline, near the bottom — the readable social-caption look.
function captionStyle(style = {}) {
  const size = ({ small: 18, medium: 24, large: 30 })[style.size] || 24;
  const parts = [
    'FontName=Arial', 'Bold=1', `FontSize=${size}`,
    'PrimaryColour=&H00FFFFFF', 'OutlineColour=&H00000000', 'BackColour=&H80000000',
    'BorderStyle=1', 'Outline=2', 'Shadow=1', 'Alignment=2', 'MarginV=48',
  ];
  return parts.join(',');
}

async function whisperSrt(audioPath, apiKey) {
  const buf = fs.readFileSync(audioPath);
  const form = new FormData();
  form.append('file', new Blob([buf]), 'audio.mp3');
  form.append('model', process.env.WHISPER_MODEL || 'whisper-1');
  form.append('response_format', 'srt');   // OpenAI returns ready-to-use SRT
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form,
  });
  if (!res.ok) throw new Error(`Whisper ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.text()).trim();
}

// Render one job. Returns { outputPath, srtPath|null, durationS }.
async function render(srcPath, ops, work, apiKey) {
  const trim = ops.trim || null;
  const cleanAudio = !!ops.clean_audio;
  const captions = !!ops.captions;

  const hasTrim = trim && (Number(trim.start) > 0 || Number(trim.end) > 0);
  const start = hasTrim ? Math.max(0, Number(trim.start) || 0) : 0;
  const end = hasTrim ? Number(trim.end) || 0 : 0;

  // Pass 1 — trim and/or clean audio into base.mp4. If neither is requested we
  // still normalise the container to mp4 so the caption burn is predictable.
  const base = path.join(work, 'base.mp4');
  const a1 = ['-y'];
  if (start > 0) a1.push('-ss', String(start));
  a1.push('-i', srcPath);
  if (end > start) a1.push('-t', String(Math.max(0.1, end - start)));   // -t duration is seek-safe
  const af = [];
  if (cleanAudio) af.push('afftdn=nf=-25', 'highpass=f=80', 'loudnorm=I=-16:TP=-1.5:LRA=11');
  if (af.length) a1.push('-af', af.join(','));
  a1.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', base);
  await run(FFMPEG, a1);

  const meta = await probe(base);
  const durationS = meta.duration || 0;

  if (!captions) return { outputPath: base, srtPath: null, durationS };

  // Pass 2 — captions. Extract audio → Whisper SRT → burn onto the video.
  if (!apiKey) throw new Error('Auto-captions need an OpenAI key — set OPENAI_API_KEY in Settings → AI.');
  const audio = path.join(work, 'audio.mp3');
  await run(FFMPEG, ['-y', '-i', base, '-vn', '-ac', '1', '-ar', '16000', '-f', 'mp3', audio]);
  const srt = await whisperSrt(audio, apiKey);
  if (!srt) return { outputPath: base, srtPath: null, durationS };   // no speech → skip burn

  // Write the .srt in the work dir and run ffmpeg with cwd=work so the subtitles
  // filter can reference it by bare name (avoids filter-path escaping headaches).
  fs.writeFileSync(path.join(work, 'subs.srt'), srt);
  const final = path.join(work, 'captioned.mp4');
  await run(FFMPEG, ['-y', '-i', base,
    '-vf', `subtitles=subs.srt:force_style='${captionStyle(ops.caption_style)}'`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'copy', '-movflags', '+faststart', final], { cwd: work });
  return { outputPath: final, srtPath: path.join(work, 'subs.srt'), durationS };
}

async function processOne(job) {
  const srcPath = editJobs.diskPathForUrl(job.source_url);
  if (!srcPath || !fs.existsSync(srcPath)) { await editJobs.fail(job.id, 'Source video is missing on disk.'); return; }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `edit-${job.id}-`));
  try {
    const apiKey = (await getSetting('OPENAI_API_KEY')) || process.env.OPENAI_API_KEY;
    const { outputPath, srtPath, durationS } = await render(srcPath, job.ops || {}, work, apiKey);

    const outputUrl = editJobs.adoptFile(job.client_id, outputPath, '.mp4');
    const srtUrl = srtPath ? editJobs.adoptFile(job.client_id, srtPath, '.srt') : null;

    let costUsd = 0;
    if (job.ops?.captions && durationS) {
      costUsd = +((durationS / 60) * WHISPER_USD_PER_MIN).toFixed(4);
      recordApiCost({ provider: 'openai', feature: 'edit_captions', costUsd, clientId: job.client_id, meta: { model: 'whisper-1', duration_s: Math.round(durationS) } });
    }
    await editJobs.complete(job.id, { outputUrl, srtUrl, costUsd });
    console.log(`[edit] ✓ job ${job.id} done (${Math.round(durationS)}s)`);
  } catch (err) {
    console.error(`[edit] ✗ job ${job.id}: ${err.message}`);
    await editJobs.fail(job.id, friendlyError(err.message)).catch(() => {});
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function friendlyError(raw) {
  const m = String(raw || '').toLowerCase();
  if (/enoent|ffmpeg exited 127|spawn ffmpeg/.test(m)) return 'The video tools (ffmpeg) aren’t available on the server. Contact the admin.';
  if (/openai key|whisper 401|whisper 4/.test(m)) return 'Auto-captions failed — check the OpenAI key in Settings → AI.';
  if (/invalid data|does not contain|moov atom|could not find codec/.test(m)) return 'Couldn’t read this video file — try a standard MP4/MOV export.';
  return 'Couldn’t process this video. ' + String(raw || '').replace(/\s+/g, ' ').slice(0, 160);
}

async function processQueue() {
  if (_running) return;
  _running = true;
  try {
    for (let i = 0; i < 10; i++) {
      const job = await editJobs.claimNext('platform-inline');
      if (!job) break;
      await processOne(job);
    }
  } catch (e) {
    console.error('[edit] queue error:', e.message);
  } finally {
    _running = false;
  }
}

function kick() { processQueue().catch(() => {}); }

module.exports = { processQueue, kick, probe };
