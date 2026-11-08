/**
 * Composition templates: validation, seeded variation, and binding.
 *
 * A template is the keystone of the batch build. Bulk is meaningless without
 * one, because thirty videos means one shape bound thirty times rather than
 * thirty editing sessions.
 *
 * The tests that matter most here are the VARIATION ones. Variation is not
 * polish: thirty videos with identical pacing and an identical camera move
 * reads as filler and damages the feed they are posted to. Two faults in the
 * first version of this module were exactly that, and both were silent:
 *
 *   - the slot's own transition took precedence over the variation rotation,
 *     so the rotation was a no-op on every template whose slot named one
 *     (three items of a batch all came out `fade` with a list of two sitting
 *     unused beside them);
 *   - the length hash had no avalanche step, so consecutive indices came out
 *     nearly identical (3.234s, 3.237s, 3.241s) and the lengths marched in
 *     step anyway.
 *
 * Neither would have thrown, failed a build, or looked wrong in a unit test
 * of the pieces. They would have shown up as thirty videos that felt the same.
 *
 *   node tests/composition-template.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  validateTemplate, isValidTemplate, bindTemplate, variantFor, transformFor,
  MOTIONS, MOTION_NAMES, TEMPLATE_VERSION,
} = require('../../shared/compositionTemplate.mjs');
const { validate } = require('../../shared/composition.mjs');
const fs = require('node:fs');
const path = require('node:path');

// ── fixtures ─────────────────────────────────────────────────────────

function montage(over = {}) {
  return {
    id: 'stills-montage',
    name: 'Stills montage',
    register: 'editorial',
    size: { width: 1080, height: 1920 },
    fps: 30,
    slots: [
      { id: 'stills', kind: 'still', min: 3, max: 6, len: { min: 2.5, max: 3.5 }, trans: 'fade', track: 0 },
    ],
    caption: { preset: 'gallery-quiet' },
    variation: { motion: ['push-in', 'drift', 'reveal'], trans: ['fade', 'fadeblack'], lenJitter: 0.15 },
    ...over,
  };
}

const STILLS = [1, 2, 3, 4].map((i) => ({
  kind: 'clip', url: `s${i}.jpg`, duration: 10, width: 1080, height: 1920, fps: 30,
}));

function itemsOf(comp, track = 0) {
  return comp.tracks[track].items;
}

// ── validation ───────────────────────────────────────────────────────

describe('validateTemplate', () => {
  it('accepts a well-formed template', () => {
    assert.deepEqual(validateTemplate(montage()), []);
  });

  it('needs an id, a name, a size, an fps and a slot', () => {
    assert.match(validateTemplate({})[0], /needs an id/);
    assert.ok(validateTemplate(montage({ slots: [] })).some((e) => /at least one slot/.test(e)));
    assert.ok(validateTemplate(montage({ fps: 0 })).some((e) => /fps must be 1..120/.test(e)));
    assert.ok(validateTemplate(montage({ size: { width: 0, height: 10 } }))
      .some((e) => /positive width and height/.test(e)));
  });

  it('rejects an unknown motion, naming the six that exist', () => {
    const errs = validateTemplate(montage({
      slots: [{ id: 's', kind: 'still', motion: 'ken-burns' }],
    }));
    assert.match(errs[0], /unknown motion "ken-burns"/);
    assert.match(errs[0], /push-in/);
  });

  it('REFUSES dissolve, which would inflate every file in a batch', () => {
    // Despite the name it is a per-pixel random dither, not a cross-fade, and
    // its noise is uncompressible: the same 11-second reel measured 6.24MB
    // with dissolve against 0.54MB with fade. The model still permits it for
    // a hand-made edit; a template must not reach for it, because a template
    // is applied thirty times.
    const onSlot = validateTemplate(montage({
      slots: [{ id: 's', kind: 'still', trans: 'dissolve' }],
    }));
    assert.ok(onSlot.some((e) => /not one a template may use/.test(e)));

    const inRotation = validateTemplate(montage({
      variation: { trans: ['fade', 'dissolve'] },
    }));
    assert.ok(
      inRotation.some((e) => /variation transition "dissolve"/.test(e)),
      'and not in the rotation either, which is the easier place to miss it'
    );
  });

  it('rejects a duplicate slot id, which would silently drop content', () => {
    const errs = validateTemplate(montage({
      slots: [{ id: 's', kind: 'still' }, { id: 's', kind: 'clip' }],
    }));
    assert.ok(errs.some((e) => /duplicate slot id "s"/.test(e)));
  });

  it('bounds the jitter, so a template cannot halve or double a length', () => {
    assert.ok(validateTemplate(montage({ variation: { lenJitter: 0.9 } }))
      .some((e) => /lenJitter must be 0..0.5/.test(e)));
  });

  it('rejects a max below a min, and a negative count', () => {
    assert.ok(validateTemplate(montage({ slots: [{ id: 's', kind: 'still', min: 5, max: 2 }] }))
      .some((e) => /max must be at least min/.test(e)));
    assert.ok(validateTemplate(montage({ slots: [{ id: 's', kind: 'still', min: -1 }] }))
      .some((e) => /non-negative/.test(e)));
  });
});

// ── the motion vocabulary ────────────────────────────────────────────

describe('motions', () => {
  it('is the six words stillsReel.js already used', () => {
    assert.deepEqual(
      [...MOTION_NAMES].sort(),
      ['drift', 'orbit', 'push-in', 'reveal', 'rise', 'subtle']
    );
  });

  it('each is a deterministic transform, not a generative call', () => {
    // Path B: a camera move costs nothing, renders in under a second, never
    // fails at a vendor, and leaves the geometry of a building alone.
    for (const name of MOTION_NAMES) {
      const t = transformFor(name);
      assert.ok(
        t.scale != null || t.pos != null,
        `${name} must move something`
      );
    }
  });

  it('hands back a copy, so two items on one motion do not share an object', () => {
    const a = transformFor('push-in');
    const b = transformFor('push-in');
    assert.notEqual(a, b);
    a.scale.to = 99;
    assert.notEqual(transformFor('push-in').scale.to, 99, 'the table was not mutated');
  });

  it('is restrained: nothing zooms past 1.2x', () => {
    // A slow move over a still reads as expensive. A fast one reads as a
    // screensaver, which is the register these clients are paying to avoid.
    for (const [name, m] of Object.entries(MOTIONS)) {
      const vals = [m.scale?.from, m.scale?.to, typeof m.scale === 'number' ? m.scale : null]
        .filter((v) => Number.isFinite(v));
      for (const v of vals) {
        assert.ok(v <= 1.2, `${name} scales to ${v}, which is a screensaver`);
      }
    }
  });
});

// ── variation ────────────────────────────────────────────────────────

describe('variation across a batch', () => {
  it('rotates the motion rather than repeating one', () => {
    const t = montage();
    const motions = [0, 1, 2, 3, 4, 5].map((i) => variantFor(t, i, 'b').motion);
    assert.deepEqual(motions, ['push-in', 'drift', 'reveal', 'push-in', 'drift', 'reveal']);
  });

  it('rotates the transition too', () => {
    const t = montage();
    const trans = [0, 1, 2, 3].map((i) => variantFor(t, i, 'b').trans);
    assert.deepEqual(trans, ['fade', 'fadeblack', 'fade', 'fadeblack']);
  });

  it('spreads the lengths instead of marching in step', () => {
    // The fault this guards: with no avalanche in the hash, consecutive
    // indices produced 3.234s, 3.237s and 3.241s. A spread of 7ms across a
    // batch is not variation, it is the appearance of it.
    const t = montage();
    const scales = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => variantFor(t, i, 'b').lenScale);
    const spread = Math.max(...scales) - Math.min(...scales);
    assert.ok(
      spread > 0.1,
      `the jitter must actually vary: scales were ${scales.map((s) => s.toFixed(3)).join(', ')}`
    );
  });

  it('keeps the average near the length the template asked for', () => {
    const t = montage();
    const scales = Array.from({ length: 40 }, (_, i) => variantFor(t, i, 'b').lenScale);
    const mean = scales.reduce((a, b) => a + b, 0) / scales.length;
    assert.ok(Math.abs(mean - 1) < 0.06, `jitter is centred on 1, got ${mean.toFixed(3)}`);
  });

  it('is stable for one seed and different across seeds', () => {
    const t = montage();
    assert.equal(variantFor(t, 3, 'a').lenScale, variantFor(t, 3, 'a').lenScale);
    assert.notEqual(variantFor(t, 3, 'a').lenScale, variantFor(t, 3, 'b').lenScale);
  });

  it('offers no variation when the template asks for none', () => {
    const t = montage({ variation: undefined });
    const v = variantFor(t, 2, 'b');
    assert.equal(v.motion, null);
    assert.equal(v.trans, null);
    assert.equal(v.lenScale, 1);
  });
});

// ── binding ──────────────────────────────────────────────────────────

describe('bindTemplate', () => {
  it('produces a valid Composition, which is what makes the output editable', () => {
    // Daniel's requirement is "80% there and I fix the rest", and that only
    // holds if a batch writes Compositions rather than a parallel shape the
    // editor cannot open.
    const comp = bindTemplate(montage(), { stills: STILLS }, { index: 0, seed: 'b' });
    assert.deepEqual(validate(comp), []);
    assert.equal(comp.size.width, 1080);
    assert.equal(comp.fps, 30);
  });

  it('takes up to max items and no more', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ kind: 'clip', url: `x${i}.jpg`, duration: 5 }));
    const comp = bindTemplate(montage(), { stills: many }, { seed: 'b' });
    assert.equal(itemsOf(comp).length, 6, 'the slot caps at max');
  });

  it('throws when a slot is under-filled rather than making a short video', () => {
    assert.throws(
      () => bindTemplate(montage(), { stills: STILLS.slice(0, 1) }, { seed: 'b' }),
      /needs at least 3 items and got 1/
    );
  });

  it('throws on content naming a slot the template does not have', () => {
    assert.throws(
      () => bindTemplate(montage(), { stlls: STILLS }, { seed: 'b' }),
      /does not have/
    );
  });

  it('refuses an invalid template rather than binding it anyway', () => {
    assert.throws(
      () => bindTemplate(montage({ fps: 999 }), { stills: STILLS }),
      /is invalid/
    );
  });

  it('overlaps items for a transition, because a transition IS the overlap', () => {
    const comp = bindTemplate(montage(), { stills: STILLS }, { index: 0, seed: 'b' });
    const items = itemsOf(comp);
    assert.ok(items.length > 1);
    const firstEnd = items[0].at + items[0].len;
    assert.ok(
      items[1].at < firstEnd,
      'the second item starts before the first ends, or there is no transition'
    );
    assert.equal(items[1].trans?.type, 'fade');
  });

  it('gives the first item no transition to come from', () => {
    const comp = bindTemplate(montage(), { stills: STILLS }, { seed: 'b' });
    assert.equal(itemsOf(comp)[0].trans, undefined);
  });

  it('carries the motion as a transform the renderer can draw', () => {
    const comp = bindTemplate(montage(), { stills: STILLS }, { index: 0, seed: 'b' });
    const first = itemsOf(comp)[0];
    assert.deepEqual(first.scale, { from: 1.0, to: 1.12 }, 'push-in at index 0');
  });

  it('carries a reason, so an unattended batch is reviewable', () => {
    const comp = bindTemplate(montage(), { stills: STILLS }, { seed: 'b' });
    const first = itemsOf(comp)[0];
    assert.match(first.reason, /Stills montage/);
    assert.ok(first.beat, 'and which motion it used');
  });

  it('puts an audio slot on its own audio track with no transform', () => {
    const t = montage({
      slots: [
        { id: 'stills', kind: 'still', min: 2, max: 4, len: { min: 3, max: 3 }, track: 0 },
        { id: 'music', kind: 'audio', min: 1, max: 1, len: { min: 12, max: 12 }, track: 1 },
      ],
    });
    const comp = bindTemplate(t, {
      stills: STILLS,
      music: { kind: 'audio', url: 'm.mp3', duration: 30 },
    }, { seed: 'b' });
    assert.deepEqual(validate(comp), []);
    const audioTrack = comp.tracks.find((tr) => tr.kind === 'audio');
    assert.ok(audioTrack, 'an audio slot made an audio track');
    const item = audioTrack.items[0];
    assert.equal(item.scale, undefined, 'music does not get a camera move');
  });

  it('gives two items of one batch different treatments', () => {
    // The whole point. If these come out identical, thirty of them will too.
    const a = bindTemplate(montage(), { stills: STILLS }, { index: 0, seed: 'b' });
    const b = bindTemplate(montage(), { stills: STILLS }, { index: 1, seed: 'b' });
    assert.notEqual(itemsOf(a)[0].len, itemsOf(b)[0].len, 'lengths differ');
    assert.notDeepEqual(itemsOf(a)[0].scale, itemsOf(b)[0].scale, 'moves differ');
  });

  it('rotates the transition even when the slot names one', () => {
    // The fault this guards: the slot's own `trans` took precedence over the
    // variation's rotation, so a template whose slot named a transition got
    // that one transition on every item of every video in the batch, with the
    // rotation list sitting unused beside it. The slot's value is the default
    // for a template with no variation, not an override of it.
    const t = montage();           // slot says 'fade', rotation is ['fade','fadeblack']
    const trans = (i) => {
      const comp = bindTemplate(t, { stills: STILLS }, { index: i, seed: 'b' });
      return itemsOf(comp)[1].trans?.type;   // item 0 has nothing to cut from
    };
    assert.equal(trans(0), 'fade');
    assert.equal(
      trans(1), 'fadeblack',
      'the variation rotation wins over the slot default, or it is decoration'
    );
  });

  it('lets a rotation ask for a hard cut on some items and a fade on others', () => {
    // A null entry in the rotation is a hard cut, and it is the only way to
    // express "cut between two unrelated mastheads, fade where two shots of
    // the same spread sit together". The fault this guards: `variant.trans ||
    // slot.trans` read a null entry as "no opinion" and substituted the
    // slot's fade, so a rotation of [null, 'fade'] faded every item and the
    // cut never happened. coverage-roundup.json is shipped with exactly that
    // rotation, so this is not a hypothetical.
    const t = montage({ variation: { trans: [null, 'fade'], lenJitter: 0.1 } });
    assert.deepEqual(validateTemplate(t), [], 'null is a legal rotation entry');
    const transAt = (i) =>
      itemsOf(bindTemplate(t, { stills: STILLS }, { index: i, seed: 'b' }))[1].trans;
    assert.equal(transAt(0), undefined, 'a null entry is a hard cut, not the slot default');
    assert.equal(transAt(1)?.type, 'fade');
  });

  it('is reproducible on timing and treatment for one seed', () => {
    // Not byte-identical: nextId carries a timestamp, so the ids differ
    // between builds. The fields are what has to match.
    const fields = (c) => itemsOf(c).map((i) => ({ at: i.at, len: i.len, scale: i.scale, trans: i.trans }));
    const a = bindTemplate(montage(), { stills: STILLS }, { index: 2, seed: 'x' });
    const b = bindTemplate(montage(), { stills: STILLS }, { index: 2, seed: 'x' });
    assert.deepEqual(fields(a), fields(b));
  });
});

describe('the version', () => {
  it('is pinned, so a stored template choice can be read back', () => {
    assert.equal(TEMPLATE_VERSION, 1);
  });
});

// ── on-screen type ───────────────────────────────────────────────────

describe('text slots', () => {
  const withText = (over = {}) => montage({
    slots: [
      { id: 'stills', kind: 'still', min: 3, max: 6, len: { min: 3, max: 3 }, track: 0 },
      {
        id: 'titles', kind: 'text', min: 1, max: 3, len: { min: 2, max: 2 }, track: 1, ...over,
      },
    ],
    variation: { lenJitter: 0 },
  });

  it('takes lines of text, not sources', () => {
    // The words come from the brief, not the asset library. Passing a source
    // used to sail through and put a jpg where a title belonged.
    assert.throws(
      () => bindTemplate(withText(), { stills: STILLS, titles: [STILLS[0]] }, { seed: 'b' }),
      /text slot, so it takes lines of text/
    );
  });

  it('makes exactly one caption source, because the renderer burns one ASS', () => {
    const comp = bindTemplate(
      withText(), { stills: STILLS, titles: ['Approach', 'Threshold'] }, { seed: 'b' }
    );
    const caps = Object.values(comp.sources).filter((s) => s.kind === 'captions');
    assert.equal(caps.length, 1);
    assert.equal(caps[0].template, 'gallery-quiet', 'the template chose the preset');
    assert.equal(caps[0].perLine, 1, 'one cue is one line, or a title breaks at the third word');
    assert.deepEqual(caps[0].transcript.map((c) => c.word), ['Approach', 'Threshold']);
  });

  it('writes ABSOLUTE cue times, because the burned ASS is global', () => {
    // An item's `at` does not offset the ASS. A cue timed from inside its
    // item would put every line at the top of the video.
    const comp = bindTemplate(
      withText(), { stills: STILLS, titles: ['One', 'Two'] }, { seed: 'b' }
    );
    const cues = Object.values(comp.sources).find((s) => s.kind === 'captions').transcript;
    assert.equal(cues[0].start, 0);
    assert.ok(cues[1].start >= 2, `the second line starts later, got ${cues[1].start}`);
  });

  it('refuses two text slots, which would need two caption sources', () => {
    const t = montage({
      slots: [
        { id: 'a', kind: 'text', min: 1, max: 1, track: 0 },
        { id: 'b', kind: 'text', min: 1, max: 1, track: 1 },
      ],
    });
    assert.match(validateTemplate(t).join(' '), /2 text slots/);
  });

  it('makes a template with type AND a clip say which the preset styles', () => {
    // Guessing from slot kinds gets it wrong: a walkthrough's clips are
    // b-roll, not somebody speaking.
    const t = montage({
      slots: [
        { id: 'footage', kind: 'clip', min: 1, max: 3, track: 0 },
        { id: 'labels', kind: 'text', min: 1, max: 3, track: 1 },
      ],
    });
    assert.match(validateTemplate(t).join(' '), /caption\.from must name which/);
    assert.deepEqual(
      validateTemplate({ ...t, caption: { preset: 'gallery-quiet', from: 'labels' } }), []
    );
  });

  it('captions a clip BY REFERENCE, because the words do not exist yet', () => {
    // Spoken captions are resolved after transcription, so the source holds
    // the id of the clip whose words to use.
    const t = montage({
      slots: [{ id: 'speech', kind: 'clip', min: 1, max: 1, len: { min: 20, max: 20 }, track: 0 }],
      caption: { preset: 'gallery' },
      variation: { lenJitter: 0 },
    });
    const comp = bindTemplate(t, { speech: STILLS[0] }, { seed: 'b' });
    const cap = Object.values(comp.sources).find((s) => s.kind === 'captions');
    assert.equal(typeof cap.transcript, 'string', 'a source id, not an array of words');
    assert.equal(comp.sources[cap.transcript].kind, 'clip');
  });
});

// ── alignment ────────────────────────────────────────────────────────

describe('alignTo', () => {
  const aligned = (over = {}) => montage({
    slots: [
      { id: 'shots', kind: 'clip', min: 1, max: 5, len: { min: 6, max: 6 }, track: 0 },
      {
        id: 'labels',
        kind: 'text',
        min: 1,
        max: 5,
        len: { min: 2, max: 2 },
        track: 1,
        alignTo: 'shots',
        ...over,
      },
    ],
    caption: { preset: 'gallery-quiet', from: 'labels' },
    variation: { lenJitter: 0 },
  });

  it('puts line N at the time of item N of the slot it names', () => {
    // The fault this guards: every slot ran on its own clock, so a
    // walkthrough's five 2.4s labels were finished by 15s while the footage
    // ran to 25s, and four of them sat over the wrong shot.
    const comp = bindTemplate(aligned(), {
      shots: [STILLS[0], STILLS[1], STILLS[2]],
      labels: ['Approach', 'Threshold', 'The room'],
    }, { seed: 'b' });
    const at = (needle) => comp.tracks.flatMap((tr) => tr.items)
      .filter((i) => (i.reason || '').includes(needle))
      .sort((a, b) => a.at - b.at).map((i) => i.at);
    assert.deepEqual(at('on-screen type'), at('slot shots'), 'no drift at all');
  });

  it('clamps the line to its own length rather than stretching it to the shot', () => {
    const comp = bindTemplate(aligned(), {
      shots: [STILLS[0]], labels: ['Approach'],
    }, { seed: 'b' });
    const type = comp.tracks.flatMap((tr) => tr.items)
      .find((i) => (i.reason || '').includes('on-screen type'));
    assert.equal(type.len, 2, 'a label appears and leaves; it does not run the whole shot');
  });

  it('refuses more lines than there are items to sit on', () => {
    assert.throws(() => bindTemplate(aligned(), {
      shots: [STILLS[0], STILLS[1]],
      labels: ['One', 'Two', 'Three'],
    }, { seed: 'b' }), /aligns to "shots" and got 3 for 2/);
  });

  it('refuses a forward reference, which would align to nothing', () => {
    const t = montage({
      slots: [
        { id: 'labels', kind: 'text', min: 1, max: 1, track: 1, alignTo: 'shots' },
        { id: 'shots', kind: 'clip', min: 1, max: 1, track: 0 },
      ],
      caption: { preset: 'gallery-quiet', from: 'labels' },
    });
    assert.match(validateTemplate(t).join(' '), /alignTo "shots" is not a slot declared before/);
  });

  it('refuses aligning to itself', () => {
    assert.match(
      validateTemplate(aligned({ alignTo: 'labels' })).join(' '),
      /alignTo points at itself/
    );
  });
});

// ── the eight shipped templates ──────────────────────────────────────

/**
 * These read the real files in shared/templates/. The point is not that the
 * loader works: it is that a shipped template cannot rot. A template is data,
 * so nothing about it is compiled, type-checked or exercised by any other
 * test, and a field renamed in the module leaves eight JSON files quietly
 * declaring the old one. That is how a batch of thirty goes out wrong.
 */
describe('the shipped templates', () => {
  const DIR = path.join(__dirname, '..', '..', 'shared', 'templates');
  const PRESETS = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'captions', 'presets.json'), 'utf8')
  ).styles;
  const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();

  // Only the fields the binder reads. A template declaring anything else is
  // claiming behaviour nothing implements, which is worse than not having it:
  // the next person reads the JSON and believes it.
  const TOP = ['id', 'name', 'description', 'bestFor', 'register', 'size', 'fps', 'slots', 'caption', 'variation'];
  const SLOT = ['id', 'kind', 'min', 'max', 'len', 'motion', 'trans', 'track', 'alignTo'];

  it('ships eight of them', () => {
    assert.equal(FILES.length, 8, `found ${FILES.join(', ')}`);
  });

  const source = (kind, n) => {
    if (kind === 'audio') return { kind: 'audio', url: `${n}.mp3`, duration: 180 };
    if (kind === 'design') return { kind: 'design', project: n };
    return { kind: 'clip', url: `${n}.jpg`, duration: 60, width: 1080, height: 1920, fps: 30 };
  };

  for (const file of FILES) {
    const t = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));

    describe(file, () => {
      it('is named after its id, so the picker can find it', () => {
        assert.equal(`${t.id}.json`, file);
      });

      it('validates', () => {
        assert.deepEqual(validateTemplate(t), []);
      });

      it('declares only fields the binder reads', () => {
        assert.deepEqual(Object.keys(t).filter((k) => !TOP.includes(k)), []);
        for (const s of t.slots) {
          assert.deepEqual(
            Object.keys(s).filter((k) => !SLOT.includes(k)), [],
            `slot ${s.id} declares a field nothing reads`
          );
        }
        if (t.caption) {
          assert.deepEqual(Object.keys(t.caption).filter((k) => !['preset', 'from'].includes(k)), []);
        }
        if (t.variation) {
          assert.deepEqual(
            Object.keys(t.variation).filter((k) => !['motion', 'trans', 'lenJitter'].includes(k)), []
          );
        }
      });

      it('names a caption preset that exists', () => {
        if (!t.caption?.preset) return;
        assert.ok(
          PRESETS[t.caption.preset],
          `"${t.caption.preset}" is not in shared/captions/presets.json`
        );
      });

      it('has copy for the picker, which is how it gets chosen', () => {
        assert.ok(t.name && t.name.length > 2, 'a name');
        assert.ok(t.description && t.description.length > 20, 'a description');
        assert.ok(t.bestFor && t.bestFor.length > 20, 'what it is for');
      });

      it('binds to a valid composition at minimum fill', () => {
        const content = {};
        for (const s of t.slots) {
          const n = s.min ?? 1;
          if (!n) continue;
          const items = Array.from({ length: n }, (_, i) => (
            s.kind === 'text' ? `Line ${i + 1}` : source(s.kind, `${s.id}${i}`)
          ));
          content[s.id] = (s.max === 1) ? items[0] : items;
        }
        const comp = bindTemplate(t, content, { index: 0, seed: 'ship' });
        assert.deepEqual(validate(comp), []);
      });

      it('binds to a valid composition at maximum fill, with one caption source', () => {
        const content = {};
        for (const s of t.slots) {
          const n = s.max ?? s.min ?? 1;
          if (!n) continue;
          const items = Array.from({ length: n }, (_, i) => (
            s.kind === 'text' ? `Line ${i + 1}` : source(s.kind, `${s.id}${i}`)
          ));
          content[s.id] = (s.max === 1) ? items[0] : items;
        }
        const comp = bindTemplate(t, content, { index: 7, seed: 'ship' });
        assert.deepEqual(validate(comp), []);
        const caps = Object.values(comp.sources).filter((s) => s.kind === 'captions');
        assert.ok(caps.length <= 1, `${caps.length} caption sources; the renderer burns one`);
      });

      it('lands inside the length a social feed will watch', () => {
        const content = {};
        for (const s of t.slots) {
          const n = s.max ?? s.min ?? 1;
          if (!n) continue;
          const items = Array.from({ length: n }, (_, i) => (
            s.kind === 'text' ? `Line ${i + 1}` : source(s.kind, `${s.id}${i}`)
          ));
          content[s.id] = (s.max === 1) ? items[0] : items;
        }
        const comp = bindTemplate(t, content, { index: 7, seed: 'ship' });
        const dur = comp.tracks
          .flatMap((tr) => tr.items.map((i) => i.at + i.len))
          .reduce((a, b) => Math.max(a, b), 0);
        // 90s is the reel ceiling. A template whose MAXIMUM fill runs past
        // 60s is being used for the wrong job, and at full fill in a batch
        // nobody is watching the clock.
        assert.ok(dur > 5 && dur <= 60, `${t.id} runs ${dur.toFixed(1)}s at full fill`);
      });
    });
  }
});

// ── the loader ───────────────────────────────────────────────────────

describe('the template loader', () => {
  const loader = require('../src/services/compositionTemplates');

  it('offers every shipped template', () => {
    assert.equal(loader.all().length, 8);
    assert.deepEqual(loader.problems(), [], 'a shipped template stopped validating');
  });

  it('finds one by id and returns null for an unknown one', () => {
    assert.equal(loader.byId('walkthrough').id, 'walkthrough');
    assert.equal(loader.byId('does-not-exist'), null);
    assert.equal(loader.byId(''), null);
    assert.equal(loader.byId(undefined), null);
  });

  it('summarises what the operator has to supply, which is the picker question', () => {
    // "What do I have to upload" is a count per kind, not a slot array.
    const m = loader.list().find((t) => t.id === 'stills-montage');
    const stills = m.needs.find((n) => n.slot === 'stills');
    assert.deepEqual(stills, { slot: 'stills', kind: 'still', min: 6, max: 8 });
    assert.ok(m.optional.some((o) => o.slot === 'endcard'), 'min 0 is optional, not required');
    assert.ok(!m.needs.some((n) => n.slot === 'endcard'));
  });

  it('carries the caption preset, so the picker can show the register', () => {
    for (const t of loader.list()) {
      assert.ok('captionPreset' in t, `${t.id} does not say which type it uses`);
    }
  });

  it('does not leak the slot array into the summary', () => {
    // The summary is a contract with the picker. Sending slots whole invites
    // the frontend to read fields the binder owns, and then a schema change
    // breaks a page rather than a test.
    for (const t of loader.list()) {
      assert.equal(t.slots, undefined, `${t.id} leaked its slots`);
      assert.equal(t.variation, undefined, `${t.id} leaked its variation`);
    }
  });
});
