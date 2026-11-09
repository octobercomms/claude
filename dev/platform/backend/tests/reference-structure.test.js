/**
 * The pass that transcribes a reference and labels its spoken shape.
 *
 * Everything here is boundaries: ffmpeg, Whisper, a labelling call, the cost
 * log, and the pure module that checks the answer. Each is replaced at the
 * boundary and what crossed it is asserted, because that is where this build
 * keeps finding faults — a cost call with the wrong parameter names that
 * threw away a transcript it had just paid for, a probe field that does not
 * exist, an asset regex that had never matched a real url.
 *
 * The assertion that matters most is the order: the words are in hand and the
 * cost is logged BEFORE anything else can throw. The transcribe route got
 * that wrong and every click of it charged again for a transcript nobody
 * received.
 *
 *   node tests/reference-structure.test.js
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const structure = require('../src/services/referenceStructure');
const whisper = require('../src/services/whisper');
const settings = require('../src/utils/settings');
const costLog = require('../src/services/costLog');
const claude = require('../src/services/claude');
const aiModels = require('../src/services/aiModels');

const real = {};
let costs;
let sent;

before(() => {
  real.extractAudio = whisper.extractAudio;
  real.whisperWords = whisper.whisperWords;
  real.getSetting = settings.getSetting;
  real.recordApiCost = costLog.recordApiCost;
  real.callClaudeProxy = claude.callClaudeProxy;
  real.resolveModel = aiModels.resolveModel;
});

after(() => {
  whisper.extractAudio = real.extractAudio;
  whisper.whisperWords = real.whisperWords;
  settings.getSetting = real.getSetting;
  costLog.recordApiCost = real.recordApiCost;
  claude.callClaudeProxy = real.callClaudeProxy;
  aiModels.resolveModel = real.resolveModel;
});

/** Words at four a second, so a time is easy to reason about. */
function say(sentence) {
  return sentence.split(/\s+/).map((word, i) => ({
    word, start: +(i * 0.25).toFixed(2), end: +(i * 0.25 + 0.2).toFixed(2),
  }));
}

const WORDS = say(
  'this extension cost ninety grand and everyone said it would be double '
  + 'we bought the glazing direct and kept the steel simple '
  + 'the full cost breakdown is in the link in bio'
);

const LABELLED = JSON.stringify({
  sections: [
    { label: 'hook', start: 0, end: 2.5, says: 'the price, flat' },
    { label: 'solution', start: 2.5, end: 5.5, says: 'how' },
    { label: 'cta', start: 5.5, end: 7.5, says: 'the bio' },
  ],
});

beforeEach(() => {
  costs = [];
  sent = null;
  settings.getSetting = async () => 'sk-test';
  aiModels.resolveModel = async () => 'claude-sonnet-4-6';
  whisper.extractAudio = async () => '/tmp/does-not-matter.mp3';
  whisper.whisperWords = async () => WORDS;
  costLog.recordApiCost = (row) => { costs.push(row); };
  claude.callClaudeProxy = async (args) => { sent = args; return LABELLED; };
});

// ── the transcript as a prompt ────────────────────────────────────────

describe('the transcript it sends', () => {
  it('groups the words into timestamped lines', () => {
    // Three hundred `{word, start, end}` objects is mostly punctuation and
    // costs more than the answer. A line of roughly a sentence with the
    // second it starts at gives the model the same clock to answer in.
    const got = structure.lines(WORDS, 6);
    assert.equal(got[0].at, 0);
    assert.equal(got[0].text.split(' ').length, 6);
    assert.equal(got[1].at, WORDS[6].start);
  });

  it('rounds the timestamps to a tenth, not a hundredth', () => {
    for (const line of structure.lines(WORDS)) {
      assert.equal(line.at, Math.round(line.at * 10) / 10);
    }
  });
});

describe('the instruction', () => {
  it('closes the vocabulary to the four sections', () => {
    const prompt = structure.system(30);
    for (const label of ['hook', 'problem', 'solution', 'cta']) {
      assert.ok(prompt.includes(`"${label}"`), `offers "${label}"`);
    }
    assert.match(prompt, /one of exactly these four/);
  });

  it('tells it to leave a section out rather than find one', () => {
    // The failure mode worth preventing: a model that feels obliged to
    // produce a "problem" will label one, and most reels do not have one.
    const prompt = structure.system(30);
    assert.match(prompt, /LEAVE A SECTION OUT if it is not there/);
    assert.match(prompt, /worse than having three sections/);
  });

  it('tells it the spans are checked, which is true', () => {
    const prompt = structure.system(30);
    assert.match(prompt, /A span covering no words is rejected/);
    assert.match(prompt, /checked against the transcript/);
  });

  it('gives it the end of the recording', () => {
    assert.match(structure.system(42.37), /ends at 42\.4s/);
  });
});

describe('reading the answer', () => {
  it('takes the sections out of whatever they are wrapped in', () => {
    assert.deepEqual(
      structure.parse('```json\n{"sections":[{"label":"hook","start":0,"end":2}]}\n```'),
      [{ label: 'hook', start: 0, end: 2 }]
    );
  });

  it('answers null for anything that is not a section list', () => {
    assert.equal(structure.parse('The video opens with a hook.'), null);
    assert.equal(structure.parse('{"shape":"hook-cta"}'), null);
    assert.equal(structure.parse(''), null);
  });
});

// ── the pass ──────────────────────────────────────────────────────────

describe('reading a reference', () => {
  it('transcribes, labels, and returns the shape', async () => {
    const out = await structure.read('/tmp/reel.mp4', { clientId: 'c-1' });
    assert.equal(out.structure.archetype, 'hook-solution-cta');
    assert.equal(out.words.length, WORDS.length);
    assert.equal(sent.feature, 'reference_structure_read');
    assert.equal(sent.clientId, 'c-1');
    assert.equal(sent.temperature, 0);
    assert.match(sent.messages[0].content, /^\[0\] this extension/);
  });

  it('logs the Whisper cost with the parameter names costLog actually takes', async () => {
    // The fault this guards called OpenAI, passed `purpose` and `cost`
    // instead of `feature` and `costUsd`, wrote no row, and then threw on
    // the undefined it got back — after the charge and before the transcript
    // was saved. Every click charged again.
    await structure.read('/tmp/reel.mp4', { clientId: 'c-1' });
    assert.equal(costs.length, 1);
    const row = costs[0];
    assert.deepEqual(Object.keys(row).sort(), ['clientId', 'costUsd', 'feature', 'meta', 'provider']);
    assert.equal(row.provider, 'openai');
    assert.equal(row.feature, 'reference_transcribe');
    assert.ok(row.costUsd > 0, `a real figure: ${row.costUsd}`);
    assert.equal(row.clientId, 'c-1');
  });

  it('prices the transcription by the seconds it actually transcribed', async () => {
    await structure.read('/tmp/reel.mp4');
    const seconds = WORDS[WORDS.length - 1].end;
    const want = (seconds / 60) * structure.WHISPER_USD_PER_MINUTE;
    assert.ok(Math.abs(costs[0].costUsd - want) < 1e-9, `${costs[0].costUsd} against ${want}`);
    assert.equal(costs[0].meta.seconds, Math.round(seconds));
  });

  it('logs the cost even when the labelling call then fails', async () => {
    // The charge happened. A labelling failure afterwards does not unspend
    // it, and a cost that is not recorded is a cost nothing can cap.
    claude.callClaudeProxy = async () => { throw new Error('529 overloaded'); };
    const out = await structure.read('/tmp/reel.mp4');
    assert.equal(out.structure, null);
    assert.match(out.says, /the labelling call failed: 529 overloaded/);
    assert.equal(costs.length, 1, 'the Whisper charge is still on the record');
    assert.equal(out.words.length, WORDS.length, 'and the transcript is not thrown away');
  });

  it('spends nothing when there is no key, and says where to put one', async () => {
    settings.getSetting = async () => null;
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const out = await structure.read('/tmp/reel.mp4');
      assert.equal(out.structure, null);
      assert.match(out.says, /no OpenAI key is configured/);
      assert.match(out.says, /Settings > AI/);
      assert.equal(costs.length, 0);
      assert.equal(sent, null);
    } finally {
      if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
    }
  });

  it('says so when the file cannot be transcribed, and logs nothing', async () => {
    whisper.whisperWords = async () => { throw new Error('Whisper 400: no audio stream'); };
    const out = await structure.read('/tmp/reel.mp4');
    assert.equal(out.structure, null);
    assert.match(out.says, /could not be transcribed: Whisper 400/);
    assert.equal(costs.length, 0, 'nothing was charged, so nothing is logged');
  });

  it('says so when the reference has no speech', async () => {
    whisper.whisperWords = async () => [];
    const out = await structure.read('/tmp/reel.mp4');
    assert.equal(out.structure, null);
    assert.match(out.says, /no speech in it/);
    assert.equal(sent, null, 'and no labelling was asked for');
  });

  it('answers null with the problems when the labelling is not usable', async () => {
    claude.callClaudeProxy = async () => JSON.stringify({
      sections: [{ label: 'epilogue', start: 0, end: 2 }],
    });
    const out = await structure.read('/tmp/reel.mp4');
    assert.equal(out.structure, null);
    assert.match(out.says, /unknown label "epilogue"/);
  });

  it('answers null when the labelling is prose', async () => {
    claude.callClaudeProxy = async () => 'It opens with a hook and ends with a call to action.';
    const out = await structure.read('/tmp/reel.mp4');
    assert.equal(out.structure, null);
    assert.match(out.says, /did not answer with readable JSON/);
  });

  it('carries the disagreement through when the labelling missed the ask', async () => {
    // The lexicon found "link in bio"; the labelling did not. The reading is
    // still returned, with the disagreement attached, because a shape with a
    // caveat is usable and a shape that hides one is not.
    claude.callClaudeProxy = async () => JSON.stringify({
      sections: [
        { label: 'hook', start: 0, end: 2.5 },
        { label: 'solution', start: 2.5, end: 7.5 },
      ],
    });
    const out = await structure.read('/tmp/reel.mp4');
    assert.equal(out.structure.archetype, 'hook-solution');
    assert.match(out.structure.disagreements.join(' '), /no call to action was labelled/);
    assert.match(out.structure.disagreements.join(' '), /"link in bio"/);
  });
});
