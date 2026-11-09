/**
 * Mutation tests for the caption matcher and its wiring into the proposal.
 *
 * Same approach as the other four sweeps: rewrite one line of the real
 * source, run the real tests, assert they fail. A survivor means the tests
 * have a gap.
 *
 * The mutations worth reading are the ones about REFUSING. Most of this
 * module's value is in what it declines to claim — that it cannot separate
 * 105pt type from 102pt, that a `scale` preset's highlight colour is not on
 * the screen, that an all-caps reference cannot be matched on case because no
 * preset carries one. A test suite that only checked the matches would pass
 * happily on a version that guessed.
 *
 *   node tests/caption-match-mutations.test.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MATCH_PATH = path.resolve(__dirname, '../../shared/captionMatch.mjs');
const ANALYSIS_PATH = path.resolve(__dirname, '../../shared/referenceAnalysis.mjs');
const MATCH_TESTS = path.resolve(__dirname, 'caption-match.test.js');
const ANALYSIS_TESTS = path.resolve(__dirname, 'reference-analysis.test.js');

const originals = new Map([
  [MATCH_PATH, fs.readFileSync(MATCH_PATH, 'utf8')],
  [ANALYSIS_PATH, fs.readFileSync(ANALYSIS_PATH, 'utf8')],
]);

function restore() {
  for (const [p, text] of originals) fs.writeFileSync(p, text);
}

function testsPass() {
  for (const t of [MATCH_TESTS, ANALYSIS_TESTS]) {
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
  const original = originals.get(file);
  const hits = original.split(find).length - 1;
  if (hits !== 1) {
    failed++;
    console.log(`  FAIL ${name}\n       target appears ${hits} times, so the mutation is ambiguous`);
    return;
  }
  fs.writeFileSync(file, original.replace(find, replace));
  try {
    if (testsPass()) {
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

console.log('# caption match mutations');

// ── what a still frame shows ──────────────────────────────────────────

mutation(
  'karaoke is read as a plain treatment',
  MATCH_PATH,
  "karaoke: 'accent',",
  "karaoke: 'plain',"
);

mutation(
  'an unknown animation type is read as plain rather than unknown',
  MATCH_PATH,
  "return FAMILY_OF[animationType] || null;",
  "return FAMILY_OF[animationType] || 'plain';"
);

mutation(
  'a plain preset reports a highlight colour no frame carries',
  MATCH_PATH,
  `    accent: family === 'accent' || family === 'box'
      ? (preset.highlightColor ?? null)
      : null,`,
  '    accent: preset.highlightColor ?? null,'
);

mutation(
  'the size bands overlap, so nothing falls between them',
  MATCH_PATH,
  "  if (capPct < 0.025) return 'small';\n  if (capPct > 0.030) return 'large';\n  return null;",
  "  if (capPct < 0.0275) return 'small';\n  return 'large';"
);

mutation(
  'the cap-height ratio is dropped, so every size lands in one band',
  MATCH_PATH,
  'return (size * CAP_RATIO) / H;',
  'return size / H;'
);

mutation(
  'the outline has no error floor, so a quarter of a pixel separates two presets',
  MATCH_PATH,
  'if (diff <= OUTLINE_TOLERANCE_PX) return 0;',
  'if (diff <= 0) return 0;'
);

mutation(
  'the outline tolerance swallows the whole range',
  MATCH_PATH,
  'export const OUTLINE_TOLERANCE_PX = 1.5;',
  'export const OUTLINE_TOLERANCE_PX = 15;'
);

mutation(
  'colour distance is unweighted, so two colours of equal lightness read alike',
  MATCH_PATH,
  'const w = [0.3, 0.59, 0.11];',
  'const w = [1, 0, 0];'
);

// ── the match ─────────────────────────────────────────────────────────

mutation(
  'an observed accent is scored against a preset that never shows one',
  MATCH_PATH,
  `    if (obs.accent && (familyOf(preset.animationType) === 'accent'
        || familyOf(preset.animationType) === 'box')) {`,
  '    if (obs.accent) {'
);

mutation(
  'the shortlist is dropped, so a tie reads as a pick',
  MATCH_PATH,
  'const tied = scored.filter((s) => s.id !== best.id && s.score - best.score <= TIE);',
  'const tied = [];'
);

mutation(
  'a reference with no type is matched to a preset anyway',
  MATCH_PATH,
  `  if (!obs.present) {
    return {
      value: null,`,
  `  if (false) {
    return {
      value: null,`
);

mutation(
  'the observations are matched without being validated',
  MATCH_PATH,
  'const problems = validateObservations(obs);\n  if (problems.length) {',
  'const problems = [];\n  if (problems.length) {'
);

mutation(
  'confidence does not fall with how little was observed',
  MATCH_PATH,
  'const breadth = used.length / Object.keys(WEIGHTS).length;',
  'const breadth = 1;'
);

mutation(
  'confidence is allowed to read as certainty',
  MATCH_PATH,
  'Math.max(0.1, Math.min(0.9, fit * (0.45 + 0.35 * breadth + 0.2 * margin))))',
  'Math.max(0.1, Math.min(1, fit * (0.45 + 0.35 * breadth + 0.2 * margin) * 2)))'
);

mutation(
  'an all-caps reference is matched on a case no preset carries',
  MATCH_PATH,
  `  if (obs.caseStyle) {
    // Worth saying rather than dropping: the presets carry no case field at`,
  `  if (false) {
    // Worth saying rather than dropping: the presets carry no case field at`
);

// ── the observation contract ──────────────────────────────────────────

mutation(
  'a field nothing reads is accepted',
  MATCH_PATH,
  'if (unknown.length) errors.push(`reports ${unknown.join(\', \')}, which nothing reads`);',
  ''
);

mutation(
  'the family vocabulary is open, so an invented word is matched on',
  MATCH_PATH,
  'if (obs.family != null && !FAMILIES.includes(obs.family)) {',
  'if (false) {'
);

mutation(
  'a colour that is not a hex triple is accepted',
  MATCH_PATH,
  'if (obs[name] != null && !HEX.test(String(obs[name]))) {',
  'if (false) {'
);

mutation(
  'an absent `present` is read as false rather than refused',
  MATCH_PATH,
  "if (typeof obs.present !== 'boolean') errors.push('present must be true or false');",
  ''
);

// ── the position ──────────────────────────────────────────────────────

mutation(
  'the caption margin is measured from the top rather than the bottom',
  MATCH_PATH,
  'const fromBottom = Math.round((H * (1 - obs.band)) / 10) * 10;',
  'const fromBottom = Math.round((H * obs.band) / 10) * 10;'
);

mutation(
  'the margin claims a pixel it cannot see',
  MATCH_PATH,
  'Math.round((H * (1 - obs.band)) / 10) * 10',
  'Math.round(H * (1 - obs.band))'
);

mutation(
  'a missing band is read as the top of the frame',
  MATCH_PATH,
  `  if (!Number.isFinite(obs.band)) {
    return {
      value: null,`,
  `  if (false) {
    return {
      value: null,`
);

// ── the wiring into the proposal ──────────────────────────────────────

mutation(
  'the preset is matched without a frame size to measure against',
  ANALYSIS_PATH,
  `  if (!format) {
    return {
      value: null,
      confidence: 0,
      why: 'the file did not report its size, and caption size is only meaningful'
        + ' as a fraction of the frame',
    };
  }`,
  ''
);

mutation(
  'a shortlist is written into the draft as though it were a choice',
  ANALYSIS_PATH,
  "if (caption.value && !(caption.alternatives || []).length) {",
  'if (caption.value) {'
);

mutation(
  'the proposal reports a caption it never read',
  ANALYSIS_PATH,
  `  const obs = measured.caption || null;
  const styles = deps.styles || null;
  if (!obs) {`,
  `  const obs = measured.caption || { present: true };
  const styles = deps.styles || null;
  if (!obs) {`
);

console.log(`# ${passed} killed, ${failed} survived`);
if (failed > 0) {
  console.log('# MUTATION TESTING FAILED: some mutations survived');
  process.exit(1);
}
