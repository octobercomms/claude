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
