/**
 * Mutation tests for splitItem and moveItemToTrack.
 *
 * Same sequential-script approach as the other mutation tests: each
 * mutation rewrites a specific line, runs the real tests, and asserts
 * they fail. A mutation that survives means the tests have a gap.
 *
 *   node tests/composition-timeline-mutations.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const COMP_PATH = path.resolve(__dirname, '../../shared/composition.mjs');
const TESTS = path.resolve(__dirname, 'composition-timeline.test.js');

const original = fs.readFileSync(COMP_PATH, 'utf8');

function restore() {
  fs.writeFileSync(COMP_PATH, original);
}

function testsPass() {
  try {
    execSync(`node --test ${TESTS}`, { stdio: 'pipe', timeout: 30000 });
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
  fs.writeFileSync(COMP_PATH, original.replace(find, replace));
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

console.log('splitItem and moveItemToTrack mutations');

// ── splitItem mutations ─────────────────────────────────────────────

mutation(
  'split ignores in-point (second half in not adjusted)',
  'in: secs(inPt + splitOffset),',
  'in: secs(inPt),'
);

mutation(
  'split second half starts at wrong time',
  'at: secs(splitTime),\n    len: secs(end - splitTime),',
  'at: secs(splitTime),\n    len: secs(item.len),'
);

mutation(
  'split first half keeps original length',
  'const first = { ...item, len: secs(splitOffset) };',
  'const first = { ...item, len: secs(item.len) };'
);

mutation(
  'split does not delete transition on second half',
  'delete second.trans;',
  '// skip delete'
);

mutation(
  'split boundary check removed (allows split at start)',
  'if (splitTime <= item.at + EPS || splitTime >= end - EPS) return { comp, id: null };',
  'if (false) return { comp, id: null };'
);

// ── moveItemToTrack mutations ───────────────────────────────────────

mutation(
  'move does not remove item from source track',
  "return { ...t, items: t.items.filter(i => i.id !== itemId) };",
  "return t;"
);

mutation(
  'move skips kind check for audio on video track',
  "if (toTrack.kind === 'audio' && (src?.kind === 'clip' || src?.kind === 'design')) return comp;",
  "// skip check"
);

mutation(
  'move skips kind check for video on audio track',
  "if (toTrack.kind === 'video' && src?.kind === 'audio') return comp;",
  "// skip check"
);

mutation(
  'move does not sort items after insertion',
  "return { ...t, items: [...t.items, item].sort((a, b) => a.at - b.at) };",
  "return { ...t, items: [...t.items, item] };"
);

// ── report ──────────────────────────────────────────────────────────

console.log(`\n${passed} killed, ${failed} survived`);
if (failed) {
  console.log('MUTATION TESTING FAILED: some mutations survived');
  process.exit(1);
}
console.log('all mutations killed');
