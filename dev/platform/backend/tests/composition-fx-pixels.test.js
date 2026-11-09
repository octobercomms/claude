/**
 * The three effects, judged on the pixels they put on screen.
 *
 * The graph-level guards next door prove the renderer builds the right
 * string. They cannot prove the effect is visible, and that is the whole
 * risk here, because the way ffmpeg loses an overlay is silently:
 *
 *   - `drawbox` writes colour and leaves ALPHA AT ZERO. A rule drawn with it
 *     measured [228,228,228,0] where geq's measured [255,255,255,230]: it
 *     composites as nothing, with no error in the log. That is why every
 *     mask in the catalogue is geq's.
 *   - `format=yuva420p` has to precede geq or there is no alpha plane to
 *     write, and the effect comes out fully opaque — a vignette that renders
 *     as a black frame.
 *
 * Neither shows in a graph string, and neither would fail a render. So each
 * effect is rendered over a mid-grey picture through the real module and the
 * frames are sampled: 128 is the base, and what moved away from it is the
 * effect.
 *
 * ffmpeg is required, not optional, for the same reason as the other two
 * pixel files: a guard that skips is a guard that is not running.
 *
 *   node tests/composition-fx-pixels.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { renderGraph, ffmpegArgs } = require('../../shared/compositionRender.mjs');
const { validate } = require('../../shared/composition.mjs');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

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

const W = 216;
const H = 384;
const FPS = 25;
// Mid-grey, so an effect that darkens and an effect that brightens are both
// measurable against the same base. On black a scrim is invisible; on white a
// rule is.
const BASE = 128;

let dir;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-pixels-'));
});

after(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
});

function makeGrey(name, seconds) {
  const p = path.join(dir, name);
  execFileSync(FFMPEG, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=0x808080:s=${W}x${H}:r=${FPS}:d=${seconds}`,
    '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${seconds}`,
    '-shortest', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac', p,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  return p;
}

/** A grey picture on track 0 with one effect over it on track 1. */
function withEffect(effect, params, len = 3, itemExtra = {}) {
  return {
    version: 1,
    size: { width: W, height: H },
    fps: FPS,
    sources: {
      g: { kind: 'clip', url: 'g.mp4', duration: 10, width: W, height: H, fps: FPS },
      f: { kind: 'fx', effect, ...(params ? { params } : {}) },
    },
    tracks: [
      { id: 't0', kind: 'video', items: [{ id: 'i1', at: 0, len, source: 'g', in: 0 }] },
      { id: 't1', kind: 'video', items: [{ id: 'i2', at: 0, len, source: 'f', ...itemExtra }] },
    ],
  };
}

let grey;

function render(comp, name) {
  if (!grey) grey = makeGrey('g.mp4', 10);
  const errs = validate(comp);
  assert.deepEqual(errs, [], `the composition itself is invalid: ${errs.join('; ')}`);
  const result = renderGraph(comp);
  const resolved = result.inputs.map((inp) => (inp.generated ? null : grey));
  const out = path.join(dir, name);
  try {
    execFileSync(FFMPEG, ffmpegArgs(result, resolved, out), { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    const tail = err.stderr ? err.stderr.toString().trim().split('\n').slice(-8).join('\n') : '';
    throw new Error(`ffmpeg refused the graph:\n${tail}\n\ngraph:\n${result.graph}`);
  }
  return out;
}

function frame(file, seconds) {
  return execFileSync(FFMPEG, [
    '-loglevel', 'error', '-ss', String(seconds), '-i', file,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { maxBuffer: 64 * 1024 * 1024 });
}

/** The luma-ish value of one pixel: these effects are all neutral. */
function at(raw, x, y) {
  return raw[(y * W + x) * 3];
}

// ── the scrim ─────────────────────────────────────────────────────────

describe('the bottom scrim', () => {
  let raw;

  before(() => {
    raw = frame(render(withEffect('scrim'), 'scrim.mp4'), 1.0);
  });

  it('leaves the top of the frame untouched', () => {
    // Not "roughly the same": identical. A scrim that darkens everything a
    // little is a grade, and it would flatten the photography it sits on.
    for (const y of [0, Math.round(H * 0.2), Math.round(H * 0.4)]) {
      assert.ok(
        Math.abs(at(raw, W >> 1, y) - BASE) <= 2,
        `y=${y} should still be ${BASE}, read ${at(raw, W >> 1, y)}`
      );
    }
  });

  it('is at full strength where the type sits, not at the bottom edge', () => {
    // `full` defaults to 0.85 because burned captions sit on MarginV 320 of
    // a 1920 frame: roughly 0.78 to 0.85 down. A ramp reaching full strength
    // only at the bottom edge spends its darkness in the empty strip below
    // the words — 30-40% where it is needed, which is not enough to rescue
    // #FBF9F7 type on white plaster.
    const words = at(raw, W >> 1, Math.round(H * 0.84));
    assert.ok(words < 60, `the caption zone should be dark, read ${words}`);
  });

  it('grades rather than stepping', () => {
    const ys = [0.6, 0.68, 0.76, 0.84].map((p) => at(raw, W >> 1, Math.round(H * p)));
    for (let i = 1; i < ys.length; i += 1) {
      assert.ok(ys[i] <= ys[i - 1], `not monotonic: ${ys.join(' -> ')}`);
    }
    assert.ok(ys[0] - ys[ys.length - 1] > 40, `barely graded: ${ys.join(' -> ')}`);
  });

  it('starts where it was asked to', () => {
    const high = frame(render(withEffect('scrim', { start: 0.2, full: 0.5 }), 'scrim-high.mp4'), 1.0);
    assert.ok(Math.abs(at(high, W >> 1, Math.round(H * 0.1)) - BASE) <= 2, 'above 0.2 untouched');
    assert.ok(at(high, W >> 1, Math.round(H * 0.35)) < BASE - 15, 'darkening by 0.35');
    assert.ok(at(high, W >> 1, Math.round(H * 0.6)) < 60, 'full strength past 0.5');
  });

  it('holds for the whole item, rather than one frame of it', () => {
    // The lavfi source emits ONE frame. Without the loop the effect appears
    // for a fortieth of a second and the rest of the reel is ungraded, which
    // is the kind of fault that passes every test that reads a graph.
    const y = Math.round(H * 0.84);
    for (const t of [0.1, 1.5, 2.8]) {
      const f = frame(render(withEffect('scrim'), 'scrim.mp4'), t);
      assert.ok(at(f, W >> 1, y) < 60, `at ${t}s the scrim is gone: ${at(f, W >> 1, y)}`);
    }
  });

  it('dials down with the item\'s own opacity', () => {
    // So an operator can soften an effect without a new preset: the item
    // opacity multiplies the mask's alpha like any other layer's.
    const half = frame(render(withEffect('scrim', null, 3, { opacity: 0.35 }), 'scrim-soft.mp4'), 1.0);
    const y = Math.round(H * 0.84);
    const full = at(raw, W >> 1, y);
    const soft = at(half, W >> 1, y);
    assert.ok(soft > full + 20, `0.35 opacity should be lighter: full ${full}, soft ${soft}`);
    assert.ok(soft < BASE - 10, `and still visible: ${soft} against a base of ${BASE}`);
  });
});

// ── the vignette ──────────────────────────────────────────────────────

describe('the vignette', () => {
  let raw;

  before(() => {
    raw = frame(render(withEffect('vignette'), 'vignette.mp4'), 1.0);
  });

  it('leaves the centre and darkens the edges', () => {
    const centre = at(raw, W >> 1, H >> 1);
    const edge = at(raw, 2, H >> 1);
    const corner = at(raw, 1, 1);
    assert.ok(Math.abs(centre - BASE) <= 2, `the centre should be ${BASE}, read ${centre}`);
    assert.ok(edge < 60, `the edge should be dark, read ${edge}`);
    assert.ok(corner <= edge, `the corner should be at least as dark: ${corner} vs ${edge}`);
  });

  it('falls off smoothly from the middle outwards', () => {
    const steps = [0, 0.15, 0.3, 0.45].map((p) => at(raw, Math.round(W * (0.5 - p)), H >> 1));
    for (let i = 1; i < steps.length; i += 1) {
      assert.ok(steps[i] <= steps[i - 1], `not monotonic: ${steps.join(' -> ')}`);
    }
  });

  it('is a circle on a TALL frame, not an oval', () => {
    // The distance is normalised per axis, so the same FRACTION of the way
    // to the edge darkens by the same amount whichever axis it is on.
    // Without that a 9:16 frame gets a vignette squashed into a letterbox:
    // dark down both sides and barely there at the top and bottom.
    //
    // This has to be measured on a frame that is NOT square. The first
    // version of it rendered at 200x200, where dividing by W/2 and by H/2
    // are the same arithmetic, so swapping one for the other changed nothing
    // and the test passed on a broken expression. A mutation sweep caught it.
    const d = 0.8; // eight tenths of the way from centre to edge, both axes
    const across = at(raw, Math.round((W / 2) * (1 + d)), H >> 1);
    const down = at(raw, W >> 1, Math.round((H / 2) * (1 + d)));
    assert.ok(
      Math.abs(across - down) < 12,
      `the same fraction out should darken the same: across ${across}, down ${down}`
    );
    assert.ok(across < BASE - 40, `and both are well into the falloff: ${across}`);
  });

  it('takes its strength from the parameter', () => {
    const soft = frame(render(withEffect('vignette', { strength: 0.3 }), 'vignette-soft.mp4'), 1.0);
    assert.ok(
      at(soft, 2, H >> 1) > at(raw, 2, H >> 1) + 20,
      `0.3 strength should be lighter at the edge: ${at(soft, 2, H >> 1)} vs ${at(raw, 2, H >> 1)}`
    );
  });
});

// ── the rule ──────────────────────────────────────────────────────────

describe('the hairline rule', () => {
  let raw;
  const Y = Math.round(H * 0.78);

  before(() => {
    raw = frame(render(withEffect('rule'), 'rule.mp4'), 1.0);
  });

  it('draws a bright line where it was asked to', () => {
    const on = at(raw, W >> 1, Y);
    assert.ok(on > 200, `the line should be near-white, read ${on}`);
  });

  it('draws NOTHING anywhere else', () => {
    // The fault this is the regression test for: `drawbox` writes colour and
    // leaves alpha at zero, so a rule drawn with it is invisible. The
    // opposite fault is as bad and as quiet: an alpha expression that is
    // non-zero everywhere washes the whole frame.
    for (const y of [Y - 6, Y + 6, 10, H >> 1, H - 4]) {
      assert.ok(
        Math.abs(at(raw, W >> 1, y) - BASE) <= 3,
        `y=${y} should be untouched ${BASE}, read ${at(raw, W >> 1, y)}`
      );
    }
  });

  it('stops short of both edges', () => {
    // `inset` defaults to 0.12 of the width. A rule running edge to edge
    // reads as a divider rather than a typographic mark.
    assert.ok(Math.abs(at(raw, 4, Y) - BASE) <= 3, `inside the left inset: ${at(raw, 4, Y)}`);
    assert.ok(Math.abs(at(raw, W - 5, Y) - BASE) <= 3, `inside the right inset: ${at(raw, W - 5, Y)}`);
    assert.ok(at(raw, Math.round(W * 0.2), Y) > 200, 'and drawn inside the insets');
  });

  it('moves and thickens with its parameters', () => {
    const moved = frame(
      render(withEffect('rule', { y: 0.3, thickness: 8 }), 'rule-moved.mp4'), 1.0
    );
    const y30 = Math.round(H * 0.3);
    assert.ok(at(moved, W >> 1, y30) > 200, `the line is at 0.3 now: ${at(moved, W >> 1, y30)}`);
    assert.ok(Math.abs(at(moved, W >> 1, Y) - BASE) <= 3, 'and not at 0.78 any more');
    // 8px thick: three pixels either side of centre are still on the line.
    assert.ok(at(moved, W >> 1, y30 + 3) > 200, 'and it is thick');
  });
});
