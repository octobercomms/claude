const { describe, it } = require('node:test');
const assert = require('assert');

// ESM import from CJS test
async function load() {
  const mod = await import('../../shared/compositionPlayback.mjs');
  return mod;
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

function fadeblackComp() {
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
        { id: 'i2', at: 5, len: 8, source: 's2', in: 0, trans: { type: 'fadeblack' } },
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

function clipWithAudioComp() {
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

// ── sceneAt tests ────────────────────────────────────────────────────

describe('compositionPlayback', async () => {
  const PB = await load();

  describe('sceneAt', () => {
    it('returns empty layers outside any item', () => {
      const comp = singleClipComp();
      const scene = PB.sceneAt(comp, 15);
      assert.strictEqual(scene.layers.length, 0);
    });

    it('returns one layer for a single clip', () => {
      const comp = singleClipComp();
      const scene = PB.sceneAt(comp, 3);
      assert.strictEqual(scene.layers.length, 1);
      assert.strictEqual(scene.layers[0].item.id, 'i1');
      assert.strictEqual(scene.layers[0].sourceTime, 3);
      assert.strictEqual(scene.layers[0].opacity, 1);
    });

    it('maps source time with in-point offset', () => {
      const comp = inPointComp();
      const scene = PB.sceneAt(comp, 2);
      assert.strictEqual(scene.layers.length, 1);
      assert.strictEqual(scene.layers[0].sourceTime, 12);
    });

    it('returns one layer at a time in a hard cut', () => {
      const comp = twoCutComp();
      const scene3 = PB.sceneAt(comp, 3);
      assert.strictEqual(scene3.layers.length, 1);
      assert.strictEqual(scene3.layers[0].item.id, 'i1');

      const scene7 = PB.sceneAt(comp, 7);
      assert.strictEqual(scene7.layers.length, 1);
      assert.strictEqual(scene7.layers[0].item.id, 'i2');
    });

    it('returns two layers during a crossfade', () => {
      const comp = crossfadeComp();
      const scene = PB.sceneAt(comp, 5.5);
      assert.strictEqual(scene.layers.length, 2);
      assert.strictEqual(scene.layers[0].item.id, 'i1');
      assert.strictEqual(scene.layers[1].item.id, 'i2');
    });

    it('crossfade blend is linear: midpoint is 0.5', () => {
      const comp = crossfadeComp();
      const scene = PB.sceneAt(comp, 5.5); // midpoint of 5..6 overlap
      const outgoing = scene.layers.find(l => l.item.id === 'i1');
      const incoming = scene.layers.find(l => l.item.id === 'i2');
      assert.ok(Math.abs(outgoing.opacity - 0.5) < 0.01, `outgoing opacity ${outgoing.opacity}`);
      assert.ok(Math.abs(incoming.opacity - 0.5) < 0.01, `incoming opacity ${incoming.opacity}`);
    });

    it('crossfade start: outgoing=1, incoming=0', () => {
      const comp = crossfadeComp();
      const scene = PB.sceneAt(comp, 5.001);
      const outgoing = scene.layers.find(l => l.item.id === 'i1');
      const incoming = scene.layers.find(l => l.item.id === 'i2');
      assert.ok(outgoing.opacity > 0.99, `outgoing should be ~1 at start: ${outgoing.opacity}`);
      assert.ok(incoming.opacity < 0.01, `incoming should be ~0 at start: ${incoming.opacity}`);
    });

    it('crossfade end: outgoing=0, incoming=1', () => {
      const comp = crossfadeComp();
      const scene = PB.sceneAt(comp, 5.999);
      const outgoing = scene.layers.find(l => l.item.id === 'i1');
      const incoming = scene.layers.find(l => l.item.id === 'i2');
      assert.ok(outgoing.opacity < 0.01, `outgoing should be ~0 at end: ${outgoing.opacity}`);
      assert.ok(incoming.opacity > 0.99, `incoming should be ~1 at end: ${incoming.opacity}`);
    });

    it('fadeblack: both at 0 opacity at midpoint', () => {
      const comp = fadeblackComp();
      const scene = PB.sceneAt(comp, 5.5); // midpoint of 5..6 overlap
      const outgoing = scene.layers.find(l => l.item.id === 'i1');
      const incoming = scene.layers.find(l => l.item.id === 'i2');
      assert.ok(outgoing.opacity < 0.01, `outgoing should be ~0 at fadeblack mid: ${outgoing.opacity}`);
      assert.ok(incoming.opacity < 0.01, `incoming should be ~0 at fadeblack mid: ${incoming.opacity}`);
    });

    it('fadeblack first quarter: outgoing fading, incoming dark', () => {
      const comp = fadeblackComp();
      const scene = PB.sceneAt(comp, 5.25); // 25% through overlap
      const outgoing = scene.layers.find(l => l.item.id === 'i1');
      const incoming = scene.layers.find(l => l.item.id === 'i2');
      assert.ok(outgoing.opacity > 0.4 && outgoing.opacity < 0.6, `outgoing ~0.5: ${outgoing.opacity}`);
      assert.strictEqual(incoming.opacity, 0);
    });

    it('fadeblack third quarter: outgoing dark, incoming fading', () => {
      const comp = fadeblackComp();
      const scene = PB.sceneAt(comp, 5.75); // 75% through overlap
      const outgoing = scene.layers.find(l => l.item.id === 'i1');
      const incoming = scene.layers.find(l => l.item.id === 'i2');
      assert.strictEqual(outgoing.opacity, 0);
      assert.ok(incoming.opacity > 0.4 && incoming.opacity < 0.6, `incoming ~0.5: ${incoming.opacity}`);
    });

    it('two tracks: both layers present, correct order', () => {
      const comp = twoTrackComp();
      const scene = PB.sceneAt(comp, 3);
      assert.strictEqual(scene.layers.length, 2);
      assert.strictEqual(scene.layers[0].trackIndex, 0); // base first
      assert.strictEqual(scene.layers[1].trackIndex, 1); // overlay on top
      assert.strictEqual(scene.layers[1].opacity, 0.8);
    });

    it('two tracks: only base visible outside overlay range', () => {
      const comp = twoTrackComp();
      const scene = PB.sceneAt(comp, 0.5);
      assert.strictEqual(scene.layers.length, 1);
      assert.strictEqual(scene.layers[0].item.id, 'i1');
    });

    it('source time is correct for overlaid item', () => {
      const comp = twoTrackComp();
      const scene = PB.sceneAt(comp, 4); // overlay at: 2, so source time is 2
      const overlay = scene.layers.find(l => l.item.id === 'i2');
      assert.strictEqual(overlay.sourceTime, 2);
    });
  });

  // ── audioAt tests ──────────────────────────────────────────────────

  describe('audioAt', () => {
    it('returns clip audio with gain', () => {
      const comp = clipWithAudioComp();
      const audio = PB.audioAt(comp, 3);
      const clip = audio.find(a => a.item.id === 'i1');
      assert.ok(clip, 'clip audio should be present');
      assert.strictEqual(clip.gain, 1.5);
      assert.strictEqual(clip.sourceTime, 3);
    });

    it('returns music track with in-point offset', () => {
      const comp = clipWithAudioComp();
      const audio = PB.audioAt(comp, 3);
      const music = audio.find(a => a.item.id === 'i2');
      assert.ok(music, 'music audio should be present');
      assert.strictEqual(music.gain, 0.6);
      assert.strictEqual(music.sourceTime, 8); // in:5 + t:3
    });

    it('returns empty outside item range', () => {
      const comp = clipWithAudioComp();
      const audio = PB.audioAt(comp, 15);
      assert.strictEqual(audio.length, 0);
    });
  });

  // ── cueAt tests ────────────────────────────────────────────────────

  describe('cueAt', () => {
    it('returns null at a gap', () => {
      const comp = singleClipComp();
      assert.strictEqual(PB.cueAt(comp, 15), null);
    });

    it('returns primary for a single clip', () => {
      const comp = singleClipComp();
      const cue = PB.cueAt(comp, 3);
      assert.strictEqual(cue.primary.item.id, 'i1');
      assert.strictEqual(cue.secondary, null);
    });

    it('returns both primary and secondary during a transition', () => {
      const comp = crossfadeComp();
      const cue = PB.cueAt(comp, 5.5);
      assert.ok(cue.primary, 'should have primary');
      assert.ok(cue.secondary, 'should have secondary during transition');
    });
  });

  // ── prerollAt tests ────────────────────────────────────────────────

  describe('prerollAt', () => {
    it('returns next item within lookahead', () => {
      const comp = twoCutComp();
      const pre = PB.prerollAt(comp, 4);
      assert.ok(pre, 'should find item starting at 5');
      assert.strictEqual(pre.item.id, 'i2');
    });

    it('returns null when nothing is within lookahead', () => {
      const comp = twoCutComp();
      const pre = PB.prerollAt(comp, 0);
      assert.strictEqual(pre, null);
    });

    it('does not return currently active items', () => {
      const comp = singleClipComp();
      const pre = PB.prerollAt(comp, 3);
      assert.strictEqual(pre, null);
    });
  });

  // ── stepFrame tests ────────────────────────────────────────────────

  describe('stepFrame', () => {
    it('steps forward one frame', () => {
      const comp = singleClipComp();
      const next = PB.stepFrame(comp, 1, 1, 30);
      assert.ok(Math.abs(next - (1 + 1/30)) < 1e-6);
    });

    it('steps backward one frame', () => {
      const comp = singleClipComp();
      const prev = PB.stepFrame(comp, 1, -1, 30);
      assert.ok(Math.abs(prev - (1 - 1/30)) < 1e-6);
    });

    it('clamps to zero', () => {
      const comp = singleClipComp();
      const clamped = PB.stepFrame(comp, 0, -1, 30);
      assert.strictEqual(clamped, 0);
    });

    it('clamps to duration', () => {
      const comp = singleClipComp();
      const clamped = PB.stepFrame(comp, 10, 1, 30);
      assert.strictEqual(clamped, 10);
    });
  });

  // ── timecode tests ─────────────────────────────────────────────────

  describe('timecode', () => {
    it('formats with frames when fps given', () => {
      assert.strictEqual(PB.timecode(62.5, 30), '01:02:15');
    });

    it('formats with centiseconds when no fps', () => {
      assert.strictEqual(PB.timecode(62.5), '01:02.50');
    });

    it('handles zero', () => {
      assert.strictEqual(PB.timecode(0, 30), '00:00:00');
    });
  });
});
