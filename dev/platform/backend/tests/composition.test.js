/**
 * Composition model tests.
 *
 *   node --test tests/composition.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  COMP_VERSION,
  EPS,
  secs,
  emptyComposition,
  validate,
  isValid,
  addSource,
  addTrack,
  addItem,
  removeItem,
  updateItem,
  removeTrack,
  removeSource,
  duration,
  itemEnd,
  itemsAt,
  overlaps,
  topmostAt,
  TRANSITION_TYPES,
} = require('../../shared/composition.mjs');

// ── helpers ───────────────────────────────────────────────────────────

function twoClipComp() {
  let comp = emptyComposition({ width: 1080, height: 1920, fps: 30 });
  const s1 = addSource(comp, { kind: 'clip', asset: 'a.mp4', url: '/a.mp4', duration: 10, width: 1920, height: 1080, fps: 30 });
  comp = s1.comp;
  const s2 = addSource(comp, { kind: 'clip', asset: 'b.mp4', url: '/b.mp4', duration: 8, width: 1920, height: 1080, fps: 30 });
  comp = s2.comp;
  const t = addTrack(comp, 'video');
  comp = t.comp;
  const i1 = addItem(comp, t.id, { at: 0, len: 5, source: s1.id });
  comp = i1.comp;
  const i2 = addItem(comp, t.id, { at: 5, len: 4, source: s2.id });
  comp = i2.comp;
  return { comp, s1: s1.id, s2: s2.id, t: t.id, i1: i1.id, i2: i2.id };
}

// ── emptyComposition ──────────────────────────────────────────────────

describe('emptyComposition', () => {
  it('has the right version', () => {
    assert.equal(emptyComposition().version, COMP_VERSION);
  });

  it('uses provided dimensions', () => {
    const c = emptyComposition({ width: 1920, height: 1080, fps: 60 });
    assert.equal(c.size.width, 1920);
    assert.equal(c.size.height, 1080);
    assert.equal(c.fps, 60);
  });

  it('defaults to 1080x1920 at 30fps', () => {
    const c = emptyComposition();
    assert.equal(c.size.width, 1080);
    assert.equal(c.size.height, 1920);
    assert.equal(c.fps, 30);
  });

  it('starts with empty sources and tracks', () => {
    const c = emptyComposition();
    assert.deepEqual(c.sources, {});
    assert.deepEqual(c.tracks, []);
  });
});

// ── validate ──────────────────────────────────────────────────────────

describe('validate', () => {
  it('accepts a valid empty composition', () => {
    assert.deepEqual(validate(emptyComposition()), []);
  });

  it('rejects null', () => {
    assert.ok(validate(null).length > 0);
  });

  it('rejects wrong version', () => {
    const c = emptyComposition();
    c.version = 99;
    assert.ok(validate(c).some(e => /version/.test(e)));
  });

  it('rejects missing size', () => {
    const c = emptyComposition();
    c.size = null;
    assert.ok(validate(c).some(e => /size/.test(e)));
  });

  it('rejects zero-width', () => {
    const c = emptyComposition();
    c.size.width = 0;
    assert.ok(validate(c).some(e => /size/.test(e)));
  });

  it('rejects fps out of range', () => {
    const c = emptyComposition();
    c.fps = 0;
    assert.ok(validate(c).some(e => /fps/.test(e)));
    c.fps = 121;
    assert.ok(validate(c).some(e => /fps/.test(e)));
  });

  it('accepts fps at boundaries', () => {
    const c1 = emptyComposition({ fps: 1 });
    assert.deepEqual(validate(c1), []);
    const c2 = emptyComposition({ fps: 120 });
    assert.deepEqual(validate(c2), []);
  });

  it('validates sources', () => {
    const c = emptyComposition();
    c.sources = { bad: { kind: 'nope' } };
    assert.ok(validate(c).some(e => /unknown kind/.test(e)));
  });

  it('validates clip source needs asset or url', () => {
    const c = emptyComposition();
    c.sources = { s1: { kind: 'clip' } };
    assert.ok(validate(c).some(e => /needs asset or url/.test(e)));
  });

  it('validates audio source needs asset or url', () => {
    const c = emptyComposition();
    c.sources = { s1: { kind: 'audio' } };
    assert.ok(validate(c).some(e => /needs asset or url/.test(e)));
  });

  it('validates design source needs project', () => {
    const c = emptyComposition();
    c.sources = { s1: { kind: 'design' } };
    assert.ok(validate(c).some(e => /needs a project/.test(e)));
  });

  it('validates captions source needs transcript', () => {
    const c = emptyComposition();
    c.sources = { s1: { kind: 'captions' } };
    assert.ok(validate(c).some(e => /needs a transcript/.test(e)));
  });

  it('accepts valid sources', () => {
    let c = emptyComposition();
    c.sources = {
      s1: { kind: 'clip', asset: 'x', duration: 10, width: 1920, height: 1080, fps: 30 },
      s2: { kind: 'audio', url: '/a.mp3', duration: 30 },
      s3: { kind: 'design', project: 'p1', page: 'page1', alpha: true },
      s4: { kind: 'captions', transcript: [{ word: 'hi', from: 0, to: 0.5 }], template: 't1' },
    };
    assert.deepEqual(validate(c), []);
  });

  it('rejects audio source on a video track', () => {
    let comp = emptyComposition();
    const s = addSource(comp, { kind: 'audio', url: '/a.mp3', duration: 10 });
    comp = s.comp;
    const t = addTrack(comp, 'video');
    comp = t.comp;
    const i = addItem(comp, t.id, { at: 0, len: 5, source: s.id });
    comp = i.comp;
    assert.ok(validate(comp).some(e => /audio source on a video track/.test(e)));
  });

  it('rejects clip source on an audio track', () => {
    let comp = emptyComposition();
    const s = addSource(comp, { kind: 'clip', asset: 'a.mp4', duration: 10 });
    comp = s.comp;
    const t = addTrack(comp, 'audio');
    comp = t.comp;
    const i = addItem(comp, t.id, { at: 0, len: 5, source: s.id });
    comp = i.comp;
    assert.ok(validate(comp).some(e => /clip source on an audio track/.test(e)));
  });

  it('validates duckUnder referencing a real track', () => {
    let comp = emptyComposition();
    const s = addSource(comp, { kind: 'audio', asset: 'music.mp3', duration: 10 });
    comp = s.comp;
    const vt = addTrack(comp, 'video');
    comp = vt.comp;
    const at = addTrack(comp, 'audio');
    comp = at.comp;
    comp.tracks[comp.tracks.length - 1].duckUnder = vt.id;
    const r = addItem(comp, at.id, { at: 0, len: 5, source: s.id });
    comp = r.comp;
    assert.deepEqual(validate(comp), []);
  });

  it('rejects duckUnder referencing unknown track', () => {
    let comp = emptyComposition();
    const s = addSource(comp, { kind: 'audio', asset: 'music.mp3', duration: 10 });
    comp = s.comp;
    const at = addTrack(comp, 'audio');
    comp = at.comp;
    comp.tracks[comp.tracks.length - 1].duckUnder = 'nonexistent';
    const r = addItem(comp, at.id, { at: 0, len: 5, source: s.id });
    comp = r.comp;
    assert.ok(validate(comp).some(e => /duckUnder references unknown track/.test(e)));
  });

  it('rejects non-string duckUnder', () => {
    let comp = emptyComposition();
    const at = addTrack(comp, 'audio');
    comp = at.comp;
    comp.tracks[comp.tracks.length - 1].duckUnder = 42;
    assert.ok(validate(comp).some(e => /duckUnder must be a track id string/.test(e)));
  });
});

// ── addSource / addTrack / addItem ────────────────────────────────────

describe('constructors', () => {
  it('addSource returns the new id', () => {
    const comp = emptyComposition();
    const { comp: c, id } = addSource(comp, { kind: 'clip', asset: 'x', duration: 10 });
    assert.ok(id);
    assert.ok(c.sources[id]);
    assert.equal(c.sources[id].kind, 'clip');
  });

  it('addTrack returns the new id', () => {
    const comp = emptyComposition();
    const { comp: c, id } = addTrack(comp, 'audio');
    assert.ok(id);
    assert.equal(c.tracks.length, 1);
    assert.equal(c.tracks[0].kind, 'audio');
  });

  it('addItem sorts by at', () => {
    const { comp, t, s1 } = twoClipComp();
    const { comp: c } = addItem(comp, t, { at: 2.5, len: 1, source: s1 });
    const track = c.tracks.find(tr => tr.id === t);
    const ats = track.items.map(i => i.at);
    assert.deepEqual(ats, [0, 2.5, 5]);
  });

  it('addItem pins times to microsecond', () => {
    let comp = emptyComposition();
    const s = addSource(comp, { kind: 'clip', asset: 'x', duration: 10 });
    comp = s.comp;
    const tr = addTrack(comp, 'video');
    comp = tr.comp;
    const { comp: c } = addItem(comp, tr.id, { at: 1.0000001, len: 2.9999999, source: s.id });
    const item = c.tracks[0].items[0];
    assert.equal(item.at, 1);
    assert.equal(item.len, 3);
  });

  it('original composition is not mutated', () => {
    const orig = emptyComposition();
    const { comp } = addSource(orig, { kind: 'clip', asset: 'x', duration: 10 });
    assert.deepEqual(orig.sources, {});
    assert.notDeepEqual(comp.sources, {});
  });
});

// ── removeItem / updateItem ───────────────────────────────────────────

describe('removeItem', () => {
  it('removes the item', () => {
    const { comp, t, i1 } = twoClipComp();
    const c = removeItem(comp, t, i1);
    const track = c.tracks.find(tr => tr.id === t);
    assert.equal(track.items.length, 1);
    assert.ok(!track.items.find(i => i.id === i1));
  });
});

describe('updateItem', () => {
  it('updates at and re-sorts', () => {
    const { comp, t, i1 } = twoClipComp();
    const c = updateItem(comp, t, i1, { at: 6 });
    const track = c.tracks.find(tr => tr.id === t);
    assert.equal(track.items[1].id, i1);
    assert.equal(track.items[1].at, 6);
  });

  it('pins updated times to microsecond', () => {
    const { comp, t, i1 } = twoClipComp();
    const c = updateItem(comp, t, i1, { at: 1.00000001 });
    const track = c.tracks.find(tr => tr.id === t);
    assert.equal(track.items.find(i => i.id === i1).at, 1);
  });
});

// ── removeTrack / removeSource ────────────────────────────────────────

describe('removeTrack', () => {
  it('removes the track', () => {
    const { comp, t } = twoClipComp();
    const c = removeTrack(comp, t);
    assert.equal(c.tracks.length, 0);
  });
});

describe('removeSource', () => {
  it('removes the source and its items', () => {
    const { comp, s1 } = twoClipComp();
    const c = removeSource(comp, s1);
    assert.ok(!c.sources[s1]);
    for (const track of c.tracks) {
      assert.ok(!track.items.find(i => i.source === s1));
    }
  });
});

// ── duration ──────────────────────────────────────────────────────────

describe('duration', () => {
  it('is 0 for empty', () => {
    assert.equal(duration(emptyComposition()), 0);
  });

  it('is the furthest item end', () => {
    const { comp } = twoClipComp();
    assert.equal(duration(comp), 9);
  });

  it('accounts for items that start late', () => {
    let comp = emptyComposition();
    const s = addSource(comp, { kind: 'clip', asset: 'x', duration: 20 });
    comp = s.comp;
    const t = addTrack(comp, 'video');
    comp = t.comp;
    addItem(comp, t.id, { at: 100, len: 5, source: s.id });
    const { comp: c } = addItem(comp, t.id, { at: 100, len: 5, source: s.id });
    assert.equal(duration(c), 105);
  });
});

// ── itemsAt ───────────────────────────────────────────────────────────

describe('itemsAt', () => {
  it('finds items at a timeline time', () => {
    const { comp } = twoClipComp();
    assert.equal(itemsAt(comp, 2).length, 1);
    assert.equal(itemsAt(comp, 7).length, 1);
  });

  it('returns empty at a gap', () => {
    let comp = emptyComposition();
    const s = addSource(comp, { kind: 'clip', asset: 'x', duration: 20 });
    comp = s.comp;
    const t = addTrack(comp, 'video');
    comp = t.comp;
    const i1 = addItem(comp, t.id, { at: 0, len: 3, source: s.id });
    comp = i1.comp;
    const i2 = addItem(comp, t.id, { at: 5, len: 3, source: s.id });
    comp = i2.comp;
    assert.equal(itemsAt(comp, 4).length, 0);
  });
});

// ── overlaps (transition detection) ───────────────────────────────────

describe('overlaps', () => {
  it('finds no overlaps when items abut', () => {
    const { comp, t } = twoClipComp();
    const track = comp.tracks.find(tr => tr.id === t);
    assert.equal(overlaps(track).length, 0);
  });

  it('detects an overlap as a transition', () => {
    let comp = emptyComposition();
    const s = addSource(comp, { kind: 'clip', asset: 'x', duration: 20 });
    comp = s.comp;
    const t = addTrack(comp, 'video');
    comp = t.comp;
    let r = addItem(comp, t.id, { at: 0, len: 6, source: s.id });
    comp = r.comp;
    r = addItem(comp, t.id, { at: 5, len: 6, source: s.id, in: 5 });
    comp = r.comp;
    const track = comp.tracks.find(tr => tr.id === t.id);
    const ov = overlaps(track);
    assert.equal(ov.length, 1);
    assert.equal(ov[0].from, 5);
    assert.equal(ov[0].duration, 1);
  });

  it('overlap duration is the overlap, not the transition prop', () => {
    let comp = emptyComposition();
    const s = addSource(comp, { kind: 'clip', asset: 'x', duration: 20 });
    comp = s.comp;
    const t = addTrack(comp, 'video');
    comp = t.comp;
    let r = addItem(comp, t.id, { at: 0, len: 8, source: s.id });
    comp = r.comp;
    r = addItem(comp, t.id, { at: 5, len: 8, source: s.id, in: 5 });
    comp = r.comp;
    const track = comp.tracks.find(tr => tr.id === t.id);
    const ov = overlaps(track);
    assert.equal(ov[0].duration, 3);
  });
});

// ── topmostAt ─────────────────────────────────────────────────────────

describe('topmostAt', () => {
  it('returns the base track item when only one track', () => {
    const { comp, i1 } = twoClipComp();
    const top = topmostAt(comp, 2);
    assert.ok(top);
    assert.equal(top.item.id, i1);
  });

  it('returns the higher track item when two tracks cover the same time', () => {
    let comp = emptyComposition();
    const s = addSource(comp, { kind: 'clip', asset: 'x', duration: 20 });
    comp = s.comp;
    const t1 = addTrack(comp, 'video');
    comp = t1.comp;
    const t2 = addTrack(comp, 'video');
    comp = t2.comp;
    let r = addItem(comp, t1.id, { at: 0, len: 10, source: s.id });
    comp = r.comp;
    r = addItem(comp, t2.id, { at: 3, len: 4, source: s.id, in: 3 });
    comp = r.comp;
    const top = topmostAt(comp, 5);
    assert.ok(top);
    assert.equal(top.trackIndex, 1);
  });

  it('returns null at a gap', () => {
    let comp = emptyComposition();
    const s = addSource(comp, { kind: 'clip', asset: 'x', duration: 20 });
    comp = s.comp;
    const t = addTrack(comp, 'video');
    comp = t.comp;
    const r = addItem(comp, t.id, { at: 0, len: 3, source: s.id });
    comp = r.comp;
    assert.equal(topmostAt(comp, 5), null);
  });

  it('ignores audio tracks', () => {
    let comp = emptyComposition();
    const sv = addSource(comp, { kind: 'clip', asset: 'x', duration: 20 });
    comp = sv.comp;
    const sa = addSource(comp, { kind: 'audio', url: '/a.mp3', duration: 20 });
    comp = sa.comp;
    const tv = addTrack(comp, 'video');
    comp = tv.comp;
    const ta = addTrack(comp, 'audio');
    comp = ta.comp;
    let r = addItem(comp, tv.id, { at: 0, len: 10, source: sv.id });
    comp = r.comp;
    r = addItem(comp, ta.id, { at: 0, len: 10, source: sa.id });
    comp = r.comp;
    const top = topmostAt(comp, 5);
    assert.equal(top.trackIndex, 0);
  });
});

// ── transition validation ─────────────────────────────────────────────

describe('transitions', () => {
  it('accepts valid transition types', () => {
    for (const type of TRANSITION_TYPES) {
      let comp = emptyComposition();
      const s = addSource(comp, { kind: 'clip', asset: 'x', duration: 20 });
      comp = s.comp;
      const t = addTrack(comp, 'video');
      comp = t.comp;
      const r = addItem(comp, t.id, { at: 0, len: 5, source: s.id, trans: { type } });
      comp = r.comp;
      assert.deepEqual(validate(comp), [], `type ${type} should be valid`);
    }
  });

  it('rejects unknown transition type', () => {
    let comp = emptyComposition();
    const s = addSource(comp, { kind: 'clip', asset: 'x', duration: 20 });
    comp = s.comp;
    const t = addTrack(comp, 'video');
    comp = t.comp;
    const r = addItem(comp, t.id, { at: 0, len: 5, source: s.id, trans: { type: 'spin' } });
    comp = r.comp;
    assert.ok(validate(comp).some(e => /unknown transition/.test(e)));
  });
});

// ── item validation edge cases ────────────────────────────────────────

describe('item validation', () => {
  it('rejects negative at', () => {
    let comp = emptyComposition();
    const s = addSource(comp, { kind: 'clip', asset: 'x', duration: 20 });
    comp = s.comp;
    const t = addTrack(comp, 'video');
    comp = t.comp;
    const r = addItem(comp, t.id, { at: -1, len: 5, source: s.id });
    comp = r.comp;
    assert.ok(validate(comp).some(e => /at must be/.test(e)));
  });

  it('rejects zero len', () => {
    let comp = emptyComposition();
    const s = addSource(comp, { kind: 'clip', asset: 'x', duration: 20 });
    comp = s.comp;
    const t = addTrack(comp, 'video');
    comp = t.comp;
    const r = addItem(comp, t.id, { at: 0, len: 0, source: s.id });
    comp = r.comp;
    assert.ok(validate(comp).some(e => /len must be/.test(e)));
  });

  it('rejects gain > 4', () => {
    let comp = emptyComposition();
    const s = addSource(comp, { kind: 'clip', asset: 'x', duration: 20 });
    comp = s.comp;
    const t = addTrack(comp, 'video');
    comp = t.comp;
    const r = addItem(comp, t.id, { at: 0, len: 5, source: s.id, gain: 5 });
    comp = r.comp;
    assert.ok(validate(comp).some(e => /gain/.test(e)));
  });

  it('rejects opacity > 1', () => {
    let comp = emptyComposition();
    const s = addSource(comp, { kind: 'clip', asset: 'x', duration: 20 });
    comp = s.comp;
    const t = addTrack(comp, 'video');
    comp = t.comp;
    const r = addItem(comp, t.id, { at: 0, len: 5, source: s.id, opacity: 1.5 });
    comp = r.comp;
    assert.ok(validate(comp).some(e => /opacity/.test(e)));
  });

  it('rejects unknown source reference', () => {
    let comp = emptyComposition();
    const t = addTrack(comp, 'video');
    comp = t.comp;
    const r = addItem(comp, t.id, { at: 0, len: 5, source: 'nonexistent' });
    comp = r.comp;
    assert.ok(validate(comp).some(e => /unknown source/.test(e)));
  });

  it('rejects negative in', () => {
    let comp = emptyComposition();
    const s = addSource(comp, { kind: 'clip', asset: 'x', duration: 20 });
    comp = s.comp;
    const t = addTrack(comp, 'video');
    comp = t.comp;
    const r = addItem(comp, t.id, { at: 0, len: 5, source: s.id, in: -1 });
    comp = r.comp;
    assert.ok(validate(comp).some(e => /in must be/.test(e)));
  });

  it('rejects invalid fit', () => {
    let comp = emptyComposition();
    const s = addSource(comp, { kind: 'clip', asset: 'x', duration: 20 });
    comp = s.comp;
    const t = addTrack(comp, 'video');
    comp = t.comp;
    const r = addItem(comp, t.id, { at: 0, len: 5, source: s.id, fit: 'stretch' });
    comp = r.comp;
    assert.ok(validate(comp).some(e => /fit/.test(e)));
  });
});

// ── secs precision ────────────────────────────────────────────────────

describe('secs', () => {
  it('rounds to microsecond', () => {
    assert.equal(secs(1.0000001), 1);
    assert.equal(secs(1.0000005), 1.000001);
  });

  it('handles the IEEE trap from the spec', () => {
    const result = secs(5 + 0.05) - secs(5);
    assert.ok(Math.abs(result - 0.05) < 1e-6);
  });

  it('returns fallback for NaN', () => {
    assert.equal(secs(NaN, 0), 0);
    assert.equal(secs(undefined, 0), 0);
  });
});
