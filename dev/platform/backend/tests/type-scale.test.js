// The type scale editor, and the one thing that will break it.
//
// Daniel wanted every font size and weight listed with a field to change it,
// a company default, and per-user overrides on top. The list of tokens is in
// backend/src/services/typeScale.js and the tokens themselves are in
// frontend/src/index.css, which is two places for one fact.
//
// That drift is silent and plausible-looking. Add a token to the CSS and
// forget the catalogue: the editor renders fourteen fields instead of
// fifteen, the missing one is simply not there, and the screen looks finished.
// Change a default in the CSS and forget the catalogue: the editor shows the
// old number as "Default" next to text rendering at the new one, so the field
// reads as though the save did not stick.
//
//   node tests/type-scale.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('../src/services/typeScale');

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; console.log(`PASS  ${what}`); };

const CSS = fs.readFileSync(
  path.join(__dirname, '../../frontend/src/index.css'), 'utf8');

// The first :root block, which is where the light-theme tokens are declared.
const rootBlock = CSS.slice(CSS.indexOf(':root'), CSS.indexOf('}', CSS.indexOf(':root')));
const declared = new Map();
for (const m of rootBlock.matchAll(/(--f[sw]-[a-z0-9-]+)\s*:\s*([0-9.]+)(px)?\s*;/g)) {
  declared.set(m[1], Number(m[2]));
}

ok('the stylesheet declares tokens at all', () => {
  // If the regex stops matching, every assertion below passes vacuously and
  // this file becomes decoration.
  assert.ok(declared.size >= 15,
    `only ${declared.size} --fs-/--fw- tokens found in :root — the parse is wrong, not the CSS`);
});

ok('every token in the stylesheet is in the editor', () => {
  const inCatalogue = new Set(Object.keys(ts.defaults()));
  const missing = [...declared.keys()].filter(t => !inCatalogue.has(t));
  assert.deepStrictEqual(missing, [],
    `these tokens exist in index.css and cannot be reached from the editor: ${missing.join(', ')} `
    + '— the field is simply absent and the screen looks complete without it');
});

ok('and every token in the editor is in the stylesheet', () => {
  const orphans = Object.keys(ts.defaults()).filter(t => !declared.has(t));
  assert.deepStrictEqual(orphans, [],
    `the editor offers fields for tokens nothing reads: ${orphans.join(', ')} — changing one does nothing`);
});

ok('the defaults match what the stylesheet actually renders', () => {
  for (const [token, value] of declared) {
    assert.strictEqual(ts.defaults()[token], value,
      `${token} is ${value} in index.css and ${ts.defaults()[token]} in the catalogue — the editor would `
      + 'show the wrong "Default", so resetting a field would change the size instead of restoring it');
  }
});

ok('the stylesheet uses the weight tokens rather than literals', () => {
  // Ten tokens were added to replace literal font-weights in the ten type
  // classes. A token nothing references is a field that silently does nothing.
  for (const t of ts.WEIGHT_TOKENS) {
    assert.ok(CSS.includes(`var(${t.token})`),
      `${t.token} is declared but never used — its field in the editor would have no effect`);
  }
});

ok('the editor card is pinned at the same defaults', () => {
  // `.type-editor` re-declares the size tokens so the card stays readable when
  // the scale it controls is broken. That is a second copy of the defaults, and
  // a second copy drifts: if :root moves and the pin does not, the card renders
  // at the old scale and the specimen inside it disagrees with the page behind
  // it for no visible reason.
  const pin = CSS.slice(CSS.indexOf('.type-editor {'), CSS.indexOf('}', CSS.indexOf('.type-editor {')));
  assert.ok(pin.includes('--fs-'), 'the pinned card rule is gone — a scale small enough to be unreadable '
    + 'can no longer be undone from the screen that set it');
  const pinned = new Map();
  for (const m of pin.matchAll(/(--fs-[a-z0-9-]+)\s*:\s*([0-9.]+)px\s*;/g)) pinned.set(m[1], Number(m[2]));
  for (const t of ts.SIZE_TOKENS) {
    assert.strictEqual(pinned.get(t.token), t.px,
      `the card pins ${t.token} at ${pinned.get(t.token)} and the scale ships ${t.px} — the editor renders `
      + 'at a scale nothing else in OMI uses');
  }
});

// ── weights the font can actually render ─────────────────────────────────────

// Brockmann ships four weights. Rendering "Handgloves 2026" at 300 through 900
// in Chromium and hashing the pixels gives four distinct images: 300 is
// identical to 400, and 800 and 900 are both identical to 700. A field offering
// 800 is a field that visibly does nothing, and the operator's conclusion is
// that the editor is broken.
//
// Measuring advance widths instead gives the wrong answer — two groups, not
// four — because Brockmann's weights are metric-compatible. Width is not a test
// of whether a weight renders.
const INDEX_HTML = fs.readFileSync(
  path.join(__dirname, '../../frontend/index.html'), 'utf8');
const faceWeights = new Set(
  [...INDEX_HTML.matchAll(/@font-face[\s\S]*?\}/g)]
    .flatMap(m => [...m[0].matchAll(/font-weight:\s*(\d+)/g)].map(w => Number(w[1]))));

ok('the font ships the weights this test thinks it does', () => {
  assert.deepStrictEqual([...faceWeights].sort((a, b) => a - b), [400, 500, 600, 700],
    'the @font-face set changed — re-measure before trusting the bounds below');
});

ok('the editor offers no weight the font cannot render', () => {
  for (let w = ts.WEIGHT_MIN; w <= ts.WEIGHT_MAX; w += 100) {
    assert.ok(faceWeights.has(w),
      `the editor offers ${w} and no Brockmann file provides it — the browser falls back to the `
      + 'nearest available weight, so the field changes the number and not the text');
  }
});

ok('and no default asks for one either', () => {
  for (const t of ts.WEIGHT_TOKENS) {
    assert.ok(faceWeights.has(t.weight),
      `${t.token} defaults to ${t.weight}, which has no font file — the stylesheet claims a weight it `
      + 'does not render, and the editor shows it as the value to reset to');
  }
});

// ── bounds ───────────────────────────────────────────────────────────────────

ok('a size below the floor is held, not taken', () => {
  // The reason there is a floor: 4px body text makes the interface unreadable,
  // and the editor that set it is itself unreadable, so there is no way back
  // except a database edit.
  const { values, clamped } = ts.sanitise({ '--fs-body': 4 });
  assert.strictEqual(values['--fs-body'], 11);
  assert.deepStrictEqual(clamped, ['--fs-body']);
});

ok('and a size above the ceiling', () => {
  const { values } = ts.sanitise({ '--fs-body': 400 });
  assert.strictEqual(values['--fs-body'], 20);
});

ok('weights snap to hundreds', () => {
  // A request for 650 renders as 600, so storing 650 shows a number the
  // screen does not obey.
  assert.strictEqual(ts.sanitise({ '--fw-h1': 650 }).values['--fw-h1'], 700);
  assert.strictEqual(ts.sanitise({ '--fw-h1': 649 }).values['--fw-h1'], 600);
  // And past the top of the range it stops at a weight that exists.
  assert.strictEqual(ts.sanitise({ '--fw-h1': 900 }).values['--fw-h1'], 700);
});

ok('rubbish is dropped rather than stored', () => {
  const { values, ignored } = ts.sanitise({
    '--fs-body': 'large', '--evil': 'red; background: url(x)', '--fw-h1': null,
  });
  assert.deepStrictEqual(values, {}, 'a non-numeric value reached the store');
  assert.ok(ignored.includes('--evil'), 'an unknown property was accepted');
  assert.ok(ignored.includes('--fs-body'), 'a non-numeric size was accepted silently');
});

ok('an empty string clears one override without clearing the rest', () => {
  const { values, ignored } = ts.sanitise({ '--fs-body': '', '--fs-title': 20 });
  assert.deepStrictEqual(values, { '--fs-title': 20 });
  assert.ok(!ignored.includes('--fs-body'),
    'resetting one field reported an error — the editor would show a save failure for a normal reset');
});

// ── the two levels ───────────────────────────────────────────────────────────

ok('a user override beats the company default', () => {
  const eff = ts.resolve({ '--fs-body': 16 }, { '--fs-body': 13 });
  assert.strictEqual(eff['--fs-body'], 13);
});

ok('and a company default reaches a user who has set nothing', () => {
  // The point of two levels rather than one. Caro raising the body size has to
  // move everyone who has not deliberately set that token themselves.
  const eff = ts.resolve({ '--fs-body': 16 }, { '--fs-title': 22 });
  assert.strictEqual(eff['--fs-body'], 16, 'a company change did not reach a user with other overrides');
  assert.strictEqual(eff['--fs-title'], 22);
});

ok('every token is resolved, always', () => {
  // The client applies `effective` wholesale and resets first, so a missing
  // token would leave the previous value on :root.
  const eff = ts.resolve({}, {});
  assert.strictEqual(Object.keys(eff).length, declared.size);
  for (const token of declared.keys()) assert.ok(eff[token] != null, `${token} resolved to nothing`);
});

ok('sizes carry px and weights do not', () => {
  assert.strictEqual(ts.cssValue('--fs-body', 14), '14px');
  assert.strictEqual(ts.cssValue('--fw-h1', 700), '700',
    'a weight with px on it is invalid CSS and the declaration is dropped whole');
});


ok('every var() the panel uses is a token that exists', () => {
  // An undefined custom property does not fall back — it makes the whole
  // declaration invalid, and the browser drops it in silence. The first cut of
  // this panel wrote `1.5px solid var(--border)` on the four preset buttons,
  // and because the token is called --card-border there was no border at all:
  // four buttons rendered as plain text, with nothing in the console and
  // nothing in the build to say so.
  const panel = fs.readFileSync(
    path.join(__dirname, '../../frontend/src/components/TypeScalePanel.jsx'), 'utf8');
  const tailwind = (() => {
    try { return fs.readFileSync(path.join(__dirname, '../../frontend/src/styles/tailwind.css'), 'utf8'); }
    catch { return ''; }
  })();
  const used = [...new Set([...panel.matchAll(/var\((--[a-z0-9-]+)\)/g)].map(m => m[1]))];
  assert.ok(used.length > 5, 'the panel stopped using tokens — it is hard-coding values instead');
  const undeclared = used.filter(t => !new RegExp(`\\${'' }s*\\${''}${t}\\s*:`).test(CSS + tailwind)
                                   && !(CSS + tailwind).includes(`${t}:`));
  assert.deepStrictEqual(undeclared, [],
    `the panel reads ${undeclared.join(', ')}, which nothing declares — each one silently deletes the `
    + 'whole CSS declaration it appears in');
});

// ── the four named steps ─────────────────────────────────────────────────────

ok('the Default step is the shipped scale', () => {
  // If it drifts, "Default" is a fifth opinion rather than the house scale,
  // and the one step everyone starts on silently changes the whole app.
  const def = ts.PRESETS.find(p => p.key === 'default');
  for (const t of ts.SIZE_TOKENS) {
    assert.strictEqual(def.values[t.token], t.px,
      `the Default step sets ${t.token} to ${def.values[t.token]}, but index.css ships ${t.px}`);
  }
});

ok('no step inverts the hierarchy', () => {
  // The real failure of a bad scale is not overflow, it is ordering: at body 18
  // with title unchanged, a card heading and the body text under it are the
  // same size, and the page stops having a shape. Every step has to hold
  // caption < body < title < section < display.
  const order = ts.SIZE_TOKENS.map(t => t.token);
  for (const p of ts.PRESETS) {
    for (let i = 1; i < order.length; i += 1) {
      assert.ok(p.values[order[i]] > p.values[order[i - 1]],
        `${p.label} sets ${order[i]} to ${p.values[order[i]]} and ${order[i - 1]} to `
        + `${p.values[order[i - 1]]} — the smaller role is not smaller, so the hierarchy reads backwards`);
    }
  }
});

ok('every step survives its own bounds', () => {
  // A step outside the clamp would be silently rewritten on save, so clicking
  // "Large" would store something other than Large.
  for (const p of ts.PRESETS) {
    const { values, clamped } = ts.sanitise(p.values);
    assert.deepStrictEqual(clamped, [],
      `${p.label} is clamped on save (${clamped.join(', ')}) — the step does not store what it shows`);
    assert.deepStrictEqual(values, p.values);
  }
});

ok('steps set sizes and leave weights alone', () => {
  // Weight is how October's work looks. Someone asking for bigger text is
  // asking to read, not to restyle a client's report.
  for (const p of ts.PRESETS) {
    const weights = Object.keys(p.values).filter(k => k.startsWith('--fw-'));
    assert.deepStrictEqual(weights, [], `${p.label} changes ${weights.join(', ')}`);
  }
});

ok('a step is recognised as itself after a reload', () => {
  for (const p of ts.PRESETS) {
    assert.strictEqual(ts.presetFor(p.values), p.key,
      `${p.label} does not read back as ${p.label} — the screen would show it as Custom`);
  }
  assert.strictEqual(ts.presetFor({ ...ts.defaults(), '--fs-body': 17 }), null,
    'an arbitrary scale is being reported as a named step');
});

// ── who may change what ──────────────────────────────────────────────────────

// Inspected rather than asserted from the source text, because the thing that
// matters is the middleware Express will actually run.
//
// Both failures here are silent. Drop requireAdmin from the company route and
// any logged-in viewer resets the house scale for everyone, with no error
// anywhere. Add it to the self route and a viewer's own size silently 403s —
// and "as Caro uses it, allows them to adjust this also" was the request.
const router = require('../src/routes/uiPrefs');
const layers = router.stack
  .filter(l => l.route)
  .map(l => ({
    path: l.route.path,
    method: Object.keys(l.route.methods)[0],
    handlers: l.route.stack.map(h => h.name || 'anon'),
  }));
const layerFor = p => layers.find(l => l.path === p);

ok('every role can read the scale', () => {
  // The shell applies it on every page for every login, a read-only client
  // included, so a gate here would leave them on the built-in values.
  const get = layerFor('/type-scale');
  assert.ok(get, 'the read route is gone');
  assert.ok(!get.handlers.includes('requireAdmin'),
    'reading the scale is admin-gated — every other role would render at the built-in sizes');
  assert.ok(!get.handlers.includes('requireClientAccess'));
});

ok('anyone may set their own size', () => {
  const own = layerFor('/type-scale/me');
  assert.ok(own, 'the per-user route is gone');
  assert.ok(!own.handlers.includes('requireAdmin'),
    'a user cannot set their own text size — this is the half of the feature Caro uses');
});

ok('and only an admin may set the house default', () => {
  const house = layerFor('/type-scale/company');
  assert.ok(house, 'the house-default route is gone');
  assert.ok(house.handlers.includes('requireAdmin'),
    'any logged-in user can rewrite the house scale for everyone, with nothing on screen to say so');
});

ok('the router authenticates before any of it', () => {
  const guards = router.stack.filter(l => !l.route).map(l => l.handle.name);
  assert.ok(guards.includes('authenticate'),
    'the routes are open to anyone who can reach the port');
});

console.log(`\n${passed} passed, 0 failed`);
