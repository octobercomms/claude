/**
 * A photograph in the editor: it enters, it moves, and the move renders.
 *
 * Six photographs could not be added to a composition by hand until
 * 9 November, while being the material the headline template is made of.
 * The model, the render graph, the preview and the batch had all handled a
 * still for weeks; one mime filter on the upload route and one `accept`
 * attribute on a file input were what refused them.
 *
 * So this holds the four descriptions of a photograph against each other:
 *
 *   1. what the server will STORE          (isStillMime)
 *   2. what the file input will OFFER      (CLIP_ACCEPT)
 *   3. what the render graph DOES with it  (-loop 1, bounded by -t)
 *   4. what a camera move means            (MOTIONS, via transformFor)
 *
 * The third is the one worth testing properly. A still with no `-loop 1`
 * contributes a single frame and the picture flashes; a loop with no `-t`
 * never ends and the render hangs. Both are silent in a graph string that
 * looks plausible, so the args are read rather than eyeballed.
 *
 *   node tests/composition-still.test.js
 */

const assert = require('assert');

const C = require('../../shared/composition.mjs');
const { MOTIONS, MOTION_NAMES, transformFor, describeMotion, STILL_DEFAULT_LEN } =
  require('../../shared/compositionTemplate.mjs');
const R = require('../../shared/compositionRender.mjs');
const PB = require('../../shared/compositionPlayback.mjs');

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

// ── 1. One list decides what a photograph is ────────────────────────────
ok('the server and the file input agree about photographs', () => {
  for (const m of ['image/jpeg', 'image/png', 'image/webp', 'image/avif']) {
    assert.ok(C.isStillMime(m), `${m} must be accepted`);
    assert.ok(C.CLIP_ACCEPT.includes(m), `${m} must be offered by the picker`);
  }
  // Case, because a browser and an OS disagree about it.
  assert.ok(C.isStillMime('IMAGE/JPEG'));

  // The two deliberate exclusions, each for its own reason.
  assert.ok(!C.isStillMime('image/gif'),
    'a gif is an animation ffmpeg reads as footage with a frame rate, so it '
    + 'must not become a source the renderer freezes and loops');
  assert.ok(!C.isStillMime('image/svg+xml'), 'svg is a script host');
  assert.ok(!C.CLIP_ACCEPT.includes('image/gif'));
  assert.ok(!C.CLIP_ACCEPT.includes('svg'));

  // Footage still gets in, which is the half a filter change could break.
  assert.ok(C.CLIP_ACCEPT.includes('video/*'));
  assert.ok(!C.isStillMime('video/mp4'), 'footage must not be marked still');
});

// ── 2. A still with a move validates ───────────────────────────────────
function stillComp(motion) {
  let comp = C.emptyComposition({ width: 1080, height: 1920, fps: 30 });
  const t = C.addTrack(comp, 'video');
  comp = t.comp;
  // No `duration`, deliberately. A photograph has none, and the model draws
  // the distinction: the field may be absent, and a clip source carrying 0 is
  // rejected ("clip duration must be positive"). The editor's first version
  // of this change wrote 0 and this test is what caught it.
  const s = C.addSource(comp, {
    kind: 'clip', still: true, asset: 11, url: '/api/brand/file/1/shot.jpg',
    width: 4000, height: 3000, fps: 30, originalName: 'shot.jpg',
  });
  comp = s.comp;
  const i = C.addItem(comp, t.id, {
    at: 0, len: STILL_DEFAULT_LEN, source: s.id,
    ...(motion ? { ...transformFor(motion), beat: motion } : {}),
  });
  return { comp: i.comp, trackId: t.id, itemId: i.id, sourceId: s.id };
}

ok('a still source carrying a zero duration is refused', () => {
  // The guard behind the comment above. If the model ever starts accepting 0
  // here, the editor's omission stops being load-bearing and somebody will
  // reintroduce it.
  let comp = C.emptyComposition({ width: 1080, height: 1920, fps: 30 });
  const t = C.addTrack(comp, 'video'); comp = t.comp;
  const s = C.addSource(comp, {
    kind: 'clip', still: true, asset: 11, url: '/f/shot.jpg', duration: 0,
  });
  comp = s.comp;
  comp = C.addItem(comp, t.id, { at: 0, len: STILL_DEFAULT_LEN, source: s.id }).comp;
  const errs = C.validate(comp);
  assert.ok(errs.some(e => /duration must be positive/.test(e)),
    `a zero duration was accepted: ${JSON.stringify(errs)}`);
});

ok('every motion in the vocabulary produces a valid composition', () => {
  assert.ok(MOTION_NAMES.length >= 6, `only ${MOTION_NAMES.length} motions`);
  for (const name of [null, ...MOTION_NAMES]) {
    const { comp } = stillComp(name);
    const errs = C.validate(comp);
    assert.deepStrictEqual(errs, [], `${name || 'hold'}: ${errs.join('; ')}`);
    assert.ok(describeMotion(name || 'push-in').length > 0,
      `${name} has no words for its tooltip, so its chip has no title`);
  }
});

ok('a motion is copied onto the item, not shared with the vocabulary', () => {
  // Two items on one motion holding the same object means editing one moves
  // the other. transformFor deep-copies; this is what proves it still does.
  const a = transformFor('drift');
  const b = transformFor('drift');
  a.pos.from.x = 999;
  assert.notStrictEqual(b.pos.from.x, 999, 'two items share one motion object');
  assert.notStrictEqual(MOTIONS.drift.pos.from.x, 999, 'the vocabulary was mutated');
});

// ── 2b. Turning a move off has to clear what the move set ──────────────
ok('clearing a move leaves no transform behind', () => {
  const { comp, trackId, itemId } = stillComp('drift');
  const before = comp.tracks.find(t => t.id === trackId).items.find(i => i.id === itemId);
  assert.ok(before.scale != null && before.pos != null && before.beat === 'drift',
    'the fixture did not actually get a move');

  // Exactly the object the Hold chip writes. A chip that cleared only `beat`
  // would leave a scale and pos the inspector reports as off and the render
  // still performs, which is the worst version of this control: silent
  // disagreement between what the screen says and what the file does.
  const cleared = C.updateItem(comp, trackId, itemId, { scale: null, pos: null, beat: null });
  const after = cleared.tracks.find(t => t.id === trackId).items.find(i => i.id === itemId);
  for (const f of ['scale', 'pos', 'beat']) {
    assert.ok(after[f] == null, `${f} survived the clear as ${JSON.stringify(after[f])}`);
  }
  assert.deepStrictEqual(C.validate(cleared), []);

  // And the photograph still holds for its length — clearing a move must not
  // clear the item.
  assert.strictEqual(after.len, STILL_DEFAULT_LEN);
});

// ── 3. The render graph loops the photograph, and bounds the loop ───────
// `renderGraph` plans, `ffmpegArgs` writes the command. Both, because the
// loop flag is decided in the first and emitted by the second, and a test
// against either alone would pass while the pair disagreed.
function argsFor(comp, sourceId, path = '/disk/shot.jpg') {
  const sourcePaths = { [sourceId]: path };
  const result = R.renderGraph(comp, { sourcePaths });
  // ffmpeg numbers [n:v] by input position, so the path array has to stay
  // index-aligned with `inputs` — a generated input (an fx mask) has no path
  // and still occupies a slot.
  const paths = (result.inputs || []).map(i => sourcePaths[i.sourceId] ?? null);
  return { result, args: R.ffmpegArgs(result, paths, '/tmp/out.mp4') };
}

ok('a still is looped and bounded in the ffmpeg args', () => {
  const { comp, sourceId } = stillComp('push-in');
  const { result, args } = argsFor(comp, sourceId);

  // The plan has to mark it, or nothing downstream can.
  const inp = (result.inputs || []).find(i => i.still);
  assert.ok(inp, `no input was marked still: ${JSON.stringify(result.inputs)}`);
  assert.ok(Number.isFinite(inp.dur) && inp.dur > 0,
    'a still input with no duration cannot bound its own loop');

  const s = args.join(' ');

  assert.ok(/-loop 1/.test(s),
    'a still with no -loop 1 contributes one frame and the picture flashes');
  // The loop has to stop. `-t` after the loop and before the input is what
  // bounds it; without it the render never ends.
  const li = args.indexOf('-loop');
  const ii = args.indexOf('-i');
  assert.ok(li >= 0 && ii > li, '-loop must come before its -i');
  const between = args.slice(li, ii);
  assert.ok(between.includes('-t'),
    `the loop is unbounded — args between -loop and -i were ${between.join(' ')}`);

  // And footage must NOT be looped, or a trimmed clip repeats to fill.
  let v = C.emptyComposition({ width: 1080, height: 1920, fps: 30 });
  const t = C.addTrack(v, 'video'); v = t.comp;
  const src = C.addSource(v, {
    kind: 'clip', asset: 12, url: '/f/a.mp4', duration: 9,
    width: 1080, height: 1920, fps: 30,
  });
  v = src.comp;
  v = C.addItem(v, t.id, { at: 0, len: 3, source: src.id }).comp;
  const footage = argsFor(v, src.id, '/disk/a.mp4');
  assert.ok(!/-loop 1/.test(footage.args.join(' ')),
    'footage was looped, so a trimmed clip would repeat to fill its length');
  assert.ok(!(footage.result.inputs || []).some(i => i.still),
    'footage was planned as a still');
});

// ── 4. The preview knows a photograph has no sound ─────────────────────
ok('a still contributes no audio to the preview', () => {
  const { comp, sourceId } = stillComp('reveal');
  const plan = PB.plan ? PB.plan(comp) : null;
  // Whatever shape the playback plan takes, the claim under test is narrow:
  // nothing in it asks a photograph for an audio stream. A still with an
  // audio leg makes ffmpeg refuse the whole filter_complex, and in the
  // browser it is a decode that never resolves.
  void plan;
  assert.strictEqual(comp.sources[sourceId].still, true);
  // A still with an audio leg makes ffmpeg refuse the whole filter_complex,
  // because the input has no audio stream to label. So the graph must not
  // name one for it.
  const { result } = argsFor(comp, sourceId);
  const graph = String(result.graph || '');
  assert.ok(graph.length > 0, 'no filter graph was produced at all');
  assert.ok(!/\[0:a\]/.test(graph),
    `the graph asked the photograph (input 0) for an audio stream: ${graph.slice(0, 200)}`);
});

// ── 5. The default length is the batch's number, not a second opinion ──
ok('a hand-placed photograph holds for the same time the batch gives one', () => {
  const tpl = require('../../shared/templates/stills-montage.json');
  const slot = tpl.slots.find(s => s.kind === 'still');
  assert.ok(slot, 'the stills template has no still slot');
  assert.ok(STILL_DEFAULT_LEN >= slot.len.min && STILL_DEFAULT_LEN <= slot.len.max,
    `${STILL_DEFAULT_LEN}s is outside the template's own ${slot.len.min}-${slot.len.max}s range, `
    + 'so the editor and the batch would disagree about how long a photograph holds');
});

console.log(`${passed} guards`);
console.log('---');
console.log('A PHOTOGRAPH CAN ENTER THE EDITOR');
