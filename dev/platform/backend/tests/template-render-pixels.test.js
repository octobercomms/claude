/**
 * A template, rendered, judged on its frames.
 *
 * Everything else in the template suite proves a template produces a valid
 * Composition. Valid is not the same as watchable, and the gap between them
 * is where this repo keeps finding faults: every render guard but one asserts
 * on the `filter_complex` STRING, and a correct string can reference a stream
 * that does not exist.
 *
 * Three faults this file exists to have caught, all of them found by trying
 * to render a stills montage rather than by reading a graph:
 *
 *   1. A CAPTIONS SOURCE BECAME AN FFMPEG INPUT. Captions are a `subtitles`
 *      filter fed by a compiled ASS file, not footage. The render route
 *      resolves a disk path for every input from `source_assets`, a captions
 *      source has no asset, so it answered 400 "Source … has no file on
 *      disk" and NO captioned composition could render at all — including
 *      every one the editor's "+ Captions" button has ever produced. Had a
 *      path existed it was worse: the caption item was scaled and overlaid as
 *      a picture layer while the same words were burned by the subtitles
 *      filter.
 *   2. A STILL HAS NO AUDIO STREAM. The graph emitted `[n:a]atrim=…` for
 *      every clip source, so one photograph made ffmpeg refuse the whole
 *      filter_complex with "matches no streams". A composition containing a
 *      photograph produced nothing.
 *   3. A ONE-FRAME INPUT NEEDS LOOPING. Without `-loop 1 -t <len>` the input
 *      ends after its single frame and the trim downstream gets nothing, so
 *      the photograph flashes instead of being held.
 *
 * Any of the three makes "upload images and brief it" impossible, which is
 * the whole of what the batch build is for.
 *
 * ffmpeg is required, not optional. A guard that skips is a guard that is not
 * running, so this fails loudly when ffmpeg is absent, the same arrangement
 * composition-render-pixels.test.js uses.
 *
 *   node tests/template-render-pixels.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { bindTemplate } = require('../../shared/compositionTemplate.mjs');
const { renderGraph, ffmpegArgs } = require('../../shared/compositionRender.mjs');
const { validate } = require('../../shared/composition.mjs');
const renderer = require('../src/services/compositionRenderer');

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

// Small, because six stills at 1080x1920 is slow and nothing here is about
// resolution. The template's own size is overridden for the same reason.
const W = 216;
const H = 384;
const FPS = 25;

const TEMPLATES = path.join(__dirname, '..', '..', 'shared', 'templates');

let dir;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-pixels-'));
});

after(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
});

/** A single-frame PNG. A photograph, with no audio stream and no duration. */
function makeStill(name, colour) {
  const p = path.join(dir, name);
  execFileSync(FFMPEG, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${colour}:s=${W}x${H}`,
    '-frames:v', '1', p,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  return p;
}

/** A silent audio file, standing in for the music bed. */
function makeBed(name, seconds) {
  const p = path.join(dir, name);
  execFileSync(FFMPEG, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${seconds}`,
    '-c:a', 'aac', p,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  return p;
}

function template(id, over = {}) {
  const t = JSON.parse(fs.readFileSync(path.join(TEMPLATES, `${id}.json`), 'utf8'));
  return { ...t, size: { width: W, height: H }, fps: FPS, ...over };
}

function render(comp, name, captionAssPath = null) {
  const result = renderGraph(comp, { captionAssPath });
  const resolved = result.inputs.map((inp) => {
    // A generated input (an effect) holds a filtergraph rather than a file,
    // and keeps its slot so the indices ffmpeg numbers by position stay
    // aligned with the graph's `[n:v]`.
    if (inp.generated) return null;
    const url = comp.sources[inp.sourceId]?.url;
    if (!url) throw new Error(`input ${inp.sourceId} (${inp.kind}) has no url`);
    return url;
  });
  const out = path.join(dir, name);
  try {
    execFileSync(FFMPEG, ffmpegArgs(result, resolved, out), { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    const tail = err.stderr ? err.stderr.toString().trim().split('\n').slice(-6).join('\n') : '';
    throw new Error(`ffmpeg refused the graph:\n${tail}\n\ngraph:\n${result.graph}`);
  }
  return { out, result };
}

/** One frame as raw RGB. */
function frame(file, seconds) {
  return execFileSync(FFMPEG, [
    '-loglevel', 'error', '-ss', String(seconds), '-i', file,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { maxBuffer: 64 * 1024 * 1024 });
}

function pixelAt(file, seconds, x = W >> 1, y = H >> 1) {
  const raw = frame(file, seconds);
  const i = (y * W + x) * 3;
  return { r: raw[i], g: raw[i + 1], b: raw[i + 2] };
}

const NAMES = [
  ['RED', (p) => p.r > 150 && p.g < 90 && p.b < 90],
  ['GREEN', (p) => p.g > 150 && p.r < 90 && p.b < 90],
  ['BLUE', (p) => p.b > 150 && p.r < 90 && p.g < 90],
  ['YELLOW', (p) => p.r > 150 && p.g > 150 && p.b < 90],
  ['MAGENTA', (p) => p.r > 150 && p.b > 150 && p.g < 90],
  ['CYAN', (p) => p.g > 150 && p.b > 150 && p.r < 90],
  ['BLACK', (p) => p.r < 40 && p.g < 40 && p.b < 40],
];
const colourOf = (p) => (NAMES.find(([, f]) => f(p)) || ['mixed'])[0];
const show = (p) => `rgb(${p.r},${p.g},${p.b}) read as ${colourOf(p)}`;

/** How many near-white pixels a frame holds, and which rows they sit in. */
function whitePixels(file, seconds) {
  const raw = frame(file, seconds);
  let n = 0;
  let top = null;
  let bottom = null;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 3;
      if (raw[i] > 200 && raw[i + 1] > 200 && raw[i + 2] > 200) {
        n += 1;
        if (top == null) top = y;
        bottom = y;
      }
    }
  }
  return { n, top, bottom };
}

const COLOURS = ['0xff0000', '0x00ff00', '0x0000ff', '0xffff00', '0xff00ff', '0x00ffff'];
const EXPECT = ['RED', 'GREEN', 'BLUE', 'YELLOW', 'MAGENTA', 'CYAN'];

// ── the stills montage, end to end ───────────────────────────────────

describe('a stills montage, bound and rendered', () => {
  let comp;
  let out;

  before(() => {
    const stills = COLOURS.map((c, i) => makeStill(`m${i}.png`, c));
    const bed = makeBed('bed.m4a', 60);
    comp = bindTemplate(template('stills-montage'), {
      stills: stills.map((p) => ({
        kind: 'clip', url: p, duration: 10, width: W, height: H, fps: FPS,
      })),
      titles: ['GRADE II LISTED', 'HACKNEY 2026'],
      music: { kind: 'audio', url: bed, duration: 60 },
    }, { index: 0, seed: 'pixels' });
    out = render(comp, 'montage.mp4').out;
  });

  it('binds to a valid composition', () => {
    assert.deepEqual(validate(comp), []);
  });

  it('marks its photographs as stills, which is how the renderer knows', () => {
    // Without this the graph asks each one for an audio stream it does not
    // have, and ffmpeg refuses the entire filter_complex.
    const clips = Object.values(comp.sources).filter((s) => s.kind === 'clip');
    assert.equal(clips.length, 6);
    for (const c of clips) assert.equal(c.still, true);
  });

  it('gives a still input -loop 1 and a duration', () => {
    // A PNG is one frame. Unlooped, the trim downstream gets nothing and the
    // photograph flashes rather than being held.
    const result = renderGraph(comp);
    const args = ffmpegArgs(result, result.inputs.map(() => '/dev/null'), '/dev/null');
    const loops = args.filter((a) => a === '-loop').length;
    assert.equal(loops, 6, `expected one -loop per still, got ${loops}`);
    const i = args.indexOf('-loop');
    assert.equal(args[i + 1], '1');
    assert.equal(args[i + 2], '-t');
    assert.ok(Number(args[i + 3]) > 0, `the loop is bounded, got ${args[i + 3]}`);
  });

  it('does NOT give an ffmpeg input to the caption source', () => {
    // Captions are a subtitles filter, not footage. As an input they had no
    // disk path, so the route answered 400 and nothing captioned rendered.
    const result = renderGraph(comp);
    assert.ok(
      !result.inputs.some((i) => i.kind === 'captions'),
      `caption sources became inputs: ${JSON.stringify(result.inputs)}`
    );
  });

  it('renders, rather than making ffmpeg refuse the graph', () => {
    assert.ok(fs.existsSync(out) && fs.statSync(out).size > 1000);
  });

  it('is as long as the composition said it would be', () => {
    const want = comp.tracks
      .flatMap((tr) => tr.items.map((i) => i.at + i.len))
      .reduce((a, b) => Math.max(a, b), 0);
    const got = Number(execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', out,
    ]).toString().trim());
    assert.ok(
      Math.abs(got - want) < 0.25,
      `composition says ${want.toFixed(2)}s, the file is ${got.toFixed(2)}s`
    );
  });

  it('darkens the caption zone and leaves the top of the frame alone', () => {
    // THE SCRIM, end to end: template JSON to pixels. The caption preset
    // this template ships with is `gallery-quiet`, which is #FBF9F7 type at
    // 36pt with a 2px outline. Over an architect's white plaster wall that is
    // marginal, and the fix is a graded scrim under the words rather than a
    // louder preset.
    //
    // Measured on the montage's own frames: a strip across the caption zone
    // against the same strip at the top, on the same photograph, in the same
    // frame. Both have to be read from one frame or a transition between two
    // colours would explain any difference.
    const raw = frame(out, 1.2);
    const strip = (y) => {
      let sum = 0;
      for (let x = 0; x < W; x += 1) {
        const i = (y * W + x) * 3;
        sum += raw[i] + raw[i + 1] + raw[i + 2];
      }
      return sum / (W * 3);
    };
    const top = strip(Math.round(H * 0.2));
    const words = strip(Math.round(H * 0.84));
    assert.ok(
      words < top * 0.6,
      `the caption zone should be well under half the brightness of the top:`
      + ` top ${top.toFixed(0)}, caption zone ${words.toFixed(0)}`
    );
    // And the top is genuinely untouched rather than darkened a little
    // everywhere, which is what a scrim starting at zero would do.
    const above = strip(Math.round(H * 0.4));
    assert.ok(
      Math.abs(above - top) < 6,
      `above the scrim's start nothing should change: ${top.toFixed(0)} then ${above.toFixed(0)}`
    );
  });

  it('generates the scrim rather than looking for a file for it', () => {
    // The fault this is the regression test for: `fx` was a declared,
    // validated source kind with no branch in the renderer, so an effect
    // became an ordinary input and the route answered `Source "x" has no
    // file on disk` — the same fault captions had, for the same reason.
    const result = renderGraph(comp);
    const fx = result.inputs.filter((i) => i.kind === 'fx');
    assert.equal(fx.length, 1);
    assert.equal(fx[0].generated, true);
    assert.match(fx[0].lavfi, /geq=/);
  });

  it('shows all six photographs, in order, each held', () => {
    // The fault this guards is the one that produces a plausible file: a
    // single-frame input unlooped gives one frame then nothing, so the
    // montage is one photograph and then black for twelve seconds.
    const shots = comp.tracks[0].items.slice().sort((a, b) => a.at - b.at);
    assert.equal(shots.length, 6);
    shots.forEach((item, i) => {
      // Mid-hold, clear of the half-second crossfades at either end.
      const t = item.at + item.len / 2;
      const p = pixelAt(out, t);
      assert.equal(
        colourOf(p), EXPECT[i],
        `photograph ${i + 1} should be held at ${t.toFixed(2)}s; got ${show(p)}`
      );
    });
  });

  it('crossfades between them rather than cutting', () => {
    // A transition IS the overlap in this model, so mid-transition is a
    // blend of two photographs and neither pure colour.
    const [first, second] = comp.tracks[0].items.slice().sort((a, b) => a.at - b.at);
    const t = second.at + (first.at + first.len - second.at) / 2;
    const p = pixelAt(out, t);
    assert.ok(
      p.r > 40 && p.g > 20,
      `mid-fade at ${t.toFixed(2)}s should blend red into green; got ${show(p)}`
    );
  });

  it('has an audio stream, from the bed alone', () => {
    const streams = execFileSync('ffprobe', [
      '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type',
      '-of', 'default=nw=1:nk=1', out,
    ]).toString().trim().split('\n').filter(Boolean);
    assert.equal(streams.length, 1, 'one audio stream, mixed from the music slot');
  });
});

// ── on-screen type, burned ───────────────────────────────────────────

describe('a template that puts type on screen', () => {
  // AT FULL SIZE, unlike the rest of this file. The ASS is authored against
  // the preset's own output format (1080x1920), and `subtitles` scales it to
  // the video. Shrinking the frame to 216 wide scales 36px type to about
  // seven pixels, which is too small to measure and would make this a test
  // of the threshold rather than of the burn. The cost is one slower render.
  const FW = 1080;
  const FH = 1920;

  let comp;
  let out;
  let cues;

  const whiteAtFull = (file, seconds) => {
    const raw = execFileSync(FFMPEG, [
      '-loglevel', 'error', '-ss', String(seconds), '-i', file,
      '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
    ], { maxBuffer: 64 * 1024 * 1024 });
    let n = 0;
    let top = null;
    for (let y = 0; y < FH; y += 1) {
      for (let x = 0; x < FW; x += 1) {
        const i = (y * FW + x) * 3;
        if (raw[i] > 200 && raw[i + 1] > 200 && raw[i + 2] > 200) {
          n += 1;
          if (top == null) top = y;
        }
      }
    }
    return { n, top };
  };

  before(async () => {
    // Dark frames, so near-white pixels can only be the type.
    const stills = ['0x202020', '0x303030', '0x282828', '0x383838', '0x242424', '0x343434']
      .map((c, i) => {
        const p = path.join(dir, `t${i}.png`);
        execFileSync(FFMPEG, [
          '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${c}:s=${FW}x${FH}`,
          '-frames:v', '1', p,
        ], { stdio: ['ignore', 'ignore', 'pipe'] });
        return p;
      });
    const bed = makeBed('bed2.m4a', 60);
    comp = bindTemplate(template('stills-montage', { size: { width: FW, height: FH } }), {
      stills: stills.map((p) => ({
        kind: 'clip', url: p, duration: 10, width: FW, height: FH, fps: FPS,
      })),
      titles: ['GRADE II LISTED', 'HACKNEY 2026'],
      music: { kind: 'audio', url: bed, duration: 60 },
    }, { index: 0, seed: 'type' });
    cues = Object.values(comp.sources).find((s) => s.kind === 'captions').transcript;
    const ass = await renderer.buildCaptionAss(comp, 'pixels', {});
    out = render(comp, 'type.mp4', ass).out;
  });

  it('writes one cue per line, not one per word', () => {
    assert.deepEqual(cues.map((c) => c.word), ['GRADE II LISTED', 'HACKNEY 2026']);
  });

  it('keeps each line whole in the ASS, rather than regrouping into threes', async () => {
    // `perLine: 1` on the source. The preset's own grouping would break
    // "GRADE II LISTED" after the third word, which for a title is wrong.
    const ass = fs.readFileSync(await renderer.buildCaptionAss(comp, 'ass-check', {}), 'utf8');
    const lines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    assert.equal(lines.length, 2);
    assert.match(lines[0], /GRADE II LISTED/);
    assert.match(lines[1], /HACKNEY 2026/);
  });

  it('burns the type into the frames', () => {
    const t = cues[0].start + (cues[0].end - cues[0].start) / 2;
    const { n } = whiteAtFull(out, t);
    assert.ok(n > 200, `expected burned type at ${t.toFixed(2)}s, found ${n} near-white pixels`);
  });

  it('puts it in the lower third, not across the middle of the photograph', () => {
    const t = cues[0].start + (cues[0].end - cues[0].start) / 2;
    const { top } = whiteAtFull(out, t);
    assert.ok(top > FH * 0.55, `type starts at row ${top} of ${FH}, which is not the lower third`);
  });

  it('takes it away when the cue ends', () => {
    // The other half of the claim. Type that never leaves is not a caption,
    // and a test that only checks for its presence passes on a watermark.
    const after = cues[cues.length - 1].end + 1.5;
    const { n } = whiteAtFull(out, after);
    assert.equal(n, 0, `${n} near-white pixels still on screen at ${after.toFixed(2)}s`);
  });
});

// ── every shipped template renders ───────────────────────────────────

describe('every shipped template renders', () => {
  // The guard that matters when a template is edited: a shape that validates
  // and binds but makes ffmpeg refuse the graph is no use, and a batch of
  // thirty is where that gets discovered otherwise.
  //
  // `design` slots are given a still, because a Design page reaches the
  // render path as a rasterised image and standing up the design service
  // here would test that service rather than the template.
  const files = fs.readdirSync(TEMPLATES).filter((f) => f.endsWith('.json')).sort();

  for (const file of files) {
    const id = file.replace('.json', '');
    it(`${id} produces a file with pictures in it`, () => {
      const t = template(id);
      const content = {};
      t.slots.forEach((s, si) => {
        const n = s.min ?? 1;
        if (!n) return;
        const made = Array.from({ length: n }, (_, i) => {
          if (s.kind === 'text') return `Line ${i + 1}`;
          if (s.kind === 'audio') return { kind: 'audio', url: makeBed(`b-${id}-${si}-${i}.m4a`, 90), duration: 90 };
          return {
            kind: 'clip',
            url: makeStill(`p-${id}-${si}-${i}.png`, COLOURS[i % COLOURS.length]),
            duration: 10,
            width: W,
            height: H,
            fps: FPS,
            // A design page rasterises to an image on this path too.
            still: true,
          };
        });
        content[s.id] = (s.max === 1) ? made[0] : made;
      });

      const comp = bindTemplate(t, content, { index: 2, seed: 'all' });
      assert.deepEqual(validate(comp), []);
      const { out } = render(comp, `${id}.mp4`);
      assert.ok(fs.statSync(out).size > 1000, 'the file has something in it');

      // Not black. A graph that renders twelve seconds of nothing is the
      // failure mode every one of the faults above produced.
      const mid = comp.tracks
        .flatMap((tr) => tr.items.map((i) => i.at + i.len))
        .reduce((a, b) => Math.max(a, b), 0) / 2;
      const p = pixelAt(out, mid);
      assert.notEqual(colourOf(p), 'BLACK', `${id} is black at ${mid.toFixed(2)}s`);
    });
  }
});
