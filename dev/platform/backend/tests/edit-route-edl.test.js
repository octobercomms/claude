/**
 * Guards on what the edit route will accept as an edit decision list.
 *
 * The EDL arrives from the browser and each block becomes its own ffmpeg
 * process, so this is a resource boundary as well as a correctness one. It is
 * tested by loading the route's own validator rather than by re-stating the
 * rules, so a rule that changes in one place cannot pass here.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src', 'routes', 'edit.js');
const src = fs.readFileSync(SRC, 'utf8');

// The validator is module-private, so it is evaluated out of the source rather
// than exported: exporting it only for a test would widen the route's surface.
function loadValidator() {
  const start = src.indexOf('const MAX_EDL_BLOCKS');
  const end = src.indexOf('// Several clips →');
  assert.ok(start > 0 && end > start, 'the EDL validator must still be there to test');
  // eslint-disable-next-line no-new-func
  return new Function(`${src.slice(start, end)}; return { edlProblem, MAX_EDL_BLOCKS };`)();
}

const { edlProblem, MAX_EDL_BLOCKS } = loadValidator();
const ok = (items) => ({ version: 1, items });
const block = (over = {}) => ({ id: 'a', clip: 0, in: 0, out: 5, gain: 1, ...over });

test('no EDL is not a problem', () => {
  assert.equal(edlProblem(null, 1), null);
  assert.equal(edlProblem(undefined, 1), null);
});

test('a plain edit passes', () => {
  assert.equal(edlProblem(ok([block(), block({ clip: 1, in: 2, out: 7 })]), 2), null);
  assert.equal(edlProblem(ok([block({ out: null })]), 1), null,
    'a whole clip of unknown length is a valid block');
});

test('the block count is capped', () => {
  const many = ok(Array.from({ length: MAX_EDL_BLOCKS + 1 }, () => block()));
  const msg = edlProblem(many, 1);
  assert.ok(msg, 'an unbounded edit would occupy the render box for an afternoon');
  assert.match(msg, new RegExp(String(MAX_EDL_BLOCKS)), 'the limit must be stated to the operator');
  assert.equal(edlProblem(ok(Array.from({ length: MAX_EDL_BLOCKS }, () => block())), 1), null,
    'exactly the limit is allowed');
});

test('a block cannot name a clip the job does not have', () => {
  assert.ok(edlProblem(ok([block({ clip: 3 })]), 2));
  assert.ok(edlProblem(ok([block({ clip: -1 })]), 2));
  assert.ok(edlProblem(ok([block({ clip: 1.5 })]), 2), 'a fractional index is not an index');
  // A numeric string passes: JSON from the timeline sends numbers, and the
  // processor runs every index through `Math.trunc(Number(...))` before using
  // it, so '0' and 0 cannot diverge. What must not pass is a string that is
  // not an index at all.
  assert.equal(edlProblem(ok([block({ clip: '0' })]), 1), null);
  assert.ok(edlProblem(ok([block({ clip: 'first' })]), 1));
  assert.ok(edlProblem(ok([block({ clip: null })]), 1));
});

test('a block that ends before it begins is refused', () => {
  assert.ok(edlProblem(ok([block({ in: 5, out: 4 })]), 1));
  assert.ok(edlProblem(ok([block({ in: 5, out: 5 })]), 1), 'and a zero-length one');
  assert.ok(edlProblem(ok([block({ in: -1 })]), 1));
  assert.ok(edlProblem(ok([block({ in: NaN })]), 1));
  assert.ok(edlProblem(ok([block({ in: 'soon' })]), 1));
  assert.ok(edlProblem(ok([block({ out: Infinity })]), 1));
});

test('something that is not an edit at all is refused', () => {
  assert.ok(edlProblem({ version: 1 }, 1));
  assert.ok(edlProblem({ version: 1, items: 'none' }, 1));
  assert.ok(edlProblem('an edit', 1));
  assert.ok(edlProblem(42, 1));
  assert.equal(edlProblem(ok([]), 1), null, 'an empty edit is valid, just empty');
});

test('reopen validates without a clip count', () => {
  assert.equal(edlProblem(ok([block({ clip: 99 })]), null), null,
    'reopen does not know the clip list, so the processor drops stale blocks');
  assert.ok(edlProblem(ok([block({ in: 9, out: 1 })]), null),
    'but malformed arithmetic is still refused before it queues');
});

test('an EDL counts as an edit, so a timeline-only change is not refused', () => {
  // Without this, trimming one clip on the timeline and pressing render came
  // back "pick at least one edit" while the trim was plainly on screen.
  assert.match(src, /const hasEdl = !!\(ops\.edl && Array\.isArray\(ops\.edl\.items\) && ops\.edl\.items\.length\)/);
  const gate = src.slice(src.indexOf('const hasEdl'), src.indexOf('const wantsSomething') + 220);
  assert.match(gate, /hasCuts = hasEdl/);
});

test('both the create and the reopen route validate the edit', () => {
  const calls = src.match(/edlProblem\(ops\.edl/g) || [];
  assert.equal(calls.length, 2,
    'an edit that could not be created must not be reachable by reopening a job');
});

// ---- positioned text ---------------------------------------------------

function loadOverlayValidator() {
  const start = src.indexOf('const MAX_OVERLAYS_IN');
  const end = src.indexOf('// Several clips →');
  assert.ok(start > 0 && end > start, 'the overlay validator must still be there to test');
  // eslint-disable-next-line no-new-func
  return new Function(`${src.slice(start, end)}; return { overlayProblem, MAX_OVERLAYS_IN, MAX_OVERLAY_TEXT };`)();
}
const OV = loadOverlayValidator();
const text = (over = {}) => ({ text: 'Hook', from: 0, to: 3, ...over });

test('no overlays is not a problem', () => {
  assert.equal(OV.overlayProblem(null), null);
  assert.equal(OV.overlayProblem(undefined), null);
  assert.equal(OV.overlayProblem([]), null);
});

test('a plain set of overlays passes', () => {
  assert.equal(OV.overlayProblem([text(), text({ from: 4, to: 6 })]), null);
  assert.equal(OV.overlayProblem([text({ from: null, to: null })]), null,
    'missing times are filled in later, not refused here');
});

test('the overlay count and text length are capped', () => {
  const many = Array.from({ length: OV.MAX_OVERLAYS_IN + 1 }, () => text());
  assert.match(OV.overlayProblem(many), new RegExp(String(OV.MAX_OVERLAYS_IN)));
  assert.equal(OV.overlayProblem(Array.from({ length: OV.MAX_OVERLAYS_IN }, () => text())), null);
  assert.ok(OV.overlayProblem([text({ text: 'x'.repeat(OV.MAX_OVERLAY_TEXT + 1) })]));
  assert.equal(OV.overlayProblem([text({ text: 'x'.repeat(OV.MAX_OVERLAY_TEXT) })]), null);
});

test('an overlay with no text, or a malformed one, is refused', () => {
  assert.ok(OV.overlayProblem([{ from: 0, to: 2 }]));
  assert.ok(OV.overlayProblem([{ text: 42, from: 0, to: 2 }]));
  assert.ok(OV.overlayProblem([null]));
  assert.ok(OV.overlayProblem(['Hook']));
  assert.ok(OV.overlayProblem('Hook'));
  assert.ok(OV.overlayProblem({ text: 'Hook' }), 'a single object is not a list');
});

test('an invalid time is refused', () => {
  assert.ok(OV.overlayProblem([text({ from: NaN })]));
  assert.ok(OV.overlayProblem([text({ to: Infinity })]));
  assert.ok(OV.overlayProblem([text({ from: -1 })]));
  assert.ok(OV.overlayProblem([text({ from: 'soon' })]));
});

test('the route does not sanitise the text, because the ASS builder does', () => {
  // Escaping here as well would replace the operator's braces in the database
  // and not only on screen. One place owns it: shared/overlays.mjs.
  assert.equal(OV.overlayProblem([text({ text: 'Hook {\\pos(0,0)}' })]), null);
  assert.doesNotMatch(src.slice(src.indexOf('function overlayProblem')), /replace\(/,
    'the validator must bound the text, not rewrite it');
});

test('text alone counts as an edit', () => {
  // Without this, adding only an overlay comes back "pick at least one edit"
  // while the text is plainly on the timeline.
  assert.match(src, /const hasOverlays = Array\.isArray\(ops\.overlays\)/);
  const gate = src.slice(src.indexOf('const hasOverlays'), src.indexOf('const edlErr'));
  assert.match(gate, /o\.text\.trim\(\)/, 'an overlay of only spaces is not an edit');
  assert.match(gate, /\|\| hasOverlays \|\|/);
});

test('both the create and the reopen route bound the overlays', () => {
  const calls = src.match(/overlayProblem\(ops\.overlays\)/g) || [];
  assert.equal(calls.length, 2,
    'an edit that could not be created must not be reachable by reopening a job');
});
