// Where prompt caching's money actually is.
//
// Anthropic's console says caching could save October up to 52% of direct
// API spend. The obvious reading of that — "nothing is cached, cache it" —
// was wrong when I checked: callClaude has wrapped every system prompt in
// cache_control for a while, and 17 of the 41 Messages calls go through it
// or call cacheableSystem directly. Of the seven that pass an uncached
// system, every one is a short string well under the 1,024-token minimum, so
// adding cache_control to them buys nothing at all.
//
// What is uncached is the user turn, where OMI's bulk lives: metrics, SERP
// payloads, transcripts, playbooks. cache_control appears on a system prompt
// in exactly two places in this codebase and on message content in none.
//
// So this ships the measurement rather than a guess, and the guard that
// matters is the arithmetic: a cache write costs 1.25x and a read 0.1x, so a
// feature that writes and never reads is WORSE off than one that never
// cached. A report that called that an optimisation would be worse than no
// report.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { verdict, writesFrom } = require('../src/services/cacheReport');
const costLog = require('../src/services/costLog');
const src = fs.readFileSync(path.join(__dirname, '..', 'src/services/cacheReport.js'), 'utf8');
let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

ok('writing without reading is called out, not counted as caching', () => {
  // The expensive mistake: a prompt that varies per call, or calls spaced
  // wider than the five-minute window. It pays the premium every time and
  // collects nothing.
  assert.strictEqual(verdict({ calls: 50, read: 0, write: 2_000_000, plain: 0 }), 'wasting');
  // Reading back less than it writes is the same disease, milder.
  assert.strictEqual(verdict({ calls: 50, read: 100_000, write: 900_000, plain: 0 }), 'wasting');
});

ok('and the three healthy states are told apart', () => {
  assert.strictEqual(verdict({ calls: 50, read: 9_000_000, write: 500_000, plain: 0 }), 'working');
  assert.strictEqual(verdict({ calls: 50, read: 0, write: 0, plain: 5_000_000 }), 'uncached');
});

ok('a feature with no traffic makes no claim', () => {
  // Three calls is not evidence of anything, and a red "Wasting" chip on a
  // feature used twice would send someone to fix nothing.
  assert.strictEqual(verdict({ calls: 2, read: 0, write: 500_000, plain: 0 }), 'quiet');
  assert.strictEqual(verdict({ calls: 50, read: 0, write: 900, plain: 100 }), 'quiet');
});

ok('both write shapes are read, as the cost log reads them', () => {
  // A Messages response carries a flat cache_creation_input_tokens; newer
  // ones carry a cache_creation split and no flat field. Reading one shape
  // would report half the writes as zero.
  assert.deepStrictEqual(writesFrom({ cache_creation_input_tokens: 500 }), { w5m: 500, w1h: 0 });
  assert.deepStrictEqual(
    writesFrom({ cache_creation: { ephemeral_5m_input_tokens: 300, ephemeral_1h_input_tokens: 200 } }),
    { w5m: 300, w1h: 200 });
  assert.deepStrictEqual(writesFrom({}), { w5m: 0, w1h: 0 });
  assert.deepStrictEqual(writesFrom(null), { w5m: 0, w1h: 0 });
});

ok('the report prices with the cost log, not with its own copy of 1.25', () => {
  // Two copies of the multiplier would drift, and this report's only job is
  // to be believed.
  assert.ok(/require\('\.\/costLog'\)/.test(src));
  assert.ok(/CACHE_WRITE_MULTIPLIER, CACHE_1H_WRITE_MULTIPLIER, DEFAULT_CACHE_READ/.test(src));
  assert.strictEqual(costLog.CACHE_WRITE_MULTIPLIER, 1.25);
  assert.strictEqual(costLog.CACHE_1H_WRITE_MULTIPLIER, 2.00);
  assert.strictEqual(costLog.DEFAULT_CACHE_READ, 0.10);
  // And it must not define its own.
  assert.ok(!/const CACHE_WRITE_MULTIPLIER\s*=/.test(src));
  assert.ok(!/= 1\.25/.test(src));
});

ok('the saving is reads earned minus the write premium, and can go negative', () => {
  const fn = src.slice(src.indexOf('async function cacheReport'), src.indexOf('function verdict'));
  assert.ok(/f\.savedUsd \+= \(read \/ 1e6\) \* price\.input \* \(1 - readMult\)/.test(fn),
    'what the reads saved against full price');
  assert.ok(/f\.savedUsd -= \(w5m \/ 1e6\) \* price\.input \* \(CACHE_WRITE_MULTIPLIER - 1\)/.test(fn),
    'minus what the 5-minute writes cost over it');
  assert.ok(/f\.savedUsd -= \(w1h \/ 1e6\) \* price\.input \* \(CACHE_1H_WRITE_MULTIPLIER - 1\)/.test(fn),
    'and the hour writes, which are 2x not 1.25x');
  assert.ok(!/Math\.max\(0,/.test(fn), 'a negative saving is the finding, so it is never clamped to zero');
});

ok('the window is bounded, and the query is parameterised', () => {
  const fn = src.slice(src.indexOf('async function cacheReport'), src.indexOf('function verdict'));
  assert.ok(/Math\.min\(365, Math\.max\(1,/.test(fn));
  assert.ok(/\$1 \|\| ' days'\)::interval/.test(fn), 'the interval is a bound parameter, not interpolated');
  assert.ok(!/\$\{window\}/.test(fn));
});

// ── The finding this replaced a guess with ───────────────────────────────────

ok('the system prompt is already cached nearly everywhere', () => {
  // Stated as a test so the next person does not repeat my first conclusion.
  const all = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) all.push(p);
    }
  };
  walk(path.join(__dirname, '..', 'src'));
  const uses = all.filter((f) => /cacheableSystem/.test(fs.readFileSync(f, 'utf8')));
  assert.ok(uses.length >= 8, `cacheableSystem is used across the codebase (${uses.length} files)`);
  const claude = fs.readFileSync(path.join(__dirname, '..', 'src/services/claude.js'), 'utf8');
  assert.ok(/system: cacheableSystem\(system\)/.test(claude),
    'and callClaude wraps it, so every caller through it is cached');
});

ok('and the user turn, where the bulk is, is cached nowhere', () => {
  // This is the lever. If a later change starts caching message content,
  // this assertion is the one to update, deliberately.
  const all = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) all.push(p);
    }
  };
  walk(path.join(__dirname, '..', 'src'));
  const withCC = all.filter((f) => /cache_control/.test(fs.readFileSync(f, 'utf8')));
  assert.deepStrictEqual(
    withCC.map((f) => path.basename(f)).sort(),
    ['claude.js', 'contentReviewer.js'],
    'cache_control still appears in exactly two files, both on the system prompt');
});

console.log(`cache-report    ✓ ${passed} assertions passed`);
