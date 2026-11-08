/**
 * Measuring a rendered video, so something else can judge it.
 *
 * This half knows ffmpeg and nothing about what is acceptable. Every threshold
 * and every verdict lives in `shared/renderQc.mjs`, which is pure and tested
 * without a video anywhere near it. The split is the same one the silence cut
 * uses, for the same reason: a decision that needs a real file to exercise is
 * a decision no test will exercise.
 *
 * TWO ffmpeg passes, not seven. One decode with every detector attached at
 * once, and one small decode for the motion measure, because decoding a
 * 20-second 1080x1920 file seven times to ask seven questions is six decodes
 * of waste on a box that is already encoding thirty videos one at a time.
 */

const { execFile } = require('child_process');
const { FFMPEG, FFPROBE } = require('./ffmpegBin');

/** Run a command and hand back stdout and stderr, whatever the exit code. */
function run(bin, args, { timeoutMs = 180000, maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer, encoding: 'buffer' }, (err, stdout, stderr) => {
      resolve({
        err: err || null,
        stdout: stdout || Buffer.alloc(0),
        stderr: (stderr || Buffer.alloc(0)).toString('utf8'),
      });
    });
  });
}

/** A rational frame rate string ("30000/1001") as a number. */
function rate(str) {
  const m = String(str || '').match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) {
    const n = Number(str);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const d = Number(m[2]);
  return d ? Number(m[1]) / d : null;
}

/** Width, height, frame rate and the two durations. */
async function probe(file) {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,width,height,avg_frame_rate,duration',
    '-show_entries', 'format=duration',
    '-of', 'json', file,
  ]);
  let parsed;
  try { parsed = JSON.parse(stdout.toString('utf8')); } catch { return {}; }

  const streams = parsed.streams || [];
  const v = streams.find((s) => s.codec_type === 'video');
  const a = streams.find((s) => s.codec_type === 'audio');
  const formatDur = Number(parsed.format?.duration);

  return {
    width: v ? Number(v.width) || null : null,
    height: v ? Number(v.height) || null : null,
    fps: v ? rate(v.avg_frame_rate) : null,
    // A stream's own duration where it has one, else the container's. A
    // concat or a filtered output often reports only the container.
    videoDuration: v ? (Number(v.duration) || formatDur || null) : (formatDur || null),
    audioDuration: a ? (Number(a.duration) || formatDur || null) : null,
  };
}

/** `black_start:0 black_end:2 black_duration:2` */
function parseBlack(text) {
  const out = [];
  const re = /black_start:([\d.]+)\s+black_end:([\d.]+)/g;
  let m = re.exec(text);
  while (m) {
    out.push({ start: Number(m[1]), end: Number(m[2]) });
    m = re.exec(text);
  }
  return out;
}

/**
 * `lavfi.freezedetect.freeze_start: 0` then `freeze_end: 2`, on separate
 * lines, each prefixed by the filter's own log tag.
 *
 * A freeze that runs to the end of the file gets a start and no end, because
 * the filter never sees it finish. That is a real freeze and the commonest
 * shape of one, so it is closed at the file's duration rather than dropped.
 */
function parseFreeze(text, duration) {
  const out = [];
  const re = /freeze_start:\s*([\d.]+)/g;
  const ends = [...text.matchAll(/freeze_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  let i = 0;
  let m = re.exec(text);
  while (m) {
    const start = Number(m[1]);
    const end = Number.isFinite(ends[i]) ? ends[i] : (Number.isFinite(duration) ? duration : start);
    out.push({ start, end });
    i += 1;
    m = re.exec(text);
  }
  return out;
}

/** `silence_start: 3.5` / `silence_end: 6 | silence_duration: 2.5` */
function parseSilence(text, duration) {
  const out = [];
  const starts = [...text.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...text.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  starts.forEach((start, i) => {
    const end = Number.isFinite(ends[i]) ? ends[i] : (Number.isFinite(duration) ? duration : start);
    out.push({ start: Math.max(0, start), end });
  });
  return out;
}

/**
 * The SUMMARY block's integrated loudness and true peak.
 *
 *   Summary:
 *     Integrated loudness:
 *       I:         -21.8 LUFS
 *     True peak:
 *       Peak:      -17.7 dBFS
 *
 * Parsed from the summary onwards, not from the whole log. `ebur128` also
 * logs a line per frame — `t: 0.1 TARGET:-23 LUFS M: -70.0 S:-70.0 I: -70.0
 * LUFS` — so the first `I:` in the output is the first frame's running figure.
 * On a file that starts quiet that is −70, which is what this read before the
 * fix: a sine measured at −21.8 LUFS was reported as −70 and would have read
 * as 54 LU too quiet. The summary is the only figure for the whole file.
 */
function parseLoudness(text) {
  const at = text.lastIndexOf('Summary:');
  const tail = at === -1 ? text : text.slice(at);
  const i = tail.match(/\bI:\s*(-?[\d.]+)\s*LUFS/);
  const peak = tail.match(/True peak:[\s\S]{0,160}?Peak:\s*(-?[\d.]+)/);
  return {
    loudnessLufs: i ? Number(i[1]) : null,
    truePeakDb: peak ? Number(peak[1]) : null,
  };
}

/**
 * Everything one decode can answer.
 *
 * `-f null -` so nothing is written: the filters report through the log, which
 * is where all four of these live. `ebur128` is attached only when there is
 * audio, because asking for an audio filter on a silent file makes ffmpeg
 * refuse the whole graph rather than skip it.
 */
async function detect(file, { hasAudio, duration }) {
  const args = ['-hide_banner', '-nostats', '-i', file];
  const vf = [
    // d is the minimum run the filter will report. Below the threshold the
    // pure module uses, so it decides rather than the filter.
    'blackdetect=d=0.1:pic_th=0.98:pix_th=0.10',
    'freezedetect=n=-60dB:d=0.5',
  ].join(',');
  args.push('-vf', vf);
  if (hasAudio) args.push('-af', 'ebur128=peak=true,silencedetect=n=-50dB:d=0.4');
  args.push('-f', 'null', '-');

  const { stderr } = await run(FFMPEG, args);
  return {
    blackRuns: parseBlack(stderr),
    freezeRuns: parseFreeze(stderr, duration),
    silenceRuns: hasAudio ? parseSilence(stderr, duration) : [],
    ...(hasAudio ? parseLoudness(stderr) : { loudnessLufs: null, truePeakDb: null }),
  };
}

/** How much the picture changes, second by second. */
const MOTION_FPS = 4;
const MOTION_W = 64;
const MOTION_H = 36;

/**
 * Mean absolute difference between consecutive sampled frames.
 *
 * Decoded small and grey on purpose: at 64×36 at four frames a second the
 * whole file is a few hundred kilobytes and the arithmetic is trivial, while
 * a deliberate camera move still shows clearly. Measuring at full resolution
 * would cost more than the render.
 *
 * Returns one entry per consecutive pair, with the time span it covers, so
 * the judge can take a median inside each item's own window rather than over
 * the whole file — where one hard cut would hide six still photographs.
 */
async function motion(file) {
  const { stdout, err } = await run(FFMPEG, [
    '-hide_banner', '-nostats', '-v', 'error',
    '-i', file,
    '-vf', `fps=${MOTION_FPS},scale=${MOTION_W}:${MOTION_H},format=gray`,
    '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
  ]);
  const frameBytes = MOTION_W * MOTION_H;
  const frames = Math.floor(stdout.length / frameBytes);
  if (err && frames < 2) return [];

  const out = [];
  for (let i = 1; i < frames; i += 1) {
    const a = i * frameBytes - frameBytes;
    const b = i * frameBytes;
    let sum = 0;
    let tot = 0;
    let sq = 0;
    for (let p = 0; p < frameBytes; p += 1) {
      const cur = stdout[b + p];
      sum += Math.abs(cur - stdout[a + p]);
      tot += cur;
      sq += cur * cur;
    }
    const mean = tot / frameBytes;
    out.push({
      start: (i - 1) / MOTION_FPS,
      end: i / MOTION_FPS,
      delta: sum / frameBytes,
      // How much DETAIL the frame has, as the standard deviation of its
      // brightness. A flat picture cannot show movement: zoom a solid colour
      // and every pixel is unchanged, so the delta is zero however hard the
      // camera moved. Without this the gate would fail a legitimate
      // solid-colour end card for not moving, which is the sort of false
      // alarm that gets a whole checklist switched off. Measured here because
      // the frames are already in memory.
      detail: Math.sqrt(Math.max(0, sq / frameBytes - mean * mean)),
    });
  }
  return out;
}

/**
 * Measure a rendered file.
 *
 * Returns the measurements only. Judging them is `shared/renderQc.mjs`.
 */
async function measure(file) {
  const base = await probe(file);
  const hasAudio = Number.isFinite(base.audioDuration);
  const [found, moved] = await Promise.all([
    detect(file, { hasAudio, duration: base.videoDuration }),
    motion(file),
  ]);
  return { ...base, ...found, motion: moved };
}

let _qcMod = null;
async function qcMod() {
  if (!_qcMod) {
    const path = require('path');
    const { pathToFileURL } = require('url');
    _qcMod = await import(pathToFileURL(
      path.join(__dirname, '..', '..', '..', 'shared', 'renderQc.mjs')
    ).href);
  }
  return _qcMod;
}

/**
 * Measure a render and judge it against the composition that produced it.
 *
 * Never throws. A QC pass that fails takes a batch item's verdict with it,
 * and an unmeasurable file is a thing to say rather than a reason to lose the
 * render: the video exists either way and a person can still watch it.
 */
async function check(file, comp) {
  const qc = await qcMod();
  try {
    const m = await measure(file);
    const expected = {
      width: comp?.size?.width ?? null,
      height: comp?.size?.height ?? null,
      fps: comp?.fps ?? null,
      duration: (comp?.tracks || [])
        .flatMap((t) => (t.items || []).map((i) => i.at + i.len))
        .reduce((a, b) => Math.max(a, b), 0) || null,
      movingWindows: qc.movingWindows(comp || {}),
    };
    const out = qc.judge(m, expected);
    return { ...out, measured: m, fingerprint: qc.QC_FINGERPRINT };
  } catch (err) {
    return {
      verdict: 'unmeasured',
      checks: [{ id: 'measure', level: 'skipped', says: err.message }],
      says: `Could not be measured: ${err.message}`,
      rank: -1,
      measured: null,
      fingerprint: qc.QC_FINGERPRINT,
    };
  }
}

module.exports = {
  measure,
  check,
  probe,
  motion,
  // Exported for the tests, which feed them real ffmpeg log text rather than
  // a fixture somebody typed.
  parseBlack,
  parseFreeze,
  parseSilence,
  parseLoudness,
  MOTION_FPS,
};
