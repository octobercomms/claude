/**
 * Reading the spoken shape of somebody else's reel: hook, problem, solution,
 * call to action.
 *
 * The plan's row for this reads "transcribe, then Claude labels the
 * archetype". The split is the same one the caption pass uses, for the same
 * reason: a model does the part that is a judgement, and everything that can
 * be measured is measured in a pure module that then holds the answer up
 * against the measurement.
 *
 * So the model is given the transcript with a timestamp on every line and
 * asked for spans. It is not asked whether there is a call to action —
 * `shared/structureLabel.mjs` searches the words for the twenty-nine phrases
 * that are one, and a labelling with no CTA where "link in bio" is said at 24
 * seconds comes back with that disagreement attached rather than accepted.
 *
 * TWO CALLS, TWO COSTS. Whisper transcribes and a model labels, and both are
 * recorded against their own feature so the chip can price them separately
 * and a cap can stop either. On a 60-second reel Whisper is about $0.006 and
 * the labelling is a few hundred tokens of text.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
// Through the module object rather than destructured, for every boundary this
// crosses. Destructuring binds the function at require time, which makes the
// boundary unstubbable, and every wiring fault this build has found was found
// by a test that replaced one boundary and asserted on what crossed it: the
// cost call with the wrong parameter names, the asset regex that had never
// matched a real url, `probe.duration` which does not exist.
const whisper = require('./whisper');
const settings = require('../utils/settings');
const costLog = require('./costLog');
const claude = require('./claude');
const aiModels = require('./aiModels');

/** The routable feature for the labelling call. */
const FEATURE = 'reference_structure_read';

/**
 * What Whisper costs, per minute of audio, in USD.
 *
 * OpenAI's published rate for `whisper-1`. Recorded rather than measured
 * because the API returns no usage figure for audio, so the only honest way
 * to log it is the rate times the duration — and logging nothing is how
 * composition transcription came to be invisible to the cost chip for
 * months.
 */
const WHISPER_USD_PER_MINUTE = 0.006;

let _structure = null;
async function structureMod() {
  if (!_structure) {
    _structure = await import(pathToFileURL(
      path.join(__dirname, '..', '..', '..', 'shared', 'structureLabel.mjs')
    ).href);
  }
  return _structure;
}

/**
 * The transcript as timestamped lines.
 *
 * Word-level timings are what the pure module needs, and they are the wrong
 * shape to put in a prompt: three hundred `{word, start, end}` objects is
 * mostly punctuation and costs more than the answer. Grouped into lines of
 * roughly a sentence, each with the second it starts at, the model has what
 * it needs to give spans back in the same clock.
 */
function lines(words, perLine = 12) {
  const out = [];
  for (let i = 0; i < words.length; i += perLine) {
    const group = words.slice(i, i + perLine);
    out.push({
      at: Math.round(group[0].start * 10) / 10,
      text: group.map((w) => w.word).join(' '),
    });
  }
  return out;
}

/**
 * The instruction.
 *
 * Three things in it are load-bearing. The vocabulary is closed. A section
 * may be LEFT OUT, said outright, because most reels are hook then solution
 * then CTA and a model that feels obliged to find a "problem" will label one.
 * And it is told the spans are checked against the transcript, which is true:
 * a span covering no words is refused.
 */
function system(end) {
  return [
    'You are labelling the structure of a short-form social video from its',
    'transcript. Each line is prefixed with the second it starts at. The last',
    `word ends at ${Math.round(end * 10) / 10}s.`,
    '',
    'Answer with a single JSON object: { "sections": [ ... ] }, and nothing',
    'else. Each section is { "label", "start", "end", "says" }:',
    '',
    '  label  one of exactly these four:',
    '           "hook"      what opens the video and makes someone stay',
    '           "problem"   the difficulty or cost being described',
    '           "solution"  what is being shown or explained as the answer',
    '           "cta"       the ask: follow, book, click, save, get in touch',
    '  start  the second the section begins',
    '  end    the second it ends',
    '  says   up to twelve words on why this span is that section',
    '',
    'Rules:',
    '  - Sections appear in that order and each appears at most once.',
    '  - LEAVE A SECTION OUT if it is not there. Most reels are hook then',
    '    solution then cta, and plenty are hook then cta. Labelling a',
    '    "problem" that was never stated is worse than having three sections.',
    '  - Spans must not overlap, and each must cover words that were actually',
    '    said. A span covering no words is rejected.',
    '  - Gaps are fine. A passage that is none of the four stays unlabelled.',
    '',
    'Your spans are checked against the transcript, so use the clock as given.',
  ].join('\n');
}

function parse(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const body = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(body?.sections) ? body.sections : null;
  } catch {
    return null;
  }
}

/**
 * Read the structure of a reference video.
 *
 * Returns `{ structure, words, says }`. `structure` is null when nothing
 * could be read and `says` is the reason, never a guess.
 */
async function read(file, { clientId = null } = {}) {
  const key = process.env.OPENAI_API_KEY || await settings.getSetting('OPENAI_API_KEY');
  if (!key) {
    return {
      structure: null,
      words: [],
      says: 'no OpenAI key is configured, so the reference cannot be transcribed.'
        + ' Set it in Settings > AI.',
    };
  }

  const model = await aiModels.resolveModel(FEATURE);

  let audio;
  let words;
  try {
    audio = await whisper.extractAudio(file);
    words = await whisper.whisperWords(audio, key);
  } catch (err) {
    return { structure: null, words: [], says: `the reference could not be transcribed: ${err.message}` };
  } finally {
    if (audio) fs.promises.unlink(audio).catch(() => {});
  }

  // THE WORDS ARE SAVED BEFORE THE COST IS LOGGED, which is the order that
  // matters: the transcribe route used to call `recordApiCost` with the wrong
  // parameter names and then `.catch()` on the undefined it returned, so
  // OpenAI was billed, a TypeError was thrown, and the transcript it had just
  // paid for was discarded. Nothing here can throw between the two.
  const sm = await structureMod();
  const end = sm.transcriptEnd(words);
  costLog.recordApiCost({
    provider: 'openai',
    feature: 'reference_transcribe',
    costUsd: (end / 60) * WHISPER_USD_PER_MINUTE,
    clientId,
    meta: { seconds: Math.round(end), rate: WHISPER_USD_PER_MINUTE },
  });

  if (!words.length) {
    return { structure: null, words: [], says: 'the reference has no speech in it to structure' };
  }

  let text;
  try {
    text = await claude.callClaudeProxy({
      model,
      max_tokens: 900,
      system: system(end),
      messages: [{
        role: 'user',
        content: lines(words).map((l) => `[${l.at}] ${l.text}`).join('\n'),
      }],
      temperature: 0,
      feature: FEATURE,
      clientId,
    });
  } catch (err) {
    return { structure: null, words, says: `the labelling call failed: ${err.message}` };
  }

  const sections = parse(text);
  if (!sections) {
    return { structure: null, words, says: 'the labelling did not answer with readable JSON' };
  }

  const structure = sm.readStructure(sections, words);
  return {
    structure: structure.archetype ? structure : null,
    words,
    says: structure.archetype ? structure.says : structure.says,
  };
}

module.exports = {
  read,
  FEATURE,
  WHISPER_USD_PER_MINUTE,
  // Exported for the tests, which run them against real word timings.
  lines,
  system,
  parse,
};
