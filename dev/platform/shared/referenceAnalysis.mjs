/**
 * Turning a finished video into a template proposal.
 *
 * Daniel's ask: "is there a way to upload someones video to be analysed and
 * build a template from it? a claude video analyser?" Yes, and it is a better
 * answer to "I want ten templates" than writing ten by hand.
 *
 * This module is the PURE half: measurements in, a template proposal out. The
 * ffmpeg that produces the measurements is
 * `backend/src/services/referenceAnalyse.js`.
 *
 * Three rules hold the whole thing honest, and they are the difference between
 * a useful tool and one that lies about what it will produce.
 *
 * **A PROPOSAL, not a template.** Every field carries a confidence and a
 * reason, and an operator confirms it. The output of this function is not
 * something to run thirty videos through; it is something to read, argue with
 * and accept.
 *
 * **It proposes from OUR vocabulary only.** The motions are the six in
 * `compositionTemplate.mjs`, the transitions are the three a template may use,
 * and the caption treatment is matched to one of the 31 shipped presets — it
 * is never invented. A generated approximation of somebody else's type is
 * exactly where this would start promising what it cannot deliver, which is
 * the fault the whole composition rewrite exists to remove. It is also where
 * reading a competitor's pacing stops being competitive analysis and starts
 * being an attempt to pass as them.
 *
 * **What cannot be recovered is said so, not guessed.** The fonts, the source
 * assets, the layering intent and anything behind the render are gone. A field
 * this cannot measure comes back `null` with a reason, never a plausible
 * invention.
 */

import { MOTIONS, MOTION_NAMES } from './compositionTemplate.mjs';

/** Shot lengths this proposes, clamped to something watchable. */
export const REF = {
  // Below this a "shot" is a flash or a detection artefact rather than a cut.
  min_shot_s: 0.4,
  // Above this it is not a cut rhythm, it is one long take.
  max_shot_s: 12,
  // A reference with fewer real shots than this has no rhythm to copy.
  min_shots: 3,
  // How much a shot must move before this proposes a camera move for it.
  moving_delta: 0.35,
  // And how much detail it needs before that reading means anything. Same
  // floor as the QC gate, for the same reason: a flat picture cannot show
  // movement, so a zero there is "unmeasurable", not "still".
  detail_floor: 3.0,
  // Confidence bands, named so they are arguable rather than vibes.
  high: 0.8,
  medium: 0.5,
  low: 0.25,
};

const round = (n, p = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** p) / 10 ** p : null);

function median(xs) {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Shot boundaries from a list of cut times.
 *
 * A cut list says where the picture changed; a shot list says how long each
 * one was held, which is what a template's `len` range is made of. Very short
 * "shots" are dropped: scene detection fires on a flash, a whip pan or a hard
 * caption change as well as on a cut, and a 0.1s shot in the distribution
 * would drag the proposed minimum below anything watchable.
 */
export function shotsFrom(cuts = [], duration = null) {
  const bounds = [0, ...cuts.filter((t) => Number.isFinite(t) && t > 0).sort((a, b) => a - b)];
  if (Number.isFinite(duration) && duration > 0) bounds.push(duration);
  const shots = [];
  for (let i = 1; i < bounds.length; i += 1) {
    const start = bounds[i - 1];
    const end = bounds[i];
    const len = end - start;
    if (len < REF.min_shot_s) continue;
    shots.push({ start: round(start), end: round(end), len: round(len) });
  }
  return shots;
}

/**
 * How much each shot moves, and whether that reading means anything.
 *
 * Reuses the measure the QC gate already takes: per-sample frame delta and the
 * frame's own detail. A shot with no detail is reported as unmeasurable rather
 * than still, because zooming a solid colour changes no pixels and calling
 * that "a static shot" would propose a cut-only template off a reference that
 * was full of movement.
 */
export function shotMotion(shots = [], motion = []) {
  return shots.map((shot) => {
    const inside = motion.filter((s) => s.end > shot.start && s.start < shot.end);
    const delta = median(inside.map((s) => s.delta));
    const detail = median(inside.map((s) => s.detail));
    const measurable = detail == null || detail >= REF.detail_floor;
    return {
      ...shot,
      delta: round(delta, 3),
      detail: round(detail, 2),
      moving: measurable && delta != null ? delta >= REF.moving_delta : null,
    };
  });
}

/**
 * Which of OUR motions a reference's movement most resembles.
 *
 * Deliberately coarse. The measurement is one number per shot — how much the
 * picture changed — and one number cannot distinguish a push from a drift,
 * because both move a similar quantity of pixels. So this proposes the gentlest
 * motion that moves at all, says that is what it is doing, and leaves the
 * choice to the operator. Pretending to read a specific preset off a single
 * scalar would be the invention this module exists not to make.
 */
export function motionFor(shotsWithMotion = []) {
  const measurable = shotsWithMotion.filter((s) => s.moving !== null);
  if (!measurable.length) {
    return {
      value: null,
      confidence: 0,
      why: 'every shot was too flat to tell movement from stillness',
    };
  }
  const movingShare = measurable.filter((s) => s.moving).length / measurable.length;
  if (movingShare < 0.25) {
    return {
      value: null,
      confidence: REF.high,
      why: `${Math.round((1 - movingShare) * 100)}% of shots held still, so no camera move`,
    };
  }
  // `subtle` is the gentlest of the six and the honest default: it says
  // "something moved" without claiming to know which preset.
  const value = MOTION_NAMES.includes('subtle') ? 'subtle' : MOTION_NAMES[0];
  return {
    value,
    confidence: movingShare > 0.75 ? REF.medium : REF.low,
    why: `${Math.round(movingShare * 100)}% of shots moved; one delta per shot cannot`
      + ` tell a push from a drift, so this proposes the gentlest of the ${MOTION_NAMES.length}`,
  };
}

/**
 * The cut rhythm as a slot length range.
 *
 * The interquartile range rather than the extremes: a reference almost always
 * has one long establishing shot and one two-frame flash, and proposing
 * min=0.4 max=12 off those is a template with no rhythm at all.
 */
export function lengthsFor(shots = []) {
  const lens = shots.map((s) => s.len).filter(Number.isFinite).sort((a, b) => a - b);
  if (lens.length < REF.min_shots) {
    return {
      value: null,
      confidence: 0,
      why: `only ${lens.length} shot${lens.length === 1 ? '' : 's'} over ${REF.min_shot_s}s;`
        + ` ${REF.min_shots} are needed before there is a rhythm to copy`,
    };
  }
  const q = (p) => lens[Math.min(lens.length - 1, Math.floor(p * lens.length))];
  const lo = Math.max(REF.min_shot_s, q(0.25));
  const hi = Math.min(REF.max_shot_s, Math.max(lo + 0.2, q(0.75)));
  const spread = hi - lo;
  return {
    value: { min: round(lo), max: round(hi) },
    // A tight interquartile range is a real rhythm; a wide one means the
    // reference mixes long takes with fast cuts and the single range this
    // produces is a compromise rather than a reading.
    confidence: spread < 1.5 ? REF.high : spread < 4 ? REF.medium : REF.low,
    why: `${lens.length} shots, middle half between ${round(lo)}s and ${round(hi)}s`
      + ` (median ${round(median(lens))}s)`,
  };
}

/**
 * Which caption preset this looks most like.
 *
 * NOT IMPLEMENTED HERE ON PURPOSE. Reading caption treatment needs sampled
 * frames, OCR and vision, and the one decision that matters is already made:
 * the answer must be one of the shipped presets, matched, never a generated
 * approximation. Until that half exists this returns a null with the reason,
 * which is the whole point of the confidence field — a proposal that says "I
 * could not read this" is usable, and one that guesses is not.
 */
export function captionFor(_measured = {}) {
  return {
    value: null,
    confidence: 0,
    why: 'caption treatment needs sampled frames and vision, which this pass does not do;'
      + ' pick from the shipped presets by eye',
  };
}

/**
 * Build a template proposal from what was measured.
 *
 * `m` is what the analyser found:
 *   { width, height, fps, duration, cuts: [t], motion: [{start,end,delta,detail}],
 *     loudnessLufs, truePeakDb }
 *
 * Returns `{ template, fields, says, confidence }`. `template` is a draft in
 * the schema `validateTemplate` accepts, so it can be checked before anybody
 * is shown it. `fields` is the per-field confidence and reasoning, which is
 * what an operator actually reads.
 */
export function propose(m = {}, { id = 'from-reference', name = 'From a reference' } = {}) {
  const duration = Number.isFinite(m.duration) ? m.duration : null;
  const shots = shotsFrom(m.cuts || [], duration);
  const withMotion = shotMotion(shots, m.motion || []);

  const len = lengthsFor(shots);
  const motion = motionFor(withMotion);
  const caption = captionFor(m);

  // The frame is the one thing a finished video states outright.
  const size = (Number.isFinite(m.width) && Number.isFinite(m.height))
    ? { value: { width: m.width, height: m.height }, confidence: 1, why: 'read from the file' }
    : { value: null, confidence: 0, why: 'the file did not report its size' };
  const fps = Number.isFinite(m.fps)
    ? { value: Math.round(m.fps), confidence: 1, why: `read from the file (${round(m.fps, 2)})` }
    : { value: null, confidence: 0, why: 'the file did not report a frame rate' };

  // How many pictures the shape wants. Not the shot count: a reference with
  // eleven shots proposes a slot that takes eight to twelve, because the next
  // batch will not have exactly eleven photographs either.
  const n = shots.length;
  const count = n >= REF.min_shots
    ? {
      value: { min: Math.max(2, Math.floor(n * 0.75)), max: Math.ceil(n * 1.15) },
      confidence: REF.medium,
      why: `${n} shots, proposed as a range because the next batch will not have exactly ${n}`,
    }
    : { value: null, confidence: 0, why: len.why };

  const fields = {
    size, fps, len, motion, caption, count,
    loudness: Number.isFinite(m.loudnessLufs)
      ? {
        value: round(m.loudnessLufs, 1),
        confidence: 1,
        why: 'measured, and recorded for reference only: nothing in this pipeline'
          + ' normalises loudness, so a template cannot ask for a level',
      }
      : { value: null, confidence: 0, why: 'no audio to measure' },
  };

  // The draft itself. Only fields that were actually read: a template that
  // states a constraint nothing measured is the lie this is built to avoid.
  const slot = {
    id: 'pictures',
    kind: 'still',
    min: count.value?.min ?? 3,
    max: count.value?.max ?? 6,
    track: 0,
  };
  if (len.value) slot.len = len.value;
  if (motion.value) slot.motion = motion.value;

  const template = {
    id,
    name,
    description: 'Proposed from a reference video. Read the notes before using it.',
    bestFor: 'Confirm or change this before running a batch through it.',
    register: 'editorial',
    size: size.value || { width: 1080, height: 1920 },
    fps: fps.value || 30,
    slots: [slot],
  };

  const graded = Object.values(fields).filter((f) => f.confidence > 0);
  const confidence = graded.length
    ? round(graded.reduce((a, f) => a + f.confidence, 0) / Object.keys(fields).length, 2)
    : 0;

  return {
    template,
    fields,
    confidence,
    shots: withMotion,
    says: summarise(shots, fields),
  };
}

/**
 * One paragraph an operator reads before deciding.
 *
 * Separate and exported because what somebody is told about a proposal is the
 * decision that determines whether they trust it, and that deserves its own
 * test.
 */
export function summarise(shots = [], fields = {}) {
  if (!shots.length) {
    return 'Nothing usable: no shots long enough to read a rhythm from.';
  }
  const bits = [`${shots.length} shot${shots.length === 1 ? '' : 's'}`];
  if (fields.len?.value) bits.push(`mostly ${fields.len.value.min}s to ${fields.len.value.max}s`);
  if (fields.motion?.value) bits.push(`with movement`);
  else if (fields.motion?.confidence >= REF.high) bits.push('held still');
  const unread = Object.entries(fields)
    .filter(([, f]) => f.confidence === 0)
    .map(([k]) => k);
  const tail = unread.length
    ? ` Could not read: ${unread.join(', ')}.`
    : '';
  return `${bits.join(', ')}.${tail}`;
}

/** The motions this may propose, so a caller can show the alternatives. */
export const PROPOSABLE_MOTIONS = MOTION_NAMES.slice();
export const MOTION_DETAIL = MOTIONS;
