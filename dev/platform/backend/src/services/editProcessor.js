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
const stillsReel = require('./stillsReel');
const { recordApiCost } = require('./costLog');
const { getSetting } = require('../utils/settings');
// captions is required lazily where it is used: it reaches back into this
// module for whisperWords, and requiring it at the top leaves a half-built
// module object whose functions are all undefined.

const { pathToFileURL } = require('url');

const { FFMPEG, FFPROBE } = require('./ffmpegBin');
const WHISPER_USD_PER_MIN = 0.006;

// The edit decision list, shared with the timeline surface so the model is
// defined once. ESM from CommonJS, so it loads on first use like the other
// shared modules.
const SHARED = path.join(__dirname, '..', '..', '..', 'shared');
let _edl = null;
async function edlMod() {
  if (!_edl) _edl = await import(pathToFileURL(path.join(SHARED, 'edl.mjs')).href);
  return _edl;
}
let _workers = 0;

/**
 * How many edits render at once.
 *
 * One was the old answer, and it meant a twenty-second trim sat behind a
 * five-minute timeline render with nothing on screen to explain the wait. Two
 * is deliberately modest: ffmpeg at `-preset veryfast` already uses several
 * cores, so a third concurrent render mostly takes time from the other two
 * rather than adding throughput, and the box also serves the app.
 */
const MAX_WORKERS = Math.max(1, Math.min(4, Number(process.env.EDIT_WORKERS) || 2));

/**
 * The processes each job currently owns, so a cancel can end them.
 *
 * A render is several ffmpeg invocations in sequence, and a cancel has to stop
 * whichever one is running now. Killing by pid from outside would race with the
 * next one starting, so the processor keeps the registry itself and the cancel
 * route asks it. A job also carries a `cancelled` flag, checked between passes:
 * killing the current ffmpeg is not enough on its own, because the loop would
 * otherwise start the next cut a millisecond later.
 */
const _live = new Map();        // jobId -> Set<ChildProcess>
const _cancelled = new Set();   // jobIds asked to stop

function register(jobId, child) {
  if (!jobId) return;
  if (!_live.has(jobId)) _live.set(jobId, new Set());
  _live.get(jobId).add(child);
}

function unregister(jobId, child) {
  const set = _live.get(jobId);
  if (!set) return;
  set.delete(child);
  if (!set.size) _live.delete(jobId);
}

/**
 * Stop a render now. Returns whether anything was actually running.
 *
 * SIGKILL rather than SIGTERM: ffmpeg handles SIGTERM by trying to finalise
 * the output file, which on a long render means the cancel appears to do
 * nothing for several seconds. The output is being thrown away either way.
 */
function cancel(jobId) {
  _cancelled.add(jobId);
  const set = _live.get(jobId);
  if (!set || !set.size) return false;
  for (const child of set) {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
  return true;
}

function isCancelled(jobId) { return _cancelled.has(jobId); }

// Called when a job leaves processing, so the flag cannot outlive the job and
// stop a later retry of the same row before it starts.
function clearCancel(jobId) { _cancelled.delete(jobId); _live.delete(jobId); }

class Cancelled extends Error {
  constructor() { super('Cancelled'); this.name = 'Cancelled'; }
}

/**
 * Run a binary.
 *
 * `jobId` registers the process so a cancel can kill it. `onProgress` turns on
 * ffmpeg's own machine-readable progress stream and calls back with the output
 * position in seconds; it is only meaningful for ffmpeg, so callers pass it
 * only there.
 */
function run(bin, args, opts = {}) {
  const { jobId = null, onProgress = null, ...spawnOpts } = opts;
  const argv = onProgress
    // `-progress pipe:1` writes key=value lines to stdout; `-nostats` stops the
    // same information being written to stderr in a form meant for a terminal.
    // Both go before the rest so they apply to the whole invocation.
    ? ['-progress', 'pipe:1', '-nostats', ...args]
    : args;
  return new Promise((resolve, reject) => {
    let p;
    try { p = spawn(bin, argv, { stdio: ['ignore', 'pipe', 'pipe'], ...spawnOpts }); }
    catch (e) { return reject(e); }
    register(jobId, p);
    let out = '', err = '', tail = '';
    p.stdout.on('data', (d) => {
      const s = String(d);
      out += s;
      if (!onProgress) return;
      // A chunk can split a line, so the remainder is carried over. Without
      // this, a progress line arriving in two reads is dropped, which on a
      // long render shows up as a bar that stalls and then jumps.
      tail += s;
      const lines = tail.split('\n');
      tail = lines.pop() || '';
      for (const line of lines) {
        const m = /^out_time_us=(\d+)/.exec(line) || /^out_time_ms=(\d+)/.exec(line);
        // ffmpeg's `out_time_ms` is a misnomer: it is microseconds, and has
        // been for years. Both keys are read, both divided by a million, which
        // is right for the real units whichever name this build uses.
        if (m) onProgress(Number(m[1]) / 1e6);
      }
    });
    p.stderr.on('data', d => { err += d; });
    p.on('error', (e) => { unregister(jobId, p); reject(e); });
    p.on('close', (code, signal) => {
      unregister(jobId, p);
      if (code === 0) return resolve(out);
      // A process we killed is a cancellation, not a failure. Without this the
      // job would be marked failed with an ffmpeg signal in the error field,
      // and the operator who pressed Cancel would be told their edit broke.
      if (signal === 'SIGKILL' && isCancelled(jobId)) return reject(new Cancelled());
      reject(new Error(`${path.basename(bin)} exited ${code}: ${(err || out).trim().slice(-400)}`));
    });
  });
}

/**
 * Render progress, as something an operator can check.
 *
 * A bare percentage on a multi-pass render is a number nobody can verify, so
 * every update carries a stage: "cutting block 3 of 7" can be checked against
 * the timeline on screen, and "41%" cannot. The percentage exists to move, the
 * stage exists to be believed.
 *
 * The weights below are estimates and are labelled as such. Assembling is the
 * expensive part of a timeline render because every block is re-encoded;
 * captions are a network call with no progress of their own, so they get a
 * slice at the end rather than a bar that sits at 99%.
 *
 * Writes are throttled: a render emitting progress every frame would be a few
 * hundred UPDATEs a second against a row nobody is reading that fast.
 */
const PHASES = { assemble: [0, 55], render: [55, 90], captions: [90, 100] };
const WRITE_EVERY_MS = 1200;

/**
 * A phase and a fraction within it, as one percentage. Pure and exported so
 * the weights are testable: the whole point of the number is that it only ever
 * goes forward, and a phase boundary off by a few points makes a bar that
 * jumps backwards between passes.
 */
function phasePercent(phase, fraction) {
  const [from, to] = PHASES[phase] || [0, 100];
  const f = Number.isFinite(Number(fraction)) ? Math.max(0, Math.min(1, Number(fraction))) : 0;
  return Math.max(0, Math.min(100, Math.round(from + (to - from) * f)));
}

function makeProgress(jobId) {
  let last = 0;
  let lastPct = -1;
  const write = (pct, stage) => {
    const now = Date.now();
    const rounded = Math.max(0, Math.min(100, Math.round(pct)));
    // Always let 100 through, and always the first update, so the bar starts
    // and finishes even on a render short enough to fit inside one window.
    if (rounded === lastPct) return;
    if (rounded < 100 && lastPct >= 0 && now - last < WRITE_EVERY_MS) return;
    last = now;
    lastPct = rounded;
    editJobs.setProgress(jobId, rounded, stage).catch(() => {});
  };
  return {
    /** `fraction` is 0 to 1 within the phase. */
    at(phase, fraction, stage) { write(phasePercent(phase, fraction), stage); },
    stage(phase, stage) { this.at(phase, 0, stage); },
  };
}

const NO_PROGRESS = { at() {}, stage() {} };

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

// Target dimensions per aspect ratio. `original` (or unknown) → no reframe.
const ASPECTS = { '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] };

/**
 * Which caption format a rendered frame is, by its actual shape.
 *
 * Chosen from the output's real dimensions rather than the requested aspect,
 * for two reasons: "original" requests have no declared aspect at all, and a
 * template designed against a 1080x1920 canvas sits wrong on a square frame.
 * libass scales the ASS canvas to the video, so matching the ratio is what
 * matters and matching the exact pixel size is not.
 */
function captionFormatFor(width, height) {
  const formats = require('./captions').formats();
  const ratio = (width && height) ? width / height : 9 / 16;
  let best = 'vertical';
  let bestGap = Infinity;
  for (const f of Object.values(formats)) {
    const gap = Math.abs((f.width / f.height) - ratio);
    if (gap < bestGap) { bestGap = gap; best = f.id; }
  }
  return best;
}

/**
 * An SRT built from word timings.
 *
 * The template path burns an ASS, which is internal to the render and thrown
 * away. The .srt beside the video is a deliverable an operator uploads to
 * YouTube or hands to a client, and a template render that silently stopped
 * producing one would be a quiet loss of something that already worked.
 */
function srtFromWords(words, perLine = 7) {
  const stamp = (t) => {
    const ms = Math.max(0, Math.round(t * 1000));
    const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
    const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
    const sec = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
    return `${h}:${m}:${sec},${String(ms % 1000).padStart(3, '0')}`;
  };
  const lines = [];
  for (let i = 0; i < words.length; i += perLine) lines.push(words.slice(i, i + perLine));
  return lines.map((g, i) =>
    `${i + 1}\n${stamp(g[0].start)} --> ${stamp(g[g.length - 1].end)}\n`
    + `${g.map((w) => w.word).join(' ').trim()}\n`).join('\n');
}

// Caption vertical margin: pos 0 (bottom) → 1 (top), in the 288-tall ASS canvas.
// Kept in sync with the front-end preview (marginVFor).
function marginVFor(pos) {
  return Math.round(Math.min(250, Math.max(40, 40 + (Number(pos) || 0) * 200)));
}

// ASS style string for the burned-in captions. Big, bold, white with a black
// outline — the readable social-caption look; vertical position from style.pos.
function captionStyle(style = {}) {
  const size = ({ small: 18, medium: 24, large: 30 })[style.size] || 24;
  const parts = [
    'FontName=Arial', 'Bold=1', `FontSize=${size}`,
    'PrimaryColour=&H00FFFFFF', 'OutlineColour=&H00000000', 'BackColour=&H80000000',
    'BorderStyle=1', 'Outline=2', 'Shadow=1', 'Alignment=2',
    // Side margins (ASS 384-wide canvas ≈ 16%) keep long captions off the
    // right-hand action rail; MarginV is the vertical position.
    'MarginL=60', 'MarginR=60', `MarginV=${marginVFor(style.pos)}`,
  ];
  return parts.join(',');
}

async function hasAudioStream(file) {
  try {
    const out = await run(FFPROBE, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]);
    return out.trim().length > 0;
  } catch { return false; }
}

// Combine several clips into one video. Each clip is normalised to the FIRST
// clip's dimensions (scaled to fit + letterboxed) with a uniform codec/fps/audio,
// then the segments are concatenated (stream copy). Clips with no audio get a
// silent track so the concat stays in sync.
async function combineClips(clipPaths, work, ctx = {}) {
  const { jobId = null, prog = NO_PROGRESS } = ctx;
  const first = await probe(clipPaths[0]);
  const W = first.width || 1080, H = first.height || 1920;
  const segs = [];
  for (let i = 0; i < clipPaths.length; i++) {
    const seg = path.join(work, `seg${i}.mp4`);
    const audio = await hasAudioStream(clipPaths[i]);
    const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p`;
    const args = ['-y', '-i', clipPaths[i]];
    if (!audio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
    args.push('-map', '0:v:0', '-map', audio ? '0:a:0?' : '1:a:0');
    if (!audio) args.push('-shortest');
    args.push('-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ar', '48000', '-b:a', '160k', '-video_track_timescale', '30000', seg);
    if (isCancelled(jobId)) throw new Cancelled();
    const clipLen = (await probe(clipPaths[i])).duration || null;
    await run(FFMPEG, args, {
      jobId,
      onProgress: (sec) => prog.at('assemble',
        (i + (clipLen ? Math.min(1, sec / clipLen) : 0)) / clipPaths.length,
        `Matching clip ${i + 1} of ${clipPaths.length}`),
    });
    segs.push(seg);
  }
  const list = path.join(work, 'concat.txt');
  fs.writeFileSync(list, segs.map(s => `file '${s.replace(/'/g, "'\\''")}'`).join('\n'));
  const combined = path.join(work, 'combined.mp4');
  prog.stage('assemble', 'Joining the clips');
  await run(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy',
    '-movflags', '+faststart', combined], { jobId });
  return combined;
}

// Keep several ranges of one clip and join them in order (multi-cut). Each range
// is re-encoded to uniform params, then concatenated (stream copy).
async function cutSegments(srcPath, segments, work, ctx = {}) {
  const { jobId = null, prog = NO_PROGRESS } = ctx;
  const meta = await probe(srcPath);
  const W = meta.width || 1080, H = meta.height || 1920;
  const audio = await hasAudioStream(srcPath);
  const segs = [];
  for (const s of segments) {
    const start = Math.max(0, Number(s.start) || 0);
    const end = Number(s.end) || 0;
    if (!(end > start)) continue;
    const seg = path.join(work, `cut${segs.length}.mp4`);
    const a = ['-y'];
    if (start > 0) a.push('-ss', String(start));
    a.push('-i', srcPath, '-t', String(Math.max(0.05, end - start)));
    if (!audio) a.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest', '-map', '0:v:0', '-map', '1:a:0');
    a.push('-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ar', '48000', '-b:a', '160k', '-video_track_timescale', '30000', seg);
    if (isCancelled(jobId)) throw new Cancelled();
    const want = end - start;
    const done = segs.length;
    await run(FFMPEG, a, {
      jobId,
      onProgress: (sec) => prog.at('assemble',
        (done + (want > 0 ? Math.min(1, sec / want) : 0)) / segments.length,
        `Cutting ${done + 1} of ${segments.length}`),
    });
    segs.push(seg);
  }
  if (!segs.length) return srcPath;
  if (segs.length === 1) return segs[0];
  const list = path.join(work, 'cuts.txt');
  fs.writeFileSync(list, segs.map(s => `file '${s.replace(/'/g, "'\\''")}'`).join('\n'));
  const out = path.join(work, 'cutjoined.mp4');
  prog.stage('assemble', 'Joining the cuts');
  await run(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy',
    '-movflags', '+faststart', out], { jobId });
  return out;
}

/**
 * Render an edit decision list: each entry a range of one clip, cut and
 * normalised, then concatenated in order.
 *
 * This is `cutSegments` generalised from one source to many, which is the one
 * real capability gap on the Edit page: until now a multi-cut only worked when
 * there was exactly one clip (`segs && segs.length && paths.length === 1`).
 *
 * The spec expected this part to need a single ffmpeg filter graph, and for
 * transitions it will. Plain cuts do not: normalise each cut to common
 * parameters and the existing stream-copy concat joins them, which is the path
 * `combineClips` already proves against real client footage. The hard part the
 * spec named, inputs that differ in resolution, frame rate, pixel format or
 * rotation, is handled by that same normalisation rather than avoided.
 *
 * `clipPaths` is indexed to match the job's `clips`, with null where a source
 * is missing from disk, so an EDL's clip indices stay meaningful.
 */
async function cutEdl(clipPaths, segments, work, ctx = {}) {
  const { jobId = null, prog = NO_PROGRESS } = ctx;
  const firstPath = clipPaths.find((p) => p);
  if (!firstPath) throw new Error('None of the clips in this edit are on disk.');
  const first = await probe(firstPath);
  const W = first.width || 1080, H = first.height || 1920;
  const outs = [];
  for (const seg of segments) {
    const src = clipPaths[seg.clip];
    if (!src) continue;                       // source gone; the cut goes with it
    const start = Math.max(0, Number(seg.start) || 0);
    const end = seg.end == null ? null : Number(seg.end);
    if (end != null && !(end > start)) continue;
    const audio = await hasAudioStream(src);
    const gain = Number(seg.gain);
    const dst = path.join(work, `edl${outs.length}.mp4`);
    const a = ['-y'];
    if (start > 0) a.push('-ss', String(start));
    a.push('-i', src);
    if (end != null) a.push('-t', String(Math.max(0.05, end - start)));
    if (!audio) a.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest',
      '-map', '0:v:0', '-map', '1:a:0');
    a.push('-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30`);
    // Per-block volume. The model carries gain whether or not it is applied,
    // so applying it here is what stops the surface promising something the
    // render ignores.
    if (Number.isFinite(gain) && gain >= 0 && Math.abs(gain - 1) > 0.001) {
      a.push('-af', `volume=${gain.toFixed(3)}`);
    }
    a.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ar', '48000', '-b:a', '160k', '-video_track_timescale', '30000', dst);
    if (isCancelled(jobId)) throw new Cancelled();
    const want = end == null ? null : end - start;
    const done = outs.length;
    await run(FFMPEG, a, {
      jobId,
      onProgress: (sec) => prog.at('assemble',
        (done + (want ? Math.min(1, sec / want) : 0)) / segments.length,
        `Cutting block ${done + 1} of ${segments.length}`),
    });
    outs.push(dst);
  }
  if (!outs.length) throw new Error('This edit has no cuts long enough to render.');
  if (outs.length === 1) return outs[0];
  const list = path.join(work, 'edl.txt');
  fs.writeFileSync(list, outs.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  const joined = path.join(work, 'edljoined.mp4');
  prog.stage('assemble', `Joining ${outs.length} blocks`);
  await run(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy',
    '-movflags', '+faststart', joined], { jobId });
  return joined;
}

// Download a remote clip (fal CDN) to disk.
async function downloadTo(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Clip download failed (${res.status}).`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

// Stills → Reel: animate each still (fal image-to-video), download the clip,
// trim it to a beat and reframe to the target aspect (crop-to-fill), then stitch
// the beats into one reel with the existing combineClips path. Returns the
// combined reel path + total fal spend.
async function buildStillsReel(job, work) {
  const spec = job.ops?.stills_reel || {};
  const aspect = ASPECTS[spec.aspect] ? spec.aspect : '9:16';
  const [W, H] = ASPECTS[aspect];
  const perClip = Math.min(4, Math.max(0.6, Number(spec.per_clip_seconds) || 1.2));
  const stills = (Array.isArray(job.clips) && job.clips.length) ? job.clips : [];

  const beats = [];
  let cost = 0;
  for (let i = 0; i < stills.length; i++) {
    const st = stills[i];
    const disk = st.url && editJobs.diskPathForUrl(st.url);
    if (!disk || !fs.existsSync(disk)) continue;
    const { url, cost: c } = await stillsReel.animate({
      diskPath: disk, motion: st.motion || spec.motion, model: spec.model, clientId: job.client_id,
    });
    cost += c || 0;
    const raw = path.join(work, `anim${i}.mp4`);
    await downloadTo(url, raw);
    // Trim to the beat length and reframe to a uniform 9:16 (or chosen) fill so
    // every beat is the same shape before the concat.
    const beat = path.join(work, `beat${i}.mp4`);
    await run(FFMPEG, ['-y', '-i', raw, '-t', String(perClip),
      '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30`,
      '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', beat]);
    beats.push(beat);
  }
  if (!beats.length) throw new Error('None of the stills could be animated into clips.');
  const reel = beats.length > 1 ? await combineClips(beats, work) : beats[0];
  return { reel, cost: +cost.toFixed(4), clipCount: beats.length };
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

/**
 * The same transcription, asked for per WORD rather than per segment.
 *
 * A segment is a phrase and lands a caption on a phrase. Everything the
 * template library does — a word changing colour, a box landing under the word
 * being said — needs the word. One extra parameter, a different response
 * format, same call and same bill.
 *
 * Returns [{ word, start, end }] in seconds, which is the shape
 * shared/captions/compile.mjs takes.
 */
async function whisperWords(audioPath, apiKey) {
  const buf = fs.readFileSync(audioPath);
  const form = new FormData();
  form.append('file', new Blob([buf]), 'audio.mp3');
  form.append('model', process.env.WHISPER_MODEL || 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form,
  });
  if (!res.ok) throw new Error(`Whisper ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const words = Array.isArray(body.words) ? body.words : [];
  // Not every model returns the word array even when asked. Saying so beats
  // returning an empty transcript that renders as a video with no captions.
  if (!words.length) {
    throw new Error('Whisper returned no word timings. The model set in WHISPER_MODEL '
      + 'may not support timestamp_granularities.');
  }
  return words
    .map((w) => ({ word: String(w.word ?? '').trim(), start: Number(w.start), end: Number(w.end) }))
    .filter((w) => w.word && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start);
}

// Render one job. Returns { outputPath, srtPath|null, durationS }.
/** The client's brand assets, as captions.kitFromAssets expects them. */
async function brandRowsFor(clientId) {
  const pool = require('../db');
  const { rows } = await pool.query(
    `SELECT kind, name, metadata FROM brand_assets
      WHERE client_id = $1 AND kind IN ('font', 'palette')`, [clientId]);
  return rows;
}

/**
 * @param deps test seam. The transcription is the one step in this pipeline
 * that costs money and needs a network, and leaving it un-injectable would
 * mean the template path could only ever be tested by paying for it, which in
 * practice means not testing it.
 */
async function render(srcPath, ops, work, apiKey, clientId = null, deps = {}, ctx = {}) {
  const { jobId = null, prog = NO_PROGRESS } = ctx;
  const transcribeWords = deps.whisperWords || whisperWords;
  const transcribeSrt = deps.whisperSrt || whisperSrt;
  const brandRows = deps.brandRowsFor || brandRowsFor;
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
  // Reframe to a target aspect by filling the frame (scale to cover + centre
  // crop) — matches how CapCut reframes, no black bars.
  const ar = ASPECTS[ops.aspect];
  if (ar) {
    const [W, H] = ar;
    a1.push('-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`);
  }
  a1.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', base);
  if (isCancelled(jobId)) throw new Cancelled();
  const srcLen = (await probe(srcPath)).duration || null;
  prog.stage('render', 'Rendering the video');
  await run(FFMPEG, a1, {
    jobId,
    onProgress: (sec) => prog.at('render', srcLen ? Math.min(1, sec / srcLen) * 0.9 : 0,
      'Rendering the video'),
  });

  const meta = await probe(base);
  const durationS = meta.duration || 0;

  if (!captions) return { outputPath: base, srtPath: null, durationS };

  // Pass 2 — captions. Extract audio → Whisper → burn onto the video.
  if (!apiKey) throw new Error('Auto-captions need an OpenAI key — set OPENAI_API_KEY in Settings → AI.');
  const audio = path.join(work, 'audio.mp3');
  if (isCancelled(jobId)) throw new Cancelled();
  prog.stage('captions', 'Pulling the audio out');
  await run(FFMPEG, ['-y', '-i', base, '-vn', '-ac', '1', '-ar', '16000', '-f', 'mp3', audio],
    { jobId });
  prog.stage('captions', 'Transcribing');

  // A chosen template takes the word-timed path: the same single Whisper call,
  // asked for per word rather than per segment, compiled to ASS by the shared
  // compiler that Shared's renders already use. One compiler, so a template
  // cannot look like one thing in Produce and another in Shared.
  //
  // The size and position controls do not apply here and the screen hides
  // them: a template that let its type size be overridden would stop meaning
  // the same thing on every account, which is the whole reason the library
  // exists.
  if (ops.caption_template) {
    const captions = require('./captions');
    captions.preset(ops.caption_template);          // refuse an unknown template early
    const timed = await transcribeWords(audio, apiKey);
    if (!timed.length) return { outputPath: base, srtPath: null, durationS };

    const kitRows = clientId ? await brandRows(clientId) : [];
    const kit = captions.kitFromAssets(kitRows);
    const formatId = captionFormatFor(meta.width, meta.height);
    const final = path.join(work, 'captioned.mp4');
    if (isCancelled(jobId)) throw new Cancelled();
    prog.at('captions', 0.6, 'Burning the captions on');
    await captions.burn({ words: timed, templateId: ops.caption_template, kit,
      formatId, source: base, outPath: final });

    const srtPath = path.join(work, 'subs.srt');
    fs.writeFileSync(srtPath, srtFromWords(timed));
    return { outputPath: final, srtPath, durationS, words: timed, formatId };
  }

  const srt = await transcribeSrt(audio, apiKey);
  if (!srt) return { outputPath: base, srtPath: null, durationS };   // no speech → skip burn

  // Write the .srt in the work dir and run ffmpeg with cwd=work so the subtitles
  // filter can reference it by bare name (avoids filter-path escaping headaches).
  fs.writeFileSync(path.join(work, 'subs.srt'), srt);
  const final = path.join(work, 'captioned.mp4');
  if (isCancelled(jobId)) throw new Cancelled();
  prog.at('captions', 0.6, 'Burning the captions on');
  await run(FFMPEG, ['-y', '-i', base,
    '-vf', `subtitles=subs.srt:force_style='${captionStyle(ops.caption_style)}'`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'copy', '-movflags', '+faststart', final], { cwd: work });
  return { outputPath: final, srtPath: path.join(work, 'subs.srt'), durationS };
}

async function processOne(job) {
  const clips = (Array.isArray(job.clips) && job.clips.length) ? job.clips : [{ url: job.source_url }];
  // Indexed to match `clips`, with null where a source has gone from disk. An
  // EDL's entries name clips by index, so compacting this array would shift
  // every cut after a missing clip onto the wrong footage.
  const clipPaths = clips.map((c) => {
    const p = c.url && editJobs.diskPathForUrl(c.url);
    return (p && fs.existsSync(p)) ? p : null;
  });
  const paths = clipPaths.filter(Boolean);
  if (!paths.length) { await editJobs.fail(job.id, 'Source video is missing on disk.'); return; }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `edit-${job.id}-`));
  const prog = makeProgress(job.id);
  const ctx = { jobId: job.id, prog };
  prog.stage('assemble', 'Starting');
  try {
    // Stills → Reel jobs carry still images (not video) in clips and an
    // ops.stills_reel spec. Animate + stitch them, then finish — the normal
    // trim/clean/caption path doesn't apply.
    if (job.ops?.stills_reel) {
      prog.stage('assemble', 'Animating the stills');
      const { reel, cost, clipCount } = await buildStillsReel(job, work);
      // Measured before the file is adopted: adoptFile moves it, and probing
      // the served URL afterwards would mean reading it back off disk by path
      // a second time.
      const reelMeta = await probe(reel);
      const reelBytes = fs.statSync(reel).size;
      if (isCancelled(job.id)) {
        // Same rule as the main path: a reel that finished a moment after Stop
        // was pressed is discarded rather than indexed. This branch returns
        // early, so without its own check it was the one path where Stop could
        // be ignored.
        await editJobs.markCancelled(job.id);
        console.log(`[edit] ⊘ stills reel ${job.id} cancelled after its last pass`);
        return;
      }
      const outputUrl = editJobs.adoptFile(job.client_id, reel, '.mp4');
      await editJobs.complete(job.id, { outputUrl, srtUrl: null, costUsd: cost,
        durationS: reelMeta.duration, width: reelMeta.width, height: reelMeta.height,
        bytes: reelBytes });
      console.log(`[edit] ✓ stills reel ${job.id} done (${clipCount} clips, $${cost})`);
      return;
    }

    const apiKey = (await getSetting('OPENAI_API_KEY')) || process.env.OPENAI_API_KEY;
    let renderOps = job.ops || {};
    let srcPath;

    // An edit decision list, if the timeline wrote one. It supersedes both of
    // the paths below, because it is the model they are each a special case of.
    const E = await edlMod();
    const storedEdl = renderOps.edl && Array.isArray(renderOps.edl.items)
      ? E.normalise(renderOps.edl, clips) : null;

    if (storedEdl && storedEdl.items.length && !E.isWholeClipsInOrder(storedEdl, clips)) {
      // A real edit: cuts, a reorder, a gain change, or any mix. Rendered as a
      // cut list across clips, which is the capability the page never had.
      srcPath = await cutEdl(clipPaths, E.compile(storedEdl, clips), work, ctx);
      renderOps = { ...renderOps, trim: null, segments: null };
    } else {
      // No EDL, or an EDL that says "every clip, whole, in order". Both take
      // the proven paths: stream-copy combine for several clips, and the
      // single-clip multi-cut for a stored `ops.segments` from an older job.
      srcPath = paths.length > 1 ? await combineClips(paths, work, ctx) : paths[0];
      const segs = Array.isArray(renderOps.segments) ? renderOps.segments : null;
      if (segs && segs.length && paths.length === 1) {
        srcPath = await cutSegments(srcPath, segs, work, ctx);
        renderOps = { ...renderOps, trim: null };   // cuts already applied
      }
    }
    const { outputPath, srtPath, durationS } = await render(
      srcPath, renderOps, work, apiKey, job.client_id, {}, ctx);

    const outMeta = await probe(outputPath);
    const outBytes = fs.statSync(outputPath).size;
    const outputUrl = editJobs.adoptFile(job.client_id, outputPath, '.mp4');
    const srtUrl = srtPath ? editJobs.adoptFile(job.client_id, srtPath, '.srt') : null;

    let costUsd = 0;
    if (job.ops?.captions && durationS) {
      costUsd = +((durationS / 60) * WHISPER_USD_PER_MIN).toFixed(4);
      recordApiCost({ provider: 'openai', feature: 'edit_captions', costUsd, clientId: job.client_id, meta: { model: 'whisper-1', duration_s: Math.round(durationS) } });
    }
    if (isCancelled(job.id)) {
      // Finished a moment after Cancel was pressed. The output is discarded
      // rather than indexed: the operator asked for this edit not to exist,
      // and an edit that appears in the library anyway is the page doing
      // something nobody asked for.
      await editJobs.markCancelled(job.id);
      console.log(`[edit] ⊘ job ${job.id} cancelled after its last pass`);
      return;
    }
    prog.at('captions', 1, 'Finishing');
    await editJobs.complete(job.id, { outputUrl, srtUrl, costUsd,
      // The duration after the edit, not the source's: a trimmed clip that
      // reported its original length would make the library lie about the one
      // number an operator scans for.
      durationS: outMeta.duration ?? durationS,
      width: outMeta.width, height: outMeta.height, bytes: outBytes });
    console.log(`[edit] ✓ job ${job.id} done (${Math.round(durationS)}s)`);
  } catch (err) {
    if (err instanceof Cancelled || isCancelled(job.id)) {
      await editJobs.markCancelled(job.id).catch(() => {});
      console.log(`[edit] ⊘ job ${job.id} cancelled`);
    } else {
      console.error(`[edit] ✗ job ${job.id}: ${err.message}`);
      await editJobs.fail(job.id, friendlyError(err.message)).catch(() => {});
    }
  } finally {
    clearCancel(job.id);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function friendlyError(raw) {
  const s = String(raw || '');
  const m = s.toLowerCase();
  // fal errors already carry a specific, user-facing reason + hint — pass them
  // through rather than wrapping them as a generic video failure.
  if (/^fal |could not be animated|clip download failed|returned no video/.test(m)) return s.slice(0, 300);
  if (/enoent|ffmpeg exited 127|spawn ffmpeg/.test(m)) return 'The video tools (ffmpeg) aren’t available on the server. Contact the admin.';
  if (/openai key|whisper 401|whisper 4/.test(m)) return 'Auto-captions failed — check the OpenAI key in Settings → AI.';
  if (/invalid data|does not contain|moov atom|could not find codec/.test(m)) return 'Couldn’t read this video file — try a standard MP4/MOV export.';
  return 'Couldn’t process this video. ' + String(raw || '').replace(/\s+/g, ' ').slice(0, 160);
}

/**
 * Drain the queue.
 *
 * Up to MAX_WORKERS renders run at once, which is the point: with one worker a
 * twenty-second trim waited behind a five-minute timeline render, and the
 * operator had nothing on screen to explain the wait. Each worker claims its
 * own job with `FOR UPDATE SKIP LOCKED`, so two workers never take the same
 * row even across processes.
 *
 * The ten-job ceiling per worker is kept: it bounds how long one call to this
 * occupies the process, and `kick()` is called again whenever work arrives.
 */
async function processQueue() {
  if (_workers >= MAX_WORKERS) return;
  const slots = MAX_WORKERS - _workers;
  const runners = [];
  for (let w = 0; w < slots; w++) runners.push(worker());
  await Promise.all(runners);
}

async function worker() {
  _workers += 1;
  try {
    for (let i = 0; i < 10; i++) {
      const job = await editJobs.claimNext('platform-inline');
      if (!job) break;
      await processOne(job);
    }
  } catch (e) {
    console.error('[edit] queue error:', e.message);
  } finally {
    _workers -= 1;
  }
}

function kick() { processQueue().catch(() => {}); }

module.exports = { processQueue, kick, probe, whisperWords, cancel, isCancelled, MAX_WORKERS,
  phasePercent, PHASES,
  // exported for the tests
  render, captionFormatFor, srtFromWords };
