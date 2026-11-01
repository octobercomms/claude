// SOSTAC: stock guidance that exists before anyone tailors anything.
//
// Every item in the stock playbook said what to do and nothing about how. The
// first attempt at fixing that shipped a paragraph explaining that the
// guidance would arrive at tailor time, which is not guidance — it is a
// promissory note, and Daniel reported the item again.
//
// The expensive failure mode here is not a missing phase. It is guidance that
// names a screen OMI does not have: a confident instruction to open
// "Convert → Objectives" is worse than silence, because the reader trusts it
// and then concludes the platform is broken. The first draft of this file
// named eleven screens that do not exist. So the guard that matters is the
// last one: every `Section → Screen` reference is checked against the nav.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

const src = read('shared/sostacHow.mjs');
const panel = read('frontend/src/components/ClientStrategyPanel.jsx');
const sections = read('frontend/src/nav/sections.js');

// Parse the module without importing it, so this stays a plain node test.
const PHASES = ['Situation Analysis', 'Objectives', 'Strategy', 'Tactics', 'Action', 'Control'];

function blockFor(phase) {
  const i = src.indexOf(`'${phase}': {`);
  if (i < 0) return null;
  const next = PHASES.map((p) => src.indexOf(`'${p}': {`)).filter((j) => j > i).sort((a, b) => a - b)[0];
  return src.slice(i, next > 0 ? next : src.indexOf('};', i));
}

ok('all six phases carry a method', () => {
  for (const p of PHASES) {
    const b = blockFor(p);
    assert.ok(b, `${p} has an entry`);
    assert.ok(/aim: '/.test(b), `${p} says what the phase is for`);
    const steps = (b.match(/\n      '/g) || []).length;
    assert.ok(steps >= 4, `${p} has at least four steps, not a sentence (${steps})`);
    assert.ok(/omi: '/.test(b), `${p} names the screens that do the work`);
  }
});

ok('it is not a promise that guidance will arrive later', () => {
  // The shape of the thing that was wrong: copy about tailoring, in place of
  // a method.
  for (const p of PHASES) {
    const b = blockFor(p);
    assert.ok(!/will be added|once tailored|after tailoring/i.test(b), `${p} explains rather than defers`);
  }
});

ok('the panel renders the method, from the shared module', () => {
  assert.ok(/import \{ howFor \} from '@shared\/sostacHow\.mjs'/.test(panel));
  assert.ok(/const method = howFor\(ph\.title\)/.test(panel), 'keyed on the phase the card is drawing');
  assert.ok(/How to work this phase/.test(panel));
  assert.ok(/method\.steps\.map/.test(panel), 'the steps, not only the aim');
  assert.ok(/In OMI: \{method\.omi\}/.test(panel));
});

ok('a tailored item still wins', () => {
  // Steps written for the client replace the generic method under that item.
  assert.ok(/!!\(it\.how \|\| \[\]\)\.length && \(/.test(panel), 'the per-item block is still there');
  const i = panel.indexOf('How to do this');
  const j = panel.indexOf('How to work this phase');
  assert.ok(i > 0 && j > 0 && j < i, 'the phase method sits above the items it covers');
});

ok('it is collapsed, so the plan still reads as a checklist', () => {
  const i = panel.indexOf('How to work this phase');
  const before = panel.slice(Math.max(0, i - 300), i);
  assert.ok(/<details className="sostac-how"/.test(before),
    'six phases of five steps open at once is a document, not a plan');
});

ok('every screen the guidance names actually exists', () => {
  // The nav's own labels, per section, which is the only list that can
  // answer this. Section titles and row labels both come from sections.js.
  const parts = sections.split(/\n  ([a-z]+): \{/);
  const bySection = new Map();
  for (let i = 1; i < parts.length; i += 2) {
    const body = parts[i + 1];
    const title = (body.match(/title: '([^']+)'/) || [])[1];
    if (!title) continue;
    const labels = [...body.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
    bySection.set(title, new Set(labels));
  }
  assert.ok(bySection.size >= 9, 'the nav parsed');

  // Every "Section → " in the guidance, with the longest label of that
  // section that follows it. A reference with no matching label is a screen
  // that does not exist.
  const bad = [];
  for (const m of src.matchAll(/\b([A-Z][A-Za-z]+) → /g)) {
    const section = m[1];
    const labels = bySection.get(section);
    if (!labels) { bad.push(`${section} → … (no such section)`); continue; }
    const after = src.slice(m.index + m[0].length, m.index + m[0].length + 60);
    const hit = [...labels]
      .filter((l) => after.startsWith(l))
      .sort((a, b) => b.length - a.length)[0];
    if (!hit) bad.push(`${section} → ${after.split(/[,.;:]| (?=[a-z])/)[0]}`);
  }
  assert.deepStrictEqual(bad, [], `guidance names screens OMI does not have: ${bad.join('; ')}`);
});

ok('and the sections it names are real sections', () => {
  const named = new Set([...src.matchAll(/\b([A-Z][A-Za-z]+) → /g)].map((m) => m[1]));
  for (const s of named) {
    assert.ok(new RegExp(`title: '${s}'`).test(sections), `${s} is a section in the nav`);
  }
  assert.ok(named.size >= 5, 'the guidance points across the platform, not at one screen');
});

ok('the progress counter cannot take the screen down', () => {
  // Found by driving the untailored screen: `strat.progress.done` was read
  // unguarded one line below a `strat?.progress?.total` that was guarded, so
  // a strategy arriving without the counter did not lose a counter — it threw
  // inside render and the error boundary replaced the whole SOSTAC plan with
  // "Something went wrong here."
  assert.ok(/\{strat\.progress\?\.done \?\? 0\}\/\{strat\.progress\?\.total \?\? 0\} done/.test(panel));
  assert.ok(!/\{strat\.progress\.done\}/.test(panel));
});

console.log(`sostac-how      ✓ ${passed} assertions passed`);
