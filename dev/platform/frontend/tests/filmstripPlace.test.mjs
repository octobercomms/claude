/**
 * Guards on where a filmstrip's stills land on a block.
 *
 * A bug here misplaces every frame on the timeline and throws nothing: the
 * strip still looks like a strip, it just no longer tells you where a cut
 * would fall, which is the only reason it is there.
 */
import test from 'node:test';
import assert from 'node:assert';
import { thumbsForBlock } from '../src/utils/filmstripPlace.js';

// A 10-second clip sampled twelve times, each still at the middle of its slice.
const strip = {
  thumbs: Array.from({ length: 12 }, (_, k) => ({
    t: 10 * ((k + 0.5) / 12), src: `s${k}`,
  })),
};
const at = (rows) => rows.map((r) => Number(r.at.toFixed(4)));

test('a whole clip shows every still, spread across the block', () => {
  const rows = thumbsForBlock(strip, 0, 10);
  assert.equal(rows.length, 12);
  assert.ok(rows[0].at >= 0 && rows[0].at < 0.05, `first still near the left: ${rows[0].at}`);
  assert.ok(rows[11].at > 0.95 && rows[11].at < 1, `last still near the right: ${rows[11].at}`);
  // Evenly spaced, because the samples were.
  const gaps = rows.slice(1).map((r, i) => r.at - rows[i].at);
  for (const g of gaps) assert.ok(Math.abs(g - 1 / 12) < 1e-9, `uneven gap ${g}`);
});

test('a trim keeps only the stills inside it, and rescales them', () => {
  // 5 → 10 of a 10s clip: the back half, six stills, spread across the block.
  const rows = thumbsForBlock(strip, 5, 10);
  assert.equal(rows.length, 6, 'the back half of twelve samples is six');
  assert.ok(rows.every((r) => r.t >= 5), 'no still from the trimmed-off part');
  assert.ok(rows[0].at < 0.1, 'the first surviving still sits near the block start');
  assert.ok(rows[5].at > 0.9, 'and the last near its end');
  // The same still is at a different place on a narrower block, which is the
  // whole point: one strip serves any trim.
  const whole = thumbsForBlock(strip, 0, 10);
  const shared = whole.find((w) => w.src === rows[0].src);
  assert.ok(Math.abs(shared.at - rows[0].at) > 0.3,
    'a still must move when the block it is on is trimmed');
});

test('a still is placed by its own source time, not by its index', () => {
  // 2 → 4 of a 10s clip. The stills inside are at 2.0833 and 2.9166 and
  // 3.75, so they land at (t-2)/2.
  const rows = thumbsForBlock(strip, 2, 4);
  for (const r of rows) {
    assert.ok(Math.abs(r.at - (r.t - 2) / 2) < 1e-12,
      `still at ${r.t}s placed at ${r.at}, not ${(r.t - 2) / 2}`);
  }
  assert.ok(rows.length >= 2, `expected a few stills in a 2s window, got ${rows.length}`);
});

test('a split draws each frame once, never on both sides of the cut', () => {
  // Cut at 5: the two halves together must hold every still, and no still
  // twice. A closed interval on both ends duplicates the one at the boundary.
  const left = thumbsForBlock(strip, 0, 5);
  const right = thumbsForBlock(strip, 5, 10);
  assert.equal(left.length + right.length, 12);
  const seen = new Set([...left, ...right].map((r) => r.src));
  assert.equal(seen.size, 12, 'a frame appeared on both sides of the cut');
});

test('a boundary still belongs to the block starting there', () => {
  const onBoundary = { thumbs: [{ t: 5, src: 'edge' }] };
  assert.equal(thumbsForBlock(onBoundary, 0, 5).length, 0, 'not the block ending at 5');
  assert.equal(thumbsForBlock(onBoundary, 5, 10).length, 1, 'but the one starting at 5');
  assert.equal(thumbsForBlock(onBoundary, 5, 10)[0].at, 0);
});

test('a block with no usable length places nothing', () => {
  // An unprobed clip has `out == null`. Guessing a width here would draw
  // every frame at the wrong time, which is worse than drawing none.
  assert.deepEqual(thumbsForBlock(strip, 0, null), []);
  assert.deepEqual(thumbsForBlock(strip, 0, undefined), []);
  assert.deepEqual(thumbsForBlock(strip, 0, NaN), []);
  assert.deepEqual(thumbsForBlock(strip, 3, 3), [], 'nor a zero-length block');
  assert.deepEqual(thumbsForBlock(strip, 5, 2), [], 'nor an inverted one');
});

test('an absent in point means the start of the clip', () => {
  // Deliberately NOT the `Number(null)` trap: a block always has a start, and
  // the EDL's own reader defaults it to 0. If this disagreed with the EDL the
  // frames would sit at different times from the cut they describe.
  assert.deepEqual(
    thumbsForBlock(strip, null, 5).map((r) => r.src),
    thumbsForBlock(strip, 0, 5).map((r) => r.src));
  assert.equal(thumbsForBlock(strip, undefined, 5).length, 6);
});

test('a missing or empty strip places nothing, and does not throw', () => {
  assert.deepEqual(thumbsForBlock(null, 0, 10), []);
  assert.deepEqual(thumbsForBlock(undefined, 0, 10), []);
  assert.deepEqual(thumbsForBlock({}, 0, 10), []);
  assert.deepEqual(thumbsForBlock({ thumbs: [] }, 0, 10), []);
  assert.deepEqual(thumbsForBlock({ thumbs: 'soon' }, 0, 10), []);
});

test('a still with no timestamp is skipped rather than placed at zero', () => {
  // `Number(null)` is 0, so a still that lost its timestamp would otherwise
  // pile up at the left edge of every block and look like a frozen clip.
  const broken = { thumbs: [
    { t: null, src: 'a' }, { t: 'soon', src: 'b' }, { t: undefined, src: 'c' },
    { t: 3, src: 'ok' },
  ] };
  const rows = thumbsForBlock(broken, 0, 10);
  assert.deepEqual(rows.map((r) => r.src), ['ok']);
});

test('every placed still is inside the block it was placed on', () => {
  for (const [a, b] of [[0, 10], [1, 9], [4.2, 4.9], [0, 0.5], [9.5, 10]]) {
    for (const r of thumbsForBlock(strip, a, b)) {
      assert.ok(r.at >= 0 && r.at < 1,
        `still at ${r.t}s placed at ${r.at} on block ${a}→${b}, outside it`);
    }
  }
});

test('placement does not mutate the strip it was given', () => {
  const before = JSON.stringify(strip);
  thumbsForBlock(strip, 2, 8);
  assert.equal(JSON.stringify(strip), before,
    'the same strip is placed again for every other block over this clip');
  assert.ok(!('at' in strip.thumbs[0]), 'and must not acquire a position of its own');
});

test('the stills keep their source order', () => {
  const rows = thumbsForBlock(strip, 1, 9);
  assert.deepEqual(at(rows), at([...rows].sort((x, y) => x.at - y.at)));
});
