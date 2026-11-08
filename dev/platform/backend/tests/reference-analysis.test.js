/**
 * Proposing a template from somebody else's video.
 *
 * Daniel's ask was a "claude video analyser": point it at a reel and get a
 * template. The risk in a feature like that is not that it fails — it is that
 * it produces something confident and wrong, which somebody then runs thirty
 * videos through. So nearly every assertion here is about what it REFUSES to
 * claim:
 *
 *   - a reference with no rhythm gets no length range, and says why;
 *   - a flat picture is unreadable for movement rather than "still";
 *   - the caption treatment comes back null, because reading it needs vision
 *     this pass does not do, and a guess would be the invention this module
 *     exists not to make;
 *   - and it proposes only from OUR vocabulary, never a new motion or a
 *     generated approximation of somebody else's type.
 *
 * The one thing it may state outright is what the file states outright: its
 * size and frame rate.
 *
 *   node tests/reference-analysis.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  propose, shotsFrom, shotMotion, lengthsFor, motionFor, captionFor, summarise,
  REF, PROPOSABLE_MOTIONS,
} = require('../../shared/referenceAnalysis.mjs');
const { validateTemplate } = require('../../shared/compositionTemplate.mjs');
const { MOTION_NAMES } = require('../../shared/compositionTemplate.mjs');

// ── fixtures ─────────────────────────────────────────────────────────

/** Motion samples four a second: textured and moving unless told otherwise. */
const samples = (seconds, { delta = 3.2, detail = 45 } = {}) =>
  Array.from({ length: seconds * 4 }, (_, i) => ({
    start: i / 4, end: (i + 1) / 4, delta, detail,
  }));

/** A reel cut every ~2.5 seconds. */
const reel = (over = {}) => ({
  width: 1080,
  height: 1920,
  fps: 30,
  duration: 19.6,
  cuts: [2.4, 5.1, 7.4, 10.0, 12.3, 14.9, 17.2],
  motion: samples(20),
  loudnessLufs: -14.2,
  truePeakDb: -1.1,
  ...over,
});

// ── shots ────────────────────────────────────────────────────────────

describe('shots from cuts', () => {
  it('turns cut times into held shots', () => {
    assert.deepEqual(
      shotsFrom([2, 4], 6),
      [{ start: 0, end: 2, len: 2 }, { start: 2, end: 4, len: 2 }, { start: 4, end: 6, len: 2 }]
    );
  });

  it('drops a flash too short to be a shot', () => {
    // Scene detection fires on a whip pan, a flash and a hard caption change
    // as well as on a cut. A 0.1s "shot" in the distribution would drag the
    // proposed minimum below anything watchable.
    const shots = shotsFrom([0.1, 0.2, 3], 6);
    assert.deepEqual(shots.map((s) => s.len), [2.8, 3]);
  });

  it('counts the run to the end of the file as the last shot', () => {
    assert.equal(shotsFrom([5], 9).length, 2);
  });

  it('works with no duration, using only the cuts', () => {
    assert.deepEqual(shotsFrom([2, 4]).map((s) => s.len), [2, 2]);
  });

  it('sorts cuts that arrive out of order', () => {
    assert.deepEqual(shotsFrom([4, 2], 6).map((s) => s.start), [0, 2, 4]);
  });
});

// ── movement ─────────────────────────────────────────────────────────

describe('whether a shot moved', () => {
  it('says a textured shot with change moved', () => {
    const [shot] = shotMotion([{ start: 0, end: 2, len: 2 }], samples(4));
    assert.equal(shot.moving, true);
  });

  it('says a textured shot with no change held still', () => {
    const [shot] = shotMotion([{ start: 0, end: 2, len: 2 }], samples(4, { delta: 0.02 }));
    assert.equal(shot.moving, false);
  });

  it('says a FLAT shot is unreadable, not still', () => {
    // The distinction that matters. A solid colour zoomed is pixel-for-pixel
    // identical, so a zero delta there means "cannot tell", and calling it
    // still would propose a cut-only template off a reference full of
    // movement. Caught on a real file: two solid-colour shots came back with
    // detail 0.16.
    const [shot] = shotMotion([{ start: 0, end: 2, len: 2 }], samples(4, { delta: 0, detail: 0.2 }));
    assert.equal(shot.moving, null);
  });

  it('takes the median inside the shot, so one cut frame cannot swing it', () => {
    const s = samples(4, { delta: 0.02 });
    s[4] = { ...s[4], delta: 200 };
    const [shot] = shotMotion([{ start: 0, end: 2, len: 2 }], s);
    assert.equal(shot.moving, false);
  });
});

// ── the length range ─────────────────────────────────────────────────

describe('the proposed shot length', () => {
  it('reads the middle half, not the extremes', () => {
    // A reference almost always has one long establishing shot and one
    // two-frame flash. Proposing min to max off those is a template with no
    // rhythm at all.
    // Lengths here are 3, 2.5, 2.5, 2.5, 2.5 and then an 11-second tail. The
    // bound has to exclude that tail, not merely allow it: an earlier draft
    // asserted `max <= 11`, which the tail satisfies exactly, so taking the
    // extremes instead of the quartiles passed.
    const shots = shotsFrom([3, 5.5, 8, 10.5, 13], 24);
    const out = lengthsFor(shots);
    assert.ok(out.value.min >= 2.4, `min ${out.value.min} should not be the shortest`);
    assert.ok(
      out.value.max <= 4,
      `max ${out.value.max} is taking the 11s establishing shot, not the middle half`
    );
  });

  it('refuses a rhythm it cannot see, and says how many shots it needed', () => {
    const out = lengthsFor(shotsFrom([], 30));
    assert.equal(out.value, null);
    assert.equal(out.confidence, 0);
    assert.match(out.why, /only 1 shot over 0.4s; 3 are needed/);
  });

  it('is less confident when the reference mixes long takes with fast cuts', () => {
    const tight = lengthsFor(shotsFrom([2.5, 5, 7.5, 10], 12.5));
    const loose = lengthsFor(shotsFrom([1, 2, 3, 11], 22));
    assert.ok(
      tight.confidence > loose.confidence,
      `a steady rhythm (${tight.confidence}) should beat a mixed one (${loose.confidence})`
    );
  });

  it('never proposes a range outside what is watchable', () => {
    const out = lengthsFor(shotsFrom([20, 40, 60], 80));
    assert.ok(out.value.max <= REF.max_shot_s, `${out.value.max} exceeds the ceiling`);
    assert.ok(out.value.min >= REF.min_shot_s);
  });
});

// ── the motion, from our own vocabulary only ─────────────────────────

describe('the proposed motion', () => {
  it('proposes one of OUR motions, never a new one', () => {
    const out = motionFor(shotMotion(shotsFrom([2, 4], 6), samples(6)));
    assert.ok(MOTION_NAMES.includes(out.value), `"${out.value}" is not one of ours`);
    assert.deepEqual(PROPOSABLE_MOTIONS, MOTION_NAMES);
  });

  it('says no camera move when the reference held still', () => {
    const out = motionFor(shotMotion(shotsFrom([2, 4], 6), samples(6, { delta: 0.02 })));
    assert.equal(out.value, null);
    assert.ok(out.confidence >= REF.high, 'and is confident about it');
    assert.match(out.why, /held still/);
  });

  it('admits one delta per shot cannot tell a push from a drift', () => {
    // The honest limit. The measurement is one number per shot — how much the
    // picture changed — and a push and a drift move a similar quantity of
    // pixels. Claiming to read a specific preset off one scalar would be the
    // invention this module exists not to make.
    const out = motionFor(shotMotion(shotsFrom([2, 4], 6), samples(6)));
    assert.match(out.why, /cannot[\s\S]*tell a push from a drift/);
    assert.ok(out.confidence <= REF.medium, 'so the confidence is middling at best');
  });

  it('refuses to read movement off a reference that is all flat', () => {
    const out = motionFor(shotMotion(shotsFrom([2, 4], 6), samples(6, { delta: 0, detail: 0.3 })));
    assert.equal(out.value, null);
    assert.equal(out.confidence, 0, 'with no confidence, which is different from "no move"');
    assert.match(out.why, /too flat/);
  });
});

// ── the caption treatment is not guessed ─────────────────────────────

describe('the caption treatment', () => {
  it('comes back unread rather than invented', () => {
    // Reading it needs sampled frames, OCR and vision. Until that exists a
    // null with a reason is usable and a guess is not — and when it does
    // exist the answer must be one of the 31 SHIPPED presets, matched, never
    // a generated approximation of somebody else's type.
    const out = captionFor({});
    assert.equal(out.value, null);
    assert.equal(out.confidence, 0);
    assert.match(out.why, /shipped presets/);
  });
});

// ── the whole proposal ───────────────────────────────────────────────

describe('the proposal', () => {
  it('is a template the schema accepts, so it can be checked before it is shown', () => {
    const p = propose(reel());
    assert.deepEqual(validateTemplate(p.template), []);
  });

  it('states the frame and rate outright, because the file does', () => {
    const p = propose(reel());
    assert.equal(p.fields.size.confidence, 1);
    assert.deepEqual(p.fields.size.value, { width: 1080, height: 1920 });
    assert.equal(p.fields.fps.value, 30);
  });

  it('proposes a RANGE of pictures, not the reference\'s exact shot count', () => {
    // The next batch will not have exactly eleven photographs either.
    const p = propose(reel());
    const slot = p.template.slots[0];
    assert.ok(slot.max > slot.min, `${slot.min}..${slot.max} is not a range`);
    assert.match(p.fields.count.why, /will not have exactly/);
  });

  it('carries a confidence and a reason for every field', () => {
    const p = propose(reel());
    for (const [name, f] of Object.entries(p.fields)) {
      assert.ok(typeof f.why === 'string' && f.why.length > 10, `${name} has no reason`);
      assert.ok(Number.isFinite(f.confidence), `${name} has no confidence`);
    }
  });

  it('leaves a field it could not read OUT of the template, rather than inventing it', () => {
    // A template that states a constraint nothing measured is the lie this is
    // built to avoid — the same fault as the first eight templates declaring
    // fields nothing read.
    const p = propose(reel({ cuts: [], motion: samples(20, { delta: 0, detail: 0.2 }) }));
    const slot = p.template.slots[0];
    assert.equal('len' in slot, false, 'no length range was readable');
    assert.equal('motion' in slot, false, 'and no motion');
    assert.deepEqual(validateTemplate(p.template), [], 'and it is still a valid template');
  });

  it('records the reference loudness as reference only', () => {
    // Nothing in this pipeline normalises loudness, so a template cannot ask
    // for a level. Recording what the reference was mastered at is still
    // worth doing.
    const p = propose(reel());
    assert.equal(p.fields.loudness.value, -14.2);
    assert.match(p.fields.loudness.why, /nothing in this pipeline\s*\n?\s*normalises loudness/);
  });

  it('says in one line what it read and what it could not', () => {
    const p = propose(reel());
    assert.match(p.says, /8 shots/);
    assert.match(p.says, /Could not read: caption/);
  });

  it('gets the singular right', () => {
    assert.match(summarise([{ len: 3 }], {}), /^1 shot\./);
    assert.match(summarise([{ len: 3 }, { len: 3 }], {}), /^2 shots\./);
  });

  it('says plainly when there is nothing usable', () => {
    const p = propose({ width: 1080, height: 1920, fps: 30, duration: 0.2, cuts: [], motion: [] });
    assert.match(p.says, /Nothing usable/);
  });

  it('scores lower overall when less was readable', () => {
    const full = propose(reel());
    const thin = propose(reel({ cuts: [], loudnessLufs: null }));
    assert.ok(full.confidence > thin.confidence, `${full.confidence} vs ${thin.confidence}`);
  });

  it('survives a file that reported nothing at all', () => {
    const p = propose({});
    assert.equal(p.fields.size.value, null);
    assert.equal(p.fields.fps.value, null);
    assert.deepEqual(validateTemplate(p.template), [], 'and still proposes something valid');
  });
});
