/**
 * Mutation tests for the composition model and mapping.
 *
 * Each test applies a specific, named mutation to the source code, runs the
 * real test suite in a subprocess, and asserts that it fails. A mutation that
 * survives (the tests still pass) means the test suite has a gap.
 *
 *   node tests/composition-mutations.test.js
 *
 * Runs sequentially as a plain script (not node:test) because mutations
 * rewrite shared source files and must not overlap.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const COMP_PATH = path.resolve(__dirname, '../../shared/composition.mjs');
const MAP_PATH = path.resolve(__dirname, '../../shared/compositionMapping.mjs');
const COMP_TESTS = path.resolve(__dirname, 'composition.test.js');
const MAP_TESTS = path.resolve(__dirname, 'composition-mapping.test.js');

const compOriginal = fs.readFileSync(COMP_PATH, 'utf8');
const mapOriginal = fs.readFileSync(MAP_PATH, 'utf8');

function restore() {
  fs.writeFileSync(COMP_PATH, compOriginal);
  fs.writeFileSync(MAP_PATH, mapOriginal);
}

function testsPass(testFile) {
  try {
    execSync(`node --test ${testFile}`, { stdio: 'pipe', timeout: 30000 });
    return true;
  } catch {
    return false;
  }
}

let passed = 0;
let failed = 0;

function mutation(name, filePath, original, find, replace, testFile) {
  if (!original.includes(find)) {
    failed++;
    console.log(`  FAIL ${name}\n       mutation target not found`);
    return;
  }
  fs.writeFileSync(filePath, original.replace(find, replace));
  try {
    const survived = testsPass(testFile);
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

// ── composition model mutations ───────────────────────────────────────

console.log('composition model mutations');

mutation(
  'secs() without rounding (binary dust accumulates)',
  COMP_PATH, compOriginal,
  'return Math.round(n * 1e6) / 1e6;',
  'return n;',
  COMP_TESTS
);

mutation(
  'validate accepts any fps',
  COMP_PATH, compOriginal,
  'comp.fps < 1 || comp.fps > 120',
  'false',
  COMP_TESTS
);

mutation(
  'addItem does not sort by at',
  COMP_PATH, compOriginal,
  '? { ...t, items: [...t.items, newItem].sort((a, b) => a.at - b.at) }',
  '? { ...t, items: [...t.items, newItem] }',
  COMP_TESTS
);

mutation(
  'topmostAt returns first track instead of last',
  COMP_PATH, compOriginal,
  'best = { track, item, trackIndex: ti };',
  'if (!best) best = { track, item, trackIndex: ti };',
  COMP_TESTS
);

mutation(
  'overlaps uses <= instead of > (false positives on abutting items)',
  COMP_PATH, compOriginal,
  'if (aEnd > b.at + EPS)',
  'if (aEnd >= b.at - EPS)',
  COMP_TESTS
);

mutation(
  'removeSource keeps orphaned items',
  COMP_PATH, compOriginal,
  'items: t.items.filter(i => i.source !== sourceId)',
  'items: t.items',
  COMP_TESTS
);

mutation(
  'track kind validation disabled',
  COMP_PATH, compOriginal,
  "if (trackKind === 'video' && src.kind === 'audio')",
  'if (false)',
  COMP_TESTS
);

// ── mapping mutations ─────────────────────────────────────────────────

console.log('\nmapping mutations');

mutation(
  'sourceToTimeline ignores in-point',
  MAP_PATH, mapOriginal,
  'const inPt = item.in || 0;',
  'const inPt = 0;',
  MAP_TESTS
);

mutation(
  'sourceToTimeline maps with wrong offset (drops in-point)',
  MAP_PATH, mapOriginal,
  'timelineTime: secs(item.at + (t - inPt)),',
  'timelineTime: secs(item.at + t),',
  MAP_TESTS
);

mutation(
  'timelineToSource maps with wrong offset (drops in-point)',
  MAP_PATH, mapOriginal,
  'sourceTime: secs(inPt + (t - item.at)),',
  'sourceTime: secs(t - item.at),',
  MAP_TESTS
);

mutation(
  'mapWordSpan uses word start instead of midpoint',
  MAP_PATH, mapOriginal,
  'const mid = (wordFrom + wordTo) / 2;',
  'const mid = wordFrom;',
  MAP_TESTS
);

mutation(
  'mapTranscript includes cut-out words',
  MAP_PATH, mapOriginal,
  'if (span) {',
  'if (true) {',
  MAP_TESTS
);

// ── report ────────────────────────────────────────────────────────────

console.log(`\n${passed} killed, ${failed} survived`);
if (failed) {
  console.log('MUTATION TESTING FAILED: some mutations survived');
  process.exit(1);
}
console.log('all mutations killed');
