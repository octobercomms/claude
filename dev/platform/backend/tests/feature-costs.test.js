// The number on the button has to be the one the next click will cost.
//
// Two things make that non-obvious. A feature can bill two providers for one
// click (Claude tokens plus a Serper search fee), and spend is wildly skewed:
// nine image generations at $0.04 and one runaway at $5 give a mean of $0.54,
// thirteen times what the next click costs. A figure that overstates by that
// much gets ignored, which is worse than showing nothing — so the query uses
// a median, and this file pins the folding either side of it.
//
//   node tests/feature-costs.test.js

const assert = require('assert');
const { foldFeatureCosts } = require('../src/routes/settings');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

check('one provider, one feature, straight through', () => {
  const out = foldFeatureCosts([
    { feature: 'image_gen', provider: 'replicate', calls: 10, cost_usd: 5.36, per_call: 0.04 },
  ]);
  assert.deepStrictEqual(out, { image_gen: { calls: 10, cost_usd: 5.36, per_call: 0.04 } });
});

check('two providers on one feature are summed, not listed twice', () => {
  // Measured against real Postgres: press_outlet_resolve bills Claude and
  // Serper for the same resolution. The click spends both.
  const out = foldFeatureCosts([
    { feature: 'press_outlet_resolve', provider: 'anthropic', calls: 2, cost_usd: 0.04, per_call: 0.02 },
    { feature: 'press_outlet_resolve', provider: 'serper',    calls: 2, cost_usd: 0.02, per_call: 0.01 },
  ]);
  assert.strictEqual(Object.keys(out).length, 1, 'the feature was reported twice');
  assert.ok(Math.abs(out.press_outlet_resolve.cost_usd - 0.06) < 1e-9, 'spend must be the sum of both providers');
  assert.ok(Math.abs(out.press_outlet_resolve.per_call - 0.03) < 1e-9, 'per-call must be the sum of both providers');
});

check('calls is the max across providers, never the sum', () => {
  // Two providers billed by one click is still one click. Summing them would
  // halve the apparent cost per call for exactly the features that cost most.
  const out = foldFeatureCosts([
    { feature: 'f', provider: 'a', calls: 2, cost_usd: 0.04, per_call: 0.02 },
    { feature: 'f', provider: 'b', calls: 2, cost_usd: 0.02, per_call: 0.01 },
  ]);
  assert.strictEqual(out.f.calls, 2, 'calls doubled — the per-click figure would read half what it is');
});

check('garbage in a row cannot produce NaN on a button', () => {
  const out = foldFeatureCosts([
    { feature: 'f', provider: 'a', calls: null, cost_usd: null, per_call: null },
    { feature: 'f', provider: 'b', calls: '3',  cost_usd: '0.5', per_call: '0.25' },
  ]);
  assert.strictEqual(out.f.calls, 3, 'numeric strings must be read as numbers');
  assert.ok(Number.isFinite(out.f.cost_usd) && Number.isFinite(out.f.per_call),
    `NaN reached the output: ${JSON.stringify(out.f)}`);
  assert.ok(Math.abs(out.f.cost_usd - 0.5) < 1e-9);
});

check('no rows is an empty object, not a crash', () => {
  assert.deepStrictEqual(foldFeatureCosts([]), {});
  assert.deepStrictEqual(foldFeatureCosts(undefined), {});
});

check('features stay separate', () => {
  const out = foldFeatureCosts([
    { feature: 'image_gen', provider: 'r', calls: 3, cost_usd: 0.12, per_call: 0.04 },
    { feature: 'ugc_video', provider: 'r', calls: 1, cost_usd: 1.00, per_call: 1.00 },
  ]);
  assert.deepStrictEqual(Object.keys(out).sort(), ['image_gen', 'ugc_video']);
  assert.strictEqual(out.ugc_video.per_call, 1);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
