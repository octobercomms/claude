const { describe, it } = require('node:test');
const assert = require('assert');

async function load() {
  const C = await import('../../shared/composition.mjs');
  return C;
}

function makeComp(C) {
  let comp = C.emptyComposition({ width: 1080, height: 1920, fps: 30 });

  const { comp: c1, id: s1 } = C.addSource(comp, {
    kind: 'clip', asset: 'a', url: '/a.mp4', duration: 20,
    width: 1080, height: 1920, fps: 30,
  });
  comp = c1;

  const { comp: c2, id: s2 } = C.addSource(comp, {
    kind: 'clip', asset: 'b', url: '/b.mp4', duration: 15,
    width: 1080, height: 1920, fps: 30,
  });
  comp = c2;

  const { comp: c3, id: t1 } = C.addTrack(comp, 'video');
  comp = c3;

  const { comp: c4, id: i1 } = C.addItem(comp, t1, {
    source: s1, at: 0, len: 10, in: 2,
  });
  comp = c4;

  const { comp: c5, id: i2 } = C.addItem(comp, t1, {
    source: s2, at: 10, len: 8, in: 0,
  });
  comp = c5;

  return { comp, s1, s2, t1, i1, i2 };
}

describe('composition editing helpers', async () => {
  const C = await load();

  describe('trimStart', () => {
    it('trims the start forward by a positive delta', () => {
      const { comp, t1, i1 } = makeComp(C);
      const result = C.trimStart(comp, t1, i1, 2);
      const item = result.tracks[0].items.find(i => i.id === i1);
      assert.strictEqual(item.at, 2);
      assert.strictEqual(item.in, 4);
      assert.strictEqual(item.len, 8);
    });

    it('trims the start backward by a negative delta', () => {
      const { comp, t1, i1 } = makeComp(C);
      const result = C.trimStart(comp, t1, i1, -1);
      const item = result.tracks[0].items.find(i => i.id === i1);
      // at was 0, clamped to max(-0, min(10 - 0.001, -1)) = -1 clamped to -0 = 0
      // Wait, at=0, delta=-1, max(-at, ...) = max(0, ...) so delta is clamped to 0
      assert.strictEqual(item.at, 0);
      assert.strictEqual(item.len, 10);
    });

    it('clamps so len stays above MIN_ITEM', () => {
      const { comp, t1, i1 } = makeComp(C);
      const result = C.trimStart(comp, t1, i1, 100);
      const item = result.tracks[0].items.find(i => i.id === i1);
      // delta clamped to len - MIN_ITEM = 10 - 0.001 = 9.999
      assert.ok(item.len >= 0.001);
      assert.ok(item.at <= 10);
    });

    it('does nothing for unknown track', () => {
      const { comp, i1 } = makeComp(C);
      const result = C.trimStart(comp, 'nonexistent', i1, 2);
      assert.deepStrictEqual(result, comp);
    });

    it('does nothing for unknown item', () => {
      const { comp, t1 } = makeComp(C);
      const result = C.trimStart(comp, t1, 'nonexistent', 2);
      assert.deepStrictEqual(result, comp);
    });
  });

  describe('trimEnd', () => {
    it('extends the end by a positive delta', () => {
      const { comp, t1, i1 } = makeComp(C);
      const result = C.trimEnd(comp, t1, i1, 3);
      const item = result.tracks[0].items.find(i => i.id === i1);
      assert.strictEqual(item.len, 13);
      assert.strictEqual(item.at, 0);
    });

    it('shortens the end by a negative delta', () => {
      const { comp, t1, i1 } = makeComp(C);
      const result = C.trimEnd(comp, t1, i1, -4);
      const item = result.tracks[0].items.find(i => i.id === i1);
      assert.strictEqual(item.len, 6);
    });

    it('clamps len to MIN_ITEM', () => {
      const { comp, t1, i1 } = makeComp(C);
      const result = C.trimEnd(comp, t1, i1, -100);
      const item = result.tracks[0].items.find(i => i.id === i1);
      assert.strictEqual(item.len, 0.001);
    });

    it('clamps to source duration when provided', () => {
      const { comp, t1, i1 } = makeComp(C);
      const result = C.trimEnd(comp, t1, i1, 100, 20);
      const item = result.tracks[0].items.find(i => i.id === i1);
      // in=2, source duration=20, max len = 20-2 = 18
      assert.strictEqual(item.len, 18);
    });

    it('does nothing for unknown track', () => {
      const { comp, i1 } = makeComp(C);
      const result = C.trimEnd(comp, 'nonexistent', i1, 2);
      assert.deepStrictEqual(result, comp);
    });
  });

  describe('moveItemTo', () => {
    it('moves an item to a new position', () => {
      const { comp, t1, i1 } = makeComp(C);
      const result = C.moveItemTo(comp, t1, i1, 5);
      const item = result.tracks[0].items.find(i => i.id === i1);
      assert.strictEqual(item.at, 5);
      assert.strictEqual(item.len, 10);
      assert.strictEqual(item.in, 2);
    });

    it('clamps to zero', () => {
      const { comp, t1, i1 } = makeComp(C);
      const result = C.moveItemTo(comp, t1, i1, -5);
      const item = result.tracks[0].items.find(i => i.id === i1);
      assert.strictEqual(item.at, 0);
    });

    it('re-sorts items by at', () => {
      const { comp, t1, i2 } = makeComp(C);
      const result = C.moveItemTo(comp, t1, i2, 0);
      const items = result.tracks[0].items;
      assert.ok(items[0].at <= items[1].at);
    });
  });

  describe('moveItemToTrack', () => {
    it('moves an item from one video track to another', () => {
      const { comp, t1, i1, s1 } = makeComp(C);
      const { comp: c2, id: t2 } = C.addTrack(comp, 'video');
      const result = C.moveItemToTrack(c2, t1, i1, t2);
      const fromTrack = result.tracks.find(t => t.id === t1);
      const toTrack = result.tracks.find(t => t.id === t2);
      assert.ok(!fromTrack.items.find(i => i.id === i1));
      assert.ok(toTrack.items.find(i => i.id === i1));
    });

    it('returns comp unchanged if from and to are the same track', () => {
      const { comp, t1, i1 } = makeComp(C);
      const result = C.moveItemToTrack(comp, t1, i1, t1);
      assert.strictEqual(result, comp);
    });

    it('returns comp unchanged for unknown from track', () => {
      const { comp, i1 } = makeComp(C);
      const { comp: c2, id: t2 } = C.addTrack(comp, 'video');
      const result = C.moveItemToTrack(c2, 'nonexistent', i1, t2);
      assert.strictEqual(result, c2);
    });

    it('returns comp unchanged for unknown to track', () => {
      const { comp, t1, i1 } = makeComp(C);
      const result = C.moveItemToTrack(comp, t1, i1, 'nonexistent');
      assert.strictEqual(result, comp);
    });

    it('blocks moving a clip source onto an audio track', () => {
      const { comp, t1, i1 } = makeComp(C);
      const { comp: c2, id: at } = C.addTrack(comp, 'audio');
      const result = C.moveItemToTrack(c2, t1, i1, at);
      assert.strictEqual(result, c2);
    });

    it('sorts items by at after moving', () => {
      const { comp, t1, i1, s1 } = makeComp(C);
      const { comp: c2, id: t2 } = C.addTrack(comp, 'video');
      const { comp: c3, id: i3 } = C.addItem(c2, t2, {
        source: s1, at: 5, len: 3, in: 0,
      });
      const moved = C.moveItemToTrack(c3, t1, i1, t2);
      const toItems = moved.tracks.find(t => t.id === t2).items;
      for (let j = 1; j < toItems.length; j++) {
        assert.ok(toItems[j].at >= toItems[j - 1].at);
      }
    });
  });

  describe('splitItem', () => {
    it('splits an item at a timeline time', () => {
      const { comp, t1, i1 } = makeComp(C);
      const { comp: result, id: secondId } = C.splitItem(comp, t1, i1, 4);
      const items = result.tracks[0].items;
      // Original had at=0, len=10, in=2
      // First: at=0, len=4, in=2
      // Second: at=4, len=6, in=6
      const first = items.find(i => i.id === i1);
      assert.strictEqual(first.at, 0);
      assert.strictEqual(first.len, 4);
      assert.strictEqual(first.in, 2);

      const second = items.find(i => i.id === secondId);
      assert.ok(second);
      assert.strictEqual(second.at, 4);
      assert.strictEqual(second.len, 6);
      assert.strictEqual(second.in, 6);
    });

    it('preserves fit and gain on both halves', () => {
      const { comp, t1, i1 } = makeComp(C);
      const withProps = C.updateItem(comp, t1, i1, { fit: 'contain', gain: 0.5 });
      const { comp: result, id: secondId } = C.splitItem(withProps, t1, i1, 5);
      const items = result.tracks[0].items;
      const first = items.find(i => i.id === i1);
      assert.strictEqual(first.fit, 'contain');
      assert.strictEqual(first.gain, 0.5);
      const second = items.find(i => i.id === secondId);
      assert.strictEqual(second.fit, 'contain');
      assert.strictEqual(second.gain, 0.5);
    });

    it('does nothing if split point is at the start', () => {
      const { comp, t1, i1 } = makeComp(C);
      const { comp: result } = C.splitItem(comp, t1, i1, 0);
      assert.strictEqual(result.tracks[0].items.length, comp.tracks[0].items.length);
    });

    it('does nothing if split point is at the end', () => {
      const { comp, t1, i1 } = makeComp(C);
      const { comp: result } = C.splitItem(comp, t1, i1, 10);
      assert.strictEqual(result.tracks[0].items.length, comp.tracks[0].items.length);
    });

    it('does nothing if split point is outside the item', () => {
      const { comp, t1, i1 } = makeComp(C);
      const { comp: result } = C.splitItem(comp, t1, i1, 15);
      assert.strictEqual(result.tracks[0].items.length, comp.tracks[0].items.length);
    });

    it('does nothing for unknown track', () => {
      const { comp, i1 } = makeComp(C);
      const { comp: result } = C.splitItem(comp, 'nonexistent', i1, 5);
      assert.deepStrictEqual(result, comp);
    });

    it('items are sorted by at after split', () => {
      const { comp, t1, i1 } = makeComp(C);
      const { comp: result } = C.splitItem(comp, t1, i1, 5);
      const items = result.tracks[0].items;
      for (let j = 1; j < items.length; j++) {
        assert.ok(items[j].at >= items[j - 1].at);
      }
    });

    it('total duration matches original', () => {
      const { comp, t1, i1 } = makeComp(C);
      const before = C.duration(comp);
      const { comp: result } = C.splitItem(comp, t1, i1, 5);
      const after = C.duration(result);
      assert.ok(Math.abs(after - before) < 0.001);
    });
  });
});
