/**
 * The render graph, judged on the pixels it produces.
 *
 * Every other render guard in this repo asserts on the filter_complex
 * STRING. That is why two faults that broke the most ordinary edits reached
 * production: in both cases the graph read correctly and the video did not.
 *
 *   - A track with two or more non-overlapping items never shifted them to
 *     their absolute time, so the overlay's `enable` window gated on the
 *     canvas clock while the item's own stream had already ended. Two clips
 *     with a hard cut rendered the first clip and then black, with the
 *     second clip's audio playing over it because the audio side shifted
 *     correctly.
 *   - That track's canvas was opaque black, so any higher video track with
 *     two or more items covered the base track for its whole duration.
 *
 * These render real footage through the real module (renderGraph plus
 * ffmpegArgs, not a hand-written graph) and sample the frames. A graph-level
 * test cannot replace this: the string is not the output.
 *
 * ffmpeg is required, not optional. A guard that skips is a guard that is
 * not running, so this fails loudly when ffmpeg is absent and the CI step
 * installs it, which is the same arrangement captions.test.js uses.
 *
 *   node tests/composition-render-pixels.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { renderGraph, ffmpegArgs } = require('../../shared/compositionRender.mjs');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const W = 320;
const H = 240;
const FPS = 25;

try {
  execFileSync(FFMPEG, ['-version'], { stdio: 'ignore' });
} catch {
  console.error(
    '\n  FAIL ffmpeg is not on this machine. These assertions are about real\n'
    + '       frames, so there is nothing to check without it. Install ffmpeg\n'
    + '       or set FFMPEG_PATH.\n'
  );
  process.exit(1);
}

let dir;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-pixels-'));
});

after(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
});

/** A solid-colour clip with a silent audio track, so the graph has an [n:a]. */
function makeClip(name, colour, seconds) {
  const p = path.join(dir, name);
  execFileSync(FFMPEG, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${colour}:s=${W}x${H}:r=${FPS}:d=${seconds}`,
    '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${seconds}`,
    '-shortest', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac',
    p,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  return p;
}

/** Render a composition through the real module. */
function render(comp, sourcePaths) {
  const result = renderGraph(comp);
  const resolved = result.inputs.map((inp) => {
    const p = sourcePaths[inp.sourceId];
    if (!p) throw new Error(`no path for source ${inp.sourceId}`);
    return p;
  });
  const out = path.join(dir, `out-${Math.abs(hash(result.graph))}.mp4`);
  const args = ffmpegArgs(result, resolved, out);
  try {
    execFileSync(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim().split('\n').slice(-6).join('\n') : '';
    throw new Error(`ffmpeg refused the graph:\n${stderr}\n\ngraph:\n${result.graph}`);
  }
  return out;
}

// A stable name for the output file without Date.now or Math.random.
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** The RGB of one pixel of one frame. */
function pixelAt(file, seconds, x, y) {
  const raw = execFileSync(FFMPEG, [
    '-loglevel', 'error', '-ss', String(seconds), '-i', file,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { maxBuffer: 64 * 1024 * 1024 });
  const i = (y * W + x) * 3;
  return { r: raw[i], g: raw[i + 1], b: raw[i + 2] };
}

const isRed = (p) => p.r > 150 && p.g < 80 && p.b < 80;
const isGreen = (p) => p.g > 150 && p.r < 80 && p.b < 80;
const isBlue = (p) => p.b > 150 && p.r < 80 && p.g < 80;
const isBlack = (p) => p.r < 40 && p.g < 40 && p.b < 40;
const show = (p) => `rgb(${p.r},${p.g},${p.b})`;

function clipComp(items, sources, size = { width: W, height: H }) {
  return { version: 1, size, fps: FPS, sources, tracks: items };
}

describe('two clips with a hard cut', () => {
  it('shows the second clip, not black', () => {
    const green = makeClip('g.mp4', '0x00ff00', 4);
    const blue = makeClip('b.mp4', '0x0000ff', 4);
    const comp = clipComp(
      [{
        id: 't0', kind: 'video', items: [
          { id: 'i1', at: 0, len: 3, source: 'a', in: 0 },
          { id: 'i2', at: 3, len: 3, source: 'b', in: 0 },
        ],
      }],
      {
        a: { kind: 'clip', url: 'a.mp4', duration: 4, width: W, height: H, fps: FPS },
        b: { kind: 'clip', url: 'b.mp4', duration: 4, width: W, height: H, fps: FPS },
      }
    );
    const out = render(comp, { a: green, b: blue });

    const first = pixelAt(out, 1.0, W / 2, H / 2);
    assert.ok(isGreen(first), `at 1s the first clip should show, got ${show(first)}`);

    const second = pixelAt(out, 4.5, W / 2, H / 2);
    assert.ok(
      !isBlack(second),
      `at 4.5s the second clip must not render as black. This is the fault: `
      + `the item was never shifted to its absolute time, so the overlay's `
      + `enable window opened after its stream had ended. Got ${show(second)}`
    );
    assert.ok(isBlue(second), `at 4.5s the second clip should show, got ${show(second)}`);
  });
});

describe('a higher video track with a gap between its items', () => {
  it('lets the base track show through the gap', () => {
    const red = makeClip('r.mp4', '0xff0000', 10);
    const blue = makeClip('b2.mp4', '0x0000ff', 2);
    const comp = clipComp(
      [
        { id: 't0', kind: 'video', items: [{ id: 'base', at: 0, len: 8, source: 'base', in: 0 }] },
        {
          id: 't1', kind: 'video', items: [
            { id: 'o1', at: 1, len: 1, source: 'ov', in: 0 },
            { id: 'o2', at: 5, len: 1, source: 'ov', in: 0 },
          ],
        },
      ],
      {
        base: { kind: 'clip', url: 'base.mp4', duration: 10, width: W, height: H, fps: FPS },
        ov: { kind: 'clip', url: 'ov.mp4', duration: 2, width: W, height: H, fps: FPS },
      }
    );
    const out = render(comp, { base: red, ov: blue });

    // In the gap between the two overlay items, the base must be visible.
    const gap = pixelAt(out, 3.0, W / 2, H / 2);
    assert.ok(
      !isBlack(gap),
      `at 3s the base track must show through the gap. This is the fault: the `
      + `upper track's canvas was opaque black, so it covered the base for its `
      + `whole duration. Got ${show(gap)}`
    );
    assert.ok(isRed(gap), `at 3s the base track should show, got ${show(gap)}`);

    // And the overlay still appears inside its own window.
    const onItem = pixelAt(out, 1.5, W / 2, H / 2);
    assert.ok(isBlue(onItem), `at 1.5s the overlay item should show, got ${show(onItem)}`);
  });
});

describe('a track with both a transition and a gap', () => {
  it('renders at all', () => {
    // The regression guard for the orphan filter output: buildXfadeChain's
    // multi-run branch emitted a pad nothing consumed, and ffmpeg refuses an
    // entire filter_complex with an unconnected output, so this shape
    // produced no file whatsoever.
    const green = makeClip('g2.mp4', '0x00ff00', 6);
    const comp = clipComp(
      [{
        id: 't0', kind: 'video', items: [
          { id: 'i1', at: 0, len: 4, source: 'a', in: 0 },
          { id: 'i2', at: 3, len: 4, source: 'a', in: 0, trans: { type: 'fade' } },
          { id: 'i3', at: 9, len: 3, source: 'a', in: 0 },
        ],
      }],
      { a: { kind: 'clip', url: 'a.mp4', duration: 6, width: W, height: H, fps: FPS } }
    );
    const out = render(comp, { a: green });
    assert.ok(fs.existsSync(out), 'the render produced a file');
    const p = pixelAt(out, 1.0, W / 2, H / 2);
    assert.ok(isGreen(p), `the footage should be visible, got ${show(p)}`);
  });
});

// ── Captions reach the output ────────────────────────────────────────
//
// Captions were silently absent from every composition render, for two
// independent reasons, and nothing noticed because no guard looked at the
// picture:
//
//   - The shipped render route called renderGraph without a captionAssPath.
//     The only code that compiled one hung off renderComposition, which
//     nothing but its own test ever called.
//   - A caption source's `transcript` holds the ID of the clip source whose
//     words to use (the words live in their own column, so a composition
//     carrying a second copy would drift). buildCaptionAss only handled a
//     literal array, so every caption the editor wrote resolved to nothing
//     and returned null.
//
// A render that drops a caption somebody asked for and reports success is
// the page lying about its output. So this asserts on pixels: with captions
// the band where they sit changes, and without them it does not.

const { buildCaptionAss, resolveTranscript } = require('../src/services/compositionRenderer');

const WORDS = [
  { word: 'MAPS', start: 0.2, end: 0.7 },
  { word: 'SHOWED', start: 0.8, end: 1.4 },
  { word: 'A', start: 1.5, end: 1.7 },
  { word: 'CONTINENT', start: 1.8, end: 2.6 },
];

function captionComp(transcriptValue) {
  return {
    version: 1,
    size: { width: W, height: H },
    fps: FPS,
    sources: {
      a: { kind: 'clip', url: 'a.mp4', duration: 4, width: W, height: H, fps: FPS },
      cap: { kind: 'captions', transcript: transcriptValue, template: 'hormozi' },
    },
    tracks: [{ id: 't0', kind: 'video', items: [{ id: 'i1', at: 0, len: 3, source: 'a', in: 0 }] }],
  };
}

/** How many pixels in the lower band are not the flat background. */
function litPixelsInCaptionBand(file, seconds) {
  const raw = execFileSync(FFMPEG, [
    '-loglevel', 'error', '-ss', String(seconds), '-i', file,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { maxBuffer: 64 * 1024 * 1024 });
  let lit = 0;
  // The band captions sit in: marginV is 17% of the height from the bottom.
  for (let y = Math.floor(H * 0.55); y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      if (raw[i] > 90 || raw[i + 1] > 90 || raw[i + 2] > 90) lit++;
    }
  }
  return lit;
}

describe('resolveTranscript', () => {
  it('takes a literal array of words', () => {
    assert.deepEqual(resolveTranscript(WORDS, {}), WORDS);
  });

  it('resolves a source id against the composition transcripts', () => {
    assert.deepEqual(resolveTranscript('a', { a: WORDS }), WORDS);
  });

  it('is null for a reference to a source with no words', () => {
    assert.equal(resolveTranscript('a', { b: WORDS }), null);
  });

  it('is null when absent', () => {
    assert.equal(resolveTranscript(undefined, { a: WORDS }), null);
    assert.equal(resolveTranscript(null, { a: WORDS }), null);
  });
});

describe('buildCaptionAss', () => {
  it('returns null when the composition has no caption source', async () => {
    const comp = { sources: { a: { kind: 'clip' } }, size: { width: W, height: H } };
    assert.equal(await buildCaptionAss(comp, 1, {}), null);
  });

  it('throws rather than silently rendering a caption-free video', async () => {
    // This is the whole fault: it used to return null here, and the render
    // went on to report success over a video with no captions on it.
    await assert.rejects(
      () => buildCaptionAss(captionComp('a'), 1, {}),
      /no words to render/
    );
  });

  it('names the shape that arrived, so the reader can see why', async () => {
    await assert.rejects(
      () => buildCaptionAss(captionComp('a'), 1, {}),
      /reference to source "a"/
    );
  });

  it('throws on an unknown template rather than rendering untemplated', async () => {
    const comp = captionComp(WORDS);
    comp.sources.cap.template = 'not-a-real-preset';
    await assert.rejects(() => buildCaptionAss(comp, 1, {}), /not in shared\/captions\/presets.json/);
  });

  it('compiles when the transcript is a reference and the words are supplied', async () => {
    const p = await buildCaptionAss(captionComp('a'), 1, { a: WORDS });
    assert.ok(p && fs.existsSync(p), 'an ASS file was written');
    const ass = fs.readFileSync(p, 'utf8');
    assert.match(ass, /\[Script Info\]/);
    assert.match(ass, /CONTINENT/i, 'the words reached the subtitle file');
    fs.unlinkSync(p);
  });
});

describe('a composition with captions', () => {
  it('burns them into the picture', async () => {
    const black = makeClip('dark.mp4', 'black', 4);

    // Without captions, the band stays flat.
    const plain = captionComp(WORDS);
    delete plain.sources.cap;
    const plainOut = render(plain, { a: black });
    const before = litPixelsInCaptionBand(plainOut, 1.0);

    // With captions, through the same chain the route now uses.
    const comp = captionComp('a');
    const assPath = await buildCaptionAss(comp, 1, { a: WORDS });
    assert.ok(assPath, 'the caption ASS compiled');

    const result = renderGraph(comp, { captionAssPath: assPath });
    assert.ok(result.needsCaptions, 'the graph reports that it carries captions');
    const resolved = result.inputs.map(() => black);
    const out = path.join(dir, 'captioned.mp4');
    execFileSync(FFMPEG, ffmpegArgs(result, resolved, out), { stdio: ['ignore', 'ignore', 'pipe'] });
    const after = litPixelsInCaptionBand(out, 1.0);
    fs.unlinkSync(assPath);

    assert.ok(
      after > before + 200,
      `captions must change the picture. Without: ${before} lit pixels, `
      + `with: ${after}. A render that drops a caption and reports success is `
      + `the fault this guard exists for.`
    );
  });
});

// ── An animated transform actually moves ─────────────────────────────
//
// The agreement test checks the numbers in the expression. This checks that
// ffmpeg does something with them, which is a different question: `scale`
// silently refuses to animate without `eval=frame`, and the whole stage is
// built around flattening onto a fixed canvas because animating the size
// changes the stream's dimensions and x264 will not encode that.
//
// Path B depends on this. A deterministic camera move over a still IS an
// animated scale and pos, chosen over a hosted image-to-video call so the
// batch has no vendor in its critical path, so if this does not move then
// the batch has no motion at all.

/** How many pixels of the frame are the subject colour. */
function subjectPixels(file, seconds) {
  const raw = execFileSync(FFMPEG, [
    '-loglevel', 'error', '-ss', String(seconds), '-i', file,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { maxBuffer: 64 * 1024 * 1024 });
  let n = 0;
  for (let i = 0; i < raw.length; i += 3) {
    if (raw[i] > 150 && raw[i + 1] < 80 && raw[i + 2] < 80) n++;
  }
  return n;
}

describe('an animated scale', () => {
  it('grows the subject across the item, matching the model', () => {
    const red = makeClip('zoom.mp4', '0xff0000', 5);
    const comp = {
      version: 1, size: { width: W, height: H }, fps: FPS,
      sources: { a: { kind: 'clip', url: 'a.mp4', duration: 5, width: W, height: H, fps: FPS } },
      tracks: [{
        id: 't0', kind: 'video', items: [
          // Start at half the frame and grow to fill it.
          { id: 'i1', at: 0, len: 4, source: 'a', in: 0, scale: { from: 0.5, to: 1.0 } },
        ],
      }],
    };
    const out = render(comp, { a: red });

    const early = subjectPixels(out, 0.1);
    const mid = subjectPixels(out, 2.0);
    const late = subjectPixels(out, 3.9);

    assert.ok(
      early > 0,
      'the subject is on screen at the start; 0 means the transform stage '
      + 'swallowed it rather than scaling it'
    );
    assert.ok(
      mid > early * 1.3,
      `the subject must grow. early=${early} mid=${mid}. If these are equal, `
      + 'scale is not animating: it needs eval=frame, and without it ffmpeg '
      + 'holds the first value for the whole item without complaining.'
    );
    assert.ok(late > mid, `and keep growing. mid=${mid} late=${late}`);

    // Against the model: area goes as scale squared, so 0.5 -> 1.0 is a
    // fourfold change in covered pixels across the item.
    const ratio = late / early;
    assert.ok(
      ratio > 2.5 && ratio < 5.5,
      `the growth should be roughly fourfold (area goes as scale squared, `
      + `0.5 to 1.0), got ${ratio.toFixed(2)}x`
    );
  });

  it('keeps the output frame a constant size', () => {
    // The reason for the flatten onto a fixed canvas. Without it the stream
    // changes dimensions per frame, which x264 refuses and xfade cannot take.
    const red = makeClip('zoom2.mp4', '0xff0000', 5);
    const comp = {
      version: 1, size: { width: W, height: H }, fps: FPS,
      sources: { a: { kind: 'clip', url: 'a.mp4', duration: 5, width: W, height: H, fps: FPS } },
      tracks: [{
        id: 't0', kind: 'video', items: [
          { id: 'i1', at: 0, len: 3, source: 'a', in: 0, scale: { from: 0.4, to: 1.6 } },
        ],
      }],
    };
    const out = render(comp, { a: red });
    const probe = execFileSync(FFMPEG.replace(/ffmpeg$/, 'ffprobe'), [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out,
    ]).toString().trim();
    assert.equal(probe, `${W},${H}`, 'the encoded stream is the composition frame');
  });
});
