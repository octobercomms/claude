/**
 * The effects catalogue and the `fx` branch of the render graph.
 *
 * Two things are being pinned here and they are different in kind.
 *
 * The CATALOGUE is data, so the guards are about it not rotting: an effect
 * whose expression hard-codes 1080 renders a different picture on a square
 * crop, a parameter outside its measured range renders something nobody
 * looked at, and a misspelt parameter that silently falls back to the
 * default is indistinguishable from the control not working.
 *
 * The MECHANISM is the part that did not exist. `fx` has been a declared,
 * validated source kind in the composition model since the model was
 * written, and the renderer had no branch for it, so an fx source became an
 * ordinary ffmpeg input and the route answered `Source "x" has no file on
 * disk`. The same fault class as captions, and invisible for the same
 * reason: the graph string was correct about a file that did not exist.
 *
 * The pixels are asserted next door in composition-fx-pixels.test.js,
 * because the string is not the output.
 *
 *   node tests/composition-fx.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  FX, FX_NAMES, REGISTERS, fxFor, paramsFor, lavfiFor, validateFxSource, describeFx,
} = require('../../shared/compositionFx.mjs');
const { renderGraph, ffmpegArgs } = require('../../shared/compositionRender.mjs');
const { validate } = require('../../shared/composition.mjs');

const W = 1080;
const H = 1920;

// ── The catalogue ─────────────────────────────────────────────────────

describe('the effects catalogue', () => {
  it('ships three effects', () => {
    assert.deepEqual(FX_NAMES, ['scrim', 'vignette', 'rule']);
  });

  it('says which audience each is for, from a closed list', () => {
    for (const name of FX_NAMES) {
      assert.ok(
        REGISTERS.includes(FX[name].register),
        `${name}: register "${FX[name].register}" is not one of ${REGISTERS.join(', ')}`
      );
    }
  });

  it('offers no creator-only effect, and says so by returning two', () => {
    // The answer to "who is this for" was both, and nothing in the shipped
    // three is creator-register only. Padding the list with an effect that
    // does not exist would be the same invention the rest of this build has
    // been stripped of, so the count is pinned rather than the intention.
    assert.deepEqual(fxFor('editorial'), ['scrim', 'vignette', 'rule']);
    assert.deepEqual(fxFor('creator'), ['scrim', 'vignette']);
  });

  it('has operator copy on every effect and every parameter', () => {
    for (const name of FX_NAMES) {
      const spec = FX[name];
      assert.ok(spec.label && spec.label.length > 2, `${name}: a label`);
      assert.ok(spec.says && spec.says.length > 30, `${name}: what it does`);
      assert.ok(Object.keys(spec.params).length > 0, `${name}: at least one control`);
      for (const [p, meta] of Object.entries(spec.params)) {
        assert.ok(meta.says && meta.says.length > 20, `${name}.${p}: what it does`);
        assert.ok(Number.isFinite(meta.default), `${name}.${p}: a default`);
        assert.ok(meta.default >= meta.min && meta.default <= meta.max,
          `${name}.${p}: default ${meta.default} is outside ${meta.min}..${meta.max}`);
      }
    }
  });

  it('writes every expression in the frame\'s own variables, never a size', () => {
    // An expression with 1080 in it is correct on one canvas and wrong on
    // every other, and the wrongness only shows in the output of the batch
    // nobody checked. Positions must be fractions of W and H. A pixel
    // THICKNESS is the one exception and it is named, not inferred.
    for (const name of FX_NAMES) {
      const a = FX[name].alpha(paramsFor(name));
      const sizes = a.match(/\b(1080|1920|720|1280|540|960)\b/g);
      assert.equal(sizes, null, `${name}: hard-codes ${sizes && sizes.join(', ')} in "${a}"`);
    }
  });
});

describe('resolving parameters', () => {
  it('fills the defaults', () => {
    assert.deepEqual(paramsFor('scrim'), { start: 0.62, full: 0.85, strength: 0.72 });
  });

  it('takes what it is given', () => {
    assert.equal(paramsFor('scrim', { strength: 0.4 }).strength, 0.4);
    assert.equal(paramsFor('scrim', { strength: 0.4 }).start, 0.62);
  });

  it('clamps to the range each parameter was measured at', () => {
    assert.equal(paramsFor('scrim', { strength: 9 }).strength, 1);
    assert.equal(paramsFor('scrim', { strength: -3 }).strength, 0);
    assert.equal(paramsFor('vignette', { falloff: 100 }).falloff, 3);
    assert.equal(paramsFor('rule', { thickness: 0 }).thickness, 1);
  });

  it('refuses a parameter the effect does not have', () => {
    // A misspelt `strenght` that renders the default looks exactly like the
    // control not working, so it is an error rather than a no-op.
    assert.throws(
      () => paramsFor('scrim', { strenght: 0.5 }),
      /has no parameter "strenght".*start, full, strength/s
    );
  });

  it('refuses a parameter that is not a number', () => {
    assert.throws(() => paramsFor('scrim', { strength: 'dark' }), /must be a number/);
    assert.throws(() => paramsFor('scrim', { strength: null }), /must be a number/);
  });

  it('refuses an effect it does not have', () => {
    assert.throws(() => paramsFor('filmburn'), /unknown effect "filmburn"/);
    assert.throws(() => lavfiFor('filmburn', { width: W, height: H }), /unknown effect/);
  });
});

// ── The generated input ───────────────────────────────────────────────

describe('the lavfi expression', () => {
  const graph = lavfiFor('scrim', { width: W, height: H });

  it('is one frame, not a stream', () => {
    // The whole reason an effect is a static mask: a per-frame geq measured
    // 3755ms against 154ms for the same picture generated once, for 60
    // frames at 1080x1920. `r=1:d=1` is exactly one frame; the renderer
    // holds it with loop.
    assert.match(graph, /color=c=black@0:s=1080x1920:r=1:d=1/);
  });

  it('formats to yuva420p BEFORE geq', () => {
    // geq writes alpha into the plane that is already there. With no alpha
    // plane the expression is evaluated and discarded: the mask comes out
    // opaque, with nothing in the log to say so.
    const fmt = graph.indexOf('format=yuva420p');
    const geq = graph.indexOf('geq=');
    assert.ok(fmt > 0 && geq > fmt, graph);
  });

  it('carries the effect\'s colour and its alpha expression', () => {
    assert.match(graph, /geq=r='0':g='0':b='0':a='/);
    assert.match(lavfiFor('rule', { width: W, height: H }), /geq=r='255':g='255':b='255'/);
  });

  it('takes the frame size it is given', () => {
    assert.match(lavfiFor('scrim', { width: 640, height: 640 }), /s=640x640/);
  });

  it('refuses a frame with no size, in either axis', () => {
    // `?? ` rather than `|| `, because a falsy zero took the default and the
    // guard could never fire. Both axes, because the first version of this
    // only checked width and a sweep walked straight through the height.
    assert.throws(() => lavfiFor('scrim', { width: 0, height: 100 }), /positive frame size/);
    assert.throws(() => lavfiFor('scrim', { width: 100, height: 0 }), /positive frame size/);
    assert.throws(() => lavfiFor('scrim', { width: -10, height: 100 }), /positive frame size/);
  });

  it('quotes the expression, so its commas are not filter separators', () => {
    // `between(Y,a,b)` has commas in it and commas separate filters in a
    // filtergraph. Unquoted, ffmpeg reads the rest of the expression as
    // further filters and refuses the input.
    const r = lavfiFor('rule', { width: W, height: H });
    assert.match(r, /a='if\(between\(Y,[^']*\)'$/);
  });
});

describe('validating an fx source', () => {
  it('passes a good one', () => {
    assert.equal(validateFxSource('s1', { kind: 'fx', effect: 'scrim' }), null);
    assert.equal(
      validateFxSource('s1', { kind: 'fx', effect: 'scrim', params: { strength: 0.5 } }),
      null
    );
  });

  it('names the catalogue when the effect is unknown', () => {
    const msg = validateFxSource('s1', { kind: 'fx', effect: 'glow' });
    assert.match(msg, /unknown effect "glow"/);
    assert.match(msg, /scrim, vignette, rule/);
  });

  it('reports a bad parameter against the source id', () => {
    const msg = validateFxSource('s1', { kind: 'fx', effect: 'scrim', params: { x: 1 } });
    assert.match(msg, /source "s1".*has no parameter "x"/s);
  });
});

describe('describeFx', () => {
  it('reads as a sentence with the resolved numbers in it', () => {
    const line = describeFx('scrim', { strength: 0.5 });
    assert.match(line, /^Bottom scrim: /);
    assert.match(line, /strength 0\.5/);
    assert.match(line, /start 0\.62/);
  });
});

// ── The render graph ──────────────────────────────────────────────────

function comp(sources, items, size = { width: W, height: H }) {
  return { version: 1, size, fps: 30, sources, tracks: items };
}

const CLIP = { kind: 'clip', url: 'a.mp4', duration: 20, width: W, height: H, fps: 30 };

function stillAndScrim() {
  return comp(
    {
      a: { ...CLIP },
      f: { kind: 'fx', effect: 'scrim' },
    },
    [
      { id: 't0', kind: 'video', items: [{ id: 'i1', at: 0, len: 4, source: 'a', in: 0 }] },
      { id: 't1', kind: 'video', items: [{ id: 'i2', at: 0, len: 4, source: 'f' }] },
    ]
  );
}

describe('an fx source in the render graph', () => {
  it('is a valid composition in the first place', () => {
    assert.deepEqual(validate(stillAndScrim()), []);
  });

  it('becomes a GENERATED input, with a filtergraph and no path', () => {
    const r = renderGraph(stillAndScrim(), { sourcePaths: { a: '/tmp/a.mp4' } });
    assert.equal(r.inputs.length, 2);
    assert.equal(r.inputs[0].generated, undefined);
    assert.equal(r.inputs[1].generated, true);
    assert.match(r.inputs[1].lavfi, /^color=c=black@0:s=1080x1920/);
  });

  it('holds the single frame for the item\'s length, at the composition rate', () => {
    // `fps` BEFORE `trim`, unlike a design source. The lavfi source emits
    // its one frame at one frame per second, so trimming first would take
    // four seconds of a 1fps stream and hand the graph four frames where it
    // wants a hundred and twenty.
    const r = renderGraph(stillAndScrim(), { sourcePaths: { a: '/tmp/a.mp4' } });
    const chain = r.graph.split(';').find((p) => p.startsWith('[1:v]'));
    assert.match(chain, /loop=loop=-1:size=1:start=0,fps=30,trim=duration=4\.000000/);
  });

  it('is not scaled, cropped or padded', () => {
    // The mask is generated AT the frame size, so a fit is an identity pass
    // that costs a filter; worse, `pad`'s black fill would replace the
    // transparency the effect is made of.
    const r = renderGraph(stillAndScrim(), { sourcePaths: { a: '/tmp/a.mp4' } });
    const chain = r.graph.split(';').find((p) => p.startsWith('[1:v]'));
    assert.doesNotMatch(chain, /scale=/);
    assert.doesNotMatch(chain, /crop=/);
    assert.doesNotMatch(chain, /pad=/);
  });

  it('contributes no audio stream', () => {
    // An `[n:a]` for an input with no audio makes ffmpeg refuse the entire
    // filter_complex, which is how a composition holding one photograph
    // produced no video at all.
    const r = renderGraph(stillAndScrim(), { sourcePaths: { a: '/tmp/a.mp4' } });
    assert.doesNotMatch(r.graph, /\[1:a\]/);
  });

  it('refuses an unknown effect, and NAMES the source', () => {
    // Which source is the whole value of the check: a batch of thirty
    // reports per item, and "unknown effect" with no source id leaves the
    // operator opening compositions to find which layer it was. Building the
    // expression would throw on its own; it would not say where.
    const c = comp(
      { f: { kind: 'fx', effect: 'glow' } },
      [{ id: 't0', kind: 'video', items: [{ id: 'i1', at: 0, len: 2, source: 'f' }] }]
    );
    assert.throws(() => renderGraph(c), /source "f": unknown effect "glow"/);
  });

  it('refuses a parameter the effect does not have, and names the source', () => {
    const c = comp(
      { f: { kind: 'fx', effect: 'scrim', params: { blur: 3 } } },
      [{ id: 't0', kind: 'video', items: [{ id: 'i1', at: 0, len: 2, source: 'f' }] }]
    );
    assert.throws(() => renderGraph(c), /source "f": .*has no parameter "blur"/s);
  });

  it('generates the mask at the composition\'s size, not a default', () => {
    const c = stillAndScrim();
    c.size = { width: 1080, height: 1080 };
    const r = renderGraph(c, { sourcePaths: { a: '/tmp/a.mp4' } });
    assert.match(r.inputs[1].lavfi, /s=1080x1080/);
  });

  it('passes the source\'s params through to the expression', () => {
    const c = stillAndScrim();
    c.sources.f.params = { strength: 0.25 };
    const r = renderGraph(c, { sourcePaths: { a: '/tmp/a.mp4' } });
    assert.match(r.inputs[1].lavfi, /255\*0\.25\*/);
  });
});

describe('ffmpegArgs with a generated input', () => {
  it('emits -f lavfi and the graph, not a path', () => {
    const r = renderGraph(stillAndScrim(), { sourcePaths: { a: '/tmp/a.mp4' } });
    const args = ffmpegArgs(r, ['/tmp/a.mp4', null], '/tmp/out.mp4');
    const i = args.indexOf('-f');
    assert.equal(args[i + 1], 'lavfi');
    assert.match(args[i + 3], /^color=c=black@0/);
    assert.ok(!args.includes(null), 'no null reached the argv');
  });

  it('keeps the inputs index-aligned when fx sits between two clips', () => {
    // ffmpeg numbers `[n:v]` by POSITION. A caller that dropped the fx entry
    // from its path array would shift every input after it onto the wrong
    // file, and the render would succeed with the wrong footage in it.
    const c = comp(
      {
        a: { ...CLIP },
        f: { kind: 'fx', effect: 'vignette' },
        b: { ...CLIP, url: 'b.mp4' },
      },
      [
        { id: 't0', kind: 'video', items: [{ id: 'i1', at: 0, len: 3, source: 'a', in: 0 }] },
        { id: 't1', kind: 'video', items: [{ id: 'i2', at: 0, len: 3, source: 'f' }] },
        { id: 't2', kind: 'video', items: [{ id: 'i3', at: 0, len: 3, source: 'b', in: 0 }] },
      ]
    );
    const r = renderGraph(c, { sourcePaths: { a: '/a.mp4', b: '/b.mp4' } });
    assert.deepEqual(r.inputs.map((x) => x.sourceId), ['a', 'f', 'b']);
    const args = ffmpegArgs(r, ['/a.mp4', null, '/b.mp4'], '/tmp/out.mp4');
    const inputs = args.reduce((acc, v, i) => (v === '-i' ? [...acc, args[i + 1]] : acc), []);
    assert.equal(inputs.length, 3);
    assert.equal(inputs[0], '/a.mp4');
    assert.match(inputs[1], /^color=c=black@0/);
    assert.equal(inputs[2], '/b.mp4');
  });

  it('refuses a real input with no resolved path, rather than passing undefined', () => {
    const r = renderGraph(stillAndScrim(), { sourcePaths: { a: '/tmp/a.mp4' } });
    assert.throws(
      () => ffmpegArgs(r, [null, null], '/tmp/out.mp4'),
      /input 0 \(source "a"\) has no resolved path/
    );
  });
});
