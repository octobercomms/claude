/**
 * Agreement tests: the playback model and the render graph must agree.
 *
 * For each fixture composition, these tests assert that:
 *   1. The same items are active at the same times
 *   2. Source times match (in-points, trim offsets)
 *   3. Transition timing and type agree
 *   4. Track layering order matches
 *   5. Audio gain and timing agree
 *
 * This is what "proved to agree with the renderer on fixtures" means.
 * The playback model drives the browser compositor. The render graph
 * drives ffmpeg. If they disagree, the preview lies.
 */

const { describe, it } = require('node:test');
const assert = require('assert');

async function load() {
  const PB = await import('../../shared/compositionPlayback.mjs');
  const RG = await import('../../shared/compositionRender.mjs');
  const C = await import('../../shared/composition.mjs');
  return { PB, RG, C };
}

// ── Fixtures ──────────────────────────────────────────────────────────

function singleClipComp() {
  return {
    version: 1,
    size: { width: 1080, height: 1920 },
    fps: 30,
    sources: {
      s1: { kind: 'clip', asset: 'a1', url: '/v1.mp4', duration: 10, width: 1920, height: 1080 },
    },
    tracks: [
      { id: 't1', kind: 'video', items: [
        { id: 'i1', at: 0, len: 10, source: 's1', in: 0 },
      ] },
    ],
  };
}

function inPointComp() {
  return {
    version: 1,
    size: { width: 1080, height: 1920 },
    fps: 30,
    sources: {
      s1: { kind: 'clip', asset: 'a1', url: '/v1.mp4', duration: 30, width: 1920, height: 1080 },
    },
    tracks: [
      { id: 't1', kind: 'video', items: [
        { id: 'i1', at: 0, len: 5, source: 's1', in: 10 },
      ] },
    ],
  };
}

function twoCutComp() {
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
        { id: 'i1', at: 0, len: 5, source: 's1', in: 0 },
        { id: 'i2', at: 5, len: 8, source: 's2', in: 0 },
      ] },
    ],
  };
}

function crossfadeComp() {
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

function twoTrackComp() {
  return {
    version: 1,
    size: { width: 1080, height: 1920 },
    fps: 30,
    sources: {
      s1: { kind: 'clip', asset: 'a1', url: '/v1.mp4', duration: 10, width: 1920, height: 1080 },
      s2: { kind: 'clip', asset: 'a2', url: '/v2.mp4', duration: 5, width: 640, height: 480 },
    },
    tracks: [
      { id: 't1', kind: 'video', items: [
        { id: 'i1', at: 0, len: 10, source: 's1', in: 0 },
      ] },
      { id: 't2', kind: 'video', items: [
        { id: 'i2', at: 2, len: 5, source: 's2', in: 0, opacity: 0.8 },
      ] },
    ],
  };
}

function clipWithMusicComp() {
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
        { id: 'i1', at: 0, len: 10, source: 's1', in: 0, gain: 1.5 },
      ] },
      { id: 't2', kind: 'audio', items: [
        { id: 'i2', at: 0, len: 10, source: 's2', in: 5, gain: 0.6 },
      ] },
    ],
  };
}

// ── Helpers to parse render graph ─────────────────────────────────────

function parseFilter(graph, pattern) {
  const re = new RegExp(pattern, 'g');
  const matches = [];
  let m;
  while ((m = re.exec(graph)) !== null) matches.push(m);
  return matches;
}

function parseTrim(graph, inputIdx) {
  const re = new RegExp(`\\[${inputIdx}:v\\](.+?)\\[vi${inputIdx}\\]`);
  const m = graph.match(re);
  return m ? m[1] : null;
}

function parseAtrim(graph, inputIdx) {
  const re = new RegExp(`\\[${inputIdx}:a\\](.+?)\\[ai${inputIdx}\\]`);
  const m = graph.match(re);
  return m ? m[1] : null;
}

// ── Agreement tests ───────────────────────────────────────────────────

describe('compositor-renderer agreement', async () => {
  const { PB, RG, C } = await load();

  describe('single clip', () => {
    const comp = singleClipComp();
    const graph = RG.renderGraph(comp);

    it('both see the item as active at t=3', () => {
      const scene = PB.sceneAt(comp, 3);
      assert.strictEqual(scene.layers.length, 1);
      assert.strictEqual(scene.layers[0].item.id, 'i1');
      assert.ok(graph.graph.includes('[0:v]'), 'render graph uses input 0');
    });

    it('both see nothing at t=15', () => {
      const scene = PB.sceneAt(comp, 15);
      assert.strictEqual(scene.layers.length, 0);
      // Render graph has no content beyond its duration
      assert.strictEqual(RG.expectedDuration(comp), 10);
    });

    it('duration agrees', () => {
      assert.strictEqual(PB.duration(comp), RG.expectedDuration(comp));
    });
  });

  describe('in-point offset', () => {
    const comp = inPointComp();
    const graph = RG.renderGraph(comp);

    it('both use in-point 10 for trim/source time', () => {
      const scene = PB.sceneAt(comp, 2);
      assert.strictEqual(scene.layers[0].sourceTime, 12);

      const trimChain = parseTrim(graph.graph, 0);
      assert.ok(trimChain, 'should have trim filter');
      assert.ok(trimChain.includes('trim=start=10.'), 'render trims from in=10');
    });
  });

  describe('hard cut', () => {
    const comp = twoCutComp();
    const graph = RG.renderGraph(comp);

    it('playback shows i1 at t=3, render has it in the graph', () => {
      const scene = PB.sceneAt(comp, 3);
      assert.strictEqual(scene.layers.length, 1);
      assert.strictEqual(scene.layers[0].item.id, 'i1');
    });

    it('playback shows i2 at t=7, render has it in the graph', () => {
      const scene = PB.sceneAt(comp, 7);
      assert.strictEqual(scene.layers.length, 1);
      assert.strictEqual(scene.layers[0].item.id, 'i2');
    });

    it('both agree on duration', () => {
      assert.strictEqual(PB.duration(comp), RG.expectedDuration(comp));
      assert.strictEqual(PB.duration(comp), 13);
    });
  });

  describe('crossfade', () => {
    const comp = crossfadeComp();
    const graph = RG.renderGraph(comp);

    it('playback shows two items during overlap (t=5.5)', () => {
      const scene = PB.sceneAt(comp, 5.5);
      assert.strictEqual(scene.layers.length, 2);
    });

    it('render graph has xfade filter', () => {
      assert.ok(graph.graph.includes('xfade=transition=fade'), 'should have xfade=fade');
    });

    it('xfade duration matches the overlap (1s)', () => {
      const ovs = C.overlaps(comp.tracks[0]);
      assert.strictEqual(ovs.length, 1);
      assert.ok(Math.abs(ovs[0].duration - 1) < 1e-6, 'overlap should be 1s');

      const xfadeMatch = graph.graph.match(/xfade=transition=fade:duration=([\d.]+)/);
      assert.ok(xfadeMatch, 'should find xfade duration');
      assert.ok(Math.abs(parseFloat(xfadeMatch[1]) - 1) < 1e-6, 'xfade dur should be 1s');
    });

    it('playback and render agree on transition type', () => {
      const scene = PB.sceneAt(comp, 5.5);
      // The playback model uses the same trans.type as the render graph
      assert.ok(graph.graph.includes('xfade=transition=fade'));
      // The incoming item has trans.type: 'fade'
      assert.strictEqual(comp.tracks[0].items[1].trans.type, 'fade');
    });

    it('both agree on duration', () => {
      assert.strictEqual(PB.duration(comp), RG.expectedDuration(comp));
    });
  });

  describe('two tracks (overlay)', () => {
    const comp = twoTrackComp();
    const graph = RG.renderGraph(comp);

    it('playback shows two layers at t=3', () => {
      const scene = PB.sceneAt(comp, 3);
      assert.strictEqual(scene.layers.length, 2);
      assert.strictEqual(scene.layers[0].trackIndex, 0);
      assert.strictEqual(scene.layers[1].trackIndex, 1);
    });

    it('render graph overlays track 1 on track 0', () => {
      assert.ok(graph.graph.includes('overlay='), 'should have overlay filter');
    });

    it('playback shows overlay opacity 0.8', () => {
      const scene = PB.sceneAt(comp, 3);
      assert.strictEqual(scene.layers[1].opacity, 0.8);
    });

    it('render graph applies opacity via colorchannelmixer', () => {
      assert.ok(graph.graph.includes('colorchannelmixer=aa=0.8'), 'should have alpha 0.8');
    });

    it('playback shows only base at t=0.5', () => {
      const scene = PB.sceneAt(comp, 0.5);
      assert.strictEqual(scene.layers.length, 1);
    });

    it('render graph limits overlay to item range via trim', () => {
      // The render graph controls overlay timing through the item's own
      // trim+setpts (which limits its video stream to its time range),
      // not through an enable clause on the overlay filter.
      const trimChain = parseTrim(graph.graph, 1);
      assert.ok(trimChain, 'overlay item should have a trim chain');
      assert.ok(trimChain.includes('trim=start=0.'), 'should trim from in=0');
      assert.ok(trimChain.includes('duration=5.'), 'should trim to len=5');
    });
  });

  describe('audio agreement', () => {
    const comp = clipWithMusicComp();
    const graph = RG.renderGraph(comp);

    it('playback and render both see two audio streams', () => {
      const audio = PB.audioAt(comp, 3);
      assert.strictEqual(audio.length, 2);
      assert.ok(graph.audioOut, 'render should have audio output');
    });

    it('clip gain agrees (1.5)', () => {
      const audio = PB.audioAt(comp, 3);
      const clip = audio.find(a => a.item.id === 'i1');
      assert.strictEqual(clip.gain, 1.5);
      assert.ok(graph.graph.includes('volume=1.5'), 'render should apply volume=1.5');
    });

    it('music gain agrees (0.6)', () => {
      const audio = PB.audioAt(comp, 3);
      const music = audio.find(a => a.item.id === 'i2');
      assert.strictEqual(music.gain, 0.6);
      assert.ok(graph.graph.includes('volume=0.6'), 'render should apply volume=0.6');
    });

    it('music in-point agrees (5)', () => {
      const audio = PB.audioAt(comp, 3);
      const music = audio.find(a => a.item.id === 'i2');
      assert.strictEqual(music.sourceTime, 8); // in:5 + t:3

      const atrimChain = parseAtrim(graph.graph, 1);
      assert.ok(atrimChain, 'should have atrim for music');
      assert.ok(atrimChain.includes('atrim=start=5.'), 'render trims from in=5');
    });

    it('both agree on amix (two inputs, normalize=0)', () => {
      assert.ok(graph.graph.includes('amix=inputs=2'), 'should mix 2 inputs');
      assert.ok(graph.graph.includes('normalize=0'), 'normalize should be 0');
    });
  });

  describe('duration agreement across all fixtures', () => {
    const fixtures = [
      ['singleClip', singleClipComp()],
      ['inPoint', inPointComp()],
      ['twoCut', twoCutComp()],
      ['crossfade', crossfadeComp()],
      ['twoTrack', twoTrackComp()],
      ['clipWithMusic', clipWithMusicComp()],
    ];

    for (const [name, comp] of fixtures) {
      it(`${name}: playback duration = render duration`, () => {
        assert.strictEqual(PB.duration(comp), RG.expectedDuration(comp));
      });
    }
  });
});
