/**
 * A composition template, and binding one to content.
 *
 * A template is a Composition with named SLOTS in place of fixed sources. It
 * is the keystone of the batch build: bulk is meaningless without one,
 * because thirty videos means one shape bound thirty times to different
 * content rather than thirty editing sessions.
 *
 * Templates ship as DATA in `shared/compositions/templates/*.json`, not as
 * code and not in a table. That is the pattern migration 211 set for the
 * caption presets, and its comment states the reasoning: a template is only
 * meaningful alongside the compiler that reads it, so the two ship together,
 * and what belongs in the database is the operator's choice.
 *
 * Everything here is pure. No I/O, no DOM, no side effects, and no
 * Math.random.
 *
 * WHAT "REPRODUCIBLE" MEANS HERE, precisely, because the looser claim was in
 * this comment first and was not true: the same seed and content give the
 * same TIMING AND TREATMENT every time, which is every length, motion and
 * transition. The generated ids differ between builds, because `nextId` in
 * composition.mjs carries a timestamp, so two builds of one template are not
 * byte-identical. Compare them on the fields rather than by stringifying, and
 * if stable ids are ever wanted (to diff two builds of a batch, say) that is
 * a change to `nextId` and not something to paper over here.
 */

import {
  emptyComposition, addSource, addTrack, addItem, secs, validate,
} from './composition.mjs';

export const TEMPLATE_VERSION = 1;

// ── The motion vocabulary ─────────────────────────────────────────────
//
// Six presets, the same words `services/stillsReel.js` has always used, so an
// operator who knows "push-in" from the old stills reel reads the same thing
// here. What changed is what they mean underneath: these are DETERMINISTIC
// camera moves, an animated `scale` and `pos` rendered inside our own filter
// graph, rather than a hosted image-to-video call.
//
// That was Daniel's decision (Path B, 8 November) and it is worth restating
// where the mapping lives: a generated move costs $0.20 to $0.45 per clip,
// takes one to three minutes, sometimes fails, and on architecture bows the
// straight lines that the client is paying to have photographed straight. A
// camera move costs nothing, renders in under a second, never fails, and
// leaves the geometry alone.
//
// Values are deliberately restrained. A slow move over a still reads as
// expensive; a fast one reads as a screensaver.
export const MOTIONS = {
  'push-in': { scale: { from: 1.0, to: 1.12 } },
  reveal: { scale: { from: 1.14, to: 1.0 } },
  drift: {
    scale: 1.08,
    pos: { from: { x: -0.035, y: 0 }, to: { x: 0.035, y: 0 } },
  },
  rise: {
    scale: 1.08,
    pos: { from: { x: 0, y: 0.035 }, to: { x: 0, y: -0.035 } },
  },
  orbit: {
    scale: { from: 1.06, to: 1.12 },
    pos: { from: { x: -0.025, y: 0.015 }, to: { x: 0.025, y: -0.015 } },
  },
  subtle: { scale: { from: 1.0, to: 1.035 } },
};

export const MOTION_NAMES = Object.keys(MOTIONS);

/** The transform fields a motion contributes to an item. */
export function transformFor(motion) {
  const m = MOTIONS[motion];
  if (!m) return {};
  // Copied rather than shared, or two items on one motion would hold the same
  // object and a later edit to one would move the other.
  return JSON.parse(JSON.stringify(m));
}

// ── Validation ────────────────────────────────────────────────────────

const SLOT_KINDS = ['clip', 'still', 'design', 'text', 'audio'];
const REGISTERS = ['editorial', 'creator'];
// `dissolve` is absent on purpose and must stay absent. Despite the name it is
// a per-pixel random-threshold dither, not a cross-fade, and the noise it
// makes is uncompressible: the same 11-second reel measured 6.24MB with
// dissolve against 0.54MB with fade. A template rotating onto it would
// inflate every file in a batch of thirty.
const TEMPLATE_TRANSITIONS = ['fade', 'fadeblack', 'wipeleft'];

function validateSlot(slot, i) {
  const at = `slot ${slot?.id || i}`;
  if (!slot || typeof slot !== 'object') return `${at}: not an object`;
  if (!slot.id) return `${at}: needs an id`;
  if (!SLOT_KINDS.includes(slot.kind)) {
    return `${at}: unknown kind "${slot.kind}" (${SLOT_KINDS.join(', ')})`;
  }
  const min = slot.min ?? 1;
  const max = slot.max ?? min;
  if (!Number.isFinite(min) || min < 0) return `${at}: min must be a non-negative number`;
  if (!Number.isFinite(max) || max < min) return `${at}: max must be at least min`;
  if (slot.len != null) {
    const { min: lo, max: hi } = slot.len;
    if (!Number.isFinite(lo) || lo <= 0) return `${at}: len.min must be positive`;
    if (!Number.isFinite(hi) || hi < lo) return `${at}: len.max must be at least len.min`;
  }
  if (slot.motion != null && !MOTIONS[slot.motion]) {
    return `${at}: unknown motion "${slot.motion}" (${MOTION_NAMES.join(', ')})`;
  }
  if (slot.trans != null && !TEMPLATE_TRANSITIONS.includes(slot.trans)) {
    return `${at}: transition "${slot.trans}" is not one a template may use`
      + ` (${TEMPLATE_TRANSITIONS.join(', ')})`;
  }
  if (slot.track != null && (!Number.isInteger(slot.track) || slot.track < 0)) {
    return `${at}: track must be a non-negative integer`;
  }
  return null;
}

export function validateTemplate(t) {
  const errors = [];
  if (!t || typeof t !== 'object') return ['not an object'];
  if (!t.id) errors.push('needs an id');
  if (!t.name) errors.push('needs a name');
  if (t.register != null && !REGISTERS.includes(t.register)) {
    errors.push(`unknown register "${t.register}" (${REGISTERS.join(', ')})`);
  }
  if (!t.size || !Number.isFinite(t.size.width) || !Number.isFinite(t.size.height)
      || t.size.width < 1 || t.size.height < 1) {
    errors.push('size must have positive width and height');
  }
  if (!Number.isFinite(t.fps) || t.fps < 1 || t.fps > 120) errors.push('fps must be 1..120');
  if (!Array.isArray(t.slots) || !t.slots.length) {
    errors.push('needs at least one slot');
  } else {
    const seen = new Set();
    t.slots.forEach((s, i) => {
      const err = validateSlot(s, i);
      if (err) errors.push(err);
      if (s?.id) {
        if (seen.has(s.id)) errors.push(`duplicate slot id "${s.id}"`);
        seen.add(s.id);
      }
      // `alignTo` must already have been laid out, because alignment reads
      // the other slot's placements. Declaration order is the binder's order,
      // so a forward reference is an error rather than an empty result.
      if (s?.alignTo != null) {
        if (s.alignTo === s.id) errors.push(`slot ${s.id}: alignTo points at itself`);
        else if (!seen.has(s.alignTo)) {
          errors.push(
            `slot ${s.id}: alignTo "${s.alignTo}" is not a slot declared before it`
          );
        }
      }
    });

    // The renderer burns ONE ASS track, so a composition can carry one
    // caption source and no more. Both of these would produce two, and the
    // old renderer rendered the first and dropped the rest without a word.
    // Refuse the template instead: a batch of thirty is the worst place to
    // find out which half of the type went missing.
    const textSlots = t.slots.filter((s) => s?.kind === 'text');
    if (textSlots.length > 1) {
      errors.push(
        `${textSlots.length} text slots (${textSlots.map((s) => s.id).join(', ')}),`
        + ' and one composition can carry one caption source. Put the lines in one slot.'
      );
    }
    // Which words the preset styles. A template with both on-screen type and
    // a clip has two candidates and only one caption source to put them in,
    // and guessing from slot kinds gets it wrong: a walkthrough's clips are
    // b-roll, not somebody speaking. So the template says, and if it has a
    // choice to make and has not made it, that is an error here rather than a
    // coin toss thirty videos deep.
    const clipSlots = t.slots.filter((s) => s?.kind === 'clip');
    const from = t.caption?.from;
    if (from != null) {
      const target = t.slots.find((s) => s?.id === from);
      if (!target) {
        errors.push(`caption.from "${from}" is not a slot of this template`);
      } else if (target.kind !== 'text' && target.kind !== 'clip') {
        errors.push(
          `caption.from "${from}" is a ${target.kind} slot, and captions come from`
          + ' a text slot (on-screen type) or a clip slot (spoken words)'
        );
      }
    } else if (t.caption?.preset && textSlots.length && clipSlots.length) {
      errors.push(
        'this template has on-screen type and a clip, so caption.from must name which'
        + ` the preset styles (${[...textSlots, ...clipSlots].map((s) => s.id).join(', ')}).`
        + ' One composition carries one caption source.'
      );
    }
  }

  // Variation is not optional decoration. Thirty videos with identical
  // pacing and an identical move reads as filler and damages the feed they
  // are posted to, so a template that offers no variation is a template that
  // will embarrass somebody at scale.
  const v = t.variation;
  if (v != null) {
    if (typeof v !== 'object') errors.push('variation must be an object');
    else {
      for (const m of v.motion || []) {
        if (!MOTIONS[m]) errors.push(`variation motion "${m}" is not a known motion`);
      }
      // A null entry in the rotation is a HARD CUT, and it is the only way a
      // template can ask for one on some items and a fade on others. A press
      // roundup wants exactly that: cut between two unrelated mastheads, fade
      // where two shots of the same spread sit together. Rejecting null left
      // the rotation unable to express the thing it exists for.
      for (const x of v.trans || []) {
        if (x != null && !TEMPLATE_TRANSITIONS.includes(x)) {
          errors.push(`variation transition "${x}" is not one a template may use`);
        }
      }
      if (v.lenJitter != null
          && (!Number.isFinite(v.lenJitter) || v.lenJitter < 0 || v.lenJitter > 0.5)) {
        errors.push('variation.lenJitter must be 0..0.5');
      }
    }
  }
  return errors;
}

export function isValidTemplate(t) {
  return validateTemplate(t).length === 0;
}

// ── Seeded variation ──────────────────────────────────────────────────

/**
 * A small deterministic hash, so item N of a batch always gets the same
 * variant. Math.random would make a batch unreproducible and its tests
 * meaningless; a counter alone would make every batch identical to the last.
 */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Avalanche, and this is load-bearing rather than tidiness. Without it the
  // index sits at the end of the string and contributes one xor and one
  // multiply, so consecutive indices came out nearly identical: three items
  // of one batch measured 3.234s, 3.237s and 3.241s, which is the lengths
  // marching in step, which is the thing the jitter exists to prevent.
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * The variant for one item of a batch: which motion, which transition, and
 * how much to stretch its length.
 *
 * Rotated rather than randomised, so a batch of thirty cycles through the
 * template's options instead of landing on the same one eleven times by
 * chance. The jitter is hashed from the seed and the index together, so two
 * batches of the same content under different seeds differ, and the same
 * batch re-run is identical.
 */
export function variantFor(template, index, seed = '') {
  const v = template.variation || {};
  const motions = (v.motion && v.motion.length) ? v.motion : null;
  const transitions = (v.trans && v.trans.length) ? v.trans : null;
  const jitterRange = v.lenJitter || 0;
  const r = hash(`${seed}:${template.id}:${index}`);
  return {
    motion: motions ? motions[index % motions.length] : null,
    // Three states, not two. `hasTrans` false means the variation has no
    // opinion and the slot's own default stands; true with `trans` null means
    // the variation asked for a hard cut on THIS item. Collapsing those two
    // into a bare null is what made a rotation of [null, 'fade'] come out as
    // the slot's fade on every item.
    hasTrans: !!transitions,
    trans: transitions ? transitions[index % transitions.length] : null,
    // Centred on 1, so a jitter of 0.15 means plus or minus 15% and the
    // average item keeps the length the template asked for.
    lenScale: 1 + (r * 2 - 1) * jitterRange,
  };
}

// ── Binding ───────────────────────────────────────────────────────────

/**
 * Bind a template to content, producing a Composition.
 *
 * `content` maps a slot id to what fills it:
 *
 *   {
 *     stills: [{ kind: 'clip', asset, url, duration, width, height, fps }, ...],
 *     music:  { kind: 'audio', asset, url, duration },
 *     titles: ['Grade II listed, reimagined', 'Hackney, 2026'],
 *   }
 *
 * A `text` slot takes STRINGS, not sources, because the words come from the
 * brief rather than the asset library. Each line becomes one cue in a single
 * caption source carrying the template's preset, with absolute times: the
 * burned ASS is global to the composition, so a cue's time is where it sits
 * on the finished video, not an offset inside an item.
 *
 * The result is an ordinary Composition, which is the whole point: every
 * batch output opens in the editor with the same timeline, inspector, undo
 * and re-export as something built by hand. Daniel's requirement was "80%
 * there and I fix the rest", and that only holds if the batch writes
 * Compositions rather than some parallel shape.
 *
 * Throws rather than guesses. A slot with too few items, a template that
 * produces an invalid composition, an unknown slot in the content: each is a
 * bug in the template or the caller, and a batch of thirty is exactly where a
 * silent fallback becomes thirty wrong videos.
 */
export function bindTemplate(template, content = {}, opts = {}) {
  const errs = validateTemplate(template);
  if (errs.length) {
    throw new Error(`template "${template?.id || '?'}" is invalid: ${errs.join('; ')}`);
  }

  const { index = 0, seed = '' } = opts;
  const variant = variantFor(template, index, seed);

  let comp = emptyComposition({
    width: template.size.width,
    height: template.size.height,
    fps: template.fps,
  });

  for (const key of Object.keys(content)) {
    if (!template.slots.some((s) => s.id === key)) {
      throw new Error(
        `content names slot "${key}", which template "${template.id}" does not have`
        + ` (${template.slots.map((s) => s.id).join(', ')})`
      );
    }
  }

  // One track per distinct `track` index the slots ask for, created in order
  // so track 0 is the base and higher indices composite over it.
  const trackIds = new Map();
  const trackIndices = [...new Set(template.slots.map((s) => s.track ?? 0))].sort((a, b) => a - b);
  for (const ti of trackIndices) {
    const kinds = template.slots.filter((s) => (s.track ?? 0) === ti).map((s) => s.kind);
    const kind = kinds.every((k) => k === 'audio') ? 'audio' : 'video';
    const made = addTrack(comp, kind);
    comp = made.comp;
    trackIds.set(ti, made.id);
  }

  const textCues = [];
  const textPlacements = [];
  // Where each slot's items landed, so a later slot can align to them. A
  // section label belongs on the shot it names, and without this every slot
  // ran on its own clock: a walkthrough's five labels were done by 15s while
  // the footage ran to 25s, so four of them sat over the wrong shot.
  const placements = new Map();

  /**
   * The times for one slot's items: either the slot's own clock, or the
   * times of the slot it aligns to.
   */
  const timesFor = (slot, count, len, overlap) => {
    const target = slot.alignTo ? placements.get(slot.alignTo) : null;
    if (slot.alignTo && !target) {
      throw new Error(
        `slot "${slot.id}" of template "${template.id}" aligns to "${slot.alignTo}",`
        + ' which placed nothing. An optional slot cannot be an alignment target'
        + ' unless it is filled.'
      );
    }
    if (target) {
      if (count > target.length) {
        throw new Error(
          `slot "${slot.id}" of template "${template.id}" aligns to "${slot.alignTo}"`
          + ` and got ${count} for ${target.length}. Supply at most one per item of`
          + ` "${slot.alignTo}", or the extras would have nowhere to sit.`
        );
      }
      // Clamped, not stretched: a label may be shorter than its shot, and
      // running past it would leave type over the next one.
      return target.slice(0, count).map((p) => ({ at: p.at, len: Math.min(len, p.len) }));
    }
    const out = [];
    let at = 0;
    for (let i = 0; i < count; i += 1) {
      out.push({ at: secs(at), len });
      at = secs(at + len - overlap);
    }
    return out;
  };

  for (const slot of template.slots) {
    const supplied = content[slot.id];
    const items = Array.isArray(supplied) ? supplied : (supplied ? [supplied] : []);
    const min = slot.min ?? 1;
    if (items.length < min) {
      throw new Error(
        `slot "${slot.id}" of template "${template.id}" needs at least ${min} item`
        + `${min === 1 ? '' : 's'} and got ${items.length}`
      );
    }
    const max = slot.max ?? min;
    const used = items.slice(0, max);
    const trackId = trackIds.get(slot.track ?? 0);

    // Lengths: the midpoint of the slot's range, stretched by this item's
    // jitter, so a batch does not march in step.
    const lo = slot.len?.min ?? 3;
    const hi = slot.len?.max ?? lo;
    const baseLen = (lo + hi) / 2;
    const len = Math.max(0.1, secs(baseLen * variant.lenScale));

    // A transition is an OVERLAP in this model, so each item after the first
    // starts before the one before it ends. That is what deletes the
    // clamping machinery an explicit duration would need.
    //
    // VARIATION WINS over the slot's own setting, which is the opposite of
    // what looks natural and is the right way round. The slot says what this
    // template is by default; the variation says how it differs across a
    // batch, and that is its entire purpose. With slot precedence the
    // variation list was a silent no-op on every template whose slot named a
    // transition, which is most of them: three items of one batch all came
    // out `fade` with a rotation of two sitting unused beside them.
    //
    // `hasTrans` rather than a truthiness test, because a rotation entry of
    // null means a hard cut on this item and `||` would read that as "no
    // opinion" and fall back to the slot's fade.
    const trans = variant.hasTrans ? variant.trans : slot.trans;
    const overlap = trans ? Math.min(0.5, len / 4) : 0;

    // A text slot's lines are words, not sources. They are gathered here and
    // committed as ONE caption source after the loop, because the renderer
    // burns a single ASS track and a second caption source would throw.
    const times = timesFor(slot, used.length, len, overlap);

    if (slot.kind === 'text') {
      used.forEach((line, i) => {
        if (typeof line !== 'string' || !line.trim()) {
          throw new Error(
            `slot "${slot.id}" of template "${template.id}" is a text slot, so it takes`
            + ` lines of text, and got ${line === null ? 'null' : typeof line}`
          );
        }
        const t = times[i];
        textCues.push({ word: line.trim(), start: t.at, end: secs(t.at + t.len) });
        textPlacements.push({ trackId, at: t.at, len: t.len });
      });
      placements.set(slot.id, times);
      continue;
    }

    for (let i = 0; i < used.length; i += 1) {
      const spec = used[i];
      const at = times[i].at;
      // A `still` slot holds a photograph, and the render path has to know:
      // a still has no audio stream and its input needs looping. The slot
      // already says so, so the source carries it rather than the renderer
      // guessing from a file extension.
      const made = addSource(comp, slot.kind === 'still' ? { ...spec, still: true } : spec);
      comp = made.comp;

      const isAudio = spec.kind === 'audio';
      // Variation first, for the same reason as the transition above.
      const motion = isAudio ? null : (variant.motion || slot.motion);
      const item = {
        at: secs(at),
        len,
        source: made.id,
        ...(spec.in != null ? { in: secs(spec.in) } : {}),
        ...(motion ? transformFor(motion) : {}),
        ...(i > 0 && trans ? { trans: { type: trans } } : {}),
        // Why this item is here, carried so an unattended batch's output is
        // reviewable. The renderer ignores these.
        reason: `${template.name} · slot ${slot.id}`,
        ...(motion ? { beat: motion } : {}),
      };
      const placed = addItem(comp, trackId, item);
      comp = placed.comp;
    }
    placements.set(slot.id, times);
  }

  // Captions, at most one source, for the reason given at the text branch.
  //
  // Two kinds of words reach a finished video and they arrive at different
  // times. On-screen type is known now: the brief supplied it, so it becomes
  // literal cues. Spoken captions are not: they come from transcribing the
  // clip, which happens after the upload, so the source holds the id of the
  // clip whose words to use and the renderer resolves it. A template asking
  // for both is refused by validateTemplate rather than silently losing one.
  const preset = template.caption?.preset;
  if (preset) {
    // `caption.from` names the slot whose words these are. Absent, there is
    // only one candidate and it is whichever exists: the type if the brief
    // supplied any, else the clip.
    const from = template.caption.from;
    const fromSlot = from ? template.slots.find((s) => s.id === from) : null;
    const wantsText = fromSlot ? fromSlot.kind === 'text' : textCues.length > 0;
    if (wantsText && !textCues.length && fromSlot) {
      // The slot it names was optional and nobody filled it. No type, no
      // caption source, and that is not an error: `min: 0` said so.
    } else if (wantsText) {
      const made = addSource(comp, {
        kind: 'captions',
        transcript: textCues,
        template: preset,
        // One cue is one line. Without this the preset regroups the words
        // into threes and breaks a title at whatever word falls third.
        perLine: 1,
      });
      comp = made.comp;
      for (const p of textPlacements) {
        const placed = addItem(comp, p.trackId, {
          at: p.at,
          len: p.len,
          source: made.id,
          reason: `${template.name} · on-screen type`,
        });
        comp = placed.comp;
      }
    } else {
      // The preset is for the spoken word. The words are not known yet, so
      // the source holds the id of the clip whose transcript to use and the
      // renderer resolves it after transcription. Audio-only narration has no
      // transcript column behind it in this model, so it is left alone.
      const speech = fromSlot && fromSlot.kind === 'clip'
        ? fromSlot
        : template.slots.find((s) => s.kind === 'clip');
      const speechItem = speech
        ? comp.tracks.flatMap((tr) => tr.items.map((it) => ({ tr, it })))
          .find(({ it }) => it.reason === `${template.name} · slot ${speech.id}`)
        : null;
      if (speechItem) {
        const made = addSource(comp, {
          kind: 'captions',
          transcript: speechItem.it.source,
          template: preset,
        });
        comp = made.comp;
        const placed = addItem(comp, speechItem.tr.id, {
          at: speechItem.it.at,
          len: speechItem.it.len,
          source: made.id,
          reason: `${template.name} · spoken captions`,
        });
        comp = placed.comp;
      }
    }
  }

  const compErrs = validate(comp);
  if (compErrs.length) {
    throw new Error(
      `template "${template.id}" produced an invalid composition: ${compErrs.join('; ')}`
    );
  }
  return comp;
}
