/**
 * Word-timed captions: the library, the client's kit, and the burn.
 *
 * The compiler itself lives in shared/captions/compile.mjs so the editor
 * preview and this renderer produce the same file from the same inputs. This
 * module is the part that needs a database and a disk: which templates exist,
 * what a given client's brand kit makes of one, and running ffmpeg.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { FFMPEG, FFPROBE } = require('./ffmpegBin');

const SHARED = path.join(__dirname, '..', '..', '..', 'shared', 'captions');
const FONTS_DIR = path.join(SHARED, 'fonts');
const PRESETS_PATH = path.join(SHARED, 'presets.json');

// The config is read once. It is a file in the repo, not a table, because a
// template is code's business: it ships with the compiler that understands its
// animationType, and a template in the database could outlive the engine that
// draws it.
let _config = null;
function config() {
  if (!_config) _config = JSON.parse(fs.readFileSync(PRESETS_PATH, 'utf8'));
  return _config;
}

let _compiler = null;
async function compiler() {
  if (!_compiler) _compiler = await import(pathToFileURL(path.join(SHARED, 'compile.mjs')).href);
  return _compiler;
}

/** The library, in the shape the picker needs. Never the whole config. */
function templates() {
  const c = config();
  return Object.values(c.styles).map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category || null,
    description: s.description || '',
    best_for: s.bestFor || '',
    font: s.fontName,
    animation: s.animationType,
    // What the picker paints its own swatch from, so the list needs no renders.
    swatch: { ink: s.primaryColor, accent: s.highlightColor, outline: s.outlineColor },
  }));
}

function formats() { return config().outputFormats; }

function preset(id) {
  const s = config().styles[id];
  if (!s) throw new Error(`No caption template "${id}"`);
  return s;
}

// --- the client's kit ---------------------------------------------------------

const hex = (c) => /^#?[0-9a-f]{3,8}$/i.test(String(c || '').trim());
const norm = (c) => (String(c).trim().startsWith('#') ? String(c).trim() : `#${String(c).trim()}`);

function rgb(c) {
  const h = norm(c).slice(1);
  const six = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(six.slice(i, i + 2), 16) || 0);
}

/** Relative luminance, so "is this readable" is a number rather than a feeling. */
function luminance(c) {
  const [r, g, b] = rgb(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** How far a colour is from grey. The brand's accent is its most saturated one. */
function saturation(c) {
  const [r, g, b] = rgb(c);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * Turn a client's brand assets into a caption kit.
 *
 * One deliberate decision, and it is a design decision rather than a technical
 * one: the BODY of a caption stays near-white with a dark outline whatever the
 * brand is. Captions sit over footage nobody has graded yet, so a brand's own
 * mid-tone as body text is a caption that disappears over half the shots. The
 * brand shows in the accent word and in the typeface, which is where a viewer
 * reads it anyway.
 *
 * The accent is the most saturated colour in the palette, and it is dropped if
 * it cannot be read against the outline, because an unreadable accent is worse
 * than the template's own.
 */
function kitFromAssets(assets, { minContrast = 2.2 } = {}) {
  const list = Array.isArray(assets) ? assets : [];
  const kit = {};

  const font = list.find((a) => a.kind === 'font' && (a.metadata?.role === 'heading'))
    || list.find((a) => a.kind === 'font');
  // Only a family name is taken. The file itself is a separate problem: libass
  // needs it on disk, and a client webfont licence does not always allow that.
  if (font?.name) kit.font = String(font.name).replace(/\.(ttf|otf|woff2?)$/i, '').trim();

  const palette = (list.find((a) => a.kind === 'palette')?.metadata?.colors || [])
    .filter(hex).map(norm);
  if (palette.length) {
    const outline = '#000000';
    const candidate = [...palette].sort((a, b) => saturation(b) - saturation(a))[0];
    if (candidate && contrast(candidate, outline) >= minContrast) kit.accent = candidate;
    else kit.rejected_accent = candidate || null;
  }
  return kit;
}

// --- rendering ----------------------------------------------------------------

function run(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${path.basename(bin)}: ${String(stderr || err.message).slice(-400)}`));
      else resolve(String(stdout || ''));
    });
  });
}

/** Write the ASS for a template, a client kit and a transcript. */
async function toAss({ words, templateId, kit = null, formatId = 'vertical', perLine = 3, marginV }) {
  const m = await compiler();
  const format = formats()[formatId] || formats().vertical;
  return m.compile({
    words, preset: preset(templateId), kit, format, perLine,
    marginV: marginV ?? Math.round(format.height * 0.17),
  });
}

/**
 * One still frame, which is what the operator approves before anything is
 * rendered. Cheap on purpose: changes are free before the render, and this is
 * the only screen where that is true.
 */
async function previewFrame({ words, templateId, kit, formatId = 'vertical', source = null, at, outPath }) {
  const format = formats()[formatId] || formats().vertical;
  const ass = await toAss({ words, templateId, kit, formatId,
    perLine: preset(templateId).wordsPerLine || 3 });
  const assPath = `${outPath}.ass`;
  fs.writeFileSync(assPath, ass);
  // Land on a word rather than between two, or the preview shows the template
  // at rest and every template looks the same.
  const mid = words.length ? words[Math.floor(words.length / 2)] : null;
  const seek = at ?? (mid ? (mid.start + mid.end) / 2 : 1);
  // The seek goes AFTER the input, deliberately. Seeking before it resets the
  // output timestamps to zero, so the subtitles filter renders whatever is on
  // screen at t=0 of the ASS rather than at the moment asked for — which made
  // every preview show the same frame, usually an empty one. Output seeking is
  // slower, and on a four-second sample that costs nothing worth having.
  const input = source
    ? ['-i', source, '-ss', String(seek)]
    : ['-f', 'lavfi', '-i', `color=c=0x101010:s=${format.width}x${format.height}:d=${seek + 1}:r=25`,
      '-ss', String(seek)];
  try {
    await run(FFMPEG, ['-y', '-loglevel', 'error', ...input,
      '-vf', `subtitles=${assPath}:fontsdir=${FONTS_DIR}`,
      '-frames:v', '1', outPath]);
  } finally { fs.existsSync(assPath) && fs.unlinkSync(assPath); }
  return outPath;
}

/** Burn captions into a clip. */
async function burn({ words, templateId, kit, formatId = 'vertical', source, outPath }) {
  const ass = await toAss({ words, templateId, kit, formatId,
    perLine: preset(templateId).wordsPerLine || 3 });
  const assPath = `${outPath}.ass`;
  fs.writeFileSync(assPath, ass);
  try {
    await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', source,
      '-vf', `subtitles=${assPath}:fontsdir=${FONTS_DIR}`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-c:a', 'copy', outPath]);
  } finally { fs.existsSync(assPath) && fs.unlinkSync(assPath); }
  return outPath;
}

// --- the sample gallery -------------------------------------------------------
//
// A swatch says what a template's colours are. It does not say whether the
// caption clears the speaker's face, whether it holds up over a bright shot, or
// whether the motion is too much for a hotel's case study. Those are the
// questions an operator is actually asking, and only moving footage answers
// them, so each template gets a short example rendered over the same clip.
//
// Rendered once and cached on disk rather than committed: twenty-seven clips is
// tens of megabytes, and they are derived from two things already in the repo.

const SAMPLES_DIR = path.join(__dirname, '..', '..', 'video-samples');
const CACHE_DIR = path.join(SAMPLES_DIR, 'cache');
const HOUSE_CLIP = path.join(SAMPLES_DIR, 'house.mp4');
const HOUSE_WORDS = path.join(SAMPLES_DIR, 'house.words.json');

/** Nine words with plausible timings, so an example shows motion, not a still. */
const SAMPLE_WORDS = [
  { word: 'Fifteen', start: 0.10, end: 0.52 }, { word: 'years', start: 0.52, end: 0.88 },
  { word: 'later', start: 0.88, end: 1.22 }, { word: 'the', start: 1.22, end: 1.36 },
  { word: 'company', start: 1.36, end: 1.90 }, { word: 'creates', start: 1.90, end: 2.32 },
  { word: 'custom', start: 2.32, end: 2.74 }, { word: 'art', start: 2.74, end: 2.98 },
  { word: 'programs', start: 2.98, end: 3.52 },
];

function houseClip() { return fs.existsSync(HOUSE_CLIP) ? HOUSE_CLIP : null; }

/**
 * What the person in the sample clip is actually saying.
 *
 * A gallery of talking-head examples whose captions do not match the lips
 * reads as broken, and an operator judging a template would be judging the
 * wrong thing. So the clip is transcribed when it is uploaded and the words
 * are kept beside it. Without a key, or if the call fails, the generic sample
 * line is used and `sampleStatus` says so rather than letting the screen imply
 * these are the real words.
 */
function houseWords() {
  try {
    const w = JSON.parse(fs.readFileSync(HOUSE_WORDS, 'utf8'));
    return Array.isArray(w) && w.length ? w : null;
  } catch { return null; }
}

function sampleStatus() {
  const clip = houseClip();
  const words = houseWords();
  return {
    uploaded: !!clip,
    updated_at: clip ? fs.statSync(clip).mtime : null,
    bytes: clip ? fs.statSync(clip).size : 0,
    transcribed: !!words,
    word_count: words ? words.length : 0,
  };
}

/**
 * A cache key that changes when anything the output depends on changes.
 *
 * The clip, the preset library and the client's kit all feed the frame, so all
 * three are in the key. Without the clip's mtime, replacing house.mp4 would
 * leave every example showing the old footage until someone emptied the folder
 * by hand, and nobody would think to.
 */
function sampleKey(templateId, kit) {
  const parts = [templateId];
  const clip = houseClip();
  parts.push(clip ? String(fs.statSync(clip).mtimeMs) : 'noclip');
  parts.push(String(fs.statSync(PRESETS_PATH).mtimeMs));
  parts.push(kit ? JSON.stringify(kit) : 'house');
  parts.push(fs.existsSync(HOUSE_WORDS) ? String(fs.statSync(HOUSE_WORDS).mtimeMs) : 'nowords');
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

/**
 * One example clip, cached. Deliberately small: 540 wide, no audio, and only as
 * long as the words last. This is a thumbnail that moves, not a deliverable.
 */
async function sampleClip({ templateId, kit = null, formatId = 'vertical' }) {
  preset(templateId);                       // refuse an unknown id before any work
  const source = houseClip();
  if (!source) throw new Error('No sample clip. Upload one under Produce to see moving examples.');

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const out = path.join(CACHE_DIR, `${templateId}-${sampleKey(templateId, kit)}.mp4`);
  if (fs.existsSync(out) && fs.statSync(out).size > 1000) return out;

  const format = formats()[formatId] || formats().vertical;
  const preset_ = preset(templateId);
  const ass = await toAss({ words: houseWords() || SAMPLE_WORDS, templateId, kit, formatId,
    perLine: preset_.wordsPerLine || 3 });
  const assPath = `${out}.ass`;
  fs.writeFileSync(assPath, ass);
  const height = Math.round((540 / format.width) * format.height / 2) * 2;
  try {
    // Captions are burned at full size and the result scaled down, rather than
    // burned onto a small frame: libass would otherwise hint the type at 540
    // wide and the example would show a weight the real render never produces.
    await run(FFMPEG, ['-y', '-loglevel', 'error', '-t', '4', '-i', source,
      '-vf', `scale=${format.width}:${format.height}:force_original_aspect_ratio=increase,`
        + `crop=${format.width}:${format.height},setsar=1,`
        + `subtitles=${assPath}:fontsdir=${FONTS_DIR},scale=540:${height}`,
      '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  } catch (e) {
    fs.existsSync(out) && fs.unlinkSync(out);
    throw e;
  } finally { fs.existsSync(assPath) && fs.unlinkSync(assPath); }
  return out;
}

/**
 * Take whatever clip the operator uploads and make it the house sample.
 *
 * Normalised on the way in rather than stored as given: a 200MB ProRes file and
 * a phone video have to produce the same four seconds, or the gallery is as
 * slow as the worst thing anyone has uploaded. Dropping the audio is part of
 * that, and a gallery that makes noise when you scroll it is nobody's idea.
 */
async function setHouseClip(srcPath) {
  fs.mkdirSync(SAMPLES_DIR, { recursive: true });
  const tmp = `${HOUSE_CLIP}.incoming.mp4`;
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-t', '4', '-i', srcPath,
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30',
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', tmp]);
  fs.renameSync(tmp, HOUSE_CLIP);
  // Transcribed from the ORIGINAL upload, not from what was just written. The
  // normalise above drops the audio, so the house clip has no sound to read;
  // transcribing it would always come back empty. Only the first four seconds
  // are sent, because that is the part the examples show.
  await transcribeHouseClip(srcPath).catch((e) => {
    // Never fail the upload over this. The clip is still usable; the captions
    // fall back to the generic line and the screen is told they are generic.
    console.error('[captions] sample clip not transcribed:', e.message);
    try { fs.existsSync(HOUSE_WORDS) && fs.unlinkSync(HOUSE_WORDS); } catch { /* nothing to clear */ }
  });
  // Every cached example was rendered over the old footage, so none of them
  // describes the library any more.
  clearSampleCache();
  return HOUSE_CLIP;
}

/** Pull word timings off the house clip, so the examples say what he says. */
async function transcribeHouseClip(fromPath = null) {
  const { getSetting } = require('../utils/settings');
  const { whisperWords } = require('./editProcessor');
  const key = (await getSetting('OPENAI_API_KEY')) || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('no OpenAI key, so the sample captions stay generic');
  const src = fromPath || HOUSE_CLIP;
  const audio = `${HOUSE_CLIP}.mp3`;
  try {
    await run(FFPROBE, ['-v', 'error', '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', src])
      .then((out) => { if (!out.trim()) throw new Error('that clip has no audio track to transcribe'); });
    await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', src, '-t', '4',
      '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', audio]);
    const words = await whisperWords(audio, key);
    fs.writeFileSync(HOUSE_WORDS, JSON.stringify(words));
    return words;
  } finally { fs.existsSync(audio) && fs.unlinkSync(audio); }
}

function clearSampleCache() {
  if (!fs.existsSync(CACHE_DIR)) return 0;
  const files = fs.readdirSync(CACHE_DIR);
  for (const f of files) { try { fs.unlinkSync(path.join(CACHE_DIR, f)); } catch { /* gone already */ } }
  return files.length;
}

module.exports = {
  sampleClip, setHouseClip, clearSampleCache, houseClip, houseWords, sampleStatus,
  transcribeHouseClip, SAMPLE_WORDS,
  SAMPLES_DIR, CACHE_DIR,
  templates, formats, preset, kitFromAssets, toAss, previewFrame, burn,
  FONTS_DIR, PRESETS_PATH,
  // exported for the tests
  _internals: { contrast, saturation, luminance },
};
