/**
 * A photograph with a camera move, judged on the frames it produces.
 *
 * The graph-level guards next door prove the renderer writes `-loop 1` and
 * bounds it with `-t`. They cannot prove the result is a moving picture, and
 * that is the whole risk with a still, because both ways it fails are silent:
 *
 *   - no `-loop 1` and the input contributes ONE frame. ffmpeg exits 0 and
 *     the reel holds a frozen flash where the photograph should be.
 *   - a loop with no `-t` never ends. Here that shows as a render that fills
 *     the disk rather than an error.
 *
 * And the move itself is the thing nobody has verified: an animated `scale`
 * that silently resolves to a constant renders a static photograph, exits 0,
 * and looks exactly like a correct render of a template that chose "hold".
 *
 * So each case is rendered through the real module and the frames are read
 * back. The control case is what makes the measurement mean anything: a
 * photograph on "hold" must come out IDENTICAL frame to frame, so a move that
 * measures as movement is movement rather than encoder noise.
 *
 * ffmpeg is required, not optional, for the same reason as the other pixel
 * files: a guard that skips is a guard that is not running.
 *
 *   node tests/composition-still-pixels.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const C = require('../../shared/composition.mjs');
const { renderGraph, ffmpegArgs, expectedDuration } = require('../../shared/compositionRender.mjs');
const { MOTION_NAMES, transformFor, STILL_DEFAULT_LEN } = require('../../shared/compositionTemplate.mjs');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

for (const bin of [FFMPEG, FFPROBE]) {
  try {
    execFileSync(bin, ['-version'], { stdio: 'ignore' });
  } catch {
    console.error(
      `\n  FAIL ${bin} is not on this machine. These assertions are about real\n`
      + '       frames, so there is nothing to check without it.\n'
    );
    process.exit(1);
  }
}

// Small, because 96 frames of 1080x1920 is slow and the question is about
// motion rather than resolution. Portrait, because that is what October ships.
const W = 216;
const H = 384;
const FPS = 25;

let dir;
let shot;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'still-pixels-'));
  // A fine checkerboard, and the choice is load-bearing.
  //
  // A camera move over a flat field produces identical frames however correct
  // the move is, so a flat picture makes every assertion below vacuous. The
  // first version of this file used `testsrc2`, which looks detailed and is
  // not: it is built from broad horizontal bands, so a VERTICAL move slides
  // within one band and changes almost nothing. `rise` measured 3.55 against
  // `drift`'s 28.8 at the same magnitude, and a held photograph measured 3.6,
  // so the two were indistinguishable and this file briefly accused the
  // renderer of dropping vertical motion. The graphs were correct; the
  // picture was wrong.
  //
  // A 6px checker has structure on both axes at a pitch finer than any move
  // here, so a shift in any direction changes most pixels. With it a held
  // photograph measures exactly 0.000 — the renderer really does emit
  // identical frames — which is what makes a number above zero mean motion
  // rather than encoder noise.
  shot = path.join(dir, 'shot.png');
  execFileSync(FFMPEG, [
    '-v', 'error', '-f', 'lavfi',
    '-i', `nullsrc=size=${W * 4}x${H * 4},`
      + "geq=lum='if(mod(floor(X/6)+floor(Y/6)\\,2)\\,235\\,16)':cb=128:cr=128",
    '-frames:v', '1', shot, '-y',
  ], { stdio: 'ignore' });
  assert.ok(fs.statSync(shot).size > 1000, 'the test photograph did not render');
});

after(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
});

function stillComp(motion) {
  let comp = C.emptyComposition({ width: W, height: H, fps: FPS });
  const t = C.addTrack(comp, 'video');
  comp = t.comp;
  const s = C.addSource(comp, {
    kind: 'clip', still: true, asset: 1, url: '/f/shot.png',
    width: W * 4, height: H * 4, fps: FPS, originalName: 'shot.png',
  });
  comp = s.comp;
  const i = C.addItem(comp, t.id, {
    at: 0, len: STILL_DEFAULT_LEN, source: s.id,
    ...(motion ? { ...transformFor(motion), beat: motion } : {}),
  });
  return { comp: i.comp, sourceId: s.id };
}

function render(motion, name) {
  const { comp, sourceId } = stillComp(motion);
  assert.deepStrictEqual(C.validate(comp), [], `${name} did not validate`);
  const sourcePaths = { [sourceId]: shot };
  const result = renderGraph(comp, { sourcePaths });
  const paths = result.inputs.map(i => sourcePaths[i.sourceId] ?? null);
  const out = path.join(dir, `${name}.mp4`);
  execFileSync(FFMPEG, ['-v', 'error', ...ffmpegArgs(result, paths, out)], { stdio: 'pipe' });
  return { out, comp };
}

/** The mean luma difference between two frames of one file, 0 = identical. */
function frameDelta(file, aSec, bSec) {
  const a = path.join(dir, `a-${path.basename(file)}-${aSec}.png`);
  const b = path.join(dir, `b-${path.basename(file)}-${bSec}.png`);
  for (const [sec, p] of [[aSec, a], [bSec, b]]) {
    execFileSync(FFMPEG, ['-v', 'error', '-ss', String(sec), '-i', file,
      '-frames:v', '1', p, '-y'], { stdio: 'ignore' });
  }
  const out = execFileSync(FFMPEG, [
    '-v', 'error', '-i', a, '-i', b,
    '-filter_complex', 'blend=all_mode=difference,format=gray,signalstats,metadata=print:file=-',
    '-f', 'null', '-',
  ], { encoding: 'utf8' });
  const m = out.match(/YAVG=([\d.]+)/);
  assert.ok(m, `could not measure the difference: ${out.slice(0, 200)}`);
  return parseFloat(m[1]);
}

function probe(file) {
  const out = execFileSync(FFPROBE, [
    '-v', 'error', '-show_entries', 'format=duration',
    '-show_entries', 'stream=width,height,nb_frames',
    '-of', 'default=nw=1', file,
  ], { encoding: 'utf8' });
  const n = (k) => {
    const m = out.match(new RegExp(`${k}=([\\d.]+)`));
    return m ? parseFloat(m[1]) : null;
  };
  return { duration: n('duration'), width: n('width'), height: n('height'), frames: n('nb_frames') };
}

describe('a photograph renders as a moving picture', () => {
  it('holds for its whole length rather than flashing one frame', () => {
    const { out, comp } = render('push-in', 'push-in');
    const p = probe(out);

    assert.strictEqual(p.width, W);
    assert.strictEqual(p.height, H);
    // The failure this catches: a still with no `-loop 1` contributes a single
    // frame, which encodes without error as a file lasting 1/fps of a second.
    assert.ok(Math.abs(p.duration - STILL_DEFAULT_LEN) < 0.1,
      `rendered ${p.duration}s, wanted ${STILL_DEFAULT_LEN}s — a one-frame still `
      + `would measure about ${(1 / FPS).toFixed(2)}s`);
    assert.strictEqual(p.duration, expectedDuration(comp),
      'the model and the file disagree about the length');
    assert.ok(p.frames >= STILL_DEFAULT_LEN * FPS - 2,
      `only ${p.frames} frames for ${STILL_DEFAULT_LEN}s at ${FPS}fps`);
  });

  it('actually moves, measured against a photograph that does not', () => {
    const moving = render('push-in', 'moving');
    const holding = render(null, 'holding');

    // The control, and it is the whole basis of the measurement: a photograph
    // with no move must be identical frame to frame. Measured at 0.000 on
    // this picture, so the tolerance is for a future encoder default rather
    // than for anything seen here.
    const still = frameDelta(holding.out, 0.2, 2.8);
    assert.ok(still < 1,
      `a photograph on hold changed by ${still} between 0.2s and 2.8s, so this `
      + 'file cannot tell a camera move from encoder noise');

    const moved = frameDelta(moving.out, 0.2, 2.8);
    assert.ok(moved > 20 && moved > still * 20,
      `push-in changed the frame by ${moved} against ${still} for hold — the `
      + 'animated scale is resolving to a constant, so the photograph is static');
  });

  it('every move in the vocabulary produces movement', () => {
    // Not one move, because an animated `pos` and an animated `scale` travel
    // different paths through the graph, and `subtle` is the one near enough
    // to nothing that a broken implementation could hide inside it.
    const results = {};
    for (const name of MOTION_NAMES) {
      const r = render(name, `m-${name}`);
      results[name] = frameDelta(r.out, 0.2, 2.8);
    }
    const dead = Object.entries(results).filter(([, d]) => d < 20).map(([n]) => n);
    assert.deepStrictEqual(dead, [],
      `these moves rendered a static photograph: ${JSON.stringify(results)}`);

    // What this file deliberately does NOT assert: that the moves rank in the
    // order their descriptions imply. An earlier version required `subtle` to
    // measure smallest, because its tooltip says it "barely moves". On this
    // checkerboard it measures LARGEST, since a small scale change on a
    // high-frequency pattern moves every pixel across an edge. The ranking is
    // a property of the picture, not of the move, and a test that encodes the
    // tooltip's prose as fact is testing the prose. Whether `subtle` reads as
    // gentle on a photograph of a building is a judgement, and this is not
    // the place for it.
  });
});
