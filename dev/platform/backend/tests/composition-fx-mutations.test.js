/**
 * Mutation tests for the effects catalogue and the `fx` render branch.
 *
 * Same approach as composition-render-mutations.test.js: each mutation
 * rewrites one line of the real source, runs the real tests in a subprocess,
 * and asserts that they fail. A mutation that survives means the tests have
 * a gap.
 *
 * Both files are in scope, because the effect and the mechanism fail
 * differently. A broken alpha expression renders a picture nobody asked for;
 * a broken render branch renders nothing at all and says a file is missing.
 *
 * The pixel file is run for every mutation, not only the geometric ones.
 * Three faults in this build were invisible to any test that reads a graph
 * string, so a sweep that only ran the string tests would be certifying the
 * wrong thing.
 *
 *   node tests/composition-fx-mutations.test.js
 *
 * Runs sequentially as a plain script (not node:test) because mutations
 * rewrite shared source files and must not overlap.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FX_PATH = path.resolve(__dirname, '../../shared/compositionFx.mjs');
const RENDER_PATH = path.resolve(__dirname, '../../shared/compositionRender.mjs');
const TEMPLATE_PATH = path.resolve(__dirname, '../../shared/compositionTemplate.mjs');
const GRAPH_TESTS = path.resolve(__dirname, 'composition-fx.test.js');
const PIXEL_TESTS = path.resolve(__dirname, 'composition-fx-pixels.test.js');
const TEMPLATE_TESTS = path.resolve(__dirname, 'composition-template.test.js');
const AGREEMENT_TESTS = path.resolve(__dirname, 'composition-fx-agreement.test.js');

const originals = new Map([
  [FX_PATH, fs.readFileSync(FX_PATH, 'utf8')],
  [RENDER_PATH, fs.readFileSync(RENDER_PATH, 'utf8')],
  [TEMPLATE_PATH, fs.readFileSync(TEMPLATE_PATH, 'utf8')],
]);

function restore() {
  for (const [p, text] of originals) fs.writeFileSync(p, text);
}

function testsPass(tests) {
  for (const t of tests) {
    try {
      execSync(`node ${t}`, { stdio: 'pipe', timeout: 120000 });
    } catch {
      return false;
    }
  }
  return true;
}

let passed = 0;
let failed = 0;

function mutation(name, file, find, replace) {
  // A template mutation is judged by the template suite; everything else by
  // the graph and the pixels. Running all three for every mutation would be
  // honest and slow, and the two sets do not overlap: nothing in the
  // template suite renders a frame.
  const tests = file === TEMPLATE_PATH
    ? [TEMPLATE_TESTS]
    : [GRAPH_TESTS, PIXEL_TESTS, AGREEMENT_TESTS];
  const original = originals.get(file);
  const hits = original.split(find).length - 1;
  if (hits !== 1) {
    failed++;
    console.log(
      `  FAIL ${name}\n       target appears ${hits} times, so the mutation is ambiguous`
    );
    return;
  }
  fs.writeFileSync(file, original.replace(find, replace));
  try {
    if (testsPass(tests)) {
      failed++;
      console.log(`  FAIL ${name}\n       mutation SURVIVED (tests still pass)`);
    } else {
      passed++;
      console.log(`  ok   ${name}`);
    }
  } finally {
    restore();
  }
}

console.log('# composition fx mutations');

// ── the masks ─────────────────────────────────────────────────────────

mutation(
  'scrim darkens above its start (max removed)',
  FX_PATH,
  "return `255*${x(p.strength)}*min(1,max(0,(Y-H*${x(p.start)})/(H*${x(span)})))`;",
  "return `255*${x(p.strength)}*min(1,(Y-H*${x(p.start)})/(H*${x(span)}))`;"
);

mutation(
  'scrim reaches full strength only at the bottom edge (full ignored)',
  FX_PATH,
  'const span = Math.max(0.02, p.full - p.start);\n      return `255*',
  'const span = Math.max(0.02, 1 - p.start);\n      return `255*'
);

mutation(
  "the scrim's function and expression disagree about where it ends",
  FX_PATH,
  'const span = Math.max(0.02, p.full - p.start);\n      return p.strength',
  'const span = Math.max(0.02, 1 - p.start);\n      return p.strength'
);

mutation(
  'scrim never reaches full strength (the clamp caps it low)',
  FX_PATH,
  '255*${x(p.strength)}*min(1,max(0,',
  '255*${x(p.strength)}*min(0.2,max(0,'
);

mutation(
  'vignette not normalised per axis (ovals on a non-square frame)',
  FX_PATH,
  'pow((Y-H/2)/(H/2),2)',
  'pow((Y-H/2)/(W/2),2)'
);

mutation(
  'vignette strength ignored',
  FX_PATH,
  '${x(p.falloff)})*${x(p.strength)})`,',
  '${x(p.falloff)})*1)`,'
);

mutation(
  'rule has no AND, so the two bands are summed rather than crossed',
  FX_PATH,
  '*between(X,W*${x(p.inset)},W-W*${x(p.inset)})',
  '+between(X,W*${x(p.inset)},W-W*${x(p.inset)})'
);

mutation(
  'rule ignores its inset and runs edge to edge',
  FX_PATH,
  'between(X,W*${x(p.inset)},W-W*${x(p.inset)})',
  'between(X,0,W)'
);

mutation(
  'rule ignores its y and sits where it was not asked to',
  FX_PATH,
  'return `if(between(Y,H*${x(p.y)}-${x(half)},H*${x(p.y)}+${x(half)})`',
  'return `if(between(Y,H*0.5-${x(half)},H*0.5+${x(half)})`'
);

// ── the generated input ───────────────────────────────────────────────

mutation(
  'no alpha plane to write (format after geq)',
  FX_PATH,
  "return `color=c=black@0:s=${W}x${H}:r=1:d=1,format=yuva420p,`\n    + `geq=r='${spec.rgb}':g='${spec.rgb}':b='${spec.rgb}':a='${a}'`;",
  "return `color=c=black@0:s=${W}x${H}:r=1:d=1,`\n    + `geq=r='${spec.rgb}':g='${spec.rgb}':b='${spec.rgb}':a='${a}',format=yuva420p`;"
);

mutation(
  'the mask is a stream rather than one frame',
  FX_PATH,
  'color=c=black@0:s=${W}x${H}:r=1:d=1',
  'color=c=black@0:s=${W}x${H}:r=25:d=10'
);

mutation(
  'the mask is generated at a fixed size rather than the frame\'s',
  FX_PATH,
  'const W = Math.round(opts.width ?? 1080);',
  'const W = 1080;'
);

// ── parameters ────────────────────────────────────────────────────────

mutation(
  'a parameter is coerced, so null reads as zero',
  FX_PATH,
  "if (typeof n !== 'number' || !Number.isFinite(n)) return null;",
  'if (!Number.isFinite(Number(n))) return null;'
);

mutation(
  'a misspelt parameter is silently ignored',
  FX_PATH,
  `    const p = spec.params[name];
    if (!p) {`,
  `    const p = spec.params[name];
    if (false) {`
);

mutation(
  'parameters are not clamped to their measured range',
  FX_PATH,
  'const v = clamp(value, p.min, p.max);',
  'const v = clamp(value, -1e9, 1e9);'
);

mutation(
  'a zero frame size takes the default instead of being refused',
  FX_PATH,
  'const H = Math.round(opts.height ?? 1920);',
  'const H = Math.round(opts.height || 1920);'
);

// ── the render branch ─────────────────────────────────────────────────

mutation(
  'an fx input is not marked generated, so a file is demanded for it',
  RENDER_PATH,
  '...(lavfi ? { generated: true, lavfi } : {}),',
  '',
);

mutation(
  'the effect name is not checked before the graph is built',
  RENDER_PATH,
  `        const bad = validateFxSource(item.source, src);
        if (bad) throw new Error(bad);`,
  '        const bad = null; if (bad) throw new Error(bad);'
);

mutation(
  'the fx chain trims before it resamples, so the mask runs at 1fps',
  RENDER_PATH,
  `        parts.push('loop=loop=-1:size=1:start=0');
        parts.push(\`fps=\${fps}\`);
        parts.push(\`trim=duration=\${f(item.len)}\`);`,
  `        parts.push('loop=loop=-1:size=1:start=0');
        parts.push(\`trim=duration=\${f(item.len)}\`);
        parts.push(\`fps=\${fps}\`);`
);

mutation(
  'the single frame is not held, so the effect lasts one frame',
  RENDER_PATH,
  "        parts.push('loop=loop=-1:size=1:start=0');",
  '',
);

mutation(
  'an fx layer is scaled and padded like footage',
  RENDER_PATH,
  '      if (!isFx) {\n        const fit = item.fit || \'cover\';',
  '      if (true) {\n        const fit = item.fit || \'cover\';'
);

mutation(
  'a generated input is passed to ffmpeg as a path',
  RENDER_PATH,
  `    if (inp?.lavfi) {
      args.push('-f', 'lavfi', '-i', inp.lavfi);
      continue;
    }`,
  ''
);

mutation(
  'a real input with no path is passed through as undefined',
  RENDER_PATH,
  `    if (p == null || p === '') {
      throw new Error(
        \`input \${i} (source "\${inp?.sourceId ?? '?'}") has no resolved path\`
      );
    }`,
  ''
);

// ── the preview's copy of the mask ────────────────────────────────────
//
// The preview and the render agreeing is the guarantee the composition model
// is built on, and the mask is described three times for three consumers. A
// parameter wired into one description and not another is the drift these
// mutations stand in for.

mutation(
  'the scrim\'s paint ignores where the ramp starts',
  FX_PATH,
  'from: { x: 0, y: p.start },',
  'from: { x: 0, y: 0 },'
);

mutation(
  'the scrim\'s paint ignores its strength',
  FX_PATH,
  'stops: [{ at: 0, alpha: 0 }, { at: 1, alpha: p.strength }],',
  'stops: [{ at: 0, alpha: 0 }, { at: 1, alpha: 1 }],'
);

mutation(
  'the scrim function and the expression clamp differently',
  FX_PATH,
  'return p.strength * Math.min(1, Math.max(0, (yf - p.start) / span));',
  'return p.strength * Math.max(0, (yf - p.start) / span);'
);

// Deliberately UNDER-sampling rather than over-. `rSat` decides where the
// stops stop, and covering too much of the saturated region is harmless
// because every stop still carries its own correct alpha: a sweep with
// `1/falloff` in place of `1/(2*falloff)` survived for exactly that reason,
// which is a benign mutation rather than a gap. Stopping the stops short of
// the knee is the fault that shows.
mutation(
  'the vignette\'s paint stops its sampling short of the knee',
  FX_PATH,
  '? Math.min(R, (1 / p.strength) ** (1 / (2 * p.falloff)))',
  '? Math.min(R, (1 / p.strength) ** (1 / (2 * p.falloff))) * 0.5'
);

mutation(
  'the vignette\'s paint is drawn on a circle rather than the frame',
  FX_PATH,
  "return { kind: 'radial', centre: { x: 0.5, y: 0.5 }, radius: R, stops };",
  "return { kind: 'radial', centre: { x: 0.5, y: 0.5 }, radius: 1, stops };"
);

mutation(
  'the vignette\'s paint is sampled too coarsely to follow the curve',
  FX_PATH,
  'Array.from({ length: 25 }, (unused, i) => {\n        const r = (i / 24) * rSat;',
  'Array.from({ length: 4 }, (unused, i) => {\n        const r = (i / 3) * rSat;'
);

mutation(
  'the vignette function squares the wrong way round',
  FX_PATH,
  'return Math.min(1, (d2 ** p.falloff) * p.strength);',
  'return Math.min(1, (d2 * p.falloff) * p.strength);'
);

mutation(
  'the rule\'s paint ignores its inset',
  FX_PATH,
  'x: p.inset,\n        w: 1 - 2 * p.inset,',
  'x: 0,\n        w: 1,'
);

mutation(
  'the rule\'s paint is a pixel thick whatever the parameter says',
  FX_PATH,
  'h: p.thickness / size.height,',
  'h: 1 / size.height,'
);

mutation(
  'the paint drops the effect\'s colour',
  FX_PATH,
  'colour: [level, level, level],',
  'colour: [0, 0, 0],'
);

// ── the template binding ──────────────────────────────────────────────

mutation(
  'an effect track is appended after the slots rather than counted with them',
  TEMPLATE_PATH,
  '    ...fxEntries.map((e) => e.track ?? 1),\n',
  ''
);

mutation(
  'an effect-only track is created as an audio track',
  TEMPLATE_PATH,
  "const kind = kinds.length && kinds.every((k) => k === 'audio') ? 'audio' : 'video';",
  "const kind = kinds.every((k) => k === 'audio') ? 'audio' : 'video';"
);

mutation(
  'the effect is sized by summing the slots rather than measuring the result',
  TEMPLATE_PATH,
  '        const end = secs(it.at + it.len);\n        if (end > bound) bound = end;',
  '        bound += it.len;'
);

mutation(
  'the effect does not start at the top of the timeline',
  TEMPLATE_PATH,
  '          at: 0,\n          len: bound,',
  '          at: 0.5,\n          len: bound,'
);

mutation(
  "the effect's parameters are dropped",
  TEMPLATE_PATH,
  '...(e.params ? { params: e.params } : {}),',
  ''
);

mutation(
  "the effect's opacity is dropped",
  TEMPLATE_PATH,
  '...(e.opacity != null ? { opacity: e.opacity } : {}),',
  ''
);

mutation(
  'a template may name an effect that does not exist',
  TEMPLATE_PATH,
  'errors.push(`${at}: unknown effect "${e.effect}" (${FX_NAMES.join(\', \')})`);',
  ''
);

mutation(
  'a template may put an effect on an audio track',
  TEMPLATE_PATH,
  'errors.push(`${at}: track ${ti} is an audio track, and an effect is a picture`);',
  ''
);

mutation(
  'a template may declare an effect field nothing reads',
  TEMPLATE_PATH,
  'if (unknown.length) errors.push(`${at}: declares ${unknown.join(\', \')}, which nothing reads`);',
  ''
);

console.log(`# ${passed} killed, ${failed} survived`);
if (failed > 0) {
  console.log('# MUTATION TESTING FAILED: some mutations survived');
  process.exit(1);
}
