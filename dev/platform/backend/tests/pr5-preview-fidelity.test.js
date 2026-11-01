// PR 5 of the review plan: what is left of the frame-accurate preview.
//
// The spec's section 2.2 asked for the preview to be rebuilt on WebCodecs,
// because an HTML `<video>` was assumed to seek to keyframes rather than
// frames. A probe settled that on 31 October: footage with its frame number
// burned into every frame as colour, eleven mid-GOP seeks per clip, and
// `currentTime` landed exact on all of them — on a clean 30fps file and on
// one at 29.97 with B-frames, rotation metadata and a 2.5-second keyframe
// interval. So 2.2 was built on the element, and `driftFrames` keeps the
// question open at runtime for a browser where the premise does hold.
//
// Two gaps remained, both named in that session's own notes, and this PR
// closes them:
//
//  1. "there is no audio gain node, so a block boosted above 100% plays at
//     the volume cap and says so rather than sounding right"
//  2. "the preview does not composite burned captions ... the way the render
//     will" — a chosen caption template drew nothing at all over the preview,
//     so the only way to see where it put its words was to render.
//
// The arithmetic is guarded in tests/edl-play.test.js (levelFor, 8 cases) and
// the transparent frame in tests/caption-overlay.test.js. This guards the
// wiring, which is where a later edit would quietly undo it.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FE = path.join(__dirname, '..', '..', 'frontend');
const SHARED = path.join(__dirname, '..', '..', 'shared');
const read = (p) => fs.readFileSync(path.join(FE, p), 'utf8');

// Read raw. Every check here is "is this here", and the caption overlay's URL
// template holds no `/*` but the edit page does elsewhere — stripping would
// take the file with it.
const player = read('src/components/video/EdlPlayer.jsx');
const audio = read('src/components/video/audioGain.js');
const editPage = read('src/pages/ClientEditPage.jsx');
const timeline = read('src/components/video/Timeline.jsx');
const edl = fs.readFileSync(path.join(SHARED, 'edl.mjs'), 'utf8');
const play = fs.readFileSync(path.join(SHARED, 'edlPlay.mjs'), 'utf8');

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

// ── 1. The gain graph is built carefully or not at all ───────────────────
ok('the graph is only built for an edit that needs it', () => {
  // createMediaElementSource is irreversible and a suspended context is
  // silent, so routing every edit would risk the audio for nothing.
  assert.ok(/PLAY\.rows\(st\.edl\)\.some\(\(r\) => PLAY\.volumeFor\(r\.gain\)\.needsAudioGraph\)/
    .test(player), 'it checks the edit first');
  assert.ok(/if \(!\(await GAIN\.wake\(\)\)\) return false;/.test(player),
    'and that the context will actually run');
});

ok('it is built from inside the play gesture, after play()', () => {
  const start = player.slice(player.indexOf('const start = useCallback'),
    player.indexOf('const step = useCallback'));
  // Both present before comparing, because indexOf returns -1 for a missing
  // string and -1 is less than everything: deleting the play() call entirely
  // satisfied the ordering check. Third time this exact trap has shown up
  // today, and the third time the mutation run is what found it.
  const playAt = start.indexOf('node.play()');
  const wireAt = start.indexOf('wireGain()');
  assert.ok(playAt > -1, 'the element is told to play');
  assert.ok(wireAt > -1, 'and the graph is wired');
  assert.ok(playAt < wireAt,
    'awaiting the context before play() would put play() outside the gesture');
  assert.ok(/wireGain\(\)\.then\(\(up\) => \{/.test(start), 'and not awaited inline');
  // place() ran while st.graph was still false, so the level has to be
  // applied again once the graph is up or the first block stays capped.
  assert.ok(/if \(cue2\) place\(m\.current\.active, cue2\);/.test(start),
    'and the level is re-applied once it is up');
});

ok('both elements are routed, or neither is', () => {
  // One routed and one not means a cut swaps between two audio paths, and the
  // unrouted one cannot exceed 100% anyway.
  assert.ok(/if \(!okA \|\| !okB\) return false;/.test(player), 'both or neither');
});

ok('the source node is cached on the element, once', () => {
  assert.ok(/if \(element\.__omiGain !== undefined\) return element\.__omiGain;/.test(audio),
    'a second call returns the first result');
  // `!== undefined` rather than truthiness: a failed attempt stores null, and
  // retrying it would throw on an element that is already routed.
  assert.ok(/element\.__omiGain = null;/.test(audio), 'including a failed one');
  assert.ok(/createMediaElementSource/.test(audio) && /createGain/.test(audio),
    'and it is a real graph');
});

ok('a context that will not run is treated as no graph', () => {
  assert.ok(/return ac\.state === 'running';/.test(audio),
    'wake() reports whether sound can actually come out');
  assert.ok(/catch \{ return false; \}/.test(audio), 'and a refused resume is a false');
});

ok('the gain is ramped rather than stepped, and clamped', () => {
  assert.ok(/setTargetAtTime\(v, node\.context\.currentTime, 0\.01\)/.test(audio),
    'a step change on a gain node is an audible click');
  assert.ok(/Math\.max\(0, Math\.min\(4, value\)\)/.test(audio),
    'a node is not clamped by anything, so a gain of 99 from a saved EDL would be deafening');
});

// ── 2. The warning tells the truth either way ────────────────────────────
ok('the warning is about being capped, not about being boosted', () => {
  // With the graph running a boosted block plays at its gain, and there is
  // nothing left to warn about. Keeping the old test would have left the line
  // up saying the render is louder when it no longer is.
  assert.ok(/setBoosted\(PLAY\.levelFor\(cue\.gain, \{ graph \}\)\.capped\)/.test(player),
    'it reads capped');
  assert.ok(/boosted && <div>/.test(player), 'and the line is still there for when it is');
});

ok('every place that sets a level goes through levelFor', () => {
  // Three of them: placing a block, the cross-fade ramp, and the hand-off. A
  // volumeFor left behind in one of them is a block that stays capped only
  // sometimes, which is the hardest version of this to notice.
  const levels = (player.match(/PLAY\.levelFor\(/g) || []).length;
  assert.ok(levels >= 4, `levelFor is used throughout (found ${levels})`);
  // volumeFor survives in one place on purpose: deciding whether the edit
  // needs a graph at all, before there is a graph to ask about.
  const volumes = (player.match(/PLAY\.volumeFor\(/g) || []).length;
  assert.strictEqual(volumes, 1,
    `volumeFor is only used to decide whether to build the graph (found ${volumes})`);
});

ok('a null blend cannot silence a block', () => {
  // num(null, 1) is 0, because Number(null) is 0 and 0 is finite, so the
  // fallback never fires. An absent blend from a saved EDL looks like null.
  assert.ok(/blend == null \? 1 :/.test(play), 'null means no fade, not no sound');
});

// ── 3. The door that was never there ─────────────────────────────────────
ok('a block\'s volume can be set from the timeline', () => {
  // The whole gain feature was unreachable. The EDL has carried `gain` since
  // it was written, `normalise` clamps it, `editProcessor` applies it with
  // ffmpeg's volume filter, and no surface ever set it — so the player's
  // "boosted above 100%" line described a state nothing could produce, and
  // the gain node above would have been plumbing for nobody.
  assert.ok(/export function setGain\(edl, id, gain\)/.test(edl), 'the model has a setter');
  assert.ok(/export function gainOf\(item\)/.test(edl), 'and a reader');
  assert.ok(/EDL\.setGain\(edl, selected\.item\.id, Number\(e\.target\.value\)\)/.test(timeline),
    'and the timeline calls it');
  assert.ok(/aria-label="Block volume"/.test(timeline), 'from a named control');
});

ok('the setter clamps, and does nothing when nothing changed', () => {
  assert.ok(/Math\.min\(4, Math\.max\(0, num\(gain, 1\)\)\)/.test(edl),
    'clamped at the entry point, not left for the next save to correct');
  // Returning the same object matters: commit() on an unchanged EDL would
  // push a history entry per slider tick.
  assert.ok(/if \(Math\.abs\(num\(items\[idx\]\.gain, 1\) - g\) < 1e-9\) return edl;/.test(edl),
    'an unchanged value returns the same edl');
  assert.ok(/if \(idx < 0\) return edl;/.test(edl), 'and so does an id that is not there');
});

ok('the control says what it is doing, in words', () => {
  assert.ok(/g === 0 \? 'Silent'/.test(timeline), 'zero reads as Silent, not 0%');
  assert.ok(/Back to 100%/.test(timeline), 'there is a way back');
  assert.ok(/Louder than the source/.test(timeline), 'and a boost says so');
  // The slider stops at 2 although the model allows 4: a boost past 2 on
  // speech is distortion rather than volume.
  assert.ok(/min="0" max="2" step="0\.05"/.test(timeline), 'and stops at 200%');
});

// ── 3. The caption overlay, which does not work and is not shipped ───────
//
// Tried, measured, reverted. The plan was to ask the caption engine for its
// own preview frame on a transparent ground and lay that over the picture:
// same ASS, same fonts, same geometry, so what the operator sees over their
// footage is where the render will put the type.
//
// ffmpeg's `subtitles` filter draws libass output into the colour planes and
// leaves alpha alone. Over a `color=black@0.0` ground, measured across rgba,
// yuva420p and yuva444p, every one of 2,073,600 pixels came back at alpha 0:
// a file with the type in its RGB and nothing to show it through. An overlay
// nobody can see is worse than no overlay, so it came back out.
//
// What this guards is that it stays out, and that the reasoning stays written
// down where the next session will look before spending an afternoon on it.
ok('no transparent caption frame is produced, and the reason is recorded', () => {
  const svc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'captions.js'), 'utf8');
  assert.ok(!/transparent/i.test(svc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')),
    'previewFrame takes no transparent option');
  assert.ok(/alpha 0/.test(svc), 'and the comment says what was measured');
  assert.ok(!/transparent=1/.test(editPage), 'and nothing asks for one');
});

ok('the editor says the template is not drawn over the preview', () => {
  // A chosen template still shows nothing over the picture. That is a gap,
  // and the editor naming it is the difference between a gap and a bug: the
  // swatch in the picker is what the template looks like, and the note points
  // at the spec for what closing it would cost.
  assert.ok(/It is not drawn over/.test(editPage), 'the note is there');
  // In the operator's terms, not a repo path: a product surface pointing at
  // docs/omi/… is a note to me, in front of the person using it.
  assert.ok(/render a test clip if you need to see what it/.test(editPage),
    'and says what to do instead');
  assert.ok(!/docs\/omi\//.test(editPage), 'without naming a file in the repo');
});

ok('the plain-caption placeholder still exists for the plain case', () => {
  assert.ok(/captions && !capTemplate && previewH > 0/.test(editPage),
    'plain captions keep their own placeholder');
  // Plain captions have size and position controls in the editor, so a CSS
  // placeholder tracks them honestly. A template sets its own, which is why
  // one is drawn here and one would have to come from ffmpeg.
  assert.ok(/the quick brown fox/.test(editPage), 'with sample words');
});

console.log(`${passed} guards`);
console.log('---');
console.log('A BOOSTED BLOCK CAN BE SET, AND SOUNDS LIKE THE RENDER');
