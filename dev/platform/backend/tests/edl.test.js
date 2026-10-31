/**
 * Guards on the edit decision list (shared/edl.mjs).
 *
 * This is the first thing in OMI that needs frame-level correctness: a wrong
 * number here is a cut landing in the wrong place in a client's reel, visible
 * to their audience. So the assertions below check arithmetic against worked
 * values rather than checking that a function returned something.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SHARED = path.join(__dirname, '..', '..', 'shared', 'edl.mjs');
let E;
test.before(async () => { E = await import(pathToFileURL(SHARED).href); });

const CLIPS = [
  { url: 'one.mp4', duration: 10 },
  { url: 'two.mp4', duration: 5 },
  { url: 'three.mp4', duration: 20 },
];

test('an untouched edit is every clip whole, in order', () => {
  const edl = E.edlFromClips(CLIPS);
  assert.equal(edl.items.length, 3);
  assert.equal(E.duration(edl), 35);
  assert.ok(E.isWholeClipsInOrder(edl, CLIPS),
    'the processor takes its cheap stream-copy path on this, so it must be recognised');
  assert.deepEqual(edl.items.map(i => i.clip), [0, 1, 2]);
});

test('trimming one clip makes the edit no longer a plain combine', () => {
  const base = E.edlFromClips(CLIPS);
  const cut = E.trim(base, base.items[0].id, 'out', 4, CLIPS);
  assert.equal(E.duration(cut), 4 + 5 + 20);
  assert.equal(E.isWholeClipsInOrder(cut, CLIPS), false,
    'a trimmed edit must not be rendered as whole clips');

  // Trimming the front leaves `out` at the clip's full duration, so a check
  // that only looked at `out` would call this a plain combine and render the
  // footage the person just cut off.
  const front = E.trim(E.edlFromClips(CLIPS), E.edlFromClips(CLIPS).items[0].id, 'in', 2, CLIPS);
  const b2 = E.edlFromClips(CLIPS);
  assert.equal(E.isWholeClipsInOrder(E.trim(b2, b2.items[0].id, 'in', 2, CLIPS), CLIPS), false,
    'a trim off the front must not be rendered as whole clips either');
  assert.ok(front);
});

test('a reordered edit is not a plain combine, however whole its blocks are', () => {
  // Clips of EQUAL length on purpose: with three different durations the
  // length check alone would catch a reorder by accident, and the thing being
  // guarded here is that the order itself is checked. Miss it and the
  // processor concatenates the original order and silently discards the
  // reorder, which looks exactly like "it generated the same video again".
  const same = [
    { url: 'a.mp4', duration: 8 },
    { url: 'b.mp4', duration: 8 },
    { url: 'c.mp4', duration: 8 },
  ];
  let edl = E.edlFromClips(same);
  assert.ok(E.isWholeClipsInOrder(edl, same), 'untouched, these are a plain combine');
  edl = E.move(edl, edl.items[2].id, 0);
  assert.deepEqual(edl.items.map(i => i.clip), [2, 0, 1]);
  assert.equal(E.isWholeClipsInOrder(edl, same), false);
  assert.equal(E.duration(edl), 24, 'a reorder changes order, not length');
});

test('a gain change is not a plain combine', () => {
  // The stream-copy combine path cannot apply gain, so an edit that only
  // changes a block's volume must not be sent down it: the render would come
  // back at the original volume with no error anywhere.
  const edl = E.edlFromClips(CLIPS);
  const louder = { version: 1, items: edl.items.map((it, i) => i === 1 ? { ...it, gain: 1.5 } : it) };
  assert.ok(E.isWholeClipsInOrder(edl, CLIPS));
  assert.equal(E.isWholeClipsInOrder(louder, CLIPS), false);
});

test('normalise repairs or drops a block shorter than a frame or two', () => {
  const stored = { version: 1, items: [
    { id: 'a', clip: 0, in: 2, out: 2, gain: 1 },        // zero length
    { id: 'b', clip: 0, in: 5, out: 4, gain: 1 },        // inverted
    { id: 'c', clip: 0, in: 1, out: 1.01, gain: 1 },     // a 10ms sliver
    { id: 'd', clip: 0, in: 0, out: 3, gain: 1 },        // a real cut
  ] };
  const fixed = E.normalise(stored, [CLIPS[0]]);
  for (const it of fixed.items) {
    assert.ok(E.atLeastMin(it.in, it.out),
      `normalise passed through a ${(it.out - it.in).toFixed(3)}s block, which ffmpeg cannot cut`);
  }
  assert.ok(fixed.items.some(it => it.in === 0 && it.out === 3), 'the real cut survives');
  // Repaired, not deleted. A block that disappears when an edit is reopened
  // loses footage with nothing on screen to say so, which is worse than a
  // block sitting there visibly too short to use.
  assert.equal(fixed.items.length, 4,
    'every stored block must still be on the timeline after a repair');
  assert.deepEqual(fixed.items.map(it => it.id), ['a', 'b', 'c', 'd']);
});

test('an in point stored beyond the clip is pulled back, not dropped', () => {
  // An edit written against a 30s clip, reopened after the source was replaced
  // with a 5s one. Clamping the in point keeps the block; failing to clamp it
  // makes the block unrepairable and it vanishes from the reopened edit.
  const stored = { version: 1, items: [{ id: 'a', clip: 0, in: 30, out: 30, gain: 1 }] };
  const fixed = E.normalise(stored, [CLIPS[1]]);
  assert.equal(fixed.items.length, 1, 'the block must survive being reopened');
  assert.ok(fixed.items[0].in < 5 && fixed.items[0].out <= 5);
  assert.ok(E.atLeastMin(fixed.items[0].in, fixed.items[0].out));
});

test('normalise drops a block whose source is shorter than a frame or two', () => {
  const stored = { version: 1, items: [{ id: 'a', clip: 0, in: 0, out: 1, gain: 1 }] };
  assert.deepEqual(E.normalise(stored, [{ url: 'tiny.mp4', duration: 0.02 }]).items, [],
    'a 20ms source cannot yield a cut, so the edit must not claim one');
});

test('an edit can cut across more than one clip, which is the capability gap', () => {
  let edl = E.edlFromClips(CLIPS);
  edl = E.trim(edl, edl.items[0].id, 'in', 2, CLIPS);     // one.mp4 2 → 10
  edl = E.trim(edl, edl.items[2].id, 'out', 6, CLIPS);    // three.mp4 0 → 6
  assert.equal(E.duration(edl), 8 + 5 + 6);
  const segs = E.compile(edl, CLIPS);
  assert.deepEqual(segs, [
    { clip: 0, url: 'one.mp4', start: 2, end: 10, gain: 1 },
    { clip: 1, url: 'two.mp4', start: 0, end: 5, gain: 1 },
    { clip: 2, url: 'three.mp4', start: 0, end: 6, gain: 1 },
  ]);
});

test('an in point cannot pass its out point, and parks against the limit', () => {
  let edl = E.edlFromClips([CLIPS[1]]);                   // 5s clip
  edl = E.trim(edl, edl.items[0].id, 'out', 2, [CLIPS[1]]);
  edl = E.trim(edl, edl.items[0].id, 'in', 9, [CLIPS[1]]); // dragged way past
  const it = edl.items[0];
  assert.equal(edl.items.length, 1, 'the block being dragged must survive the drag');
  assert.ok(E.atLeastMin(it.in, it.out), `item collapsed: ${it.in} → ${it.out}`);
  assert.equal(it.out, 2, 'the edge not being dragged must hold still');
  assert.ok(Math.abs(it.in - (2 - E.MIN_ITEM)) < 1e-9, `in parked at ${it.in}`);
});

test('an out point cannot pass the end of its source clip', () => {
  let edl = E.edlFromClips([CLIPS[1]]);
  edl = E.trim(edl, edl.items[0].id, 'out', 999, [CLIPS[1]]);
  assert.equal(edl.items[0].out, 5,
    'dragging past the end of the footage must not invent footage');
});

test('splitting divides one block into two over the same source', () => {
  let edl = E.edlFromClips([CLIPS[0]]);                   // 0 → 10
  edl = E.split(edl, 3);
  assert.equal(edl.items.length, 2);
  assert.deepEqual(edl.items.map(i => [i.in, i.out]), [[0, 3], [3, 10]]);
  assert.equal(E.duration(edl), 10, 'a split must not change the length of the edit');
  assert.notEqual(edl.items[0].id, edl.items[1].id, 'two blocks need two ids');
});

test('a split is placed on the timeline, not inside the source clip', () => {
  // one.mp4 trimmed to 5 → 10 then split at timeline 1s is source 6s, not 1s.
  let edl = E.edlFromClips([CLIPS[0]]);
  edl = E.trim(edl, edl.items[0].id, 'in', 5, [CLIPS[0]]);
  edl = E.split(edl, 1);
  assert.deepEqual(edl.items.map(i => [i.in, i.out]), [[5, 6], [6, 10]]);
});

test('a split that would leave a sliver is refused', () => {
  let edl = E.edlFromClips([CLIPS[0]]);
  const before = JSON.stringify(edl.items.map(i => [i.in, i.out]));
  const after = E.split(edl, 0.01);
  assert.equal(after.items.length, 1, 'a mis-click must not produce a 10ms block');
  assert.equal(JSON.stringify(after.items.map(i => [i.in, i.out])), before);
  assert.equal(E.split(edl, 9.999).items.length, 1, 'nor at the far end');
});

test('splitting past the end of the edit does nothing', () => {
  const edl = E.edlFromClips([CLIPS[0]]);
  assert.equal(E.split(edl, 50).items.length, 1);
  assert.equal(E.itemAt(edl, 50), null);
});

test('moving a block reorders the render, and clamps rather than throwing', () => {
  let edl = E.edlFromClips(CLIPS);
  const last = edl.items[2].id;
  edl = E.move(edl, last, 0);
  assert.deepEqual(edl.items.map(i => i.clip), [2, 0, 1]);
  assert.deepEqual(E.compile(edl, CLIPS).map(s => s.url),
    ['three.mp4', 'one.mp4', 'two.mp4']);
  const clamped = E.move(edl, edl.items[0].id, 99);
  assert.deepEqual(clamped.items.map(i => i.clip), [0, 1, 2]);
  // A negative index must mean "the front", not Array.splice's count-from-the-end,
  // which would drop the block one short of where it was aimed.
  assert.deepEqual(E.move(edl, edl.items[2].id, -1).items.map(i => i.clip), [1, 2, 0]);
  assert.deepEqual(E.move(edl, edl.items[0].id, -4).items.map(i => i.clip), [2, 0, 1]);
  assert.equal(E.move(edl, 'nope', 0), edl, 'an unknown id is a no-op');
});

test('laidOut gives each block its position on the timeline', () => {
  let edl = E.edlFromClips(CLIPS);
  const rows = E.laidOut(edl);
  assert.deepEqual(rows.map(r => [r.start, r.end]), [[0, 10], [10, 15], [15, 35]]);
  assert.equal(E.itemAt(edl, 12).item.clip, 1, 'the playhead at 12s is inside clip two');
  assert.equal(E.itemAt(edl, 10).item.clip, 1, 'a boundary belongs to the block starting there');
  assert.equal(E.itemAt(edl, 9.99).item.clip, 0);
});

test('normalise drops items whose source clip has gone', () => {
  const edl = E.edlFromClips(CLIPS);
  const fewer = E.normalise(edl, [CLIPS[0]]);
  assert.equal(fewer.items.length, 1,
    'removing a clip must not leave the edit pointing at it');
  assert.equal(fewer.items[0].clip, 0);
});

test('normalise clamps a stored edit against the real clip length', () => {
  // An edit stored when the clip was thought to be 30s, reopened against a 5s clip.
  const stored = { version: 1, items: [{ id: 'x', clip: 0, in: 1, out: 30, gain: 1 }] };
  const fixed = E.normalise(stored, [CLIPS[1]]);
  assert.equal(fixed.items[0].out, 5, 'an out point beyond the footage is brought back');
  assert.equal(fixed.items[0].in, 1);
});

test('an unprobed clip stays unprobed rather than being read as empty', () => {
  const unknown = [{ url: 'pending.mp4' }];
  const edl = E.edlFromClips(unknown);
  assert.equal(edl.items.length, 1, 'a clip whose duration is unknown is still in the edit');
  assert.equal(edl.items[0].out, null);
  assert.equal(E.clipDuration(unknown[0]), null, 'unknown is null, never 0');
  assert.equal(E.clipDuration({ url: 'x', duration: 0 }), null);
  const segs = E.compile(edl, unknown);
  assert.deepEqual(segs, [{ clip: 0, url: 'pending.mp4', start: 0, end: null, gain: 1 }],
    'a whole clip of unknown length renders to its end');
  assert.equal(E.normalise(edl, unknown).items.length, 1,
    'normalise must not delete an unprobed clip');
});

test('compile refuses a zero-length cut from a stored edit', () => {
  // compile() is reached from the render route, which may hold an edit written
  // by an older build. An `-ss 3 -t 0` cut is an ffmpeg error, not a frame.
  const stored = { version: 1, items: [
    { id: 'a', clip: 0, in: 3, out: 3, gain: 1 },
    { id: 'b', clip: 0, in: 3, out: 3.01, gain: 1 },
    { id: 'c', clip: 0, in: 4, out: 2, gain: 1 },
    { id: 'd', clip: 0, in: 0, out: 2, gain: 1 },
  ] };
  assert.deepEqual(E.compile(stored, CLIPS),
    [{ clip: 0, url: 'one.mp4', start: 0, end: 2, gain: 1 }],
    'only the one cut long enough to be a cut survives');
});

test('compile skips a clip with no URL rather than emitting a broken cut', () => {
  const clips = [{ duration: 5 }, { url: 'ok.mp4', duration: 5 }];
  const edl = E.edlFromClips(clips);
  assert.deepEqual(E.compile(edl, clips).map(s => s.url), ['ok.mp4']);
  // And it carries its own index, because dropping the first entry means
  // position in the output no longer matches position in the edit. Reading the
  // index by position here renders clip 2's footage as clip 1.
  assert.deepEqual(E.compile(edl, clips).map(s => s.clip), [1]);
});

test('every compiled cut names its own source clip', () => {
  // The same clip used twice, in a different order from the clip list, with a
  // short cut in between that compile drops.
  const stored = { version: 1, items: [
    { id: 'a', clip: 2, in: 0, out: 4, gain: 1 },
    { id: 'b', clip: 1, in: 1, out: 1.01, gain: 1 },   // dropped: too short
    { id: 'c', clip: 0, in: 5, out: 9, gain: 1 },
    { id: 'd', clip: 2, in: 10, out: 14, gain: 1 },
  ] };
  assert.deepEqual(E.compile(stored, CLIPS).map(s => [s.clip, s.url, s.start]), [
    [2, 'three.mp4', 0],
    [0, 'one.mp4', 5],
    [2, 'three.mp4', 10],
  ]);
});

test('gain is kept per block and bounded', () => {
  const stored = { version: 1, items: [
    { id: 'a', clip: 0, in: 0, out: 5, gain: 2 },
    { id: 'b', clip: 1, in: 0, out: 5, gain: 99 },
  ] };
  const fixed = E.normalise(stored, [CLIPS[1], CLIPS[1]]);
  assert.equal(fixed.items[0].gain, 2);
  assert.equal(fixed.items[1].gain, 4, 'a gain of 99 would clip the audio to noise');
  assert.equal(E.compile(fixed, [CLIPS[1], CLIPS[1]])[0].gain, 2,
    'gain must reach the renderer');
});

test('every block carries an id, including ones restored without one', () => {
  const stored = { version: 1, items: [{ clip: 0, in: 0, out: 5 }] };
  const fixed = E.normalise(stored, [CLIPS[1]]);
  assert.ok(fixed.items[0].id, 'without an id the surface cannot address the block');
  assert.equal(fixed.items[0].gain, 1, 'gain defaults to unity, not zero');
});

test('append adds a clip whole and refuses an index that does not exist', () => {
  let edl = E.emptyEdl();
  edl = E.append(edl, 1, CLIPS);
  assert.deepEqual(E.compile(edl, CLIPS), [{ clip: 1, url: 'two.mp4', start: 0, end: 5, gain: 1 }]);
  assert.equal(E.append(edl, 9, CLIPS).items.length, 1);
  assert.equal(E.append(edl, -1, CLIPS).items.length, 1);
});

test('an empty edit compiles to nothing, and nothing is not a crash', () => {
  assert.deepEqual(E.compile(E.emptyEdl(), CLIPS), []);
  assert.equal(E.duration(E.emptyEdl()), 0);
  assert.deepEqual(E.laidOut(E.emptyEdl()), []);
  assert.equal(E.isWholeClipsInOrder(E.emptyEdl(), CLIPS), false);
  assert.deepEqual(E.compile(null, CLIPS), []);
  assert.deepEqual(E.normalise(null, CLIPS).items, []);
});

test('the editing operations never mutate the edit they were given', () => {
  const edl = E.edlFromClips(CLIPS);
  const snapshot = JSON.stringify(edl);
  const id = edl.items[0].id;
  E.trim(edl, id, 'out', 3, CLIPS);
  E.move(edl, id, 2);
  E.remove(edl, id);
  E.split(edl, 5);
  E.append(edl, 0, CLIPS);
  assert.equal(JSON.stringify(edl), snapshot,
    'undo and React both depend on these being copies');
});

test('removing a block shortens the edit by exactly that block', () => {
  let edl = E.edlFromClips(CLIPS);
  const before = E.duration(edl);
  edl = E.remove(edl, edl.items[1].id);
  assert.equal(E.duration(edl), before - 5);
  assert.deepEqual(edl.items.map(i => i.clip), [0, 2]);
});


test('the minimum-length test survives float arithmetic', () => {
  // `(5 + 0.05) - 5` is 0.049999999999999822 in IEEE doubles. An exact
  // comparison against MIN_ITEM therefore rejects a block that is exactly the
  // minimum length, and rejects it at 5s while accepting it at 1s, so the same
  // edit behaves differently depending on where in the clip it sits.
  for (const at of [0, 1, 2, 3, 5, 7.3, 11, 59.95, 123.4]) {
    assert.ok(E.atLeastMin(at, at + E.MIN_ITEM),
      `a block of exactly MIN_ITEM at ${at}s was rejected`);
  }
  assert.equal(E.atLeastMin(5, 5.04), false, 'genuinely short blocks are still rejected');
  assert.equal(E.atLeastMin(5, 5), false);
  assert.equal(E.atLeastMin(5, 4), false, 'an inverted block is not long enough');
});

test('stored times are pinned to the microsecond', () => {
  // Repeated splits accumulate binary dust, and two blocks that should abut
  // are then drawn with a hairline between them on the surface.
  let edl = E.edlFromClips([{ url: 'a.mp4', duration: 10 }]);
  edl = E.split(edl, 1 / 3);
  edl = E.split(edl, 2 / 3);
  for (const it of edl.items) {
    for (const v of [it.in, it.out]) {
      assert.equal(v, Math.round(v * 1e6) / 1e6, `${v} carries more precision than a time needs`);
    }
  }
  const rows = E.laidOut(edl);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(Math.abs(rows[i].start - rows[i - 1].end) < 1e-9,
      'blocks must abut exactly, with no gap to draw');
  }
});
