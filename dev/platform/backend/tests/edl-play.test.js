/**
 * Guards on playing an edit back.
 *
 * The thing these protect is one promise: the preview never shows a frame the
 * render will not contain. Every assertion here is a way that promise gets
 * broken — a hand-off that lands wherever the element was rather than on the
 * next block's in-point, a frame step that walks off the end of a clip, a
 * cross-fade drawn as a cut with nothing said, a boosted block previewed at
 * the volume cap.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SHARED = path.join(__dirname, '..', '..', 'shared');
let P, E;
test.before(async () => {
  P = await import(pathToFileURL(path.join(SHARED, 'edlPlay.mjs')).href);
  E = await import(pathToFileURL(path.join(SHARED, 'edl.mjs')).href);
});

// Three clips, ten seconds each, so a block's source time and its timeline
// time are never accidentally equal and a mix-up shows up.
const CLIPS = [
  { id: 'a', url: 'a.mp4', duration: 10 },
  { id: 'b', url: 'b.mp4', duration: 10 },
  { id: 'c', url: 'c.mp4', duration: 10 },
];

function edlOf(items) {
  return E.normalise({ version: E.EDL_VERSION, items }, CLIPS);
}

// Block 0: clip 0, 2s–5s  (timeline 0–3)
// Block 1: clip 1, 1s–4s  (timeline 3–6)
// Block 2: clip 2, 0s–2s  (timeline 6–8)
const THREE = () => edlOf([
  { clip: 0, in: 2, out: 5 },
  { clip: 1, in: 1, out: 4 },
  { clip: 2, in: 0, out: 2 },
]);

// ---- which clip, and where inside it -----------------------------------

test('a timeline time maps to the clip and the point inside it', () => {
  const edl = THREE();
  const cue = P.cueAt(edl, 4);
  assert.equal(cue.clip, 1, 'four seconds in is the second block');
  assert.equal(cue.sourceTime, 2, 'one second into a block that starts at 1s in its clip');
  assert.equal(cue.start, 3);
  assert.equal(cue.end, 6);
});

test('the first frame of a block is the block in-point, not zero', () => {
  // The hand-off bug this exists to stop: resuming the next element wherever
  // it happened to be rather than at the point the edit asks for.
  const edl = THREE();
  assert.equal(P.cueAt(edl, 3).sourceTime, 1, 'block 1 opens at 1s in its clip');
  assert.equal(P.cueAt(edl, 6).sourceTime, 0, 'block 2 opens at 0s in its clip');
});

test('the very end of the edit holds the last block rather than nothing', () => {
  const edl = THREE();
  const cue = P.cueAt(edl, 8);
  assert.ok(cue, 'a player paused at its own end still needs a frame to hold');
  assert.equal(cue.clip, 2);
});

test('a time past the end still resolves, and clamping keeps it in range', () => {
  const edl = THREE();
  assert.equal(P.clampToEdit(edl, 99), 8);
  assert.equal(P.clampToEdit(edl, -5), 0);
  assert.equal(P.clampToEdit(edlOf([]), 4), 0, 'an empty edit has nowhere to be');
});

test('an empty edit has no cue at all', () => {
  assert.equal(P.cueAt(edlOf([]), 0), null);
});

// ---- the round trip ----------------------------------------------------

test('source time and timeline time are inverses of each other', () => {
  const edl = THREE();
  for (const t of [0, 1.5, 3, 4.25, 6, 7.9]) {
    const cue = P.cueAt(edl, t);
    assert.ok(Math.abs(P.timelineTime(cue, cue.sourceTime) - t) < 1e-6,
      `round trip failed at ${t}: got ${P.timelineTime(cue, cue.sourceTime)}`);
  }
});

test('the playhead is derived from the frame shown, not from a clock', () => {
  // The element reports 3.4s inside clip 1; that is 2.4s along the timeline.
  const edl = THREE();
  const cue = P.cueAt(edl, 4);
  assert.equal(P.timelineTime(cue, 3.4), 5.4);
});

// ---- hand-offs ---------------------------------------------------------

test('reaching a block out-point is what ends it', () => {
  const edl = THREE();
  const cue = P.cueAt(edl, 4);
  assert.equal(P.reachedEnd(cue, 3.9), false);
  assert.equal(P.reachedEnd(cue, 4), true, 'the out point itself is the end');
  assert.equal(P.reachedEnd(cue, 4.5), true);
});

test('a block whose length is still unknown never reports an end', () => {
  // A clip whose duration has not arrived yet has out = null. Treating that
  // as "ended" would hand off immediately and skip the clip entirely.
  const edl = E.normalise({ version: E.EDL_VERSION, items: [{ clip: 0, in: 0, out: null }] },
    [{ id: 'a', url: 'a.mp4', duration: null }]);
  const cue = P.cueAt(edl, 0) || { outPoint: edl.items[0].out, start: 0, inPoint: 0 };
  assert.equal(edl.items[0].out, null, 'a clip still being probed has no out point yet');
  assert.equal(P.reachedEnd(cue, 50), false);
});

test('the next event is the next block boundary, and null at the end', () => {
  const edl = THREE();
  assert.equal(P.nextEventAt(edl, 0), 3);
  assert.equal(P.nextEventAt(edl, 3), 6);
  assert.equal(P.nextEventAt(edl, 6), 8, 'the last event is the edit ending');
  assert.equal(P.nextEventAt(edl, 8), null);
});

test('the spare element is loaded before the hand-off, not at it', () => {
  const edl = THREE();
  const pre = P.prerollAt(edl, 0, 1.2);
  assert.equal(pre.at, 1.8, 'block 1 starts at 3s, so preparing starts at 1.8s');
  assert.equal(pre.due, false, 'not yet, at time zero');
  assert.equal(pre.cue.clip, 1);
  assert.equal(pre.cue.sourceTime, 1, 'and it is seeked to the next block in-point');
  assert.equal(P.prerollAt(edl, 2, 1.2).due, true);
});

test('a pre-roll never starts before the block it is inside', () => {
  // A block shorter than the lead would otherwise ask to preload at a
  // negative time, or during the block before it.
  const edl = edlOf([{ clip: 0, in: 0, out: 0.4 }, { clip: 1, in: 0, out: 3 }]);
  const pre = P.prerollAt(edl, 0, 1.2);
  assert.equal(pre.at, 0, 'clamped to the start of the block you are in');
});

test('the last block has nothing to pre-roll', () => {
  assert.equal(P.prerollAt(THREE(), 7), null);
});

// ---- cross-fades -------------------------------------------------------

// One edit, then the transition set on its own block: `normalise` mints a
// fresh id per call, so `setTransition(THREE(), THREE().items[1].id)` names a
// block that does not exist in the edit being changed.
const FADED = () => { const base = THREE(); return E.setTransition(base, base.items[1].id, 'fade', 1); };

test('outside a transition exactly one clip is on screen', () => {
  const scene = P.sceneAt(THREE(), 1);
  assert.equal(scene.incoming, null);
  assert.equal(scene.blend, 0);
  assert.equal(scene.type, 'cut');
});

test('inside a cross-fade both clips are on screen, with the blend', () => {
  const edl = FADED();
  const list = P.rows(edl);
  const overlapStart = list[1].start;
  const dur = 1;

  const early = P.sceneAt(edl, overlapStart + 0.01);
  assert.ok(early.incoming, 'the incoming clip is on screen during the overlap');
  assert.equal(early.main.clip, 0);
  assert.equal(early.incoming.clip, 1);
  assert.ok(early.blend < 0.05, `blend starts at 0, got ${early.blend}`);

  const late = P.sceneAt(edl, overlapStart + dur - 0.01);
  assert.ok(late.blend > 0.95, `blend ends at 1, got ${late.blend}`);
});

test('the incoming clip is seeked into its own source, not to its in-point', () => {
  // Half a second into a one-second fade, the incoming clip is already half a
  // second past its in-point — it is playing, not waiting.
  const edl = FADED();
  const overlapStart = P.rows(edl)[1].start;
  const scene = P.sceneAt(edl, overlapStart + 0.5);
  assert.ok(Math.abs(scene.incoming.sourceTime - 1.5) < 1e-6,
    `expected 1.5s into clip 1, got ${scene.incoming.sourceTime}`);
});

test('a fade, a dissolve and a fade-through-black are drawn; a wipe is not', () => {
  assert.equal(P.canDraw('fade'), true);
  assert.equal(P.canDraw('dissolve'), true);
  assert.equal(P.canDraw('fadeblack'), true);
  assert.equal(P.canDraw('wipeleft'), false,
    'the easing would be this component guessing at ffmpeg, so it is not claimed');
  assert.equal(P.canDraw('cut'), false);
});

test('a transition the preview cannot draw still says which one it is', () => {
  const base = THREE();
  const edl = E.setTransition(base, base.items[1].id, 'wipeleft', 0.8);
  const scene = P.sceneAt(edl, P.rows(edl)[1].start + 0.4);
  assert.equal(scene.type, 'wipeleft');
  assert.equal(scene.drawable, false, 'so the player can name it rather than imply a cut');
  assert.ok(scene.incoming, 'and the next clip is still the one arriving');
});

test('a cut between blocks is not a transition', () => {
  const edl = THREE();
  const scene = P.sceneAt(edl, 2.99);
  assert.equal(scene.incoming, null, 'nothing overlaps across a plain cut');
});

// ---- frame stepping ----------------------------------------------------

// A step is counted in frames of the clip, from the frame the playhead is
// in to the next one. These assertions are written that way rather than as
// "t plus a thirtieth" because that is the thing that has to be true.
const frameAt = (edl, t, fps) => {
  const cue = P.cueAt(edl, t);
  return cue ? P.frameIndex(cue.sourceTime, fps) : null;
};

test('a step forward moves exactly one frame at the clip rate', () => {
  const edl = THREE();
  const at = P.stepFrame(edl, 1, +1, () => 25);
  assert.equal(frameAt(edl, at, 25), frameAt(edl, 1, 25) + 1,
    `one frame on at 25fps, from ${frameAt(edl, 1, 25)} to ${frameAt(edl, at, 25)}`);
});

test('a step lands inside a frame, never on the boundary between two', () => {
  // Measured in Chromium: seeking to a frame's exact start showed the same
  // frame twice and then skipped one, because which side of the boundary the
  // decoder takes is its own business. Landing half a frame in removes the
  // question.
  const edl = THREE();
  let t = 1;
  for (let i = 0; i < 6; i++) {
    t = P.stepFrame(edl, t, +1, () => 30);
    const cue = P.cueAt(edl, t);
    const into = cue.sourceTime * 30 - Math.floor(cue.sourceTime * 30 + 1e-6);
    assert.ok(into > 0.2 && into < 0.8,
      `step ${i} landed ${into} of the way into its frame, too near an edge`);
  }
});

test('repeated steps advance one frame each, with no doubles and no skips', () => {
  const edl = THREE();
  let t = 1;
  const seen = [frameAt(edl, t, 30)];
  for (let i = 0; i < 10; i++) { t = P.stepFrame(edl, t, +1, () => 30); seen.push(frameAt(edl, t, 30)); }
  for (let i = 1; i < seen.length; i++) {
    assert.equal(seen[i], seen[i - 1] + 1, `frames went ${seen.join(',')}`);
  }
});

test('a step forward then back returns to the frame it started on', () => {
  const edl = THREE();
  const start = 1.237;
  const was = frameAt(edl, start, 30);
  const there = P.stepFrame(edl, start, +1, () => 30);
  const back = P.stepFrame(edl, there, -1, () => 30);
  assert.equal(frameAt(edl, back, 30), was, 'a round trip is not a net move');
});

test('clips with different rates each step at their own', () => {
  const edl = THREE();
  const fpsOf = (clip) => (clip === 0 ? 30 : 25);
  assert.equal(frameAt(edl, P.stepFrame(edl, 1, +1, fpsOf), 30), frameAt(edl, 1, 30) + 1);
  assert.equal(frameAt(edl, P.stepFrame(edl, 4, +1, fpsOf), 25), frameAt(edl, 4, 25) + 1);
});

test('an unmeasured rate falls back rather than dividing by nothing', () => {
  const edl = THREE();
  const at = P.stepFrame(edl, 1, +1, () => null);
  assert.equal(frameAt(edl, at, P.FALLBACK_FPS), frameAt(edl, 1, P.FALLBACK_FPS) + 1);
  assert.ok(Number.isFinite(P.stepFrame(edl, 1, +1, () => 0)), 'zero is not a frame rate');
  assert.ok(Number.isFinite(P.stepFrame(edl, 1, +1, () => -5)));
});

test('stepping forward over a cut lands in the next block first frame', () => {
  // Not on a time the next block does not contain, and not on the last frame
  // of the one before: the frame after the cut is the next block's in-point.
  const edl = THREE();
  const at = P.stepFrame(edl, 2.99, +1, () => 30);
  const cue = P.cueAt(edl, at);
  assert.equal(cue.clip, 1, 'the next clip');
  assert.equal(P.frameIndex(cue.sourceTime, 30), P.frameIndex(1, 30),
    'on the frame its in-point names, which is 1s into clip 1');
});

test('stepping back over a cut lands in the previous block last frame', () => {
  const edl = THREE();
  const at = P.stepFrame(edl, 3, -1, () => 30);
  const cue = P.cueAt(edl, at);
  assert.equal(cue.clip, 0);
  assert.equal(P.frameIndex(cue.sourceTime, 30), P.frameIndex(5, 30) - 1,
    'the frame before the out-point of block 0, which ends at 5s in its clip');
});

test('the step back over a cut uses the previous clip rate, not this one', () => {
  const edl = THREE();
  const at = P.stepFrame(edl, 3, -1, (clip) => (clip === 0 ? 25 : 60));
  const cue = P.cueAt(edl, at);
  assert.equal(cue.clip, 0);
  assert.equal(P.frameIndex(cue.sourceTime, 25), P.frameIndex(5, 25) - 1,
    'the frame before the cut belongs to clip 0, so it is 25fps wide');
});

test('stepping stops at both ends instead of running off', () => {
  const edl = THREE();
  const first = P.stepFrame(edl, 0, -1, () => 30);
  assert.ok(first >= 0 && first < 1 / 30, `held on the first frame, got ${first}`);
  assert.equal(P.cueAt(edl, first).clip, 0);
  const last = P.stepFrame(edl, 8, +1, () => 30);
  assert.ok(last < 8 && last > 8 - 1 / 30, `held on the last frame, got ${last}`);
});

test('the frame a time falls in is floored, not rounded', () => {
  // A playhead 0.9 of the way through frame 1 is in frame 1. Rounding it to 2
  // is the timecode disagreeing with the picture.
  assert.equal(P.frameIndex(1.9 / 30, 30), 1);
  assert.equal(P.frameIndex(2 / 30, 30), 2);
  assert.equal(P.frameIndex(0, 30), 0);
});

test('stepping an empty edit does nothing rather than throwing', () => {
  assert.equal(P.stepFrame(edlOf([]), 0, +1, () => 30), 0);
});

// ---- gain --------------------------------------------------------------

test('a quieter block previews at its own level', () => {
  const v = P.volumeFor(0.5);
  assert.equal(v.volume, 0.5);
  assert.equal(v.needsAudioGraph, false);
  assert.equal(v.muted, false);
});

test('a silenced block is muted, not merely quiet', () => {
  assert.equal(P.volumeFor(0).muted, true);
});

test('a boosted block cannot be previewed by volume, and says so', () => {
  // HTMLMediaElement.volume caps at 1 and the EDL allows 4. Showing the cap
  // and calling it the output is the lie this flag exists to avoid.
  const v = P.volumeFor(2.5);
  assert.equal(v.volume, 1);
  assert.equal(v.needsAudioGraph, true);
  assert.equal(v.gain, 2.5);
});

test('gain is clamped the same way the EDL clamps it', () => {
  assert.equal(P.volumeFor(99).gain, 4);
  assert.equal(P.volumeFor(-1).gain, 0);
  assert.equal(P.volumeFor(undefined).gain, 1);
});

// ---- frame rate measurement -------------------------------------------

test('a frame rate is read off two presented frames', () => {
  const fps = P.rateFrom({ mediaTime: 1, presentedFrames: 30 }, { mediaTime: 2, presentedFrames: 60 });
  assert.equal(fps, 30);
});

test('29.97 is recognised as 29.97 and not as 30', () => {
  const fps = P.rateFrom({ mediaTime: 0, presentedFrames: 0 },
    { mediaTime: 1001 / 30000 * 300, presentedFrames: 300 });
  assert.equal(fps, 29.97, 'snapping to a real rate stops a step drifting a frame every few hundred');
});

test('two frames too close together are refused', () => {
  // A 1/30s gap divides by a number small enough that a millisecond of
  // jitter reads as 40fps, so the measurement is thrown away instead.
  assert.equal(P.rateFrom({ mediaTime: 1, presentedFrames: 30 }, { mediaTime: 1.033, presentedFrames: 31 }), null);
});

test('nonsense measurements are refused rather than believed', () => {
  assert.equal(P.rateFrom(null, { mediaTime: 1, presentedFrames: 1 }), null);
  assert.equal(P.rateFrom({ mediaTime: 2, presentedFrames: 60 }, { mediaTime: 1, presentedFrames: 30 }), null,
    'time running backwards');
  assert.equal(P.rateFrom({ mediaTime: 0, presentedFrames: 0 }, { mediaTime: 1, presentedFrames: 0 }), null,
    'no frames painted');
  assert.equal(P.rateFrom({ mediaTime: 0, presentedFrames: 0 }, { mediaTime: 0.1, presentedFrames: 900 }), null,
    '9000fps is a measurement fault, not a clip');
});

// ---- the honesty check -------------------------------------------------

test('a seek that lands where it was asked reports no drift', () => {
  assert.equal(P.driftFrames(4.2, 4.2, 30), 0);
});

test('a seek that lands on a keyframe instead reports how far off it is', () => {
  // The case the spec assumed was universal. Chromium does not do this, but a
  // browser that does must be reported rather than shown as if it had not.
  assert.equal(P.driftFrames(4.2, 4.0, 30), -6);
  assert.equal(P.driftFrames(4.2, 5.0, 25), 20);
});

test('drift is unknown rather than zero when nothing was reported', () => {
  assert.equal(P.driftFrames(4.2, null, 30), null);
  assert.equal(P.driftFrames(4.2, undefined, 30), null);
});
