/**
 * Mutation tests for the composition playback model.
 *
 * Same sequential-script approach as the other mutation tests. Each
 * mutation rewrites a specific line in compositionPlayback.mjs, runs the
 * real tests, and asserts they fail. A mutation that survives means the
 * tests have a gap.
 *
 *   node tests/composition-playback-mutations.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PB_PATH = path.resolve(__dirname, '../../shared/compositionPlayback.mjs');
const PB_TESTS = path.resolve(__dirname, 'composition-playback.test.js');
const AGREE_TESTS = path.resolve(__dirname, 'compositor-agreement.test.js');

const original = fs.readFileSync(PB_PATH, 'utf8');

function restore() {
  fs.writeFileSync(PB_PATH, original);
}

function testsPass() {
  try {
    execSync(`node --test ${PB_TESTS} ${AGREE_TESTS}`, { stdio: 'pipe', timeout: 30000 });
    return true;
  } catch {
    return false;
  }
}

let passed = 0;
let failed = 0;

function mutation(name, find, replace) {
  if (!original.includes(find)) {
    failed++;
    console.log(`  FAIL ${name}\n       mutation target not found`);
    return;
  }
  fs.writeFileSync(PB_PATH, original.replace(find, replace));
  try {
    const survived = testsPass();
    if (survived) {
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

console.log('composition playback mutations');

// ── Source time mapping ──────────────────────────────────────────────

mutation(
  'source time ignores in-point',
  'const sourceTime = secs(inPt + (t - item.at));',
  'const sourceTime = secs(t - item.at);'
);

mutation(
  'source time ignores item.at offset',
  'const sourceTime = secs(inPt + (t - item.at));',
  'const sourceTime = secs(inPt + t);'
);

// ── Transition opacity ──────────────────────────────────────────────

mutation(
  'crossfade out opacity inverted (in instead of out)',
  'return 1 - progress;',
  'return progress;'
);

mutation(
  'fadeblack outgoing never reaches zero',
  'return progress < 0.5 ? 1 - 2 * progress : 0;',
  'return progress < 0.5 ? 1 - progress : 0;'
);

mutation(
  'fadeblack incoming starts immediately (no black dip)',
  'return progress < 0.5 ? 0 : 2 * (progress - 0.5);',
  'return progress;'
);

// ── Layer ordering ──────────────────────────────────────────────────

mutation(
  'tracks iterated backwards (overlay order reversed)',
  'for (let ti = 0; ti < comp.tracks.length; ti++) {\n    const track = comp.tracks[ti];\n    if (track.kind !== \'video\') continue;\n\n    const sorted = [...track.items].sort((a, b) => a.at - b.at);\n    const trackOvs = findOverlaps({ ...track, items: sorted });',
  'for (let ti = comp.tracks.length - 1; ti >= 0; ti--) {\n    const track = comp.tracks[ti];\n    if (track.kind !== \'video\') continue;\n\n    const sorted = [...track.items].sort((a, b) => a.at - b.at);\n    const trackOvs = findOverlaps({ ...track, items: sorted });'
);

// ── audioAt mutations ───────────────────────────────────────────────

mutation(
  'audio ignores gain (always 1)',
  'const gain = item.gain != null ? item.gain : 1;',
  'const gain = 1;'
);

mutation(
  'audio source time ignores in-point',
  'const sourceTime = secs(inPt + (t - item.at));\n      const gain',
  'const sourceTime = secs(t - item.at);\n      const gain'
);

// ── stepFrame mutations ─────────────────────────────────────────────

mutation(
  'step always moves forward (ignores dir)',
  'const next = secs(t + dir * frameDur);',
  'const next = secs(t + frameDur);'
);

// ── report ───────────────────────────────────────────────────────────

console.log(`\n${passed} killed, ${failed} survived`);
if (failed) {
  console.log('MUTATION TESTING FAILED: some mutations survived');
  process.exit(1);
}
console.log('all mutations killed');
