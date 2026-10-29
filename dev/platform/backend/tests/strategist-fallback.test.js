// The queue is the page. An empty one must never ship silently.
//
// Falcon's first briefing shipped exactly that: five Claude passes, paid and
// owned recommendations sitting inside the pillar analyses, and a page reading
// "Nothing on the queue from this briefing." The synthesis prompt told the
// model that if nothing had changed it should write one line "and nothing
// else", and on a first briefing nothing has changed by definition, so it
// wrote the line and stopped before the queue.
//
// The prompt is fixed. This guards the floor under it, because a model can
// always omit a section and the fix must not depend on it never doing so.
//
//   node tests/strategist-fallback.test.js

const assert = require('assert');
const { pillarFallbackQueue, queueFor } = require('../src/services/strategist/briefing');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const section = (pillar, ok, recs) => ({ pillar, label: pillar, ok, recommendations: recs });

console.log('pillarFallbackQueue');

check('a pillar recommendation becomes a queue line', () => {
  const out = pillarFallbackQueue([
    section('paid', true, [{ priority: 'crucial', text: 'Fix the Meta Pixel :: 4,360 clicks at zero conversions.' }]),
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].text, 'Fix the Meta Pixel');
  assert.strictEqual(out[0].rationale, '4,360 clicks at zero conversions.');
  assert.strictEqual(out[0].pillar, 'paid');
  assert.strictEqual(out[0].priority, 'crucial');
});

check('crucial comes before nice, across pillars', () => {
  // Pillar order would put the owned item first; priority has to win, or the
  // page leads with a nice-to-have.
  const out = pillarFallbackQueue([
    section('owned', true, [{ priority: 'nice', text: 'Refresh three pages :: organic fell 18%.' }]),
    section('paid', true, [{ priority: 'crucial', text: 'Fix the Pixel :: zero conversions.' }]),
  ]);
  assert.deepStrictEqual(out.map(r => r.priority), ['crucial', 'nice']);
  assert.strictEqual(out[0].text, 'Fix the Pixel');
});

check('a pillar that reported nothing contributes nothing', () => {
  const out = pillarFallbackQueue([
    section('earned', false, [{ priority: 'crucial', text: 'Should never appear :: no data.' }]),
  ]);
  assert.deepStrictEqual(out, []);
});

check('an item with no rationale still becomes a line', () => {
  const out = pillarFallbackQueue([
    section('paid', true, [{ priority: 'crucial', text: 'Fix the Pixel' }]),
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].text, 'Fix the Pixel');
  assert.strictEqual(out[0].rationale, null);
});

check('an empty text is dropped rather than queued blank', () => {
  const out = pillarFallbackQueue([
    section('paid', true, [{ priority: 'crucial', text: ' :: a reason with no action' }]),
  ]);
  assert.deepStrictEqual(out, []);
});

check('no sections, or junk, is an empty queue rather than a crash', () => {
  for (const input of [[], null, undefined, [{}], [section('paid', true, null)]]) {
    assert.deepStrictEqual(pillarFallbackQueue(input || []), [], JSON.stringify(input));
  }
});

check('it carries no tag, so nothing inherits another item\'s age', () => {
  // The [A1] tags thread a carried item back to when it was first raised.
  // A fallback item was never in a previous queue, so claiming a tag would
  // date it to something it is not.
  const out = pillarFallbackQueue([
    section('paid', true, [{ priority: 'crucial', text: 'Fix the Pixel :: zero conversions.' }]),
  ]);
  assert.strictEqual(out[0].tag, null);
});

check('every pillar is represented, not just the first with anything', () => {
  const out = pillarFallbackQueue([
    section('paid', true, [{ priority: 'crucial', text: 'A :: one.' }]),
    section('owned', true, [{ priority: 'crucial', text: 'B :: two.' }]),
  ]);
  assert.deepStrictEqual(out.map(r => r.text), ['A', 'B']);
});

console.log('\nqueueFor');

const SYNTH_WITH_QUEUE = `### What changed

- The Pixel is still dead.

### The queue

- [CRUCIAL] Fix the Meta Pixel :: 4,360 clicks at zero conversions.
`;
// What Falcon's first briefing actually looked like: one line, no queue.
const SYNTH_NO_QUEUE = `### What changed

First briefing. All figures are opening baselines, not movements.
`;
const PILLARS = [section('paid', true, [{ priority: 'crucial', text: 'Fix the Pixel :: zero conversions.' }])];

check('a synthesis with a queue is used as written', () => {
  const r = queueFor(SYNTH_WITH_QUEUE, PILLARS);
  assert.strictEqual(r.fromPillars, false);
  assert.strictEqual(r.lines.length, 1);
  assert.match(r.lines[0].text, /Meta Pixel/);
});

check('a synthesis with NO queue falls back to the pillars', () => {
  // The whole guard. Without it the page reads "Nothing on the queue from
  // this briefing" while the recommendations sit unused in the sections.
  const r = queueFor(SYNTH_NO_QUEUE, PILLARS);
  assert.strictEqual(r.fromPillars, true);
  assert.strictEqual(r.lines.length, 1);
  assert.strictEqual(r.lines[0].text, 'Fix the Pixel');
});

check('the fallback does not fire while the synthesis has a queue', () => {
  // Two lists of the same work is the failure the pillar recs were kept out
  // of the queue to avoid, so the fallback must only fire into a vacuum.
  const r = queueFor(SYNTH_WITH_QUEUE, PILLARS);
  assert.strictEqual(r.lines.length, 1, 'the pillar item must not be added alongside');
});

check('no queue anywhere is an empty queue, honestly', () => {
  const r = queueFor(SYNTH_NO_QUEUE, [section('earned', false, [])]);
  assert.deepStrictEqual(r.lines, []);
  assert.strictEqual(r.fromPillars, false, 'nothing was substituted, so nothing should claim it was');
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
