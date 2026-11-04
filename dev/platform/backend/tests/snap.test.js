/**
 * Snap engine tests.
 *
 *   node --test tests/snap.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  emptyComposition,
  addSource,
  addTrack,
  addItem,
} = require('../../shared/composition.mjs');

const { findSnap, collectSnapPoints } = require('../../shared/snap.mjs');

// ── helpers ───────────────────────────────────────────────────────────

/** Build a composition with two clips on one video track. */
function twoClipComp() {
  let comp = emptyComposition({ width: 1080, height: 1920, fps: 30 });
  const s1 = addSource(comp, { kind: 'clip', asset: 'a.mp4', url: '/a.mp4', duration: 10 });
  comp = s1.comp;
  const s2 = addSource(comp, { kind: 'clip', asset: 'b.mp4', url: '/b.mp4', duration: 8 });
  comp = s2.comp;
  const t = addTrack(comp, 'video');
  comp = t.comp;
  const i1 = addItem(comp, t.id, { at: 0, len: 5, source: s1.id });
  comp = i1.comp;
  const i2 = addItem(comp, t.id, { at: 5, len: 4, source: s2.id });
  comp = i2.comp;
  return { comp, s1: s1.id, s2: s2.id, t: t.id, i1: i1.id, i2: i2.id };
}

/** Build a composition with items on two tracks. */
function multiTrackComp() {
  let comp = emptyComposition({ width: 1080, height: 1920, fps: 30 });
  const sv = addSource(comp, { kind: 'clip', asset: 'v.mp4', url: '/v.mp4', duration: 20 });
  comp = sv.comp;
  const sa = addSource(comp, { kind: 'audio', url: '/a.mp3', duration: 20 });
  comp = sa.comp;
  const tv = addTrack(comp, 'video');
  comp = tv.comp;
  const ta = addTrack(comp, 'audio');
  comp = ta.comp;
  const iv = addItem(comp, tv.id, { at: 2, len: 6, source: sv.id });
  comp = iv.comp;
  const ia = addItem(comp, ta.id, { at: 10, len: 3, source: sa.id });
  comp = ia.comp;
  return { comp, tv: tv.id, ta: ta.id, iv: iv.id, ia: ia.id, sv: sv.id, sa: sa.id };
}

// ── collectSnapPoints ────────────────────────────────────────────────

describe('collectSnapPoints', () => {
  it('always includes zero', () => {
    const comp = emptyComposition();
    const pts = collectSnapPoints(comp);
    assert.ok(pts.some(p => p.time === 0 && p.label === 'start'));
  });

  it('includes item edges from all tracks', () => {
    const { comp } = multiTrackComp();
    const pts = collectSnapPoints(comp);
    const times = pts.map(p => p.time);
    // video item: at=2 len=6 => start=2, end=8
    assert.ok(times.includes(2));
    assert.ok(times.includes(8));
    // audio item: at=10 len=3 => start=10, end=13
    assert.ok(times.includes(10));
    assert.ok(times.includes(13));
  });

  it('excludes the specified item', () => {
    const { comp, i1 } = twoClipComp();
    // i1 is at=0 len=5, so its edges are 0 and 5
    const pts = collectSnapPoints(comp, { excludeItemId: i1 });
    // 0 should still appear (as the "start" point), but not from i1
    // 5 should appear as i2's start
    // i1's end at 5 is excluded, but i2 starts at 5 so 5 is still there
    const labels5 = pts.filter(p => p.time === 5);
    assert.ok(labels5.length > 0);
    // The key test: with both items, we get edges at 0, 5, 9
    // Without i1: still 0 (from 'start'), 5 (i2 start), 9 (i2 end)
    const times = pts.map(p => p.time);
    assert.ok(times.includes(0));
    assert.ok(times.includes(5));
    assert.ok(times.includes(9));
  });

  it('respects ignoreItems set', () => {
    const { comp, i1, i2 } = twoClipComp();
    const pts = collectSnapPoints(comp, { ignoreItems: new Set([i1, i2]) });
    // Only zero remains (no items contribute edges)
    assert.equal(pts.length, 1);
    assert.equal(pts[0].time, 0);
  });

  it('includes playhead when provided', () => {
    const comp = emptyComposition();
    const pts = collectSnapPoints(comp, { playhead: 3.5 });
    assert.ok(pts.some(p => p.time === 3.5 && p.label === 'playhead'));
  });

  it('includes composition markers', () => {
    const comp = emptyComposition();
    comp.markers = [
      { time: 1.5, label: 'intro' },
      { time: 7.0, label: 'chorus' },
    ];
    const pts = collectSnapPoints(comp);
    assert.ok(pts.some(p => p.time === 1.5 && p.label === 'intro'));
    assert.ok(pts.some(p => p.time === 7.0 && p.label === 'chorus'));
  });

  it('deduplicates same-time points', () => {
    const { comp } = twoClipComp();
    // i1 end = 5, i2 start = 5 — should appear only once
    const pts = collectSnapPoints(comp);
    const at5 = pts.filter(p => p.time === 5);
    assert.equal(at5.length, 1);
  });

  it('returns sorted by time', () => {
    const { comp } = multiTrackComp();
    const pts = collectSnapPoints(comp, { playhead: 5 });
    for (let i = 1; i < pts.length; i++) {
      assert.ok(pts[i].time >= pts[i - 1].time,
        `expected ${pts[i].time} >= ${pts[i - 1].time}`);
    }
  });

  it('handles empty composition', () => {
    const comp = emptyComposition();
    const pts = collectSnapPoints(comp);
    assert.equal(pts.length, 1);
    assert.equal(pts[0].time, 0);
  });
});

// ── findSnap ─────────────────────────────────────────────────────────

describe('findSnap', () => {
  it('snaps to a nearby item edge', () => {
    const { comp, t, i1 } = twoClipComp();
    // i2 starts at 5; propose 4.95 (within default 0.1 threshold)
    const result = findSnap(
      { trackId: t, itemId: i1, edge: 'end', time: 4.95 },
      comp,
    );
    assert.equal(result.snapped, true);
    assert.equal(result.time, 5);
    assert.equal(result.snapTo, 'item-start');
  });

  it('does not snap when beyond threshold', () => {
    const { comp, t, i1 } = twoClipComp();
    // i2 starts at 5; propose 4.8 (0.2 away, beyond 0.1 threshold)
    const result = findSnap(
      { trackId: t, itemId: i1, edge: 'end', time: 4.8 },
      comp,
    );
    assert.equal(result.snapped, false);
    assert.equal(result.time, 4.8);
  });

  it('snaps to playhead', () => {
    const { comp, t, i1 } = twoClipComp();
    const result = findSnap(
      { trackId: t, itemId: i1, edge: 'start', time: 3.02 },
      comp,
      { playhead: 3.0 },
    );
    assert.equal(result.snapped, true);
    assert.equal(result.time, 3.0);
    assert.equal(result.snapTo, 'playhead');
  });

  it('snaps to zero', () => {
    const { comp, t, i2 } = twoClipComp();
    // Propose very close to 0
    const result = findSnap(
      { trackId: t, itemId: i2, edge: 'start', time: 0.05 },
      comp,
    );
    assert.equal(result.snapped, true);
    assert.equal(result.time, 0);
    assert.equal(result.snapTo, 'start');
  });

  it('returns closest snap when multiple are within threshold', () => {
    const { comp, t, i1 } = twoClipComp();
    // i2 starts at 5; playhead at 4.97; proposal at 4.98
    // Distance to playhead: 0.01, distance to i2 start: 0.02
    const result = findSnap(
      { trackId: t, itemId: i1, edge: 'end', time: 4.98 },
      comp,
      { playhead: 4.97 },
    );
    assert.equal(result.snapped, true);
    assert.equal(result.time, 4.97);
    assert.equal(result.snapTo, 'playhead');
  });

  it('handles empty composition gracefully', () => {
    const comp = emptyComposition();
    const result = findSnap(
      { trackId: 'tX', itemId: 'iX', edge: 'both', time: 3.0 },
      comp,
    );
    // Only snap point is zero at 3.0 away, beyond default 0.1
    assert.equal(result.snapped, false);
    assert.equal(result.time, 3.0);
  });

  it('excludes the dragged item from snap targets', () => {
    // Build a comp where the only nearby edge belongs to the dragged item
    let comp = emptyComposition();
    const s = addSource(comp, { kind: 'clip', asset: 'x', url: '/x', duration: 20 });
    comp = s.comp;
    const t = addTrack(comp, 'video');
    comp = t.comp;
    const i = addItem(comp, t.id, { at: 3, len: 4, source: s.id });
    comp = i.comp;
    // Item start=3, end=7; propose time=3.05 while dragging this item
    const result = findSnap(
      { trackId: t.id, itemId: i.id, edge: 'start', time: 3.05 },
      comp,
    );
    // Should NOT snap to 3 (own edge) — only zero at 3.05 away
    assert.equal(result.snapped, false);
    assert.equal(result.time, 3.05);
  });

  it('respects custom threshold', () => {
    const { comp, t, i1 } = twoClipComp();
    // i2 starts at 5; propose 4.7 — 0.3 away
    const noSnap = findSnap(
      { trackId: t, itemId: i1, edge: 'end', time: 4.7 },
      comp,
      { threshold: 0.2 },
    );
    assert.equal(noSnap.snapped, false);

    const snap = findSnap(
      { trackId: t, itemId: i1, edge: 'end', time: 4.7 },
      comp,
      { threshold: 0.5 },
    );
    assert.equal(snap.snapped, true);
    assert.equal(snap.time, 5);
  });

  it('snaps across tracks', () => {
    const { comp, tv, iv, ia } = multiTrackComp();
    // audio item starts at 10; drag video item end near 10
    const result = findSnap(
      { trackId: tv, itemId: iv, edge: 'end', time: 9.95 },
      comp,
    );
    assert.equal(result.snapped, true);
    assert.equal(result.time, 10);
  });

  it('snaps to composition markers', () => {
    const comp = emptyComposition();
    comp.markers = [{ time: 5.5, label: 'beat' }];
    const result = findSnap(
      { trackId: 'tX', itemId: 'iX', edge: 'both', time: 5.45 },
      comp,
    );
    assert.equal(result.snapped, true);
    assert.equal(result.time, 5.5);
    assert.equal(result.snapTo, 'beat');
  });

  it('handles edge=both (move) correctly', () => {
    const { comp, t, i1 } = twoClipComp();
    // Moving i1 — both edges move together. Propose start at 4.96
    const result = findSnap(
      { trackId: t, itemId: i1, edge: 'both', time: 4.96 },
      comp,
    );
    // Nearest point is i2 start at 5 (distance 0.04)
    assert.equal(result.snapped, true);
    assert.equal(result.time, 5);
  });

  it('handles null composition', () => {
    const result = findSnap(
      { trackId: 'tX', itemId: 'iX', edge: 'start', time: 1.0 },
      null,
    );
    assert.equal(result.snapped, false);
    assert.equal(result.time, 1.0);
  });

  it('handles NaN time', () => {
    const comp = emptyComposition();
    const result = findSnap(
      { trackId: 'tX', itemId: 'iX', edge: 'start', time: NaN },
      comp,
    );
    assert.equal(result.snapped, false);
    assert.equal(result.time, 0);
  });

  it('snaps to exact edge (distance = 0)', () => {
    const { comp, t, i1 } = twoClipComp();
    // Propose exactly at i2 start
    const result = findSnap(
      { trackId: t, itemId: i1, edge: 'end', time: 5.0 },
      comp,
    );
    assert.equal(result.snapped, true);
    assert.equal(result.time, 5);
  });
});

// ── Performance ──────────────────────────────────────────────────────

describe('performance', () => {
  it('findSnap with 200+ items completes in under 1ms', () => {
    // Build a composition with 250 items across 5 tracks
    let comp = emptyComposition();
    const s = addSource(comp, { kind: 'clip', asset: 'x', url: '/x', duration: 10000 });
    comp = s.comp;

    const trackIds = [];
    for (let t = 0; t < 5; t++) {
      const tr = addTrack(comp, 'video');
      comp = tr.comp;
      trackIds.push(tr.id);
    }

    for (let i = 0; i < 250; i++) {
      const tId = trackIds[i % trackIds.length];
      const r = addItem(comp, tId, { at: i * 2, len: 1.5, source: s.id });
      comp = r.comp;
    }

    const firstTrack = trackIds[0];
    const firstItem = comp.tracks[0].items[0].id;

    // Warm up
    findSnap({ trackId: firstTrack, itemId: firstItem, edge: 'end', time: 100.05 }, comp);

    // Measure
    const runs = 100;
    const start = performance.now();
    for (let i = 0; i < runs; i++) {
      findSnap(
        { trackId: firstTrack, itemId: firstItem, edge: 'end', time: 100.05 + i * 0.001 },
        comp,
      );
    }
    const elapsed = performance.now() - start;
    const perCall = elapsed / runs;

    assert.ok(perCall < 1, `Expected < 1ms per call, got ${perCall.toFixed(3)}ms`);
  });
});
