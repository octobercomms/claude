/**
 * The vision pass that reads caption treatment off a reference video.
 *
 * Everything here is the wiring between ffmpeg, a model and the pure matcher,
 * and wiring is where this build keeps finding faults: a correct graph about
 * a file that did not exist, a cost call with the wrong parameter names, a
 * regex that had never once matched a real asset url. So the frames are real
 * frames from a real file measured with ffprobe, and the model is stubbed at
 * the boundary rather than mocked deeper in, so what is asserted is what
 * would actually be sent and what would actually come back.
 *
 * The one assertion that matters most is the one about the prompt: it must
 * name no preset. A model handed a list of 31 names picks one, and the whole
 * design of this feature is that it describes what it sees and the matching
 * is arithmetic.
 *
 *   node tests/reference-vision.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const vision = require('../src/services/referenceVision');
const claude = require('../src/services/claude');
const aiModels = require('../src/services/aiModels');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

try {
  execFileSync(FFMPEG, ['-version'], { stdio: 'ignore' });
} catch {
  console.error(
    '\n  FAIL ffmpeg is not on this machine. The frames these assertions are\n'
    + '       about are real frames, so there is nothing to check without it.\n'
  );
  process.exit(1);
}

const W = 1080;
const H = 1920;
let dir;
let reel;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-vision-'));
  reel = path.join(dir, 'reel.mp4');
  // A real vertical file with a real duration. The content does not matter:
  // nothing here reads the picture, only its size and how many frames came
  // back.
  execFileSync(FFMPEG, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=0x303030:s=${W}x${H}:r=25:d=12`,
    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', reel,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
});

after(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ── when to sample ────────────────────────────────────────────────────

describe('when it samples', () => {
  it('spreads the frames across the middle of the reel', () => {
    // Not from the first frame: the opening and closing moments of a reel are
    // a title card and an end card as often as not, and neither shows the
    // caption treatment the body of the video uses.
    const t = vision.sampleTimes(60);
    assert.equal(t.length, 8);
    assert.ok(t[0] > 60 * 0.05, `first at ${t[0]}`);
    assert.ok(t[t.length - 1] < 60 * 0.95, `last at ${t[t.length - 1]}`);
    const gaps = t.slice(1).map((v, i) => +(v - t[i]).toFixed(2));
    assert.equal(new Set(gaps).size, 1, `evenly spaced: ${gaps.join(', ')}`);
  });

  it('never asks for more frames than the reel has seconds', () => {
    // Eight samples of a three-second clip are three samples of the same
    // moment, charged eight times.
    assert.equal(vision.sampleTimes(3).length, 3);
    assert.equal(vision.sampleTimes(1).length, 1);
  });

  it('answers nothing for a file with no duration', () => {
    assert.deepEqual(vision.sampleTimes(null), []);
    assert.deepEqual(vision.sampleTimes(0), []);
  });
});

// ── the frames themselves ─────────────────────────────────────────────

describe('the frames it sends', () => {
  it('caps the long edge and keeps the aspect', async () => {
    const { images, scale } = await (vision.frames(reel, [2, 6], { width: W, height: H }));
    assert.equal(images.length, 2);
    assert.equal(scale, vision.SEND_LONG_EDGE / H);
    const size = jpegSize(images[0].jpeg);
    assert.equal(size.height, vision.SEND_LONG_EDGE);
    assert.equal(size.width, 720, `1080x1920 scaled to the cap is 720x1280, got ${size.width}`);
  });

  it('sends a small frame untouched rather than scaling it up', async () => {
    const small = path.join(dir, 'small.mp4');
    execFileSync(FFMPEG, [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=540x960:r=25:d=4',
      '-pix_fmt', 'yuv420p', '-c:v', 'libx264', small,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const { images, scale } = await (vision.frames(small, [2], { width: 540, height: 960 }));
    assert.equal(scale, 1);
    assert.deepEqual(jpegSize(images[0].jpeg), { width: 540, height: 960 });
  });

  it('skips a frame it cannot read rather than failing the pass', async () => {
    // Seven frames still answer the question. A time past the end of the file
    // is the ordinary case: a duration read from the container can be a
    // fraction longer than the last decodable frame.
    const { images } = await (vision.frames(reel, [2, 999], { width: W, height: H }));
    assert.equal(images.length, 1);
    assert.equal(images[0].at, 2);
  });
});

// ── the instruction ───────────────────────────────────────────────────

describe('what the model is asked', () => {
  const PRESETS = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'shared', 'captions', 'presets.json'), 'utf8'
  )).styles;

  it('names no preset anywhere', () => {
    // The whole design. A model shown a list of 31 names picks one, and a
    // confident wrong pick is the failure mode that matters when somebody
    // runs ten references through this in an afternoon.
    const prompt = vision.system({ w: 720, h: 1280 });
    for (const [id, p] of Object.entries(PRESETS)) {
      assert.ok(!prompt.includes(id), `the prompt names the preset "${id}"`);
      assert.ok(!prompt.includes(p.name), `the prompt names "${p.name}"`);
      assert.ok(!prompt.includes(p.fontName), `the prompt names the face "${p.fontName}"`);
    }
  });

  it('tells it the size of the frame it is looking at', () => {
    // Because `outlinePx` is reported in those pixels and scaled back here.
    const prompt = vision.system({ w: 720, h: 1280 });
    assert.match(prompt, /720x1280 pixels/);
  });

  it('asks for a null rather than an estimate, in those words', () => {
    const prompt = vision.system({ w: 720, h: 1280 });
    assert.match(prompt, /A null is useful and a guess is not/);
    assert.match(prompt, /may be null/);
  });

  it('closes the family vocabulary', () => {
    const prompt = vision.system({ w: 720, h: 1280 });
    for (const word of ['accent', 'box', 'glow', 'plain']) {
      assert.ok(prompt.includes(`"${word}"`), `the prompt offers "${word}"`);
    }
  });

  it('tells it to ignore text that is part of the filmed scene', () => {
    assert.match(vision.system({ w: 1, h: 1 }), /logos, watermarks, UI chrome/);
  });
});

describe('reading the answer', () => {
  it('takes the JSON out of whatever it is wrapped in', () => {
    assert.deepEqual(vision.parse('{"present":true}'), { present: true });
    assert.deepEqual(
      vision.parse('```json\n{"present":false}\n```'),
      { present: false }
    );
    assert.deepEqual(
      vision.parse('Here is what I see:\n{"present":true,"band":0.8}\nHope that helps.'),
      { present: true, band: 0.8 }
    );
  });

  it('answers null for prose with no JSON in it', () => {
    assert.equal(vision.parse('I cannot see any captions.'), null);
    assert.equal(vision.parse(''), null);
    assert.equal(vision.parse('{not json}'), null);
  });
});

// ── the pass, end to end, with the model stubbed at the boundary ──────

describe('observing a reference', () => {
  let realCall;
  let realResolve;
  let sent;

  before(() => {
    realCall = claude.callClaudeProxy;
    realResolve = aiModels.resolveModel;
  });

  after(() => {
    claude.callClaudeProxy = realCall;
    aiModels.resolveModel = realResolve;
  });

  const stub = (answer, model = 'claude-sonnet-4-6') => {
    sent = null;
    aiModels.resolveModel = async () => model;
    claude.callClaudeProxy = async (args) => { sent = args; return answer; };
  };

  it('sends the frames as images and asks on behalf of the client', async () => {
    stub('{"present":true,"band":0.82,"capPct":0.059,"colour":"#FFFFFF","family":"plain"}');
    const out = await (vision.observe(reel, { clientId: 'c-1' }));
    assert.equal(out.observations.present, true);
    assert.equal(out.frames, 8);
    assert.equal(sent.feature, 'reference_caption_read');
    assert.equal(sent.clientId, 'c-1');
    assert.equal(sent.temperature, 0);
    const blocks = sent.messages[0].content;
    assert.equal(blocks.filter((b) => b.type === 'image').length, 8);
    assert.equal(blocks[0].source.media_type, 'image/jpeg');
    assert.ok(blocks[0].source.data.length > 500, 'a real JPEG went up');
  });

  it('scales the reported outline back to the real frame', async () => {
    // THE FAULT THIS GUARDS. The frames are sent at 1280 so a 4px outline is
    // still readable, which means the model's pixels are 1280-frame pixels
    // and the presets' are 1920-frame pixels. Matching one against the other
    // would read every reference as a third finer than it is, and the
    // outline is the dimension the shortlist turns on.
    stub('{"present":true,"outlinePx":4,"family":"plain"}');
    const out = await (vision.observe(reel));
    assert.equal(out.observations.outlinePx, 6, 'four pixels of 1280 is six of 1920');
  });

  it('refuses before calling anything when the model takes no images', async () => {
    // Routed to DeepSeek this would fail inside the API call with a provider
    // error. The refusal names the setting to change instead.
    stub('{"present":true}', 'deepseek-chat');
    const out = await (vision.observe(reel));
    assert.equal(out.observations, null);
    assert.match(out.says, /needs a model that takes images/);
    assert.match(out.says, /Settings > AI models/);
    assert.equal(sent, null, 'and nothing was sent');
  });

  it('answers null with the problems when the model goes outside the vocabulary', async () => {
    stub('{"present":true,"family":"shimmer","colour":"white"}');
    const out = await (vision.observe(reel));
    assert.equal(out.observations, null);
    assert.match(out.says, /answered outside what it was asked for/);
    assert.match(out.says, /family must be one of/);
    assert.match(out.says, /hex colour/);
  });

  it('answers null with a reason when the model writes prose', async () => {
    stub('There are no captions in these frames.');
    const out = await (vision.observe(reel));
    assert.equal(out.observations, null);
    assert.match(out.says, /did not answer with readable JSON/);
  });

  it('carries a clean "no type" answer through rather than treating it as a failure', async () => {
    // A reference with no burned type is a real finding: it means no caption
    // preset applies, which the matcher reports with full confidence.
    stub('{"present":false,"band":null,"capPct":null,"colour":null,"family":null}');
    const out = await (vision.observe(reel));
    assert.deepEqual(out.observations, { present: false });
    assert.match(out.says, /no burned type in 8 sampled frames/);
  });

  it('drops the nulls rather than passing them to the matcher', async () => {
    stub('{"present":true,"band":0.8,"capPct":null,"accent":null,"family":"plain"}');
    const out = await (vision.observe(reel));
    assert.deepEqual(Object.keys(out.observations).sort(), ['band', 'family', 'present']);
  });
});

// ── helpers ───────────────────────────────────────────────────────────

/** The real pixel size of a JPEG buffer, read with ffprobe. */
function jpegSize(buf) {
  const p = path.join(dir, `probe-${buf.length}.jpg`);
  fs.writeFileSync(p, buf);
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', p,
  ]).toString().trim();
  const [width, height] = out.split(',').map(Number);
  return { width, height };
}
