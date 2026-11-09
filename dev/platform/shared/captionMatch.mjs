/**
 * Matching somebody else's caption treatment to one of OUR shipped presets.
 *
 * The reference analyser reads pacing, cut rhythm and motion off a finished
 * video. This is the other half of the question it could not answer: what the
 * type looks like. `referenceAnalysis.captionFor` returned a null with its
 * reason, and this is the reason being removed.
 *
 * ── The design decision that keeps this honest ─────────────────────────
 *
 * MATCH, NEVER GENERATE. The answer is always one of the 31 entries in
 * `shared/captions/presets.json`, because a generated approximation of
 * somebody else's type is where this feature would start lying about what it
 * will produce — the same fault the whole composition rewrite was built to
 * remove. A proposal an operator confirms, from our own set.
 *
 * ── The split between judgement and arithmetic ────────────────────────
 *
 * A vision model is asked only what it can see: is there type, where does it
 * sit, how big is it, what colour, is a second colour used on one word, is
 * there a box or a glow behind it, how heavy is the outline, how many words
 * to a line. Those are OBSERVATIONS. Which preset they are nearest is
 * arithmetic, and it happens here, in a pure module with no API behind it, so
 * the match is the same answer every time and can be tested without spending
 * anything.
 *
 * The model is never asked to name a preset. Asked to pick from a list of 31
 * it would pick one, and a confident wrong answer is the failure mode that
 * matters when somebody runs ten references through this.
 *
 * ── What a still frame cannot show, stated rather than guessed ────────
 *
 * `animationType` has eight values and four of them — `scale`, `pop`,
 * `bounce` and a plain `none` — differ only in a per-cue entrance of about
 * 120ms. Ten frames sampled across sixty seconds will not catch one. So the
 * eight are grouped into the four FAMILIES a still can actually distinguish,
 * and inside a family the match returns a SHORTLIST rather than a pick, with
 * the reason it cannot narrow further.
 *
 * Size is the same story one level down. The 31 presets split cleanly into
 * the four `measured` ones at 36-44 and the 27 ported creator ones at 92-120,
 * which is a difference anybody can see. Within the creator group, 105 against
 * 102 is 5.47% of a 1920 frame against 5.31%: a sixth of a percentage point,
 * which no model reads off a frame. So size is used as a BAND and refused
 * finer, and the test pins that refusal.
 *
 * Pure. No I/O, no API, no side effects.
 */

/**
 * The preset fields a sampled still can and cannot show.
 *
 * Carried as data so the match can SAY what it ignored. A field in `ignored`
 * is not a field the matcher is bad at: it is one no still frame contains.
 */
export const OBSERVABLE = {
  used: ['fontSize', 'primaryColor', 'highlightColor', 'outlineSize', 'animationType', 'wordsPerLine'],
  ignored: {
    fontName: 'the typeface is a visual approximation at best, and matching on'
      + ' a guess would pick a preset for the wrong reason',
    letterSpacing: 'a tenth of an em at caption size is below what a sampled'
      + ' frame shows',
    wordSpacing: 'as letterSpacing',
    italic: 'two of the 31 differ on it and neither is separable on anything else',
    shadowDepth: 'a two-pixel shadow under an outline of four is not separable'
      + ' from the outline',
    shadowAlpha: 'as shadowDepth',
    bold: '29 of the 31 are bold, so it decides nothing',
  },
};

/**
 * The treatment families a still frame can tell apart.
 *
 * `plain` is the honest one: four of the eight animation types put nothing in
 * a still that the others do not, because what separates them happens in the
 * 120ms a cue arrives.
 */
export const FAMILIES = ['plain', 'accent', 'box', 'glow'];

const FAMILY_OF = {
  none: 'plain',
  scale: 'plain',
  pop: 'plain',
  bounce: 'plain',
  highlight: 'accent',
  karaoke: 'accent',
  box: 'box',
  glow: 'glow',
};

/** What a still shows of this animation type. */
export function familyOf(animationType) {
  return FAMILY_OF[animationType] || null;
}

/**
 * Outline thickness, IN FRAME PIXELS.
 *
 * A preset's `outlineSize` is already in frame pixels: the compiler writes
 * `PlayResX/Y` as the output format's own size, so `ScaledBorderAndShadow`
 * has nothing to scale. That makes this the one fine-grained thing a still
 * frame really carries — 3.5px against 6.5px is nearly a factor of two and
 * visible, where 105pt type against 102pt is a sixth of a percentage point
 * of frame height and is not.
 *
 * It is also what rescues the worst case. Eleven of the 27 creator presets
 * are near-white, plain-family and within 18pt of each other, so family,
 * colour and size put all eleven on one shortlist. At the tolerance below
 * they fall into three groups of two, four and five.
 */
export const OUTLINE_TOLERANCE_PX = 1.5;

/** A word for an outline, for the sentence an operator reads. */
export function outlineWord(outlinePx) {
  const px = Number(outlinePx);
  if (!Number.isFinite(px) || px <= 0.5) return 'no outline';
  if (px < 3) return 'a fine outline';
  if (px < 6) return 'a medium outline';
  return 'a heavy outline';
}

/** Size bands. The only split in `fontSize` a frame actually shows. */
export const SIZE_BANDS = ['small', 'large'];

/**
 * Cap height as a fraction of the frame, from a preset's `fontSize`.
 *
 * `fontSize` is already in frame units: the compiler writes `PlayResX/Y` as
 * the output format's own width and height, so 105 in a 1920-high frame is
 * 105 pixels of em box. Cap height is the part a frame shows, and for the
 * sans faces these presets use it is close to 0.72 of the em — Inter is 0.727
 * and Montserrat 0.700. The ratio is NAMED rather than folded in, because it
 * is the one assumption in this conversion and a different face moves it.
 */
export const CAP_RATIO = 0.72;

export function capPctOf(fontSize, format) {
  const H = Number(format?.height);
  const size = Number(fontSize);
  if (!Number.isFinite(H) || H <= 0 || !Number.isFinite(size) || size <= 0) return null;
  return (size * CAP_RATIO) / H;
}

/** Which band a measured cap height falls in, or null between the two. */
export function sizeBandOf(capPct) {
  if (!Number.isFinite(capPct) || capPct <= 0) return null;
  // The four measured presets land at 0.0135 to 0.0165 of the frame and the
  // 27 creator ones at 0.0345 to 0.045. The gap between the groups is wide,
  // so the boundaries sit in it with room either side rather than splitting
  // the difference and calling a near-miss a band.
  if (capPct < 0.025) return 'small';
  if (capPct > 0.030) return 'large';
  return null;
}

// ── The observation contract ──────────────────────────────────────────

/**
 * What a vision pass is allowed to report. A closed list, because a field
 * nobody reads is a field that looks implemented, and a free-form answer from
 * a model is a field that cannot be matched.
 */
export const OBSERVATION_FIELDS = [
  'present', 'band', 'capPct', 'wordsPerLine', 'caseStyle', 'colour', 'accent',
  'family', 'outlinePx',
];

export const CASES = ['upper', 'mixed', 'lower'];

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Check a set of observations before anything is matched on them.
 *
 * Returns a list of problems, empty when it is usable. A model's answer goes
 * through here: an out-of-vocabulary family or a colour that is not a hex
 * triple is a fault in the call rather than a reason to guess.
 */
export function validateObservations(obs) {
  const errors = [];
  if (!obs || typeof obs !== 'object' || Array.isArray(obs)) return ['not an object'];

  const unknown = Object.keys(obs).filter((k) => !OBSERVATION_FIELDS.includes(k));
  if (unknown.length) errors.push(`reports ${unknown.join(', ')}, which nothing reads`);

  if (typeof obs.present !== 'boolean') errors.push('present must be true or false');

  const frac = (name, lo, hi) => {
    const v = obs[name];
    if (v == null) return;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) {
      errors.push(`${name} must be a number from ${lo} to ${hi}`);
    }
  };
  frac('band', 0, 1);
  frac('capPct', 0, 1);

  if (obs.wordsPerLine != null
      && (!Number.isInteger(obs.wordsPerLine) || obs.wordsPerLine < 1 || obs.wordsPerLine > 20)) {
    errors.push('wordsPerLine must be a whole number from 1 to 20');
  }
  if (obs.caseStyle != null && !CASES.includes(obs.caseStyle)) {
    errors.push(`caseStyle must be one of ${CASES.join(', ')}`);
  }
  if (obs.family != null && !FAMILIES.includes(obs.family)) {
    errors.push(`family must be one of ${FAMILIES.join(', ')}`);
  }
  if (obs.outlinePx != null
      && (typeof obs.outlinePx !== 'number' || !Number.isFinite(obs.outlinePx)
        || obs.outlinePx < 0 || obs.outlinePx > 60)) {
    errors.push('outlinePx must be a number of pixels from 0 to 60');
  }
  for (const name of ['colour', 'accent']) {
    if (obs[name] != null && !HEX.test(String(obs[name]))) {
      errors.push(`${name} must be a hex colour like #FFFFFF`);
    }
  }
  return errors;
}

/**
 * The observations a given preset WOULD produce, in a given frame size.
 *
 * This is what makes the matcher testable without a model and without a
 * video: every one of the 31 can be run through its own observations and the
 * answer checked. Where that round trip cannot recover the preset, the
 * presets are genuinely identical in a still, and the test states which.
 */
export function observationsOf(preset, format) {
  const family = familyOf(preset.animationType);
  return {
    present: true,
    band: null,
    capPct: capPctOf(preset.fontSize, format),
    wordsPerLine: preset.wordsPerLine ?? null,
    caseStyle: null,
    colour: preset.primaryColor ?? null,
    // The accent is only visible when the treatment shows a second colour.
    // A `scale` preset's highlightColor is in the data and not on the screen,
    // so reporting it here would hand the matcher a signal no frame carries.
    accent: family === 'accent' || family === 'box'
      ? (preset.highlightColor ?? null)
      : null,
    family,
    outlinePx: Number.isFinite(Number(preset.outlineSize))
      ? Number(preset.outlineSize)
      : null,
  };
}

// ── Colour distance ───────────────────────────────────────────────────

function rgb(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return null;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * How far apart two colours look, 0 to 1.
 *
 * Weighted toward the green channel the way perceived brightness is, which is
 * enough to do the job asked of it: tell white from cyan from yellow from
 * pink, and treat #FFFFFF and #F8FAFC as the same colour, which they are —
 * thirteen presets are pure white and another four are within three levels of
 * it, and separating those on colour would be reading noise.
 */
export function colourDistance(a, b) {
  const x = rgb(a);
  const y = rgb(b);
  if (!x || !y) return null;
  const w = [0.3, 0.59, 0.11];
  let sum = 0;
  for (let i = 0; i < 3; i += 1) {
    const d = (x[i] - y[i]) / 255;
    sum += w[i] * d * d;
  }
  return Math.sqrt(sum);
}

// ── The match ─────────────────────────────────────────────────────────

/**
 * What each dimension is worth.
 *
 * The family carries the most because it is the one thing a still shows
 * unambiguously. Colour is next, and only when it is not white: seventeen of
 * the 31 are white or within three levels of it, so for those it decides
 * nothing and the weight is spent on nothing.
 */
export const WEIGHTS = {
  family: 1.0,
  colour: 0.7,
  accent: 0.6,
  size: 0.8,
  // Second only to the family, because it is the only fine-grained thing a
  // still carries. At a lower weight the eleven near-white plain presets
  // stayed on one shortlist whatever else was observed.
  outline: 0.9,
  // Lowest, and it is worth saying why it is here at all: `wordsPerLine` is a
  // note about the reel a preset was measured from, not a property of the
  // output. The compiler groups words by its own `perLine` argument and reads
  // the preset's figure only to widen the side margins. Four of the 31 carry
  // it and all four are already separated by size, so it corroborates rather
  // than decides.
  wordsPerLine: 0.3,
};

/** How close a candidate has to be to the best one to count as tied. */
export const TIE = 0.03;

/**
 * The spread an outline difference is measured against, past the tolerance.
 *
 * Three pixels. The shipped outlines run 2 to 14, but the 27 creator presets
 * sit between 3.5 and 10, so three pixels beyond the tolerance is already a
 * different look rather than a near miss.
 *
 * These three numbers were chosen on a sweep of 27 combinations against the
 * round trip, and the useful part is what did NOT move: the true preset was
 * in the shortlist 31 times out of 31 in every one of them, and the exact
 * pick was 25 of 31 in every one. Only the shortlist LENGTH responded, from a
 * mean of 2.74 at these values to 5.00 at the worst. So this is tuning how
 * useful the answer is, not whether it is right, which is the only kind of
 * tuning worth trusting.
 */
export const OUTLINE_SPREAD_PX = 3;

function sizeScore(obs, preset, format) {
  const band = sizeBandOf(obs.capPct);
  if (!band) return null;
  const presetBand = sizeBandOf(capPctOf(preset.fontSize, format));
  if (!presetBand) return null;
  return band === presetBand ? 0 : 1;
}

function outlineScore(obs, preset) {
  if (!Number.isFinite(obs.outlinePx)) return null;
  const want = Number(preset.outlineSize);
  if (!Number.isFinite(want)) return null;
  // An error floor rather than a straight difference. A model reading a 4px
  // outline off a 1080-wide frame is not accurate to a quarter of a pixel, so
  // anything inside the tolerance costs nothing: claiming otherwise would
  // separate two presets on a precision the observation does not have.
  const diff = Math.abs(obs.outlinePx - want);
  if (diff <= OUTLINE_TOLERANCE_PX) return 0;
  return Math.min(1, (diff - OUTLINE_TOLERANCE_PX) / OUTLINE_SPREAD_PX);
}

/**
 * Match observations to the nearest shipped preset.
 *
 * `styles` is presets.json's `styles` map, passed in rather than imported, so
 * this module stays pure and a caller can match against a subset — the
 * measured four for an architecture practice, say.
 *
 * Returns:
 *   value         the preset id, or null when nothing could be matched
 *   confidence    0..1
 *   why           one sentence an operator reads
 *   alternatives  other preset ids the stills cannot separate from the pick
 *   used          which dimensions actually contributed
 *   ignored       which of the reference's own properties were not matchable
 */
export function matchPreset(obs, { styles, format } = {}) {
  const problems = validateObservations(obs);
  if (problems.length) {
    return {
      value: null,
      confidence: 0,
      why: `the observations are not usable: ${problems.join('; ')}`,
      alternatives: [],
      used: [],
      ignored: [],
    };
  }
  if (!styles || !Object.keys(styles).length) {
    return {
      value: null, confidence: 0, why: 'no presets to match against',
      alternatives: [], used: [], ignored: [],
    };
  }
  if (!obs.present) {
    return {
      value: null,
      confidence: 1,
      why: 'the reference burns no type, so no caption preset applies',
      alternatives: [],
      used: ['present'],
      ignored: [],
    };
  }

  const used = [];
  const scored = [];

  for (const [id, preset] of Object.entries(styles)) {
    let total = 0;
    let weight = 0;
    const contributed = [];

    const add = (name, score) => {
      if (score == null) return;
      total += WEIGHTS[name] * score;
      weight += WEIGHTS[name];
      contributed.push(name);
    };

    if (obs.family) {
      add('family', obs.family === familyOf(preset.animationType) ? 0 : 1);
    }
    if (obs.colour) add('colour', colourDistance(obs.colour, preset.primaryColor));
    // The accent only counts where the reference showed one AND this preset
    // puts one on the screen. Scoring a `scale` preset's unused
    // highlightColor against an observed accent would reward it for a colour
    // nobody sees.
    if (obs.accent && (familyOf(preset.animationType) === 'accent'
        || familyOf(preset.animationType) === 'box')) {
      add('accent', colourDistance(obs.accent, preset.highlightColor));
    }
    add('size', sizeScore(obs, preset, format));
    add('outline', outlineScore(obs, preset));
    if (obs.wordsPerLine != null && preset.wordsPerLine != null) {
      add('wordsPerLine', Math.min(1, Math.abs(obs.wordsPerLine - preset.wordsPerLine) / 4));
    }

    if (!weight) continue;
    for (const name of contributed) if (!used.includes(name)) used.push(name);
    scored.push({ id, score: total / weight, contributed });
  }

  if (!scored.length) {
    return {
      value: null,
      confidence: 0,
      why: 'nothing in the observations could be compared with a preset',
      alternatives: [],
      used: [],
      ignored: Object.keys(OBSERVABLE.ignored),
    };
  }

  scored.sort((a, b) => (a.score - b.score) || a.id.localeCompare(b.id));
  const best = scored[0];
  const tied = scored.filter((s) => s.id !== best.id && s.score - best.score <= TIE);

  // Confidence falls with how close the field is behind the pick and with how
  // little was observed. A single observation matching 31 presets equally is
  // not a match, and it should not read as one.
  const margin = tied.length
    ? 0
    : Math.min(1, (scored[1] ? scored[1].score - best.score : 1) / (TIE * 4));
  const breadth = used.length / Object.keys(WEIGHTS).length;
  const fit = Math.max(0, 1 - best.score);
  const confidence = round(Math.max(0.1, Math.min(0.9, fit * (0.45 + 0.35 * breadth + 0.2 * margin))));

  const ignored = Object.keys(OBSERVABLE.ignored);
  const notes = [];
  if (tied.length) {
    notes.push(
      `${tied.length + 1} presets look the same in a still frame`
      + ` (${[best.id, ...tied.map((t) => t.id)].join(', ')})`
      + (sameFamilyAnimations(styles, [best.id, ...tied.map((t) => t.id)])
        ? ', differing only in a per-cue animation a sampled frame cannot show'
        : '')
    );
  }
  if (Number.isFinite(obs.outlinePx)) {
    notes.push(`${outlineWord(obs.outlinePx)} at about ${round1(obs.outlinePx)}px`);
  }
  if (obs.caseStyle) {
    // Worth saying rather than dropping: the presets carry no case field at
    // all and the compiler changes none, so an all-caps reference cannot be
    // matched on it and the output will not be all caps unless the words are.
    notes.push(
      `the reference's type is ${obs.caseStyle} case, which no preset carries:`
      + ' set the case in the words themselves'
    );
  }

  return {
    value: best.id,
    confidence,
    why: `matched on ${used.join(', ')}`
      + (notes.length ? `; ${notes.join('; ')}` : ''),
    alternatives: tied.map((t) => t.id),
    used,
    ignored,
  };
}

/** Whether a tied set differs only in animation type. */
function sameFamilyAnimations(styles, ids) {
  const anims = new Set(ids.map((id) => styles[id]?.animationType));
  return anims.size > 1;
}

/**
 * Where the type sat, as a caption margin.
 *
 * Position is NOT a preset field: the compiler takes `marginV` from the
 * caption source, with 320 of a 1920 frame as its default. So the band a
 * reference puts its type in is proposed separately, and it is one of the few
 * things here a frame states outright.
 */
export function marginVFor(obs, format) {
  const H = Number(format?.height);
  if (!Number.isFinite(H) || H <= 0) {
    return { value: null, confidence: 0, why: 'no frame height to measure against' };
  }
  if (!obs?.present) {
    return { value: null, confidence: 0, why: 'no type to place' };
  }
  if (!Number.isFinite(obs.band)) {
    return {
      value: null,
      confidence: 0,
      why: 'the pass did not report where the type sat',
    };
  }
  // `band` is the centre of the block as a fraction down the frame; marginV
  // is the distance from the BOTTOM, because the compiled ASS uses alignment
  // 2. Rounded to ten pixels: a frame does not locate a block of type to the
  // pixel and a margin that reads 317 claims it does.
  const fromBottom = Math.round((H * (1 - obs.band)) / 10) * 10;
  const value = Math.max(0, Math.min(Math.round(H * 0.8), fromBottom));
  return {
    value,
    confidence: 0.7,
    why: `the type sat ${Math.round(obs.band * 100)}% down the frame,`
      + ` so ${value}px up from the bottom`,
  };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
