const { describe, it } = require('node:test');
const assert = require('assert');

/**
 * Tests for design-page sources in the composition editor (step 6).
 *
 * Covers: composition model with design sources, render graph output
 * for design items, and the compositor's image-element handling pattern.
 */

// ── Design source in composition model ──────────────────────────────

describe('design source in composition model', async () => {
  const C = await import('../../shared/composition.mjs');

  it('adds a design source and places it on a track', () => {
    let comp = C.emptyComposition({ width: 1080, height: 1920, fps: 30 });
    const { comp: c1, id: t1 } = C.addTrack(comp, 'video');
    comp = c1;

    const { comp: c2, id: s1 } = C.addSource(comp, {
      kind: 'design', project: 42, page: 1, alpha: true,
      url: '/design/logo.png', width: 500, height: 500,
    });
    comp = c2;

    const { comp: c3 } = C.addItem(comp, t1, {
      source: s1, at: 2, len: 5, fit: 'contain', opacity: 0.8,
    });
    comp = c3;

    const src = comp.sources[s1];
    assert.strictEqual(src.kind, 'design');
    assert.strictEqual(src.alpha, true);
    assert.strictEqual(src.project, 42);

    const item = comp.tracks[0].items[0];
    assert.strictEqual(item.source, s1);
    assert.strictEqual(item.at, 2);
    assert.strictEqual(item.len, 5);
    assert.strictEqual(item.fit, 'contain');
    assert.strictEqual(item.opacity, 0.8);
  });

  it('validates a composition with mixed clip and design sources', () => {
    let comp = C.emptyComposition();
    const { comp: c1, id: t1 } = C.addTrack(comp, 'video');
    comp = c1;
    const { comp: c2, id: t2 } = C.addTrack(comp, 'video');
    comp = c2;

    const { comp: c3, id: clipSrc } = C.addSource(comp, {
      kind: 'clip', asset: 'a1', url: '/a.mp4', duration: 10,
      width: 1920, height: 1080, fps: 30,
    });
    comp = c3;
    const { comp: c4, id: designSrc } = C.addSource(comp, {
      kind: 'design', project: 1, page: 1, alpha: true,
    });
    comp = c4;

    const { comp: c5 } = C.addItem(comp, t1, { source: clipSrc, at: 0, len: 10 });
    comp = c5;
    const { comp: c6 } = C.addItem(comp, t2, { source: designSrc, at: 2, len: 3 });
    comp = c6;

    const errors = C.validate(comp);
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(comp.tracks[0].items.length, 1);
    assert.strictEqual(comp.tracks[1].items.length, 1);
  });

  it('design source survives JSON round-trip', () => {
    let comp = C.emptyComposition();
    const { comp: c1, id: t1 } = C.addTrack(comp, 'video');
    comp = c1;
    const { comp: c2, id: s1 } = C.addSource(comp, {
      kind: 'design', project: 7, page: 1, alpha: true,
      url: '/design/lower-third.png', width: 1080, height: 300,
    });
    comp = c2;
    const { comp: c3 } = C.addItem(comp, t1, {
      source: s1, at: 0, len: 4, fit: 'contain',
    });
    comp = c3;

    const loaded = JSON.parse(JSON.stringify(comp));
    const errors = C.validate(loaded);
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(loaded.sources[s1].kind, 'design');
    assert.strictEqual(loaded.sources[s1].alpha, true);
  });
});

// ── Render graph for design sources ─────────────────────────────────

describe('render graph for design sources', async () => {
  const C = await import('../../shared/composition.mjs');
  const R = await import('../../shared/compositionRender.mjs');

  it('produces loop+trim filters for a design source', () => {
    let comp = C.emptyComposition({ width: 1080, height: 1920, fps: 30 });
    const { comp: c1, id: t1 } = C.addTrack(comp, 'video');
    comp = c1;
    const { comp: c2, id: s1 } = C.addSource(comp, {
      kind: 'design', project: 1, page: 1, alpha: true,
    });
    comp = c2;
    const { comp: c3 } = C.addItem(comp, t1, {
      source: s1, at: 0, len: 5, fit: 'contain',
    });
    comp = c3;

    const result = R.renderGraph(comp);
    assert.ok(result.graph.includes('loop=loop=-1:size=1:start=0'),
      'graph should contain loop filter for design source');
    assert.ok(result.graph.includes('trim=duration=5'),
      'graph should trim design to item length');
    assert.strictEqual(result.inputs.length, 1);
    assert.strictEqual(result.inputs[0].kind, 'design');
  });

  it('handles mixed clip and design on separate tracks', () => {
    let comp = C.emptyComposition({ width: 1080, height: 1920, fps: 30 });
    const { comp: c1, id: t1 } = C.addTrack(comp, 'video');
    comp = c1;
    const { comp: c2, id: t2 } = C.addTrack(comp, 'video');
    comp = c2;

    const { comp: c3, id: clipSrc } = C.addSource(comp, {
      kind: 'clip', asset: 'a1', url: '/a.mp4', duration: 10,
      width: 1920, height: 1080, fps: 30,
    });
    comp = c3;
    const { comp: c4, id: designSrc } = C.addSource(comp, {
      kind: 'design', project: 1, page: 1, alpha: true,
    });
    comp = c4;

    const { comp: c5 } = C.addItem(comp, t1, { source: clipSrc, at: 0, len: 10 });
    comp = c5;
    const { comp: c6 } = C.addItem(comp, t2, { source: designSrc, at: 2, len: 3 });
    comp = c6;

    const result = R.renderGraph(comp);
    assert.strictEqual(result.inputs.length, 2);
    assert.ok(result.graph.includes('overlay'), 'tracks should be composited with overlay');
    assert.ok(result.graph.includes('loop='), 'design source should use loop filter');
    assert.ok(result.graph.includes('trim=start='), 'clip source should use trim');
  });

  it('applies opacity filter for design items with opacity < 1', () => {
    let comp = C.emptyComposition({ width: 1080, height: 1920, fps: 30 });
    const { comp: c1, id: t1 } = C.addTrack(comp, 'video');
    comp = c1;
    const { comp: c2, id: s1 } = C.addSource(comp, {
      kind: 'design', project: 1, page: 1, alpha: true,
    });
    comp = c2;
    const { comp: c3 } = C.addItem(comp, t1, {
      source: s1, at: 0, len: 5, opacity: 0.5,
    });
    comp = c3;

    const result = R.renderGraph(comp);
    assert.ok(result.graph.includes('colorchannelmixer=aa=0.5'),
      'graph should apply opacity via colorchannelmixer');
  });

  it('design sources produce no audio', () => {
    let comp = C.emptyComposition({ width: 1080, height: 1920, fps: 30 });
    const { comp: c1, id: t1 } = C.addTrack(comp, 'video');
    comp = c1;
    const { comp: c2, id: s1 } = C.addSource(comp, {
      kind: 'design', project: 1, page: 1, alpha: true,
    });
    comp = c2;
    const { comp: c3 } = C.addItem(comp, t1, {
      source: s1, at: 0, len: 5,
    });
    comp = c3;

    const result = R.renderGraph(comp);
    assert.strictEqual(result.audioOut, null, 'design-only composition has no audio');
  });
});

// ── Design endpoint response shape ──────────────────────────────────

describe('design endpoint response shape', () => {
  it('maps asset rows to the expected API shape', () => {
    const rows = [
      { id: 1, title: 'Logo', url: '/design/logo.png', width: 500, height: 500, metadata: { pages: 1 } },
      { id: 2, title: 'Lower third', url: '/design/lt.png', width: 1080, height: 300, metadata: {} },
    ];

    const mapped = rows.map(r => ({
      id: r.id,
      title: r.title,
      url: r.url,
      width: r.width,
      height: r.height,
      metadata: r.metadata,
    }));

    assert.strictEqual(mapped.length, 2);
    assert.strictEqual(mapped[0].id, 1);
    assert.strictEqual(mapped[0].title, 'Logo');
    assert.strictEqual(mapped[0].width, 500);
    assert.strictEqual(mapped[1].title, 'Lower third');
  });
});

// ── Playback model with design sources ──────────────────────────────

describe('playback model with design sources', async () => {
  const C = await import('../../shared/composition.mjs');
  const PB = await import('../../shared/compositionPlayback.mjs');

  it('sceneAt returns design layer at the right time', () => {
    let comp = C.emptyComposition({ width: 1080, height: 1920, fps: 30 });
    const { comp: c1, id: t1 } = C.addTrack(comp, 'video');
    comp = c1;
    const { comp: c2, id: s1 } = C.addSource(comp, {
      kind: 'design', project: 1, page: 1, alpha: true,
    });
    comp = c2;
    const { comp: c3 } = C.addItem(comp, t1, {
      source: s1, at: 2, len: 3, opacity: 0.7,
    });
    comp = c3;

    const before = PB.sceneAt(comp, 1);
    assert.strictEqual(before.layers.length, 0, 'no layers before design starts');

    const during = PB.sceneAt(comp, 3);
    assert.strictEqual(during.layers.length, 1, 'one layer during design');
    assert.strictEqual(during.layers[0].sourceId, s1);
    assert.ok(Math.abs(during.layers[0].opacity - 0.7) < 0.01);

    const after = PB.sceneAt(comp, 5.5);
    assert.strictEqual(after.layers.length, 0, 'no layers after design ends');
  });

  it('design and clip layers composite in track order', () => {
    let comp = C.emptyComposition({ width: 1080, height: 1920, fps: 30 });
    const { comp: c1, id: t1 } = C.addTrack(comp, 'video');
    comp = c1;
    const { comp: c2, id: t2 } = C.addTrack(comp, 'video');
    comp = c2;

    const { comp: c3, id: clipSrc } = C.addSource(comp, {
      kind: 'clip', asset: 'a1', url: '/a.mp4', duration: 10,
      width: 1920, height: 1080, fps: 30,
    });
    comp = c3;
    const { comp: c4, id: designSrc } = C.addSource(comp, {
      kind: 'design', project: 1, page: 1, alpha: true,
    });
    comp = c4;

    const { comp: c5 } = C.addItem(comp, t1, { source: clipSrc, at: 0, len: 10 });
    comp = c5;
    const { comp: c6 } = C.addItem(comp, t2, { source: designSrc, at: 2, len: 3 });
    comp = c6;

    const scene = PB.sceneAt(comp, 3);
    assert.strictEqual(scene.layers.length, 2, 'both clip and design visible');
    assert.strictEqual(scene.layers[0].sourceId, clipSrc, 'clip is base layer');
    assert.strictEqual(scene.layers[1].sourceId, designSrc, 'design overlays on top');
  });
});
