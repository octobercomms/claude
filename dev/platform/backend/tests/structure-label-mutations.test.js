/**
 * Mutation tests for the structure labeller and the pass around it.
 *
 * The labeller's job is to hold a model's answer up against the transcript,
 * so most of these mutations remove a check. A suite that only tested the
 * happy labelling would pass on a version that accepted anything, which is
 * the version that reads as working.
 *
 * The service mutations are about the one ordering that costs money: the
 * words are in hand and the Whisper charge is on the record before anything
 * else can throw.
 *
 *   node tests/structure-label-mutations.test.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const LABEL_PATH = path.resolve(__dirname, '../../shared/structureLabel.mjs');
const SERVICE_PATH = path.resolve(__dirname, '../src/services/referenceStructure.js');
const LABEL_TESTS = path.resolve(__dirname, 'structure-label.test.js');
const SERVICE_TESTS = path.resolve(__dirname, 'reference-structure.test.js');

const originals = new Map([
  [LABEL_PATH, fs.readFileSync(LABEL_PATH, 'utf8')],
  [SERVICE_PATH, fs.readFileSync(SERVICE_PATH, 'utf8')],
]);

function restore() {
  for (const [p, text] of originals) fs.writeFileSync(p, text);
}

function testsPass(tests) {
  for (const t of tests) {
    try {
      execSync(`node ${t}`, { stdio: 'pipe', timeout: 120000 });
    } catch {
      return false;
    }
  }
  return true;
}

let passed = 0;
let failed = 0;

function mutation(name, file, find, replace) {
  const tests = file === SERVICE_PATH ? [SERVICE_TESTS] : [LABEL_TESTS, SERVICE_TESTS];
  const original = originals.get(file);
  const hits = original.split(find).length - 1;
  if (hits !== 1) {
    failed++;
    console.log(`  FAIL ${name}\n       target appears ${hits} times, so the mutation is ambiguous`);
    return;
  }
  fs.writeFileSync(file, original.replace(find, replace));
  try {
    if (testsPass(tests)) {
      failed++;
      console.log(`  FAIL ${name}\n       mutation SURVIVED (tests still pass)`);
    } else {
      passed++;
      console.log(`  ok   ${name}`);
    }
  } finally {
    restore();
  }
}

console.log('# structure label mutations');

// ── finding the ask ───────────────────────────────────────────────────

mutation(
  'the lexicon ignores word boundaries, so "subscriber" asks for a subscription',
  LABEL_PATH,
  "if (before !== ' ' || after !== ' ') continue;",
  ''
);

mutation(
  'only the left boundary is checked',
  LABEL_PATH,
  "if (before !== ' ' || after !== ' ') continue;",
  "if (before !== ' ') continue;"
);

mutation(
  'punctuation is kept, so "bio!" is not "bio"',
  LABEL_PATH,
  ".replace(/[^a-z0-9']+/g, '')",
  ''
);

mutation(
  'the case is kept, so "Link in bio" is not found',
  LABEL_PATH,
  '.toLowerCase().replace',
  '.replace'
);

mutation(
  'a match reports the wrong word, so the time is wrong',
  LABEL_PATH,
  'const wordIndex = offsets[i];',
  'const wordIndex = offsets[i] + 1;'
);

mutation(
  'the cues come back in whatever order the lexicon is written in',
  LABEL_PATH,
  'found.sort((a, b) => a.at - b.at || a.phrase.localeCompare(b.phrase));',
  ''
);

// ── checking the labelling ────────────────────────────────────────────

mutation(
  'a label outside the four is accepted',
  LABEL_PATH,
  'if (!SECTIONS.includes(s.label)) {',
  'if (false) {'
);

mutation(
  'the same section may be labelled twice',
  LABEL_PATH,
  'if (seen.includes(s.label)) {',
  'if (false) {'
);

mutation(
  'a solution may come before the problem it solves',
  LABEL_PATH,
  'if (rank < worst) {',
  'if (false) {'
);

mutation(
  'spans may overlap',
  LABEL_PATH,
  'if (start < previousEnd - 0.05) {',
  'if (false) {'
);

mutation(
  'a span may cover no words at all',
  LABEL_PATH,
  'if (words.length && !wordsIn(words, start, stop).length) {',
  'if (false) {'
);

mutation(
  'a span may start after the last word was said',
  LABEL_PATH,
  'if (end > 0 && start > end + 0.05) {',
  'if (false) {'
);

mutation(
  'a field nothing reads is accepted',
  LABEL_PATH,
  "if (unknown.length) errors.push(`${at}: reports ${unknown.join(', ')}, which nothing reads`);",
  ''
);

mutation(
  'an empty labelling is read as a shape',
  LABEL_PATH,
  "if (!sections.length) return ['no sections'];",
  ''
);

mutation(
  'end before start is accepted',
  LABEL_PATH,
  'if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) {',
  'if (!Number.isFinite(start) || !Number.isFinite(stop)) {'
);

// ── holding the labelling against the transcript ──────────────────────

mutation(
  'a hook may begin anywhere',
  LABEL_PATH,
  'export const HOOK_STARTS_BY = 1.5;',
  'export const HOOK_STARTS_BY = 600;'
);

mutation(
  'a labelling with no hook passes without comment',
  LABEL_PATH,
  "    disagreements.push('nothing was labelled a hook, and every reel opens with something');",
  ''
);

mutation(
  'a missed call to action passes without comment',
  LABEL_PATH,
  'if (!cta && lateCues.length) {',
  'if (false) {'
);

mutation(
  'a spoken ask nowhere near the labelled CTA passes without comment',
  LABEL_PATH,
  'if (!inside.length) {',
  'if (false) {'
);

mutation(
  'a CTA with nothing in the words is not flagged as on-screen only',
  LABEL_PATH,
  'if (cta && !cues.length) {',
  'if (false) {'
);

mutation(
  'a labelling that covers a third of the reel is not flagged',
  LABEL_PATH,
  'if (coverage < 0.6) {',
  'if (false) {'
);

mutation(
  'confidence ignores the disagreements',
  LABEL_PATH,
  '0.85 * coverage - 0.15 * disagreements.length)',
  '0.85 * coverage)'
);

mutation(
  'confidence is allowed to read as certainty',
  LABEL_PATH,
  'Math.max(0.1, 0.85 * coverage',
  'Math.max(0.1, 1.0 * coverage'
);

mutation(
  'the shape is reported even when the labelling was refused',
  LABEL_PATH,
  `    return {
      archetype: null,
      sections: [],`,
  `    return {
      archetype: sections.map((s) => s.label).join('-'),
      sections: [],`
);

mutation(
  'the sections are sorted rather than reported in the order they occur',
  LABEL_PATH,
  "archetype: labels.join('-'),",
  "archetype: labels.slice().sort().join('-'),"
);

// ── the pass ──────────────────────────────────────────────────────────

mutation(
  'the Whisper charge is logged after the labelling, so a failure loses it',
  SERVICE_PATH,
  `  costLog.recordApiCost({
    provider: 'openai',
    feature: 'reference_transcribe',
    costUsd: (end / 60) * WHISPER_USD_PER_MINUTE,
    clientId,
    meta: { seconds: Math.round(end), rate: WHISPER_USD_PER_MINUTE },
  });`,
  ''
);

mutation(
  'the cost is logged with parameter names costLog does not take',
  SERVICE_PATH,
  "    feature: 'reference_transcribe',\n    costUsd: (end / 60) * WHISPER_USD_PER_MINUTE,",
  "    purpose: 'reference_transcribe',\n    cost: (end / 60) * WHISPER_USD_PER_MINUTE,"
);

mutation(
  'the transcription is charged by a flat figure rather than the seconds',
  SERVICE_PATH,
  'costUsd: (end / 60) * WHISPER_USD_PER_MINUTE,',
  'costUsd: WHISPER_USD_PER_MINUTE,'
);

mutation(
  'it calls OpenAI with no key rather than saying where to put one',
  SERVICE_PATH,
  '  if (!key) {',
  '  if (false) {'
);

mutation(
  'a silent reference is sent to the labelling pass anyway',
  SERVICE_PATH,
  '  if (!words.length) {',
  '  if (false) {'
);

mutation(
  'the transcript lines lose their timestamps',
  SERVICE_PATH,
  'content: lines(words).map((l) => `[${l.at}] ${l.text}`).join(\'\\n\'),',
  "content: lines(words).map((l) => l.text).join('\\n'),"
);

console.log(`# ${passed} killed, ${failed} survived`);
if (failed > 0) {
  console.log('# MUTATION TESTING FAILED: some mutations survived');
  process.exit(1);
}
