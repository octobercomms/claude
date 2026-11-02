// A render branch with one reachable value is dead code.
//
// Several screens were pages in their own right once, and kept a standalone
// layout behind an `embedded` prop long after they stopped being reachable
// that way. One caller each, always passing the flag, so the other half of
// every branch could not run: a kicker, a hero, a max-width wrapper and in
// two cases a second ?tab= key, all of it unreachable and all of it
// maintained. Two were deleted on 2 November; the scan that found them found
// seven more, and OutletEditModal had the mirror-image fault — a pane half
// that nothing had called since Publications went back to a table.
//
// So the rule, rather than the nine instances: a component that declares
// `embedded = false` must have a caller that passes it AND either a caller
// that does not or a route, or one side of its branches cannot draw. The
// honest fix for a single-caller component is to delete the prop and inline
// the one behaviour, which is why this file asserts a count of zero rather
// than an allowlist.
//
// EditContactModal is the shape that earns the prop: SettingsPage opens it as
// a modal, ClientOutreachPage renders it as a pane. Both halves draw.
//
//   node tests/embedded-reachable.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'frontend', 'src');

function jsxFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...jsxFiles(p));
    else if (/\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

// Comments are stripped before anything is counted. This file's own
// explanation names `embedded = false` and the components that had it, and so
// do the comments left behind in the screens that were fixed — a scan of the
// raw text would match the account of the bug rather than the bug.
const strip = (s) => s
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const files = jsxFiles(SRC);
const sources = new Map(files.map((f) => [path.relative(SRC, f), strip(fs.readFileSync(f, 'utf8'))]));

// Every component declaring the prop with a false default.
const declared = [];
for (const [rel, src] of sources) {
  const re = /function\s+([A-Z][A-Za-z0-9_]*)\s*\(\s*\{[^)]*\bembedded\s*=\s*false/g;
  let m;
  while ((m = re.exec(src))) declared.push({ file: rel, name: m[1] });
}

const unreachable = [];
for (const { file, name } of declared) {
  let withFlag = 0;
  let withoutFlag = 0;
  let routed = false;
  for (const [rel, src] of sources) {
    const re = new RegExp(`<${name}(\\s[^>]*)?/?>`, 'g');
    let m;
    while ((m = re.exec(src))) {
      if (/\bembedded\b/.test(m[1] || '')) withFlag += 1;
      else withoutFlag += 1;
    }
    if (rel === 'App.jsx' && new RegExp(`element=\\{<${name}\\b`).test(src)) routed = true;
  }
  const bothSidesDraw = withFlag > 0 && (withoutFlag > 0 || routed);
  if (!bothSidesDraw) unreachable.push(`${name} (${file}): passed by ${withFlag} caller(s), omitted by ${withoutFlag}, routed=${routed}`);
}

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

ok('the scan finds the components that declare the prop', () => {
  assert.ok(declared.length >= 1,
    'no component declares `embedded = false` — if the prop is gone everywhere, delete this file rather than letting it pass vacuously');
});

ok('every `embedded` prop has both halves reachable', () => {
  assert.deepStrictEqual(unreachable, [],
    'these components branch on `embedded` but only one value can occur, so the other branch is dead:\n  ' + unreachable.join('\n  '));
});

ok('EditContactModal is still the two-caller case', () => {
  const callers = [...sources].filter(([, s]) => /<EditContactModal\b/.test(s)).map(([f]) => f);
  assert.ok(callers.includes('pages/SettingsPage.jsx'), 'SettingsPage should still open the contact record as a modal');
  assert.ok(callers.includes('pages/ClientOutreachPage.jsx'), 'ClientOutreachPage should still render it as a pane');
});

console.log(`embedded-reachable: ${passed} checks passed (${declared.length} component(s) declare the prop)`);
