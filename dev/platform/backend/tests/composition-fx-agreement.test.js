/**
 * The three descriptions of one mask, held against each other.
 *
 * An effect is described three times in this codebase, because three
 * consumers cannot read one form:
 *
 *   1. `alpha`   a geq expression, for ffmpeg, which renders the output
 *   2. `alphaAt` the same arithmetic as a function, the reference
 *   3. `paint`   a canvas gradient or rectangle, for the browser preview
 *
 * Two implementations of one description drift. The preview and the render
 * agreeing is the guarantee the whole composition model is built on, and a
 * preview that disagrees with the export is worse than no preview: the page
 * lies about its own output, and the operator trusts it.
 *
 * So the geq expression is EVALUATED here — parsed into JavaScript and run
 * at points across the frame — and held against the function and against
 * the canvas paint. Nothing is mocked and nothing is taken on trust: if a
 * parameter is wired into one description and not another, this fails.
 *
 *   node tests/composition-fx-agreement.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { FX, FX_NAMES, paramsFor, lavfiFor, paintFor, alphaAt } = require('../../shared/compositionFx.mjs');

const W = 1080;
const H = 1920;

// ── evaluating a geq expression ───────────────────────────────────────

/**
 * ffmpeg's expression language, for the subset the catalogue uses.
 *
 * `between(v,a,b)` and `if(c,a,b)` are ffmpeg's own; the rest maps onto
 * Math. Written as a translation to JavaScript rather than an interpreter,
 * because the point is to read the SHIPPED STRING rather than a parallel
 * description of it: an expression this cannot parse is a signal that the
 * catalogue has grown a construct nobody has checked against a frame.
 */
function evalGeq(expr, pt) {
  const js = expr
    .replace(/\bpow\(/g, 'Math.pow(')
    .replace(/\bmin\(/g, 'Math.min(')
    .replace(/\bmax\(/g, 'Math.max(')
    .replace(/\bbetween\(/g, '_between(')
    .replace(/\bif\(/g, '_if(')
    .replace(/\bX\b/g, '_x')
    .replace(/\bY\b/g, '_y')
    .replace(/\bW\b/g, '_w')
    .replace(/\bH\b/g, '_h');
  // eslint-disable-next-line no-new-func
  const fn = new Function('_x', '_y', '_w', '_h', '_between', '_if', `return (${js});`);
  return fn(
    pt.x, pt.y, pt.w, pt.h,
    (v, a, b) => (v >= a && v <= b ? 1 : 0),
    (c, a, b) => (c ? a : b)
  );
}

/** The alpha expression of one effect, pulled out of the shipped lavfi. */
function alphaExpr(effect, params) {
  const graph = lavfiFor(effect, { width: W, height: H, params });
  const m = graph.match(/:a='(.*)'$/);
  assert.ok(m, `no alpha expression in ${graph}`);
  return m[1];
}

/**
 * A spread of points: a coarse grid for anything that varies across the
 * frame, plus a row-by-row sweep down the middle.
 *
 * The sweep is there because the grid alone could not see the rule's
 * thickness. A 2px line in a 1920-high frame falls between grid rows, so
 * widening it changed nothing at any sampled point and the parameter looked
 * wired when it might not have been. Caught by this file's own assertion
 * that moving a parameter has to change something somewhere.
 */
const POINTS = [];
for (const fx of [0, 0.08, 0.25, 0.5, 0.75, 0.92, 1]) {
  for (const fy of [0, 0.1, 0.3, 0.5, 0.62, 0.78, 0.85, 0.95, 1]) {
    POINTS.push([fx, fy]);
  }
}
for (let py = 0; py < H; py += 1) POINTS.push([0.5, py / H]);

/**
 * The end of a parameter's range furthest from its default.
 *
 * A midpoint is not enough. Halving the rule's thickness from 2px to 1.5px
 * changes no pixel at all — both round to the same two rows of a 1920-high
 * frame — so the "moving this changed something" assertion failed on a
 * parameter that is correctly wired. The extreme is unambiguous, and it is
 * also where a clamp or a sign error shows.
 */
function furthest(meta) {
  const toMin = Math.abs(meta.default - meta.min);
  const toMax = Math.abs(meta.max - meta.default);
  return toMin >= toMax ? meta.min : meta.max;
}

describe('the expression evaluator reads what it is given', () => {
  it('handles the constructs the catalogue uses', () => {
    assert.equal(evalGeq('pow(2,3)', { x: 0, y: 0, w: W, h: H }), 8);
    assert.equal(evalGeq('min(1,max(0,-2))', { x: 0, y: 0, w: W, h: H }), 0);
    assert.equal(evalGeq('between(Y,0,10)', { x: 0, y: 5, w: W, h: H }), 1);
    assert.equal(evalGeq('if(between(Y,0,10)*between(X,0,10),9,0)', { x: 5, y: 5, w: W, h: H }), 9);
    assert.equal(evalGeq('if(between(Y,0,10)*between(X,0,10),9,0)', { x: 50, y: 5, w: W, h: H }), 0);
    assert.equal(evalGeq('W/2+H/2', { x: 0, y: 0, w: 100, h: 200 }), 150);
  });

  it('parses every shipped expression', () => {
    // A construct this cannot read is a construct nobody has held against a
    // frame. Better to fail here than to let it through unchecked.
    for (const name of FX_NAMES) {
      const got = evalGeq(alphaExpr(name), { x: 10, y: 10, w: W, h: H });
      assert.ok(Number.isFinite(got), `${name}: evaluated to ${got}`);
    }
  });
});

// ── the expression against the function ───────────────────────────────

describe('the geq expression and alphaAt agree', () => {
  for (const name of FX_NAMES) {
    it(`${name}, at defaults`, () => {
      const expr = alphaExpr(name);
      for (const [fx, fy] of POINTS) {
        const px = Math.min(W - 1, Math.round(fx * W));
        const py = Math.min(H - 1, Math.round(fy * H));
        const fromExpr = evalGeq(expr, { x: px, y: py, w: W, h: H }) / 255;
        const fromFn = alphaAt(name, undefined, px / W, py / H, { width: W, height: H });
        assert.ok(
          Math.abs(fromExpr - fromFn) < 0.004,
          `${name} at (${fx}, ${fy}): expression ${fromExpr.toFixed(4)},`
          + ` function ${fromFn.toFixed(4)}`
        );
      }
    });
  }

  // Every parameter, moved off its default, in both descriptions. A
  // parameter wired into the expression and not the function is exactly the
  // drift this file exists to catch, and defaults hide it.
  for (const name of FX_NAMES) {
    for (const [pname, meta] of Object.entries(FX[name].params)) {
      it(`${name}, with ${pname} moved off its default`, () => {
        const params = { [pname]: furthest(meta) };
        const value = params[pname];
        const expr = alphaExpr(name, params);
        let moved = 0;
        for (const [fx, fy] of POINTS) {
          const px = Math.min(W - 1, Math.round(fx * W));
          const py = Math.min(H - 1, Math.round(fy * H));
          const fromExpr = evalGeq(expr, { x: px, y: py, w: W, h: H }) / 255;
          const fromFn = alphaAt(name, params, px / W, py / H, { width: W, height: H });
          const base = alphaAt(name, undefined, px / W, py / H, { width: W, height: H });
          if (Math.abs(fromFn - base) > 0.01) moved += 1;
          assert.ok(
            Math.abs(fromExpr - fromFn) < 0.004,
            `${name} ${pname}=${value} at (${fx}, ${fy}):`
            + ` expression ${fromExpr.toFixed(4)}, function ${fromFn.toFixed(4)}`
          );
        }
        assert.ok(moved > 0, `moving ${pname} to ${value} changed nothing anywhere`);
      });
    }
  }
});

// ── the function against the canvas paint ─────────────────────────────

/**
 * The alpha a canvas would draw at a point, from a paint description.
 *
 * This is the arithmetic the browser's own gradient does: project the point
 * onto the gradient's axis, then interpolate linearly between the two stops
 * either side of it. Written here rather than measured off a canvas because
 * the question is whether the DESCRIPTION is right; whether a browser
 * renders a gradient correctly is not this repo's problem.
 */
function paintAlpha(paint, fx, fy) {
  if (paint.kind === 'rect') {
    const inX = fx >= paint.x && fx <= paint.x + paint.w;
    const inY = fy >= paint.y && fy <= paint.y + paint.h;
    return inX && inY ? paint.alpha : 0;
  }
  let t;
  if (paint.kind === 'linear') {
    const dx = paint.to.x - paint.from.x;
    const dy = paint.to.y - paint.from.y;
    const len2 = dx * dx + dy * dy;
    t = ((fx - paint.from.x) * dx + (fy - paint.from.y) * dy) / len2;
  } else {
    // Radial, in the normalised space the paint is described in: the frame
    // is scaled to a unit square about its centre, so the circle the browser
    // draws becomes the ellipse the expression describes.
    const r = Math.hypot(2 * (fx - paint.centre.x), 2 * (fy - paint.centre.y));
    t = r / paint.radius;
  }
  const stops = paint.stops;
  if (t <= stops[0].at) return stops[0].alpha;
  if (t >= stops[stops.length - 1].at) return stops[stops.length - 1].alpha;
  for (let i = 1; i < stops.length; i += 1) {
    if (t <= stops[i].at) {
      const a = stops[i - 1];
      const b = stops[i];
      const k = (t - a.at) / (b.at - a.at);
      return a.alpha + k * (b.alpha - a.alpha);
    }
  }
  return stops[stops.length - 1].alpha;
}

describe('the canvas paint and the mask agree', () => {
  // A gradient interpolates linearly between its stops and two of these
  // curves are not linear, so the tolerance is the sampling error rather
  // than zero. It is asserted rather than assumed: 0.02 of full alpha is
  // about five levels of 255, which is below what anybody sees on a graded
  // picture and well inside what would show a parameter wired to one
  // description and not the other.
  const TOL = 0.02;

  for (const name of FX_NAMES) {
    it(`${name}, at defaults`, () => {
      const paint = paintFor(name, undefined, { width: W, height: H });
      for (const [fx, fy] of POINTS) {
        const want = alphaAt(name, undefined, fx, fy, { width: W, height: H });
        const got = paintAlpha(paint, fx, fy);
        assert.ok(
          Math.abs(want - got) <= TOL,
          `${name} at (${fx}, ${fy}): mask ${want.toFixed(4)}, paint ${got.toFixed(4)}`
        );
      }
    });

    it(`${name}, with every parameter moved`, () => {
      const params = {};
      for (const [pname, meta] of Object.entries(FX[name].params)) {
        params[pname] = furthest(meta);
      }
      const paint = paintFor(name, params, { width: W, height: H });
      for (const [fx, fy] of POINTS) {
        const want = alphaAt(name, params, fx, fy, { width: W, height: H });
        const got = paintAlpha(paint, fx, fy);
        assert.ok(
          Math.abs(want - got) <= TOL,
          `${name} ${JSON.stringify(params)} at (${fx}, ${fy}):`
          + ` mask ${want.toFixed(4)}, paint ${got.toFixed(4)}`
        );
      }
    });
  }

  it('carries the effect\'s own colour, so the compositor needs nothing else', () => {
    assert.deepEqual(paintFor('scrim').colour, [0, 0, 0]);
    assert.deepEqual(paintFor('rule').colour, [255, 255, 255]);
  });

  it('describes every effect, so none is silently missing from the preview', () => {
    // An effect with no paint would render in the export and not in the
    // preview, which is the disagreement this whole file is about.
    for (const name of FX_NAMES) {
      const paint = paintFor(name, undefined, { width: W, height: H });
      assert.ok(['linear', 'radial', 'rect'].includes(paint.kind), `${name}: ${paint.kind}`);
    }
  });
});
