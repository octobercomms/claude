/**
 * Reading somebody else's caption treatment off their finished video.
 *
 * The measurement half of the analyser (`referenceAnalyse.js`) reads cuts,
 * shot lengths, motion and loudness from the file. None of that says what the
 * type looks like, so `captionFor` answered with a null and its reason. This
 * is the pass that removes the reason.
 *
 * ── What the model is asked, and what it is not ───────────────────────
 *
 * It is asked only what a frame contains: is there burned type, where does it
 * sit, how big is it, what colour, is a second colour used on one word, is
 * there a box or a glow behind it, how thick is the outline, how many words
 * to a line. Those are OBSERVATIONS, in the closed vocabulary
 * `shared/captionMatch.mjs` defines, and they are validated against it before
 * anything is done with them.
 *
 * IT IS NEVER ASKED TO NAME A PRESET. Given a list of 31 it would name one,
 * and a confident wrong answer is the failure mode that matters when somebody
 * runs ten references through this in an afternoon. Which preset the
 * observations are nearest is arithmetic, it happens in a pure module, and it
 * returns a shortlist when a still frame genuinely cannot narrow further.
 *
 * ── Why the frames are sent at 1280 ──────────────────────────────────
 *
 * Outline thickness is the one fine-grained thing a still frame carries: the
 * shipped presets run 3.5px to 10px, which is nearly a factor of three and
 * visible, where 105pt type against 102pt is a sixth of a percentage point of
 * frame height and is not. Halving the frame would put a 4px outline at 2px
 * and throw that away, so the long edge is capped at 1280 rather than 960,
 * and the reported pixels are scaled back to the real frame. Eight frames at
 * 720x1280 is about 10k tokens, which keeps the whole pass inside the
 * plan's budget of $0.10 a reference alongside Whisper.
 *
 * ── Where the line is ────────────────────────────────────────────────
 *
 * Reading caption style off a competitor is ordinary competitive analysis.
 * The answer is always one of OUR presets, matched rather than generated,
 * which is what keeps it on that side: nothing here reproduces a distinctive
 * brand's type closely enough that their own audience would mistake it.
 */

const { execFile } = require('child_process');
const { pathToFileURL } = require('url');
const path = require('path');
const { FFMPEG } = require('./ffmpegBin');
const renderQc = require('./renderQc');
const claude = require('./claude');
const aiModels = require('./aiModels');

/** The routable feature name, for model choice, the cost log and the chip. */
const FEATURE = 'reference_caption_read';

/** How many frames to sample. */
const FRAMES = 8;

/** The long edge the frames are sent at. See the note above. */
const SEND_LONG_EDGE = 1280;

function run(bin, args, { timeoutMs = 60000, maxBuffer = 32 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    execFile(
      bin, args,
      { timeout: timeoutMs, maxBuffer, encoding: 'buffer' },
      (err, stdout, stderr) => resolve({ err: err || null, stdout, stderr })
    );
  });
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

/**
 * When to sample.
 *
 * Evenly spaced across the middle 90%, because the first and last moments of
 * a reel are a title card and an end card as often as not, and neither shows
 * the caption treatment the body of the video uses.
 */
function sampleTimes(duration, count = FRAMES) {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const from = duration * 0.05;
  const to = duration * 0.95;
  const span = to - from;
  if (span <= 0) return [round(duration / 2)];
  const n = Math.max(1, Math.min(count, Math.floor(duration)));
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push(round(from + (span * (i + 0.5)) / n));
  }
  return out;
}

/**
 * One JPEG per time, at the send size.
 *
 * `-ss` before `-i` so ffmpeg seeks rather than decoding up to the time: on a
 * 60-second reel that is the difference between eight quick reads and eight
 * full decodes. A frame that cannot be read is skipped rather than failing
 * the pass, because seven frames still answer the question.
 */
async function frames(file, times, { height, width }) {
  const long = Math.max(Number(width) || 0, Number(height) || 0);
  const scale = long > SEND_LONG_EDGE ? SEND_LONG_EDGE / long : 1;
  const out = [];
  for (const t of times) {
    const args = [
      '-hide_banner', '-nostats', '-loglevel', 'error',
      '-ss', String(t), '-i', file, '-frames:v', '1',
    ];
    if (scale < 1) {
      args.push('-vf', `scale=${even(width * scale)}:${even(height * scale)}`);
    }
    args.push('-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '3', '-');
    const { err, stdout } = await run(FFMPEG, args);
    if (err || !stdout || !stdout.length) continue;
    out.push({ at: t, jpeg: stdout });
  }
  return { images: out, scale };
}

function even(n) {
  const v = Math.max(2, Math.round(Number(n) || 0));
  return v % 2 === 0 ? v : v + 1;
}

function round(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * The instruction. Written to make a refusal easy and a guess hard.
 *
 * Three things in it are load-bearing. The vocabulary is closed, so an
 * invented word fails validation rather than being matched on. Every field is
 * nullable with "say null rather than estimate" said outright, because the
 * whole proposal is built on a confidence per field and a guessed colour
 * poisons a match in a way a null does not. And no preset names appear
 * anywhere: the model cannot pick one if it has never seen the list.
 */
function system(dims) {
  return [
    'You are reading frames from a short-form social video to describe its',
    'burned-in caption treatment. You describe what is on the screen. You do',
    'not identify styles, name templates, or guess what software made it.',
    '',
    `Each frame you are shown is ${dims.w}x${dims.h} pixels.`,
    '',
    'Answer with a single JSON object and nothing else. The fields:',
    '',
    '  present      true if ANY frame shows burned-in caption text, else false.',
    '               Ignore logos, watermarks, UI chrome and text that is part',
    '               of the filmed scene, such as a sign or a screen.',
    '  band         where the middle of the caption block sits, as a fraction',
    '               from the top of the frame: 0 is the top edge, 1 the bottom.',
    '  capPct       the height of a capital letter as a fraction of the frame',
    '               height. A 76-pixel capital in a 1280-tall frame is 0.059.',
    '  outlinePx    the thickness of the outline or stroke around the letters,',
    '               in pixels AS MEASURED IN THE FRAME YOU ARE SHOWN. 0 if the',
    '               letters have no outline.',
    '  wordsPerLine the typical number of words on one line.',
    '  caseStyle    "upper" if the type is all capitals, "lower" if all',
    '               lowercase, "mixed" otherwise.',
    '  colour       the main colour of the letters, as #RRGGBB.',
    '  accent       the colour of a SINGLE highlighted word, as #RRGGBB, when',
    '               one word is a different colour from the rest. null if every',
    '               word is the same colour.',
    '  family       one of:',
    '                 "accent" one word at a time is a different colour',
    '                 "box"    the type sits on a filled rectangle',
    '                 "glow"   the letters have a soft coloured halo',
    '                 "plain"  none of the above',
    '',
    'Every field except `present` may be null. Use null whenever you would be',
    'estimating. A null is useful and a guess is not: a wrong colour or a wrong',
    'thickness is worse than no answer, because it will be matched on.',
    '',
    'No prose, no markdown, no code fence. The JSON object only.',
  ].join('\n');
}

function parse(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Observe the caption treatment of a reference video.
 *
 * Returns `{ observations, says, frames, model }`. `observations` is null
 * when nothing could be read, and `says` is the reason — never a guess. The
 * caller matches it to a preset; this does not.
 */
async function observe(file, { clientId = null, count = FRAMES } = {}) {
  const probe = await renderQc.probe(file);
  if (!Number.isFinite(probe.height) || !Number.isFinite(probe.width)) {
    return {
      observations: null,
      says: 'the file did not report a frame size, so nothing could be sampled',
      frames: 0,
      model: null,
    };
  }

  const model = await aiModels.resolveModel(FEATURE);
  // DeepSeek takes no images. Routed there this would fail inside the API
  // call with a provider error, so it is refused here with the reason an
  // operator can act on: change the model for this feature in Settings.
  if (aiModels.MODELS[model]?.provider !== 'anthropic') {
    return {
      observations: null,
      says: `reading type off a frame needs a model that takes images, and this`
        + ` feature is set to ${aiModels.MODELS[model]?.label || model}.`
        + ' Change it in Settings > AI models.',
      frames: 0,
      model,
    };
  }

  // `videoDuration`, which is what `renderQc.probe` returns: a stream's own
  // duration where it has one, else the container's. Reading `probe.duration`
  // instead gave undefined for every file, so the pass refused every
  // reference with "reported no duration" and never sampled a frame. Found by
  // this service's own test on a real file, which is the only place it could
  // have been found: the message was plausible and the file was fine.
  const times = sampleTimes(probe.videoDuration, count);
  if (!times.length) {
    return {
      observations: null,
      says: 'the file reported no duration, so there was nothing to sample',
      frames: 0,
      model,
    };
  }

  const { images, scale } = await frames(file, times, probe);
  if (!images.length) {
    return {
      observations: null,
      says: 'no frame could be decoded from the file',
      frames: 0,
      model,
    };
  }

  const sentW = Math.round(probe.width * scale);
  const sentH = Math.round(probe.height * scale);

  const content = [
    ...images.map((im) => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: im.jpeg.toString('base64') },
    })),
    {
      type: 'text',
      text: `${images.length} frames, sampled at `
        + `${images.map((im) => `${im.at}s`).join(', ')}. Describe the caption treatment.`,
    },
  ];

  const text = await claude.callClaudeProxy({
    model,
    max_tokens: 700,
    system: system({ w: sentW, h: sentH }),
    messages: [{ role: 'user', content }],
    temperature: 0,
    feature: FEATURE,
    clientId,
  });

  const answered = parse(text);
  if (!answered) {
    return {
      observations: null,
      says: 'the pass did not answer with readable JSON',
      frames: images.length,
      model,
    };
  }

  // Drop nulls before validating. The instruction asks for null where the
  // model would be estimating, and a null field and an absent one mean the
  // same thing to the matcher; keeping them would make every optional field
  // explicitly present and the error messages harder to read.
  const obs = {};
  for (const [k, v] of Object.entries(answered)) {
    if (v !== null && v !== undefined) obs[k] = v;
  }

  // THE PIXELS ARE IN THE FRAME IT WAS SHOWN, not the real one. Scaled back
  // here rather than asked for in frame terms, because a model that has been
  // told the image is 1280 tall and asked for a figure in 1920 terms has to
  // do the arithmetic itself, and it is arithmetic we can do exactly.
  if (Number.isFinite(obs.outlinePx) && scale < 1) {
    obs.outlinePx = Math.round((obs.outlinePx / scale) * 10) / 10;
  }

  const cm = await matchMod();
  const problems = cm.validateObservations(obs);
  if (problems.length) {
    return {
      observations: null,
      says: `the pass answered outside what it was asked for: ${problems.join('; ')}`,
      frames: images.length,
      model,
    };
  }

  return {
    observations: obs,
    says: obs.present
      ? `read from ${images.length} sampled frames`
      : `no burned type in ${images.length} sampled frames`,
    frames: images.length,
    model,
  };
}

module.exports = {
  observe,
  FEATURE,
  FRAMES,
  SEND_LONG_EDGE,
  // Exported for the tests, which run them against a real file and real
  // numbers rather than a fixture somebody typed.
  sampleTimes,
  frames,
  system,
  parse,
};
