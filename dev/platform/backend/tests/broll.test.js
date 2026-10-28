/**
 * Where b-roll belongs, and that it actually lands there.
 *
 * Two halves, tested differently. The plan is arithmetic on a transcript and
 * is checked directly. The render is checked by sampling frames: the only
 * honest question about an overlay is whether the picture changed during the
 * span and went back afterwards, and nothing but a frame answers that.
 *
 * Renders real video with ffmpeg; no network and no database.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const brollRender = require('../src/services/brollRender');

let pass = 0; const fails = [];
function ok(label, fn) {
  try { fn(); pass += 1; console.log(`  ok   ${label}`); }
  catch (e) { fails.push([label, e.message]); console.log(`  FAIL ${label}\n       ${e.message}`); }
}
function have(bin) {
  try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

/** Words at a steady rate, with a sentence break wherever a full stop is. */
function say(text, wps = 2.6) {
  return text.split(/\s+/).map((w, i) => ({ word: w, start: i / wps, end: i / wps + 0.3 }));
}

const solid = (dir, name, colour, seconds, size = '480x854') => {
  const out = path.join(dir, name);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${colour}:s=${size}:d=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=220:duration=${seconds}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', out]);
  return out;
};

/** The average colour of one frame, which is how "the picture changed" is asked. */
function frameColour(video, at) {
  const txt = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', video,
    '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
  { maxBuffer: 1 << 20 });
  return [txt[0], txt[1], txt[2]];
}
const near = (a, b, tol = 26) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

(async () => {
  const { planBroll } = await import(pathToFileURL(
    path.join(__dirname, '..', '..', 'shared', 'brollPlan.mjs')).href);

  console.log('\nThe hook and the payoff stay on the face');
  {
    // Both sentences here would otherwise be chosen: each names something
    // showable, which is the only way a candidate wins this early or this
    // late. A fixture of plain filler would pass whether the guards existed
    // or not, which is no test of a guard at all.
    const r = planBroll(say('Here is the thing we made. '
      + 'One two three four five six seven eight nine ten eleven twelve thirteen. '
      + 'Fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one. '
      + 'Finally this is it.'));
    ok('nothing is proposed inside the opening, though the first sentence points at something', () =>
      assert.ok(r.spans.every((s) => s.from >= 3), JSON.stringify(r.spans)));
    ok('and nothing runs into the last seconds, though the last sentence does too', () =>
      assert.ok(r.spans.every((s) => s.to <= r.duration_s - 2 + 0.01), JSON.stringify(r.spans)));
  }

  console.log('\nIt proposes a change when the shot has run long');
  {
    const long = say('a '.repeat(60).trim());        // one unbroken stretch
    const r = planBroll(long);
    ok('a long unbroken take earns at least one cutaway', () => assert.ok(r.spans.length >= 1));
    ok('and the reason names how long the shot had run', () =>
      assert.match(r.spans[0].reason, /on the same shot/));
  }

  console.log('\nAnd when a sentence names something showable');
  {
    // Long enough to have room. On a six-second clip there is no room between
    // the hook and the payoff for any cutaway at all, which is correct and is
    // covered by the short-transcript case below.
    const r = planBroll(say('Right so we begin here and I want to walk you through it. '
      + 'This is the drawing we made at the very start of the project. '
      + 'It took us three weeks of work to get the thing right. '
      + 'Nobody outside the studio has seen this one before today.'));
    const showable = r.spans.filter((s) => s.showable);
    ok('a sentence that points at something is picked out', () => assert.ok(showable.length >= 1));
    ok('and the reason quotes the words that did it', () =>
      assert.match(showable[0].reason, /names something you could show/));
  }

  console.log('\nIt does not cut every other sentence');
  {
    const r = planBroll(say('This is one. This is two. This is three. This is four. '
      + 'This is five. This is six. This is seven. This is eight. This is nine.'));
    ok('two cutaways are never closer than the minimum gap', () => {
      for (let i = 1; i < r.spans.length; i += 1) {
        assert.ok(r.spans[i].from - r.spans[i - 1].to >= 4 - 0.01,
          `${r.spans[i - 1].to} then ${r.spans[i].from}`);
      }
    });
    ok('and no single cutaway runs longer than the maximum', () =>
      assert.ok(r.spans.every((s) => s.to - s.from <= 5 + 0.01)));
  }

  console.log('\nNothing throws on nothing');
  {
    ok('an empty transcript proposes nothing', () => {
      const r = planBroll([]);
      assert.deepStrictEqual(r.spans, []);
      assert.strictEqual(r.duration_s, 0);
    });
    ok('and so does rubbish', () => {
      assert.deepStrictEqual(planBroll('nope').spans, []);
      assert.deepStrictEqual(planBroll(null).spans, []);
    });
    ok('a transcript shorter than the protected ends proposes nothing', () =>
      assert.deepStrictEqual(planBroll(say('One two three four')).spans, []));
  }

  console.log('\nThe plan is told the file’s real length');
  {
    const words = say('One two three four five six seven eight nine ten eleven twelve');
    const short = planBroll(words);
    const full = planBroll(words, { media_s: 40 });
    ok('a clip that runs on past the last word has more room for cutaways', () =>
      assert.ok(full.duration_s > short.duration_s));
  }

  if (!have('ffmpeg')) {
    console.log('\nffmpeg missing: the render assertions would silently skip');
    process.exit(1);
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'broll-'));
  const base = solid(work, 'base.mp4', 'black', 12);
  const red = solid(work, 'red.mp4', 'red', 6);
  const green = solid(work, 'green.mp4', 'green', 6);

  console.log('\nThe cutaway is on the screen, and only during its span');
  {
    const out = path.join(work, 'one.mp4');
    const r = await brollRender.overlay({ source: base,
      placements: [{ from: 4, to: 7, file: red }], outPath: out });
    ok('it renders, and keeps the length of the talking head', () =>
      assert.ok(Math.abs(r.seconds - 12) < 0.6, `${r.seconds}s`));
    ok('the frame before the span is the speaker', () =>
      assert.ok(near(frameColour(out, 2), [0, 0, 0]), String(frameColour(out, 2))));
    ok('the frame inside the span is the b-roll', () =>
      assert.ok(frameColour(out, 5.5)[0] > 100, String(frameColour(out, 5.5))));
    ok('and the frame after it is the speaker again', () =>
      assert.ok(near(frameColour(out, 9), [0, 0, 0]), String(frameColour(out, 9))));
  }

  console.log('\nTwo cutaways do not bleed into each other');
  {
    const out = path.join(work, 'two.mp4');
    await brollRender.overlay({ source: base,
      placements: [{ from: 2, to: 4, file: red }, { from: 7, to: 9, file: green }],
      outPath: out });
    ok('the first span is the first clip', () => assert.ok(frameColour(out, 3)[0] > 100));
    ok('the gap between them is the speaker', () =>
      assert.ok(near(frameColour(out, 5.5), [0, 0, 0]), String(frameColour(out, 5.5))));
    ok('and the second span is the second clip', () => {
      const c = frameColour(out, 8);
      assert.ok(c[1] > 60 && c[0] < 100, String(c));
    });
  }

  console.log('\nA cutaway shorter than its span is clipped, not looped');
  {
    const brief = solid(work, 'brief.mp4', 'red', 1.5);
    const out = path.join(work, 'short.mp4');
    const r = await brollRender.overlay({ source: base,
      placements: [{ from: 4, to: 9, file: brief }], outPath: out });
    ok('the render says what it actually used', () => {
      assert.strictEqual(r.placements[0].clipped, true);
      assert.ok(r.placements[0].to < 6, `ran to ${r.placements[0].to}`);
    });
    ok('and the speaker is back before the span the operator asked for ended', () =>
      assert.ok(near(frameColour(out, 8), [0, 0, 0]), String(frameColour(out, 8))));
  }

  console.log('\nIt refuses what it cannot render');
  {
    const bad = async (placements, re) => {
      try {
        await brollRender.overlay({ source: base, placements, outPath: path.join(work, 'x.mp4') });
        return 'no error';
      } catch (e) { return re.test(e.message) ? 'ok' : `wrong error: ${e.message}`; }
    };
    ok('no placements at all', async () =>
      assert.strictEqual(await bad([], /nothing to lay over/), 'ok'));
    ok('more cutaways than one pass should carry', async () => {
      const many = Array.from({ length: 9 }, (_, i) => ({ from: i, to: i + 0.5, file: red }));
      assert.strictEqual(await bad(many, /most this renders/), 'ok');
    });
    ok('a clip that is no longer on disk', async () =>
      assert.strictEqual(await bad([{ from: 1, to: 2, file: path.join(work, 'gone.mp4') }],
        /no longer on disk/), 'ok'));
  }

  fs.rmSync(work, { recursive: true, force: true });
  console.log(fails.length ? `\n${fails.length} failed, ${pass} passed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('THREW:', e.message); process.exit(1); });
