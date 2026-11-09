/**
 * Mutation tests for the composition render graph.
 *
 * Same approach as composition-mutations.test.js: each mutation rewrites a
 * specific line in the source, runs the real tests in a subprocess, and
 * asserts that they fail. A mutation that survives means the tests have a gap.
 *
 *   node tests/composition-render-mutations.test.js
 *
 * Runs sequentially as a plain script (not node:test) because mutations
 * rewrite shared source files and must not overlap.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const RENDER_PATH = path.resolve(__dirname, '../../shared/compositionRender.mjs');
const RENDER_TESTS = path.resolve(__dirname, 'composition-render.test.js');

const original = fs.readFileSync(RENDER_PATH, 'utf8');

function restore() {
  fs.writeFileSync(RENDER_PATH, original);
}

function testsPass() {
  try {
    execSync(`node ${RENDER_TESTS}`, { stdio: 'pipe', timeout: 30000 });
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
  fs.writeFileSync(RENDER_PATH, original.replace(find, replace));
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

console.log('composition render graph mutations');

// ── Video item prep mutations ────────────────────────────────────────

mutation(
  'trim uses wrong start (ignores in-point)',
  'parts.push(`trim=start=${f(inPt)}:duration=${f(item.len)}`);',
  'parts.push(`trim=start=0:duration=${f(item.len)}`);'
);

mutation(
  'scale uses contain instead of cover',
  "if (fit === 'cover') {",
  "if (fit === 'contain') {"
);

// The `if (!isFx)` is part of the target, not decoration. An fx layer has
// its own `fps` earlier in the same function, so the bare line now appears
// twice and `String.replace` takes the first: the mutation hit the effect
// branch, the real one survived, and the sweep reported a gap that was its
// own. Caught by this file failing when the fx branch landed.
mutation(
  'fps filter removed',
  "if (!isFx) parts.push(`fps=${fps}`);",
  "// parts.push(`fps=${fps}`);"
);

mutation(
  'setsar removed (aspect ratio not normalised)',
  "parts.push('setsar=1');",
  "// parts.push('setsar=1');"
);

// ── Transition mutations ─────────────────────────────────────────────

mutation(
  'xfade uses wrong transition name (always fade)',
  "const xfadeName = XFADE_NAME[transType] || 'fade';",
  "const xfadeName = 'fade';"
);

mutation(
  'xfade offset calculation wrong (no overlap subtracted)',
  'const offset = secs(chainLen - dur);',
  'const offset = secs(chainLen);'
);

// ── Audio mutations ──────────────────────────────────────────────────

mutation(
  'audio gain not applied',
  "if (Math.abs(gain - 1) > 0.001) {\n        parts.push(`volume=${f(gain)}`);",
  "if (false) {\n        parts.push(`volume=${f(gain)}`);"
);

mutation(
  'audio delay removed (all audio starts at t=0)',
  'if (delayMs > 0) {\n        parts.push(`adelay=${delayMs}|${delayMs}`);',
  'if (false) {\n        parts.push(`adelay=${delayMs}|${delayMs}`);'
);

mutation(
  'amix normalize enabled (volume would change with track count)',
  'amix=inputs=${audioItemPads.length}:duration=longest:normalize=0',
  'amix=inputs=${audioItemPads.length}:duration=longest:normalize=1'
);

// ── Caption mutations ────────────────────────────────────────────────

mutation(
  'caption filter not added when path provided',
  'if (captionAssPath) {',
  'if (false) {'
);

mutation(
  'caption colon escaping removed',
  "const escaped = captionAssPath.replace(/\\\\/g, '/').replace(/:/g, '\\\\:');",
  "const escaped = captionAssPath;"
);

// ── report ───────────────────────────────────────────────────────────

console.log(`\n${passed} killed, ${failed} survived`);
if (failed) {
  console.log('MUTATION TESTING FAILED: some mutations survived');
  process.exit(1);
}
console.log('all mutations killed');
