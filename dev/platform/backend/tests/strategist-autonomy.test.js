// GTM Brain Phase 4 — autonomy tests.
//
//   node tests/strategist-autonomy.test.js

const assert = require('assert');
const { STAGES, STAGE_KEYS, threshold } = require('../src/services/strategist/autonomy');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

// ── STAGES ─────────────────────────────────────────────────────────

console.log('STAGES');

check('has exactly three stages', () => {
  assert.strictEqual(STAGE_KEYS.length, 3);
  assert.deepStrictEqual(STAGE_KEYS, ['assist', 'supervised', 'auto']);
});

check('each stage has a label', () => {
  for (const key of STAGE_KEYS) {
    assert.ok(typeof STAGES[key] === 'string' && STAGES[key].length > 0, `${key} has no label`);
  }
});

// ── threshold ──────────────────────────────────────────────────────

console.log('\nthreshold');

check('assist never auto-acts (threshold > 100%)', () => {
  assert.ok(threshold('assist') > 1.0);
});

check('supervised requires 75% win rate', () => {
  assert.strictEqual(threshold('supervised'), 0.75);
});

check('auto requires 60% win rate', () => {
  assert.strictEqual(threshold('auto'), 0.60);
});

check('unknown stage defaults to assist-level', () => {
  assert.ok(threshold('unknown') > 1.0);
  assert.ok(threshold(null) > 1.0);
  assert.ok(threshold(undefined) > 1.0);
});

check('supervised threshold is stricter than auto', () => {
  assert.ok(threshold('supervised') > threshold('auto'));
});

check('auto threshold is achievable (< 100%)', () => {
  assert.ok(threshold('auto') < 1.0);
});

// ── threshold integration with win rates ───────────────────────────

console.log('\nthreshold integration');

check('a 80% win rate clears supervised but also clears auto', () => {
  const winRate = 80;
  assert.ok(winRate >= threshold('supervised') * 100);
  assert.ok(winRate >= threshold('auto') * 100);
});

check('a 70% win rate clears auto but not supervised', () => {
  const winRate = 70;
  assert.ok(winRate >= threshold('auto') * 100);
  assert.ok(winRate < threshold('supervised') * 100);
});

check('a 50% win rate clears neither', () => {
  const winRate = 50;
  assert.ok(winRate < threshold('auto') * 100);
  assert.ok(winRate < threshold('supervised') * 100);
});

check('no win rate ever clears assist', () => {
  assert.ok(100 < threshold('assist') * 100);
});

// ── STAGE_KEYS validation ──────────────────────────────────────────

console.log('\nSTAGE_KEYS validation');

check('valid stages are accepted', () => {
  assert.ok(STAGE_KEYS.includes('assist'));
  assert.ok(STAGE_KEYS.includes('supervised'));
  assert.ok(STAGE_KEYS.includes('auto'));
});

check('invalid stages are not in the list', () => {
  assert.ok(!STAGE_KEYS.includes('turbo'));
  assert.ok(!STAGE_KEYS.includes(''));
  assert.ok(!STAGE_KEYS.includes(null));
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
