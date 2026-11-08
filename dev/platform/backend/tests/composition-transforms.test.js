/**
 * Animatable transforms on a composition item.
 *
 * These carry the batch build's motion: a deterministic camera move over a
 * still is an animated `scale` and `pos`, chosen over a hosted
 * image-to-video call so the batch has no vendor in its critical path.
 *
 * The central test here is the SPLIT INVARIANT. It asserts the property
 * rather than the implementation: sampling the transform across the two
 * halves of a split item must give the same numbers as sampling the
 * original at the same timeline times. Without proportional slicing both
 * halves inherit the whole {from, to} and each performs the entire move, so
 * the cut jumps. That fault appears on one editing path only, which is
 * exactly the shape this repo has shipped three times.
 *
 *   node --test tests/composition-transforms.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  emptyComposition,
  addSource,
  addTrack,
  addItem,
  splitItem,
  moveItemToTrack,
  validate,
  isValid,
  isAnim,
  animAt,
  sliceAnim,
  sliceItemTransforms,
  itemTransformAt,
  TRANSFORM_FIELDS,
} = require('../../shared/composition.mjs');

// ── fixtures ─────────────────────────────────────────────────────────

// One 10s clip on a video track, pushing in from 1.0 to 1.5 across itself.
function pushInComp(extra = {}) {
  let comp = emptyComposition({ width: 1080, height: 1920, fps: 30 });
  const s = addSource(comp, { kind: 'clip', asset: 'a.mp4', duration: 20, width: 1080, height: 1920, fps: 30 });
  comp = s.comp;
  const t = addTrack(comp, 'video');
  comp = t.comp;
  const r = addItem(comp, t.id, {
    at: 0, len: 10, source: s.id, in: 0,
    scale: { from: 1.0, to: 1.5 },
    ...extra,
  });
  return { comp: r.comp, trackId: t.id, itemId: r.id, sourceId: s.id };
}

function itemOf(comp, trackId, itemId) {
  return comp.tracks.find(t => t.id === trackId).items.find(i => i.id === itemId);
}

// ── animatable arithmetic ────────────────────────────────────────────

describe('animatable values', () => {
  it('tells a pair from a scalar', () => {
    assert.equal(isAnim({ from: 1, to: 2 }), true);
    assert.equal(isAnim(1.5), false);
    assert.equal(isAnim(null), false);
    assert.equal(isAnim([1, 2]), false, 'an array is not a from/to pair');
  });

  it('interpolates a scalar pair linearly', () => {
    const v = { from: 1, to: 2 };
    assert.equal(animAt(v, 0), 1);
    assert.equal(animAt(v, 0.5), 1.5);
    assert.equal(animAt(v, 1), 2);
  });

  it('clamps progress outside 0..1 rather than extrapolating', () => {
    const v = { from: 1, to: 2 };
    assert.equal(animAt(v, -1), 1, 'before the item starts, hold the first value');
    assert.equal(animAt(v, 5), 2, 'after it ends, hold the last');
  });

  it('interpolates a point pair per axis', () => {
    const v = { from: { x: 0, y: 0 }, to: { x: 0.2, y: -0.1 } };
    assert.deepEqual(animAt(v, 0.5), { x: 0.1, y: -0.05 });
  });

  it('holds a scalar at every progress', () => {
    assert.equal(animAt(2.5, 0), 2.5);
    assert.equal(animAt(2.5, 1), 2.5);
  });

  it('slices a sub-range', () => {
    assert.deepEqual(sliceAnim({ from: 1, to: 2 }, 0, 0.5), { from: 1, to: 1.5 });
    assert.deepEqual(sliceAnim({ from: 1, to: 2 }, 0.5, 1), { from: 1.5, to: 2 });
    assert.equal(sliceAnim(3, 0, 0.5), 3, 'a scalar has no sub-range');
  });

  it('returns only the transform fields an item actually carries', () => {
    const sliced = sliceItemTransforms({ scale: { from: 1, to: 2 }, len: 10, at: 0 }, 0, 0.5);
    assert.deepEqual(Object.keys(sliced), ['scale']);
    assert.equal('pos' in sliced, false, 'must not introduce a field that was absent');
  });
});

// ── the split invariant ──────────────────────────────────────────────

describe('splitting an item with an animated transform', () => {
  it('keeps the transform identical at every timeline time', () => {
    const { comp, trackId, itemId } = pushInComp();
    const original = itemOf(comp, trackId, itemId);

    // Sample the original across its whole length.
    const times = [0, 1, 2.5, 4, 5, 6, 7.5, 9, 9.99];
    const before = times.map(t => itemTransformAt(original, t).scale);

    const split = splitItem(comp, trackId, itemId, 4);
    assert.ok(split.id, 'the split produced a second item');

    const items = split.comp.tracks.find(t => t.id === trackId).items;
    assert.equal(items.length, 2);

    // Sample the pair: whichever half covers that time owns it.
    const after = times.map((t) => {
      const owner = items.find(i => t >= i.at && t < i.at + i.len) || items[items.length - 1];
      return itemTransformAt(owner, t).scale;
    });

    for (let i = 0; i < times.length; i++) {
      assert.ok(
        Math.abs(before[i] - after[i]) < 1e-9,
        `at t=${times[i]} the split changed the scale: ${before[i]} became ${after[i]}`
      );
    }
  });

  it('gives each half the proportional sub-range, not the whole move', () => {
    const { comp, trackId, itemId } = pushInComp();
    const split = splitItem(comp, trackId, itemId, 4); // 40% through
    const [first, second] = split.comp.tracks.find(t => t.id === trackId).items;

    assert.equal(first.scale.from, 1.0);
    assert.ok(Math.abs(first.scale.to - 1.2) < 1e-9, 'first half ends 40% along the move');
    assert.ok(Math.abs(second.scale.from - 1.2) < 1e-9, 'second half starts where the first ended');
    assert.equal(second.scale.to, 1.5);
  });

  it('slices every transform field, not only scale', () => {
    const { comp, trackId, itemId } = pushInComp({
      pos: { from: { x: 0, y: 0 }, to: { x: 0.5, y: 0.5 } },
      rot: { from: 0, to: 10 },
    });
    const split = splitItem(comp, trackId, itemId, 5); // halfway
    const [first, second] = split.comp.tracks.find(t => t.id === trackId).items;

    for (const f of TRANSFORM_FIELDS) {
      assert.ok(first[f] != null && second[f] != null, `${f} survives the split`);
    }
    assert.ok(Math.abs(first.rot.to - 5) < 1e-9, 'rot halves');
    assert.ok(Math.abs(second.pos.from.x - 0.25) < 1e-9, 'pos.x halves');
  });

  it('leaves a static transform alone', () => {
    const { comp, trackId, itemId } = pushInComp({ scale: 1.2 });
    const split = splitItem(comp, trackId, itemId, 4);
    const [first, second] = split.comp.tracks.find(t => t.id === trackId).items;
    assert.equal(first.scale, 1.2);
    assert.equal(second.scale, 1.2);
  });

  it('produces two valid items', () => {
    const { comp, trackId, itemId } = pushInComp({ reason: 'opens on the facade' });
    const split = splitItem(comp, trackId, itemId, 4);
    assert.deepEqual(validate(split.comp), []);
  });
});

// ── itemTransformAt ──────────────────────────────────────────────────

describe('itemTransformAt', () => {
  it('defaults to an untransformed frame', () => {
    const tr = itemTransformAt({ at: 0, len: 5 }, 2);
    assert.deepEqual(tr, { scale: 1, pos: { x: 0, y: 0 }, rot: 0 });
  });

  it('reads progress from the item, not the timeline origin', () => {
    const item = { at: 10, len: 10, scale: { from: 1, to: 2 } };
    assert.equal(itemTransformAt(item, 10).scale, 1);
    assert.equal(itemTransformAt(item, 15).scale, 1.5);
    assert.equal(itemTransformAt(item, 20).scale, 2);
  });

  it('does not divide by zero on a zero-length item', () => {
    const tr = itemTransformAt({ at: 0, len: 0, scale: { from: 1, to: 2 } }, 0);
    assert.ok(Number.isFinite(tr.scale));
  });
});

// ── validation ───────────────────────────────────────────────────────

describe('transform validation', () => {
  function withItem(extra) {
    let comp = emptyComposition({ width: 1080, height: 1920, fps: 30 });
    const s = addSource(comp, { kind: 'clip', asset: 'a.mp4', duration: 20 });
    comp = s.comp;
    const t = addTrack(comp, 'video');
    comp = t.comp;
    return addItem(comp, t.id, { at: 0, len: 5, source: s.id, ...extra }).comp;
  }

  it('rejects a half pair, because it would silently read as static', () => {
    const errs = validate(withItem({ scale: { from: 1.2 } }));
    assert.equal(errs.length, 1);
    assert.match(errs[0], /needs both from and to/);
  });

  it('rejects a non-finite or out-of-range scale', () => {
    assert.match(validate(withItem({ scale: 0 }))[0], /must be 0.01..10/);
    assert.match(validate(withItem({ scale: 50 }))[0], /must be 0.01..10/);
    assert.match(validate(withItem({ scale: 'big' }))[0], /finite number/);
    assert.match(validate(withItem({ scale: { from: 1, to: Infinity } }))[0], /finite number/);
  });

  it('rejects a pos that is not a point, and one off in the distance', () => {
    assert.match(validate(withItem({ pos: 0.5 }))[0], /\{x, y\} point/);
    assert.match(validate(withItem({ pos: { x: 99, y: 0 } }))[0], /must be -2..3/);
  });

  it('allows a pos just outside the frame, so a move can start off screen', () => {
    assert.equal(isValid(withItem({ pos: { from: { x: -1, y: 0 }, to: { x: 0, y: 0 } } })), true);
  });

  it('rejects a rotation beyond a full turn', () => {
    assert.match(validate(withItem({ rot: 400 }))[0], /must be -360..360/);
    assert.equal(isValid(withItem({ rot: -90 })), true);
  });

  it('accepts an absent transform', () => {
    assert.equal(isValid(withItem({})), true);
  });
});

describe('rationale fields', () => {
  function withItem(extra) {
    let comp = emptyComposition({ width: 1080, height: 1920, fps: 30 });
    const s = addSource(comp, { kind: 'clip', asset: 'a.mp4', duration: 20 });
    comp = s.comp;
    const t = addTrack(comp, 'video');
    comp = t.comp;
    return addItem(comp, t.id, { at: 0, len: 5, source: s.id, ...extra }).comp;
  }

  it('accepts a short explanation', () => {
    assert.equal(isValid(withItem({ reason: 'the hook lands here', beat: 'hook', quote: 'every map showed' })), true);
  });

  it('rejects a non-string', () => {
    assert.match(validate(withItem({ reason: 42 }))[0], /must be a string/);
  });

  it('bounds the length, because an agent writes these', () => {
    assert.match(validate(withItem({ reason: 'x'.repeat(501) }))[0], /at most 500 characters/);
  });
});

// ── fx belongs on a picture track ────────────────────────────────────

describe('fx sources', () => {
  function fxComp(trackKind) {
    let comp = emptyComposition({ width: 1080, height: 1920, fps: 30 });
    const s = addSource(comp, { kind: 'fx', effect: 'spotlight', duration: 3, alpha: true });
    comp = s.comp;
    const t = addTrack(comp, trackKind);
    comp = t.comp;
    const r = addItem(comp, t.id, { at: 0, len: 3, source: s.id });
    return { comp: r.comp, trackId: t.id, itemId: r.id, sourceId: s.id };
  }

  it('validates on a video track', () => {
    assert.equal(isValid(fxComp('video').comp), true);
  });

  it('is refused on an audio track', () => {
    const errs = validate(fxComp('audio').comp);
    assert.equal(errs.length, 1);
    assert.match(errs[0], /fx source on an audio track/);
  });

  it('cannot be dragged onto an audio track either', () => {
    // The same rule has to hold in the editing helper, not only in
    // validation: a drag that produces an invalid composition would be
    // caught on save rather than refused on drop.
    const { comp, trackId, itemId } = fxComp('video');
    const a = addTrack(comp, 'audio');
    const moved = moveItemToTrack(a.comp, trackId, itemId, a.id);
    const stillThere = moved.tracks.find(t => t.id === trackId).items.length;
    assert.equal(stillThere, 1, 'the fx item stayed on the video track');
  });

  it('needs an effect name', () => {
    let comp = emptyComposition({ width: 1080, height: 1920, fps: 30 });
    comp = addSource(comp, { kind: 'fx', duration: 3 }).comp;
    assert.match(validate(comp)[0], /fx needs an effect name/);
  });

  it('rejects a non-positive duration and a non-object params', () => {
    let a = emptyComposition({ width: 1080, height: 1920, fps: 30 });
    a = addSource(a, { kind: 'fx', effect: 'orbit', duration: 0 }).comp;
    assert.match(validate(a)[0], /fx duration must be positive/);

    let b = emptyComposition({ width: 1080, height: 1920, fps: 30 });
    b = addSource(b, { kind: 'fx', effect: 'orbit', params: [] }).comp;
    assert.match(validate(b)[0], /fx params must be an object/);
  });
});
