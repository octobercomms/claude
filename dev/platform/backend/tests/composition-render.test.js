/**
 * Composition render graph tests.
 *
 * These test that renderGraph() produces correct ffmpeg filter_complex
 * strings for various composition shapes, without running ffmpeg itself.
 * The graph is string arithmetic over the composition model; the tests
 * assert on structure, not pixel output.
 *
 *   node --test tests/composition-render.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  emptyComposition,
  addSource,
  addTrack,
  addItem,
  secs,
} = require('../../shared/composition.mjs');

const {
  renderGraph,
  ffmpegArgs,
  expectedDuration,
} = require('../../shared/compositionRender.mjs');

// ── helpers ──────────────────────────────────────────────────────────

function f(n) { return secs(n).toFixed(6); }

// ── fixture builders ─────────────────────────────────────────────────

// One 10s clip on one video track, no transitions
function singleClipComp() {
  let comp = emptyComposition({ width: 1080, height: 1920, fps: 30 });
  const s = addSource(comp, { kind: 'clip', asset: 'a.mp4', duration: 10, width: 1920, height: 1080, fps: 30 });
  comp = s.comp;
  const t = addTrack(comp, 'video');
  comp = t.comp;
  const r = addItem(comp, t.id, { at: 0, len: 10, source: s.id, in: 0 });
  comp = r.comp;
  return { comp, sourceId: s.id, trackId: t.id, itemId: r.id };
}

// Two clips on one track, no overlap (hard cut at 5s)
function twoCutComp() {
  let comp = emptyComposition({ width: 1080, height: 1920, fps: 30 });
  const s1 = addSource(comp, { kind: 'clip', asset: 'a.mp4', duration: 10, width: 1920, height: 1080, fps: 30 });
  comp = s1.comp;
  const s2 = addSource(comp, { kind: 'clip', asset: 'b.mp4', duration: 10, width: 1920, height: 1080, fps: 30 });
  comp = s2.comp;
  const t = addTrack(comp, 'video');
  comp = t.comp;
  let r = addItem(comp, t.id, { at: 0, len: 5, source: s1.id, in: 0 });
  comp = r.comp;
  const i1 = r.id;
  r = addItem(comp, t.id, { at: 5, len: 5, source: s2.id, in: 0 });
  comp = r.comp;
  const i2 = r.id;
  return { comp, s1: s1.id, s2: s2.id, trackId: t.id, i1, i2 };
}

// Two clips with a 1s crossfade transition
function crossfadeComp() {
  let comp = emptyComposition({ width: 1080, height: 1920, fps: 30 });
  const s1 = addSource(comp, { kind: 'clip', asset: 'a.mp4', duration: 10, width: 1920, height: 1080, fps: 30 });
  comp = s1.comp;
  const s2 = addSource(comp, { kind: 'clip', asset: 'b.mp4', duration: 10, width: 1920, height: 1080, fps: 30 });
  comp = s2.comp;
  const t = addTrack(comp, 'video');
  comp = t.comp;
  let r = addItem(comp, t.id, { at: 0, len: 6, source: s1.id, in: 0 });
  comp = r.comp;
  const i1 = r.id;
  // Overlaps by 1s (at=5, previous ends at 6)
  r = addItem(comp, t.id, { at: 5, len: 6, source: s2.id, in: 0, trans: { type: 'fade' } });
  comp = r.comp;
  const i2 = r.id;
  return { comp, s1: s1.id, s2: s2.id, trackId: t.id, i1, i2 };
}

// Two video tracks: base (0-10s) and overlay (3-7s)
function twoTrackComp() {
  let comp = emptyComposition({ width: 1080, height: 1920, fps: 30 });
  const s1 = addSource(comp, { kind: 'clip', asset: 'base.mp4', duration: 10, width: 1920, height: 1080, fps: 30 });
  comp = s1.comp;
  const s2 = addSource(comp, { kind: 'clip', asset: 'overlay.mp4', duration: 10, width: 1920, height: 1080, fps: 30 });
  comp = s2.comp;
  const t1 = addTrack(comp, 'video');
  comp = t1.comp;
  const t2 = addTrack(comp, 'video');
  comp = t2.comp;
  let r = addItem(comp, t1.id, { at: 0, len: 10, source: s1.id, in: 0 });
  comp = r.comp;
  r = addItem(comp, t2.id, { at: 3, len: 4, source: s2.id, in: 0 });
  comp = r.comp;
  return { comp, s1: s1.id, s2: s2.id, t1: t1.id, t2: t2.id };
}

// Clip + separate audio track
function clipWithAudioComp() {
  let comp = emptyComposition({ width: 1080, height: 1920, fps: 30 });
  const s1 = addSource(comp, { kind: 'clip', asset: 'a.mp4', duration: 10, width: 1920, height: 1080, fps: 30 });
  comp = s1.comp;
  const s2 = addSource(comp, { kind: 'audio', asset: 'music.mp3', duration: 30 });
  comp = s2.comp;
  const vt = addTrack(comp, 'video');
  comp = vt.comp;
  const at = addTrack(comp, 'audio');
  comp = at.comp;
  let r = addItem(comp, vt.id, { at: 0, len: 10, source: s1.id, in: 0 });
  comp = r.comp;
  r = addItem(comp, at.id, { at: 0, len: 10, source: s2.id, in: 5, gain: 0.5 });
  comp = r.comp;
  return { comp, clipSource: s1.id, audioSource: s2.id };
}

// ── renderGraph: basic ───────────────────────────────────────────────

describe('renderGraph', () => {
  describe('empty composition', () => {
    it('returns empty for a composition with no items', () => {
      const comp = emptyComposition();
      const result = renderGraph(comp);
      assert.equal(result.inputs.length, 0);
      assert.equal(result.graph, '');
      assert.equal(result.duration, 0);
    });
  });

  describe('single clip', () => {
    it('produces one input', () => {
      const { comp } = singleClipComp();
      const result = renderGraph(comp);
      assert.equal(result.inputs.length, 1);
      assert.equal(result.inputs[0].kind, 'clip');
    });

    it('includes trim in the graph', () => {
      const { comp } = singleClipComp();
      const result = renderGraph(comp);
      assert.ok(result.graph.includes('trim=start='));
      assert.ok(result.graph.includes('setpts=PTS-STARTPTS'));
    });

    it('includes scale for cover fit', () => {
      const { comp } = singleClipComp();
      const result = renderGraph(comp);
      assert.ok(result.graph.includes('scale=1080:1920:force_original_aspect_ratio=increase'));
      assert.ok(result.graph.includes('crop=1080:1920'));
    });

    it('includes fps filter', () => {
      const { comp } = singleClipComp();
      const result = renderGraph(comp);
      assert.ok(result.graph.includes('fps=30'));
    });

    it('includes setsar=1 to normalise pixel aspect ratio', () => {
      const { comp } = singleClipComp();
      const result = renderGraph(comp);
      assert.ok(result.graph.includes('setsar=1'));
    });

    it('has a video output pad', () => {
      const { comp } = singleClipComp();
      const result = renderGraph(comp);
      assert.ok(result.videoOut.startsWith('['));
      assert.ok(result.videoOut.endsWith(']'));
    });

    it('reports correct duration', () => {
      const { comp } = singleClipComp();
      const result = renderGraph(comp);
      assert.equal(result.duration, 10);
    });

    it('includes audio from the clip', () => {
      const { comp } = singleClipComp();
      const result = renderGraph(comp);
      assert.ok(result.audioOut, 'should have audio output');
      assert.ok(result.graph.includes('atrim='));
    });
  });

  describe('contain fit', () => {
    it('uses pad instead of crop for contain', () => {
      let comp = emptyComposition({ width: 1080, height: 1920, fps: 30 });
      const s = addSource(comp, { kind: 'clip', asset: 'a.mp4', duration: 5, width: 1920, height: 1080, fps: 30 });
      comp = s.comp;
      const t = addTrack(comp, 'video');
      comp = t.comp;
      const r = addItem(comp, t.id, { at: 0, len: 5, source: s.id, in: 0, fit: 'contain' });
      comp = r.comp;
      const result = renderGraph(comp);
      assert.ok(result.graph.includes('force_original_aspect_ratio=decrease'));
      assert.ok(result.graph.includes('pad=1080:1920'));
      assert.ok(!result.graph.includes('crop='));
    });
  });

  describe('in-point offset', () => {
    it('uses the in-point as the trim start', () => {
      let comp = emptyComposition();
      const s = addSource(comp, { kind: 'clip', asset: 'a.mp4', duration: 30, width: 1920, height: 1080, fps: 30 });
      comp = s.comp;
      const t = addTrack(comp, 'video');
      comp = t.comp;
      const r = addItem(comp, t.id, { at: 0, len: 5, source: s.id, in: 10 });
      comp = r.comp;
      const result = renderGraph(comp);
      assert.ok(result.graph.includes(`trim=start=${f(10)}:duration=${f(5)}`));
    });

    it('does NOT trim from 0 when in-point is non-zero', () => {
      let comp = emptyComposition();
      const s = addSource(comp, { kind: 'clip', asset: 'a.mp4', duration: 30, width: 1920, height: 1080, fps: 30 });
      comp = s.comp;
      const t = addTrack(comp, 'video');
      comp = t.comp;
      const r = addItem(comp, t.id, { at: 0, len: 5, source: s.id, in: 10 });
      comp = r.comp;
      const result = renderGraph(comp);
      // Extract the trim start value from the graph. It must be 10, not 0 in any form.
      const trimMatch = result.graph.match(/trim=start=([^:]+):/);
      assert.ok(trimMatch, 'should have a trim filter');
      const trimStart = parseFloat(trimMatch[1]);
      assert.ok(trimStart >= 9.999, `trim start should be 10 (the in-point), got ${trimStart}`);
    });
  });

  describe('two clips, hard cut', () => {
    it('produces two inputs', () => {
      const { comp } = twoCutComp();
      const result = renderGraph(comp);
      assert.equal(result.inputs.length, 2);
    });

    it('uses overlay for non-overlapping items on same track', () => {
      const { comp } = twoCutComp();
      const result = renderGraph(comp);
      // Non-overlapping items on one track use overlay on a blank canvas
      assert.ok(result.graph.includes('overlay='));
      assert.ok(result.graph.includes('color=c=black'));
    });

    it('reports correct duration of 10s', () => {
      const { comp } = twoCutComp();
      const result = renderGraph(comp);
      assert.equal(result.duration, 10);
    });
  });

  describe('crossfade transition', () => {
    it('uses xfade filter', () => {
      const { comp } = crossfadeComp();
      const result = renderGraph(comp);
      assert.ok(result.graph.includes('xfade=transition=fade'));
    });

    it('xfade duration matches the overlap', () => {
      const { comp } = crossfadeComp();
      const result = renderGraph(comp);
      // Overlap is 1s (item1 ends at 6, item2 starts at 5)
      assert.ok(result.graph.includes(`duration=${f(1)}`));
    });

    it('xfade offset is chainLen minus overlap duration', () => {
      const { comp } = crossfadeComp();
      const result = renderGraph(comp);
      // Item 1 is 6s. Overlap is 1s. So offset should be 6-1 = 5
      assert.ok(result.graph.includes(`offset=${f(5)}`),
        'xfade offset should be chainLen - overlap');
      // And it must NOT have offset=6 (which would be chainLen without subtracting)
      assert.ok(!result.graph.includes(`offset=${f(6)}`),
        'offset must subtract the overlap duration');
    });

    it('reports correct duration (6 + 6 - 1 = 11)', () => {
      const { comp } = crossfadeComp();
      const result = renderGraph(comp);
      assert.equal(result.duration, 11);
    });

    it('shifts the xfade chain to absolute time', () => {
      const { comp } = crossfadeComp();
      const result = renderGraph(comp);
      // The chain starts at t=0 so setpts should shift by 0
      assert.ok(result.graph.includes(`setpts=PTS+${f(0)}/TB`));
    });
  });

  describe('wipeleft transition', () => {
    it('uses the correct xfade transition name', () => {
      let comp = emptyComposition();
      const s1 = addSource(comp, { kind: 'clip', asset: 'a.mp4', duration: 10, width: 1920, height: 1080, fps: 30 });
      comp = s1.comp;
      const s2 = addSource(comp, { kind: 'clip', asset: 'b.mp4', duration: 10, width: 1920, height: 1080, fps: 30 });
      comp = s2.comp;
      const t = addTrack(comp, 'video');
      comp = t.comp;
      let r = addItem(comp, t.id, { at: 0, len: 6, source: s1.id, in: 0 });
      comp = r.comp;
      r = addItem(comp, t.id, { at: 5, len: 6, source: s2.id, in: 0, trans: { type: 'wipeleft' } });
      comp = r.comp;
      const result = renderGraph(comp);
      assert.ok(result.graph.includes('xfade=transition=wipeleft'));
    });
  });

  describe('two video tracks', () => {
    it('produces two inputs', () => {
      const { comp } = twoTrackComp();
      const result = renderGraph(comp);
      assert.equal(result.inputs.length, 2);
    });

    it('uses overlay to composite tracks', () => {
      const { comp } = twoTrackComp();
      const result = renderGraph(comp);
      // Should have overlay for track compositing
      assert.ok(result.graph.includes('overlay='));
    });

    it('reports correct duration of 10s', () => {
      const { comp } = twoTrackComp();
      const result = renderGraph(comp);
      assert.equal(result.duration, 10);
    });
  });

  describe('opacity', () => {
    it('includes colorchannelmixer for items with opacity < 1', () => {
      let comp = emptyComposition();
      const s = addSource(comp, { kind: 'clip', asset: 'a.mp4', duration: 5, width: 1920, height: 1080, fps: 30 });
      comp = s.comp;
      const t = addTrack(comp, 'video');
      comp = t.comp;
      const r = addItem(comp, t.id, { at: 0, len: 5, source: s.id, in: 0, opacity: 0.5 });
      comp = r.comp;
      const result = renderGraph(comp);
      assert.ok(result.graph.includes('colorchannelmixer=aa='));
    });

    it('omits colorchannelmixer when opacity is 1', () => {
      const { comp } = singleClipComp();
      const result = renderGraph(comp);
      assert.ok(!result.graph.includes('colorchannelmixer'));
    });
  });

  describe('audio', () => {
    it('produces audio output for a clip', () => {
      const { comp } = singleClipComp();
      const result = renderGraph(comp);
      assert.ok(result.audioOut);
    });

    it('applies gain to audio items', () => {
      const { comp } = clipWithAudioComp();
      const result = renderGraph(comp);
      assert.ok(result.graph.includes('volume=0.500000'));
    });

    it('uses adelay for audio placed after t=0', () => {
      let comp = emptyComposition();
      const s = addSource(comp, { kind: 'audio', asset: 'music.mp3', duration: 10 });
      comp = s.comp;
      const t = addTrack(comp, 'audio');
      comp = t.comp;
      const r = addItem(comp, t.id, { at: 3, len: 5, source: s.id, in: 0 });
      comp = r.comp;
      const result = renderGraph(comp);
      assert.ok(result.graph.includes('adelay=3000|3000'));
    });

    it('mixes multiple audio sources with amix', () => {
      const { comp } = clipWithAudioComp();
      const result = renderGraph(comp);
      assert.ok(result.graph.includes('amix=inputs=2'));
    });

    it('amix uses normalize=0 to preserve volume levels', () => {
      const { comp } = clipWithAudioComp();
      const result = renderGraph(comp);
      assert.ok(result.graph.includes('normalize=0'),
        'amix must not normalise (normalize=0) or adding a track changes volume');
    });

    it('does not apply gain when gain is 1', () => {
      const { comp } = singleClipComp();
      const result = renderGraph(comp);
      assert.ok(!result.graph.includes('volume='));
    });
  });

  describe('captions', () => {
    it('adds subtitles filter when captionAssPath is provided', () => {
      const { comp } = singleClipComp();
      const result = renderGraph(comp, { captionAssPath: '/tmp/subs.ass' });
      assert.ok(result.graph.includes('subtitles=/tmp/subs.ass'));
      assert.ok(result.needsCaptions);
    });

    it('escapes colons in caption path', () => {
      const { comp } = singleClipComp();
      const result = renderGraph(comp, { captionAssPath: 'C:/tmp/subs.ass' });
      assert.ok(result.graph.includes('subtitles=C\\:/tmp/subs.ass'));
    });

    it('does not add subtitles when no path given', () => {
      const { comp } = singleClipComp();
      const result = renderGraph(comp);
      assert.ok(!result.graph.includes('subtitles='));
      assert.ok(!result.needsCaptions);
    });
  });

  describe('design source', () => {
    it('uses loop for still image sources', () => {
      let comp = emptyComposition();
      const s = addSource(comp, { kind: 'design', project: 'p1', page: 'page1', alpha: true });
      comp = s.comp;
      const t = addTrack(comp, 'video');
      comp = t.comp;
      const r = addItem(comp, t.id, { at: 2, len: 3, source: s.id });
      comp = r.comp;
      const result = renderGraph(comp);
      assert.ok(result.graph.includes('loop='));
      assert.ok(result.graph.includes(`trim=duration=${f(3)}`));
    });
  });
});

// ── ffmpegArgs ───────────────────────────────────────────────────────

describe('ffmpegArgs', () => {
  it('produces valid ffmpeg arguments', () => {
    const { comp } = singleClipComp();
    const result = renderGraph(comp);
    const paths = ['a.mp4'];
    const args = ffmpegArgs(result, paths, 'out.mp4');
    assert.ok(args.includes('-y'));
    assert.ok(args.includes('-i'));
    assert.ok(args.includes('a.mp4'));
    assert.ok(args.includes('-filter_complex'));
    assert.ok(args.includes('-c:v'));
    assert.ok(args.includes('libx264'));
    assert.ok(args.includes('out.mp4'));
  });

  it('includes audio codec when audio is present', () => {
    const { comp } = singleClipComp();
    const result = renderGraph(comp);
    const args = ffmpegArgs(result, ['a.mp4'], 'out.mp4');
    assert.ok(args.includes('-c:a'));
    assert.ok(args.includes('aac'));
  });

  it('omits audio codec when no audio', () => {
    let comp = emptyComposition();
    const s = addSource(comp, { kind: 'design', project: 'p1', page: 'page1', alpha: true });
    comp = s.comp;
    const t = addTrack(comp, 'video');
    comp = t.comp;
    const r = addItem(comp, t.id, { at: 0, len: 5, source: s.id });
    comp = r.comp;
    const result = renderGraph(comp);
    const args = ffmpegArgs(result, ['design.png'], 'out.mp4');
    assert.ok(!args.includes('-c:a'));
  });

  it('includes multiple -i flags for multiple inputs', () => {
    const { comp } = twoCutComp();
    const result = renderGraph(comp);
    const args = ffmpegArgs(result, ['a.mp4', 'b.mp4'], 'out.mp4');
    const inputCount = args.filter(a => a === '-i').length;
    assert.equal(inputCount, 2);
  });

  it('respects custom preset and crf', () => {
    const { comp } = singleClipComp();
    const result = renderGraph(comp);
    const args = ffmpegArgs(result, ['a.mp4'], 'out.mp4', { preset: 'slow', crf: 18 });
    assert.ok(args.includes('slow'));
    assert.ok(args.includes('18'));
  });
});

// ── expectedDuration ─────────────────────────────────────────────────

describe('expectedDuration', () => {
  it('returns 0 for empty composition', () => {
    assert.equal(expectedDuration(emptyComposition()), 0);
  });

  it('returns the end of the last item', () => {
    const { comp } = singleClipComp();
    assert.equal(expectedDuration(comp), 10);
  });

  it('accounts for items starting after t=0', () => {
    let comp = emptyComposition();
    const s = addSource(comp, { kind: 'clip', asset: 'a.mp4', duration: 10, width: 1920, height: 1080, fps: 30 });
    comp = s.comp;
    const t = addTrack(comp, 'video');
    comp = t.comp;
    const r = addItem(comp, t.id, { at: 5, len: 10, source: s.id, in: 0 });
    comp = r.comp;
    assert.equal(expectedDuration(comp), 15);
  });

  it('returns the maximum across all tracks', () => {
    const { comp } = twoTrackComp();
    assert.equal(expectedDuration(comp), 10);
  });
});

// ── round-trip: graph structure ──────────────────────────────────────

describe('graph structure', () => {
  it('every pad referenced as input is defined as output', () => {
    const { comp } = crossfadeComp();
    const result = renderGraph(comp);
    // Extract all pad references: [name] appearing after a ] (as input)
    const outputPads = new Set();
    const inputPads = new Set();
    for (const part of result.graph.split(';')) {
      // Output pads: [name] at the end of a filter
      const outMatch = part.match(/\[([^\]]+)\]$/);
      if (outMatch) outputPads.add(outMatch[1]);
      // Input pads: [name] at the start or between filters
      const inMatches = part.match(/^\[([^\]]+)\]/g) || [];
      for (const m of inMatches) {
        const name = m.slice(1, -1);
        // Skip numeric input references like 0:v, 1:a
        if (!/^\d+:[va]$/.test(name)) inputPads.add(name);
      }
    }
    // Every internal pad used as input should be defined as output
    for (const pad of inputPads) {
      assert.ok(outputPads.has(pad) || /^\d+:[va]$/.test(pad),
        `pad [${pad}] used as input but never defined as output`);
    }
  });

  it('graph is semicolon-separated filter chain', () => {
    const { comp } = twoCutComp();
    const result = renderGraph(comp);
    const parts = result.graph.split(';');
    assert.ok(parts.length > 1, 'should have multiple filter stages');
    for (const part of parts) {
      assert.ok(part.length > 0, 'no empty filter stages');
    }
  });
});
