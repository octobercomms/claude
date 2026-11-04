/**
 * Composition mapping tests: source-to-timeline and back.
 *
 * These test the three decided rules from editor-composition-model.md §The
 * mapping, which is where this project dies if it is going to:
 *
 *   1. A word in a cut-out region maps to nothing.
 *   2. A word inside an overlap belongs to whichever item is uppermost.
 *   3. A word straddling a cut belongs to the item its midpoint falls in.
 *
 *   node --test tests/composition-mapping.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  emptyComposition,
  addSource,
  addTrack,
  addItem,
  secs,
  EPS,
} = require('../../shared/composition.mjs');

const {
  sourceToTimeline,
  sourceToTimelineOne,
  timelineToSource,
  mapWordSpan,
  mapTranscript,
} = require('../../shared/compositionMapping.mjs');

// ── fixture builders ──────────────────────────────────────────────────

// A simple composition: one 20s clip, two items on one track (0-8s and 10-18s).
// Source seconds 0-8 appear at timeline 0-8.
// Source seconds 8-10 are CUT OUT (gap in timeline).
// Source seconds 10-18 appear at timeline 10-18.
function simpleComp() {
  let comp = emptyComposition();
  const s = addSource(comp, { kind: 'clip', asset: 'x', duration: 20, width: 1920, height: 1080, fps: 30 });
  comp = s.comp;
  const t = addTrack(comp, 'video');
  comp = t.comp;
  let r = addItem(comp, t.id, { at: 0, len: 8, source: s.id, in: 0 });
  comp = r.comp;
  const i1 = r.id;
  r = addItem(comp, t.id, { at: 10, len: 8, source: s.id, in: 10 });
  comp = r.comp;
  const i2 = r.id;
  return { comp, sourceId: s.id, trackId: t.id, i1, i2 };
}

// Two items from the same source overlapping on one track.
// Item 1: at=0, len=6, in=0  (source 0-6 at timeline 0-6)
// Item 2: at=5, len=6, in=5  (source 5-11 at timeline 5-11)
// Overlap: timeline 5-6, where source 5-6 is in both items.
function overlapComp() {
  let comp = emptyComposition();
  const s = addSource(comp, { kind: 'clip', asset: 'x', duration: 20, width: 1920, height: 1080, fps: 30 });
  comp = s.comp;
  const t = addTrack(comp, 'video');
  comp = t.comp;
  let r = addItem(comp, t.id, { at: 0, len: 6, source: s.id, in: 0 });
  comp = r.comp;
  const i1 = r.id;
  r = addItem(comp, t.id, { at: 5, len: 6, source: s.id, in: 5, trans: { type: 'fade' } });
  comp = r.comp;
  const i2 = r.id;
  return { comp, sourceId: s.id, trackId: t.id, i1, i2 };
}

// Two tracks: base covers 0-10, overlay covers 3-7.
// At t=5, the overlay (track 1) is topmost.
function twoTrackComp() {
  let comp = emptyComposition();
  const s = addSource(comp, { kind: 'clip', asset: 'base.mp4', duration: 20, width: 1920, height: 1080, fps: 30 });
  comp = s.comp;
  const s2 = addSource(comp, { kind: 'clip', asset: 'overlay.mp4', duration: 20, width: 1920, height: 1080, fps: 30 });
  comp = s2.comp;
  const t1 = addTrack(comp, 'video');
  comp = t1.comp;
  const t2 = addTrack(comp, 'video');
  comp = t2.comp;
  let r = addItem(comp, t1.id, { at: 0, len: 10, source: s.id, in: 0 });
  comp = r.comp;
  r = addItem(comp, t2.id, { at: 3, len: 4, source: s2.id, in: 0 });
  comp = r.comp;
  return { comp, baseSourceId: s.id, overlaySourceId: s2.id, t1: t1.id, t2: t2.id };
}

// ── sourceToTimeline ──────────────────────────────────────────────────

describe('sourceToTimeline', () => {
  it('maps a source-time to its timeline position', () => {
    const { comp, sourceId } = simpleComp();
    const results = sourceToTimeline(comp, sourceId, 3);
    assert.equal(results.length, 1);
    assert.equal(results[0].timelineTime, 3);
  });

  it('maps a source-time in the second item', () => {
    const { comp, sourceId } = simpleComp();
    const results = sourceToTimeline(comp, sourceId, 12);
    assert.equal(results.length, 1);
    assert.equal(results[0].timelineTime, 12);
  });

  it('returns empty for a cut-out region', () => {
    const { comp, sourceId } = simpleComp();
    const results = sourceToTimeline(comp, sourceId, 9);
    assert.equal(results.length, 0);
  });

  it('returns empty for source-time past all items', () => {
    const { comp, sourceId } = simpleComp();
    const results = sourceToTimeline(comp, sourceId, 19);
    assert.equal(results.length, 0);
  });

  it('returns two results in an overlap region', () => {
    const { comp, sourceId } = overlapComp();
    const results = sourceToTimeline(comp, sourceId, 5.5);
    assert.equal(results.length, 2);
  });

  it('returns empty for unknown source', () => {
    const { comp } = simpleComp();
    const results = sourceToTimeline(comp, 'nosuch', 3);
    assert.equal(results.length, 0);
  });
});

// ── sourceToTimelineOne ───────────────────────────────────────────────

describe('sourceToTimelineOne', () => {
  it('maps a simple case', () => {
    const { comp, sourceId } = simpleComp();
    assert.equal(sourceToTimelineOne(comp, sourceId, 3), 3);
  });

  it('returns null for cut-out region', () => {
    const { comp, sourceId } = simpleComp();
    assert.equal(sourceToTimelineOne(comp, sourceId, 9), null);
  });

  it('picks a result in an overlap (single track)', () => {
    const { comp, sourceId } = overlapComp();
    const result = sourceToTimelineOne(comp, sourceId, 5.5);
    assert.ok(result !== null);
    assert.ok(typeof result === 'number');
  });
});

// ── timelineToSource ──────────────────────────────────────────────────

describe('timelineToSource', () => {
  it('maps timeline time to source time', () => {
    const { comp, sourceId } = simpleComp();
    const result = timelineToSource(comp, 3);
    assert.ok(result);
    assert.equal(result.sourceId, sourceId);
    assert.equal(result.sourceTime, 3);
  });

  it('maps through the second item', () => {
    const { comp, sourceId } = simpleComp();
    const result = timelineToSource(comp, 12);
    assert.ok(result);
    assert.equal(result.sourceId, sourceId);
    assert.equal(result.sourceTime, 12);
  });

  it('returns null at a gap', () => {
    const { comp } = simpleComp();
    assert.equal(timelineToSource(comp, 9), null);
  });

  it('picks the overlay track in a two-track composition', () => {
    const { comp, overlaySourceId } = twoTrackComp();
    const result = timelineToSource(comp, 5);
    assert.ok(result);
    assert.equal(result.sourceId, overlaySourceId);
    assert.equal(result.sourceTime, 2);
  });

  it('picks the base track outside the overlay range', () => {
    const { comp, baseSourceId } = twoTrackComp();
    const result = timelineToSource(comp, 1);
    assert.ok(result);
    assert.equal(result.sourceId, baseSourceId);
    assert.equal(result.sourceTime, 1);
  });
});

// ── mapWordSpan: the three rules ──────────────────────────────────────

describe('mapWordSpan', () => {
  describe('Rule 1: cut-out region', () => {
    it('returns null when the word is entirely in a cut region', () => {
      const { comp, sourceId } = simpleComp();
      assert.equal(mapWordSpan(comp, sourceId, 8.5, 9.5), null);
    });

    it('returns null when the midpoint is in a cut region', () => {
      const { comp, sourceId } = simpleComp();
      assert.equal(mapWordSpan(comp, sourceId, 7.8, 9.2), null);
    });
  });

  describe('Rule 2: overlap belongs to topmost', () => {
    it('maps through the topmost item in a two-track overlap', () => {
      const { comp, overlaySourceId } = twoTrackComp();
      const span = mapWordSpan(comp, overlaySourceId, 1, 1.5);
      assert.ok(span);
      assert.equal(span.from, 4);
      assert.equal(span.to, 4.5);
    });
  });

  describe('Rule 3: straddling a cut belongs to the midpoint item', () => {
    it('a word straddling the cut at t=8 with midpoint before the cut', () => {
      const { comp, sourceId } = simpleComp();
      // Word from 7.5 to 8.3, midpoint = 7.9, which is in item 1 (0-8)
      const span = mapWordSpan(comp, sourceId, 7.5, 8.3);
      assert.ok(span);
      assert.ok(span.from >= 7.5 - EPS);
      assert.ok(span.to <= 8 + EPS);
    });

    it('a word straddling the gap boundary with midpoint after the gap', () => {
      const { comp, sourceId } = simpleComp();
      // Word from 9.8 to 10.5, midpoint = 10.15, which is in item 2 (10-18)
      const span = mapWordSpan(comp, sourceId, 9.8, 10.5);
      assert.ok(span);
      assert.ok(span.from >= 10 - EPS);
    });
  });

  it('maps a normal word within one item', () => {
    const { comp, sourceId } = simpleComp();
    const span = mapWordSpan(comp, sourceId, 2, 2.5);
    assert.ok(span);
    assert.equal(span.from, 2);
    assert.equal(span.to, 2.5);
  });

  it('clamps to item boundaries', () => {
    const { comp, sourceId } = simpleComp();
    // Word starts before the item's source range: in=0, so source-time -1 is out
    // but the item at=0 provides the clamp
    const span = mapWordSpan(comp, sourceId, 0, 0.5);
    assert.ok(span);
    assert.ok(span.from >= 0);
  });
});

// ── mapTranscript ─────────────────────────────────────────────────────

describe('mapTranscript', () => {
  it('maps words that are in the edit', () => {
    const { comp, sourceId } = simpleComp();
    const words = [
      { word: 'hello', from: 1, to: 1.5 },
      { word: 'world', from: 3, to: 3.5 },
    ];
    const mapped = mapTranscript(comp, sourceId, words);
    assert.equal(mapped.length, 2);
    assert.equal(mapped[0].from, 1);
    assert.equal(mapped[1].word, 'world');
  });

  it('omits words that are in a cut-out region', () => {
    const { comp, sourceId } = simpleComp();
    const words = [
      { word: 'before', from: 7, to: 7.5 },
      { word: 'cut', from: 8.5, to: 9.5 },
      { word: 'after', from: 11, to: 11.5 },
    ];
    const mapped = mapTranscript(comp, sourceId, words);
    assert.equal(mapped.length, 2);
    assert.equal(mapped[0].word, 'before');
    assert.equal(mapped[1].word, 'after');
  });

  it('preserves extra word properties', () => {
    const { comp, sourceId } = simpleComp();
    const words = [{ word: 'hi', from: 1, to: 1.5, confidence: 0.99, speaker: 'A' }];
    const mapped = mapTranscript(comp, sourceId, words);
    assert.equal(mapped[0].confidence, 0.99);
    assert.equal(mapped[0].speaker, 'A');
  });

  it('returns empty for an empty transcript', () => {
    const { comp, sourceId } = simpleComp();
    assert.deepEqual(mapTranscript(comp, sourceId, []), []);
  });

  it('handles a transcript against a non-existent source', () => {
    const { comp } = simpleComp();
    const words = [{ word: 'hi', from: 1, to: 1.5 }];
    assert.deepEqual(mapTranscript(comp, 'nosuch', words), []);
  });
});

// ── round-trip: timeline → source → timeline ──────────────────────────

describe('round-trip', () => {
  it('timeline → source → timeline is identity for simple case', () => {
    const { comp, sourceId } = simpleComp();
    const t = 4.5;
    const src = timelineToSource(comp, t);
    assert.ok(src);
    const back = sourceToTimelineOne(comp, src.sourceId, src.sourceTime);
    assert.ok(Math.abs(back - t) < 1e-6);
  });

  it('round-trips through the second item', () => {
    const { comp } = simpleComp();
    const t = 14;
    const src = timelineToSource(comp, t);
    assert.ok(src);
    const back = sourceToTimelineOne(comp, src.sourceId, src.sourceTime);
    assert.ok(Math.abs(back - t) < 1e-6);
  });

  it('round-trips through a two-track composition', () => {
    const { comp } = twoTrackComp();
    const t = 5;
    const src = timelineToSource(comp, t);
    assert.ok(src);
    const back = sourceToTimelineOne(comp, src.sourceId, src.sourceTime);
    assert.ok(Math.abs(back - t) < 1e-6);
  });
});

// ── with in-point offset ──────────────────────────────────────────────

describe('in-point offset', () => {
  it('maps correctly when item has a non-zero in-point', () => {
    let comp = emptyComposition();
    const s = addSource(comp, { kind: 'clip', asset: 'x', duration: 30, width: 1920, height: 1080, fps: 30 });
    comp = s.comp;
    const t = addTrack(comp, 'video');
    comp = t.comp;
    // Item starts at timeline 0, plays source from 10s to 15s
    const r = addItem(comp, t.id, { at: 0, len: 5, source: s.id, in: 10 });
    comp = r.comp;

    // Source-time 12 should map to timeline-time 2
    const tl = sourceToTimelineOne(comp, s.id, 12);
    assert.equal(tl, 2);

    // Timeline-time 2 should map back to source-time 12
    const src = timelineToSource(comp, 2);
    assert.equal(src.sourceTime, 12);

    // Source-time 8 (before the in-point) should map to nothing
    assert.equal(sourceToTimelineOne(comp, s.id, 8), null);
  });
});
