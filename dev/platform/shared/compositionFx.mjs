/**
 * The effects catalogue: what an `fx` source draws, as data.
 *
 * An `fx` source is a GENERATED picture layer. It holds no file: the
 * renderer makes it with ffmpeg's lavfi input and composites it through the
 * same overlay chain as any other layer, so an effect can sit under the
 * captions, over the footage, at whatever opacity the item asks for.
 *
 * The `fx` kind has been declared and validated in the composition model
 * since the model was written, and `compositionRender.mjs` had no handler
 * for it, so an fx source became an ffmpeg input with no file on disk and
 * the route answered `Source "x" has no file on disk`. Shipping effects as
 * data alone would have shipped effects that cannot render. The mechanism
 * is this module plus the `fx` branch in the renderer.
 *
 * ── Why every effect is a STATIC mask ──────────────────────────────────
 *
 * Four facts about ffmpeg, each measured rather than read, decide the shape
 * of everything below:
 *
 * 1. `geq` costs 24x per frame. 60 frames of a 1080x1920 per-frame geq took
 *    3755ms; the same picture generated ONCE and held took 154ms. A batch of
 *    thirty reels cannot pay the first figure.
 * 2. `drawbox` writes colour and leaves alpha at zero. A rule drawn with it
 *    measured [228,228,228,0] where geq's measured [255,255,255,230]: it
 *    composites as NOTHING, with no error anywhere. So the mask is geq's.
 * 3. `drawbox` exposes neither `t` nor `n`, so there is no cheap animated
 *    mask to fall back to: `n/100` errors, and `t` silently fills the full
 *    width.
 * 4. `format=yuva420p` must come BEFORE geq or there is no alpha plane to
 *    write and the whole mask comes out opaque.
 *
 * So: one frame, generated once with geq, held with `loop=-1:size=1`.
 * Movement, where an effect wants it, comes from the item transform the
 * template model already animates and tests. An effect that must change
 * shape per frame is not in here, and the reason is cost, not taste.
 *
 * ── Why only three ────────────────────────────────────────────────────
 *
 * The effects worth having for October's clients are the ones a broadcast
 * grade would call finishing: a scrim so white type survives a white wall,
 * a vignette to hold the eye, a rule to date-stamp a frame. Glass widgets
 * and phone-UI toggles read as off-brand for an architecture practice, and
 * nothing in here invents a pixel that was not photographed.
 *
 * Pure. No I/O, no ffmpeg, no side effects: the renderer asks for a string.
 */

/** Which audience an effect is for. */
export const REGISTERS = ['editorial', 'creator', 'both'];

/**
 * Clamp helper shared by every parameter, so a hand-written composition
 * cannot push an effect past the range it was measured at.
 */
function clamp(n, lo, hi) {
  // `typeof` rather than `Number(n)`. Coercion reads `null` as 0 and `[]` as
  // 0, so a parameter left null came back as the darkest possible scrim
  // instead of an error, and a parameter given as the string "0.5" was
  // accepted from one caller and not another. Both were found by the test
  // that asserts this refuses a non-number: a number is a number.
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, n));
}

/** Fixed-precision for an ffmpeg expression: no exponent notation, ever. */
function x(n) {
  return Number(n).toFixed(6).replace(/\.?0+$/, '') || '0';
}

/**
 * The catalogue.
 *
 * Each effect gives:
 *   label     what the operator sees
 *   register  who it is for: 'editorial' (clients), 'creator', or 'both'
 *   says      one sentence on what it does, shown next to the control
 *   rgb       the colour expression for r, g and b (a geq expression)
 *   params    { name: { default, min, max, says } }
 *   alpha(p)  the geq alpha expression, given resolved params
 *
 * `alpha` is written in geq's own variables, so it scales with the frame
 * rather than assuming a size: X and Y are the pixel being drawn, W and H
 * the frame. An expression that hard-codes 1080 renders a different picture
 * on a square crop, which is the kind of fault that only shows in the
 * output of the one batch nobody checked.
 */
export const FX = {
  scrim: {
    label: 'Bottom scrim',
    register: 'both',
    says: 'Darkens the lower part of the frame so white captions stay legible'
      + ' over a pale picture.',
    rgb: '0',
    params: {
      start: {
        default: 0.62, min: 0, max: 0.95,
        says: 'Where the darkening begins, as a fraction down the frame.',
      },
      full: {
        default: 0.85, min: 0.05, max: 1,
        says: 'Where it reaches full strength, as a fraction down the frame.'
          + ' Put it where the type sits.',
      },
      strength: {
        default: 0.72, min: 0, max: 1,
        says: 'How dark it gets once it is at full strength.',
      },
    },
    // Zero above `start`, rising linearly, flat at `strength` from `full`
    // down.
    //
    // A ramp that reaches full strength only at the BOTTOM EDGE spends most
    // of its darkness below the words. Burned captions sit on `MarginV` 320
    // of a 1920 frame, so a two-line block occupies roughly 0.78 to 0.85 down
    // the frame; a 0.62-to-1.0 ramp is 30-40% black there while the darkest
    // part of it is in the empty strip underneath. Hence `full`, defaulted to
    // where the type actually is.
    //
    // `min`/`max` rather than conditionals: geq has no branch cheaper than
    // the arithmetic, and this reads as the clamped ramp it is.
    alpha: (p) => {
      const span = Math.max(0.02, p.full - p.start);
      return `255*${x(p.strength)}*min(1,max(0,(Y-H*${x(p.start)})/(H*${x(span)})))`;
    },
    alphaAt: (p, xf, yf) => {
      const span = Math.max(0.02, p.full - p.start);
      return p.strength * Math.min(1, Math.max(0, (yf - p.start) / span));
    },
    paint: (p) => ({
      kind: 'linear',
      from: { x: 0, y: p.start },
      to: { x: 0, y: p.start + Math.max(0.02, p.full - p.start) },
      stops: [{ at: 0, alpha: 0 }, { at: 1, alpha: p.strength }],
    }),
  },

  vignette: {
    label: 'Vignette',
    register: 'both',
    says: 'Darkens the corners so the eye stays on the middle of the frame.',
    rgb: '0',
    params: {
      strength: {
        default: 0.85, min: 0, max: 1,
        says: 'How dark the corners go.',
      },
      falloff: {
        default: 1.1, min: 0.5, max: 3,
        says: 'How abruptly it falls off from the centre. Higher is tighter.',
      },
    },
    // Radial, normalised so the frame's own aspect does not oval it: the
    // squared distance from centre in each axis is divided by that axis's
    // half-size before it is added.
    alpha: (p) => `255*min(1,pow(pow((X-W/2)/(W/2),2)+pow((Y-H/2)/(H/2),2),`
      + `${x(p.falloff)})*${x(p.strength)})`,
    alphaAt: (p, xf, yf) => {
      const d2 = (2 * xf - 1) ** 2 + (2 * yf - 1) ** 2;
      return Math.min(1, (d2 ** p.falloff) * p.strength);
    },
    // Sampled, because a canvas gradient interpolates linearly between its
    // stops and this curve is not. Two things decide the scheme, and the
    // agreement test measured both rather than taking them on faith:
    //
    //   - The stops stop at the SATURATION RADIUS, where the curve reaches
    //     full strength, with one more at the corner. Spreading them evenly
    //     to the corner instead left the saturated region interpolating up
    //     to it from below: 0.935 where the mask was 1.0, a visibly lighter
    //     corner in the preview than in the export.
    //   - Twenty-four segments. Across the whole parameter range the worst
    //     interpolation error is 0.006 of full alpha, against 0.046 at eight
    //     and 0.022 at twelve; the test's tolerance is 0.02.
    paint: (p) => {
      const R = Math.SQRT2;
      const rSat = p.strength > 0
        ? Math.min(R, (1 / p.strength) ** (1 / (2 * p.falloff)))
        : R;
      const alpha = (r) => Math.min(1, (r * r) ** p.falloff * p.strength);
      // No stop at the corner. A gradient holds its last stop's colour for
      // everything beyond it, so the saturated region needs no description:
      // one was written, and the mutation sweep walked straight through its
      // removal with nothing failing, which is what redundant means.
      const stops = Array.from({ length: 25 }, (unused, i) => {
        const r = (i / 24) * rSat;
        return { at: r / R, alpha: alpha(r) };
      });
      return { kind: 'radial', centre: { x: 0.5, y: 0.5 }, radius: R, stops };
    },
  },

  rule: {
    label: 'Hairline rule',
    register: 'editorial',
    says: 'A thin horizontal line, inset from the edges. Sits under a date or'
      + ' a project name.',
    rgb: '255',
    params: {
      y: {
        default: 0.78, min: 0, max: 1,
        says: 'Where the line sits, as a fraction down the frame.',
      },
      inset: {
        default: 0.12, min: 0, max: 0.45,
        says: 'How far in from each side it stops, as a fraction of the width.',
      },
      thickness: {
        default: 2, min: 1, max: 12,
        says: 'Line thickness in pixels.',
      },
      opacity: {
        default: 0.92, min: 0, max: 1,
        says: 'How solid the line is.',
      },
    },
    // A rectangle, written as the product of two `between`s: geq has no
    // boolean `and`, and multiplying two 0/1 results is what it does instead.
    alpha: (p) => {
      const half = p.thickness / 2;
      return `if(between(Y,H*${x(p.y)}-${x(half)},H*${x(p.y)}+${x(half)})`
        + `*between(X,W*${x(p.inset)},W-W*${x(p.inset)}),`
        + `${x(Math.round(255 * p.opacity))},0)`;
    },
    alphaAt: (p, xf, yf, size) => {
      const H = size.height;
      const W = size.width;
      const half = p.thickness / 2;
      const onY = Math.abs(yf * H - p.y * H) <= half;
      const onX = xf * W >= p.inset * W && xf * W <= W - p.inset * W;
      // The same rounding the expression does, so the two agree to the byte
      // rather than to a tolerance.
      return onY && onX ? Math.round(255 * p.opacity) / 255 : 0;
    },
    paint: (p, size) => {
      const half = p.thickness / 2;
      return {
        kind: 'rect',
        x: p.inset,
        w: 1 - 2 * p.inset,
        y: (p.y * size.height - half) / size.height,
        h: p.thickness / size.height,
        alpha: Math.round(255 * p.opacity) / 255,
      };
    },
  },
};

export const FX_NAMES = Object.keys(FX);

/**
 * Effects for an audience. 'both' appears in either list.
 *
 * Nothing in the shipped three is creator-register only, and that is stated
 * rather than padded: `fxFor('creator')` returns two, not three. A catalogue
 * that listed a creator effect it did not have would be the same invention
 * the rest of this build has been stripped of.
 */
export function fxFor(register) {
  return FX_NAMES.filter((name) => {
    const r = FX[name].register;
    return r === 'both' || r === register;
  });
}

/**
 * Resolve an effect's parameters: defaults, overridden by what was given,
 * each clamped to its own measured range. An unknown parameter name is an
 * error rather than a silent no-op, because a misspelt `strenght` that
 * renders the default is indistinguishable from the control not working.
 */
export function paramsFor(effect, given = {}) {
  const spec = FX[effect];
  if (!spec) throw new Error(`unknown effect "${effect}"`);
  const out = {};
  for (const [name, p] of Object.entries(spec.params)) {
    out[name] = p.default;
  }
  for (const [name, value] of Object.entries(given || {})) {
    const p = spec.params[name];
    if (!p) {
      throw new Error(
        `effect "${effect}" has no parameter "${name}"`
        + ` (${Object.keys(spec.params).join(', ')})`
      );
    }
    const v = clamp(value, p.min, p.max);
    if (v == null) {
      throw new Error(`effect "${effect}" parameter "${name}" must be a number`);
    }
    out[name] = v;
  }
  return out;
}

/**
 * The lavfi input graph for an effect at a frame size.
 *
 * ONE frame: `r=1:d=1`. The renderer holds it with `loop=-1:size=1` for as
 * long as the item asks, so geq runs once per render rather than once per
 * frame. See the cost figures at the top of this file.
 *
 * `format=yuva420p` precedes geq because geq writes alpha into the plane
 * that is already there; with no alpha plane the expression is evaluated and
 * discarded, and the effect comes out opaque with nothing in the log.
 */
export function lavfiFor(effect, opts = {}) {
  const spec = FX[effect];
  if (!spec) throw new Error(`unknown effect "${effect}"`);
  // `?? ` rather than `||`: a falsy zero took the default, so the guard
  // below could never fire and a composition with a zero-width frame
  // generated a 1080x1920 mask for it. Dead code the test caught.
  const W = Math.round(opts.width ?? 1080);
  const H = Math.round(opts.height ?? 1920);
  if (!(W > 0) || !(H > 0)) {
    throw new Error(`fx needs a positive frame size, got ${W}x${H}`);
  }
  const p = paramsFor(effect, opts.params);
  const a = spec.alpha(p);
  return `color=c=black@0:s=${W}x${H}:r=1:d=1,format=yuva420p,`
    + `geq=r='${spec.rgb}':g='${spec.rgb}':b='${spec.rgb}':a='${a}'`;
}

/**
 * Validate an fx source beyond what the composition model checks.
 *
 * The model checks that `effect` is a string and `params` an object; it does
 * not know the catalogue, because it predates it and must keep validating a
 * composition on a machine that has never loaded this module. So the name
 * and the parameter names are checked here, and the renderer calls it before
 * it builds a graph.
 */
export function validateFxSource(id, src) {
  if (!FX[src?.effect]) {
    return `source "${id}": unknown effect "${src?.effect}" (${FX_NAMES.join(', ')})`;
  }
  try {
    paramsFor(src.effect, src.params);
  } catch (err) {
    return `source "${id}": ${err.message}`;
  }
  return null;
}

// ── The same mask, for the browser ────────────────────────────────────
//
// The preview and the render agreeing is the guarantee the whole composition
// model is built on. The compositor cannot run geq, so each effect describes
// itself a second way: as a canvas paint — a gradient or a rectangle, in
// fractions of the frame.
//
// TWO IMPLEMENTATIONS OF ONE DESCRIPTION DRIFT. That is why this module also
// carries `alphaAt`, the mask's arithmetic as a plain function, and why
// composition-fx-agreement.test.js evaluates the geq expression numerically
// and holds it against `alphaAt` and against the paint at sample points
// across the frame. Without that test this section would be a second opinion
// about what the output looks like, which is worse than no preview: a
// preview that disagrees with the export is the page lying.

/**
 * A declarative paint for an effect, in fractions of the frame.
 *
 *   { kind: 'linear', from, to, stops }   a gradient along a line
 *   { kind: 'radial', centre, radius, stops }
 *   { kind: 'rect', x, y, w, h, alpha }
 *
 * Every stop's `alpha` is 0..1 and the colour is the effect's own `rgb`,
 * returned as `colour` so a caller needs nothing else.
 */
export function paintFor(effect, params, size = {}) {
  const spec = FX[effect];
  if (!spec) throw new Error(`unknown effect "${effect}"`);
  const p = paramsFor(effect, params);
  const dims = {
    width: Math.round(size.width ?? 1080),
    height: Math.round(size.height ?? 1920),
  };
  const level = Number(spec.rgb);
  return {
    ...spec.paint(p, dims),
    colour: [level, level, level],
  };
}

/**
 * The mask's alpha at a point, 0..1, with the point given in fractions of
 * the frame. The reference the geq expression and the canvas paint are both
 * held against.
 */
export function alphaAt(effect, params, xf, yf, size = {}) {
  const spec = FX[effect];
  if (!spec) throw new Error(`unknown effect "${effect}"`);
  const p = paramsFor(effect, params);
  return spec.alphaAt(p, xf, yf, {
    width: Math.round(size.width ?? 1080),
    height: Math.round(size.height ?? 1920),
  });
}

/** One line an operator can read, with the resolved numbers in it. */
export function describeFx(effect, params) {
  const spec = FX[effect];
  if (!spec) return `unknown effect "${effect}"`;
  const p = paramsFor(effect, params);
  const bits = Object.keys(spec.params).map((n) => `${n} ${x(p[n])}`);
  return `${spec.label}: ${spec.says} (${bits.join(', ')})`;
}
