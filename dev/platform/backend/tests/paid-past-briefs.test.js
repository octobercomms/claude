/**
 * Clicking a past brief goes somewhere.
 *
 * Reported twice. First as "the past briefs doesnt seem to do anything",
 * which got a round of explanatory copy; then, after that shipped, as "i
 * click it and nothing happens."
 *
 * Both readings were right. The click did call `selectBatch`, and selecting
 * changed what Draft, Render and Launch work on — all screens you are not
 * looking at when you click. On the Brief step itself the only visible
 * change was a border colour. Explaining that in a sentence under the
 * heading explains a problem instead of removing it.
 *
 * An action whose entire effect is on another screen has to take you to that
 * screen. These pin that, because the failure is invisible in a diff: the
 * old code and the new code both call `selectBatch` and both look correct.
 *
 *   node tests/paid-past-briefs.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const FE = path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'paid');
const step = fs.readFileSync(path.join(FE, 'PaidBriefStep.jsx'), 'utf8');
const panel = fs.readFileSync(path.join(FE, 'PaidPipelinePanel.jsx'), 'utf8');

test('the panel hands the brief step a way to open a batch, not only select it', () => {
  assert.match(panel, /onOpenBatch=\{\(id\) => \{ pipeline\.selectBatch\(id\); go\('concepts'\); \}\}/,
    'opening a past brief selects it and moves to Draft');
});

test("'concepts' is the step Draft actually is", () => {
  // If the step keys are ever renamed, go('concepts') silently becomes a
  // no-op and this bug comes back wearing the same clothes.
  assert.match(panel, /case 'concepts':\s*\n\s*return <PaidConceptsStep/,
    "the key passed to go() is the one the switch renders Draft for");
});

test('the card click opens rather than selects', () => {
  assert.match(step, /onClick=\{\(\) => open\(b\.id\)\}/);
  assert.match(step, /onKeyDown=\{e => \{ if \(e\.key === 'Enter' \|\| e\.key === ' '\) \{ e\.preventDefault\(\); open\(b\.id\); \} \}\}/,
    'and the keyboard does the same thing as the mouse');
  assert.ok(!/onClick=\{\(\) => selectBatch\(b\.id\)\}/.test(step),
    'the select-only click is gone, not left beside the new one');
});

test('it still works if mounted with no step rail', () => {
  assert.match(step, /const open = \(id\) => \(onOpenBatch \? onOpenBatch\(id\) : selectBatch\(id\)\);/,
    'falling back to selecting alone rather than throwing');
});

test('the copy says where the click goes', () => {
  // The previous fix was copy alone, which is why the wording matters here:
  // it must describe what now happens, not stand in for it.
  assert.match(step, /Click one to open it in Draft/);
  assert.ok(!/Click one to work on it/.test(step),
    'the old wording, which described an effect you could not see, is gone');
});
