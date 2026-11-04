const { describe, it } = require('node:test');
const assert = require('assert');

async function load() {
  return import('../../shared/composition.mjs');
}

// ── Fixtures ──────────────────────────────────────────────────────────

function twoClipComp() {
  return {
    version: 1,
    size: { width: 1080, height: 1920 },
    fps: 30,
    sources: {
      s1: { kind: 'clip', asset: 'a1', url: '/v1.mp4', duration: 10, width: 1920, height: 1080 },
      s2: { kind: 'clip', asset: 'a2', url: '/v2.mp4', duration: 8, width: 1920, height: 1080 },
    },
    tracks: [
      { id: 't1', kind: 'video', items: [
        { id: 'i1', at: 0, len: 5, source: 's1', in: 2 },
        { id: 'i2', at: 5, len: 8, source: 's2', in: 0 },
      ] },
    ],
  };
}

function twoTrackComp() {
  return {
    version: 1,
    size: { width: 1080, height: 1920 },
    fps: 30,
    sources: {
      s1: { kind: 'clip', asset: 'a1', url: '/v1.mp4', duration: 10, width: 1920, height: 1080 },
      s2: { kind: 'audio', asset: 'a2', url: '/music.mp3', duration: 30 },
    },
    tracks: [
      { id: 't1', kind: 'video', items: [
        { id: 'i1', at: 0, len: 10, source: 's1', in: 0 },
      ] },
      { id: 't2', kind: 'video', items: [] },
      { id: 't3', kind: 'audio', items: [
        { id: 'i2', at: 0, len: 10, source: 's2', in: 5 },
      ] },
    ],
  };
}

function overlapComp() {
  return {
    version: 1,
    size: { width: 1080, height: 1920 },
    fps: 30,
    sources: {
      s1: { kind: 'clip', asset: 'a1', url: '/v1.mp4', duration: 10, width: 1920, height: 1080 },
      s2: { kind: 'clip', asset: 'a2', url: '/v2.mp4', duration: 8, width: 1920, height: 1080 },
    },
    tracks: [
      { id: 't1', kind: 'video', items: [
        { id: 'i1', at: 0, len: 6, source: 's1', in: 0 },
        { id: 'i2', at: 5, len: 8, source: 's2', in: 0, trans: { type: 'fade' } },
      ] },
    ],
  };
}

// ── splitItem tests ───────────────────────────────────────────────────

describe('splitItem', async () => {
  const C = await load();

  it('splits an item at a timeline time', () => {
    const comp = twoClipComp();
    const { comp: next, id } = C.splitItem(comp, 't1', 'i1', 3);
    assert.ok(id, 'should return the second half id');
    assert.strictEqual(next.tracks[0].items.length, 3);

    const first = next.tracks[0].items.find(i => i.id === 'i1');
    const second = next.tracks[0].items.find(i => i.id === id);
    assert.ok(first, 'first half should exist');
    assert.ok(second, 'second half should exist');

    assert.strictEqual(first.at, 0);
    assert.strictEqual(first.len, 3);
    assert.strictEqual(first.in, 2);

    assert.strictEqual(second.at, 3);
    assert.strictEqual(second.len, 2);
    assert.strictEqual(second.in, 5);
  });

  it('preserves the source reference', () => {
    const comp = twoClipComp();
    const { comp: next, id } = C.splitItem(comp, 't1', 'i1', 3);
    const second = next.tracks[0].items.find(i => i.id === id);
    assert.strictEqual(second.source, 's1');
  });

  it('removes transition from the second half', () => {
    const comp = overlapComp();
    const { comp: next, id } = C.splitItem(comp, 't1', 'i2', 8);
    const first = next.tracks[0].items.find(i => i.id === 'i2');
    const second = next.tracks[0].items.find(i => i.id === id);
    assert.deepStrictEqual(first.trans, { type: 'fade' });
    assert.strictEqual(second.trans, undefined);
  });

  it('returns unchanged if split time is before item start', () => {
    const comp = twoClipComp();
    const { comp: next, id } = C.splitItem(comp, 't1', 'i2', 4);
    assert.strictEqual(next, comp);
    assert.strictEqual(id, null);
  });

  it('returns unchanged if split time is after item end', () => {
    const comp = twoClipComp();
    const { comp: next, id } = C.splitItem(comp, 't1', 'i1', 10);
    assert.strictEqual(next, comp);
    assert.strictEqual(id, null);
  });

  it('returns unchanged if track not found', () => {
    const comp = twoClipComp();
    const { comp: next, id } = C.splitItem(comp, 'nope', 'i1', 3);
    assert.strictEqual(next, comp);
    assert.strictEqual(id, null);
  });

  it('returns unchanged if item not found', () => {
    const comp = twoClipComp();
    const { comp: next, id } = C.splitItem(comp, 't1', 'nope', 3);
    assert.strictEqual(next, comp);
    assert.strictEqual(id, null);
  });

  it('split preserves total duration of the item', () => {
    const comp = twoClipComp();
    const { comp: next, id } = C.splitItem(comp, 't1', 'i1', 2);
    const first = next.tracks[0].items.find(i => i.id === 'i1');
    const second = next.tracks[0].items.find(i => i.id === id);
    const totalLen = first.len + second.len;
    assert.ok(Math.abs(totalLen - 5) < 1e-6, `total len should be 5, got ${totalLen}`);
  });

  it('split at an in-point offset preserves source continuity', () => {
    const comp = twoClipComp();
    const { comp: next, id } = C.splitItem(comp, 't1', 'i1', 1);
    const first = next.tracks[0].items.find(i => i.id === 'i1');
    const second = next.tracks[0].items.find(i => i.id === id);
    assert.strictEqual(first.in, 2);
    assert.strictEqual(second.in, 3);
    assert.strictEqual(first.len, 1);
    assert.strictEqual(second.len, 4);
  });

  it('does not mutate the original composition', () => {
    const comp = twoClipComp();
    const origLen = comp.tracks[0].items.length;
    C.splitItem(comp, 't1', 'i1', 3);
    assert.strictEqual(comp.tracks[0].items.length, origLen);
  });
});

// ── moveItemToTrack tests ─────────────────────────────────────────────

describe('moveItemToTrack', async () => {
  const C = await load();

  it('moves a video item to another video track', () => {
    const comp = twoTrackComp();
    const next = C.moveItemToTrack(comp, 't1', 'i1', 't2');
    assert.strictEqual(next.tracks[0].items.length, 0);
    assert.strictEqual(next.tracks[1].items.length, 1);
    assert.strictEqual(next.tracks[1].items[0].id, 'i1');
  });

  it('preserves item properties after move', () => {
    const comp = twoTrackComp();
    const next = C.moveItemToTrack(comp, 't1', 'i1', 't2');
    const moved = next.tracks[1].items[0];
    assert.strictEqual(moved.at, 0);
    assert.strictEqual(moved.len, 10);
    assert.strictEqual(moved.source, 's1');
  });

  it('refuses to move a clip to an audio track', () => {
    const comp = twoTrackComp();
    const next = C.moveItemToTrack(comp, 't1', 'i1', 't3');
    assert.strictEqual(next, comp);
  });

  it('refuses to move audio to a video track', () => {
    const comp = twoTrackComp();
    const next = C.moveItemToTrack(comp, 't3', 'i2', 't1');
    assert.strictEqual(next, comp);
  });

  it('returns unchanged for same track', () => {
    const comp = twoTrackComp();
    const next = C.moveItemToTrack(comp, 't1', 'i1', 't1');
    assert.strictEqual(next, comp);
  });

  it('returns unchanged for unknown from-track', () => {
    const comp = twoTrackComp();
    const next = C.moveItemToTrack(comp, 'nope', 'i1', 't2');
    assert.strictEqual(next, comp);
  });

  it('returns unchanged for unknown to-track', () => {
    const comp = twoTrackComp();
    const next = C.moveItemToTrack(comp, 't1', 'i1', 'nope');
    assert.strictEqual(next, comp);
  });

  it('returns unchanged for unknown item', () => {
    const comp = twoTrackComp();
    const next = C.moveItemToTrack(comp, 't1', 'nope', 't2');
    assert.strictEqual(next, comp);
  });

  it('items are sorted by at after move', () => {
    const comp = {
      ...twoTrackComp(),
      tracks: [
        { id: 't1', kind: 'video', items: [
          { id: 'i1', at: 5, len: 5, source: 's1', in: 0 },
        ] },
        { id: 't2', kind: 'video', items: [
          { id: 'i3', at: 0, len: 3, source: 's1', in: 0 },
          { id: 'i4', at: 8, len: 2, source: 's1', in: 0 },
        ] },
        { id: 't3', kind: 'audio', items: [] },
      ],
    };
    const next = C.moveItemToTrack(comp, 't1', 'i1', 't2');
    const ids = next.tracks[1].items.map(i => i.id);
    assert.deepStrictEqual(ids, ['i3', 'i1', 'i4']);
  });

  it('does not mutate the original composition', () => {
    const comp = twoTrackComp();
    const origLen = comp.tracks[0].items.length;
    C.moveItemToTrack(comp, 't1', 'i1', 't2');
    assert.strictEqual(comp.tracks[0].items.length, origLen);
  });
});
