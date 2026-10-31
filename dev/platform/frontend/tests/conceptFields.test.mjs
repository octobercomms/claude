// Reading a revised concept back out of Claude's reply.
//
// This parser is the join between a chat and a form. When it fails the user
// sees "could not read a revised concept", which is honest but useless, so
// the tolerances matter more than they look: the system prompt asks for
// labelled fields, and a model obliges in several different shapes.
//
//   node --test tests/conceptFields.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The component imports React, which this runner has no business loading, so
// the function is lifted out of the source by name and evaluated on its own.
// Keeps one copy of the logic: if the export is renamed or removed, this
// throws rather than silently testing a stale duplicate.
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const file = readFileSync(path.join(SRC, 'components', 'paid', 'ConceptEditModal.jsx'), 'utf8');
const start = file.indexOf('export function parseConceptFields');
assert.ok(start > -1, 'parseConceptFields is no longer exported from ConceptEditModal.jsx');
const end = file.indexOf('\n}', start) + 2;
const source = file.slice(start, end).replace('export function', 'function');
const parseConceptFields = eval(`(() => { ${source}; return parseConceptFields; })()`);

test('reads a plain labelled reply', () => {
  const out = parseConceptFields([
    'HEADLINE: Enamel bowls built to outlive you',
    'BODY: Vitreous enamel over heavy-gauge steel.',
    'CTA: Shop the range',
    'VISUAL CONCEPT: Two bowls on a steel bench.',
  ].join('\n\n'));
  assert.deepEqual(out, {
    headline: 'Enamel bowls built to outlive you',
    body: 'Vitreous enamel over heavy-gauge steel.',
    cta: 'Shop the range',
    visual_concept: 'Two bowls on a steel bench.',
  });
});

test('tolerates markdown bold and lowercase labels', () => {
  const out = parseConceptFields('**headline**: Four hundred kitchens\n\n**cta**: See the spec');
  assert.equal(out.headline, 'Four hundred kitchens');
  assert.equal(out.cta, 'See the spec');
});

test('"VISUAL" and "VISUAL CONCEPT" both land on visual_concept', () => {
  assert.equal(parseConceptFields('VISUAL: A steel bench.').visual_concept, 'A steel bench.');
  assert.equal(parseConceptFields('VISUAL CONCEPT: A steel bench.').visual_concept, 'A steel bench.');
});

test('a multi-line body stops at the next label, not at the first newline', () => {
  const out = parseConceptFields('BODY: Line one.\nLine two.\nLine three.\n\nCTA: Buy');
  assert.equal(out.body, 'Line one.\nLine two.\nLine three.');
  assert.equal(out.cta, 'Buy');
});

test('a partial reply returns only what it carried', () => {
  // The modal merges onto the draft, so a reply that revises the headline
  // alone must not blank the body.
  const out = parseConceptFields('HEADLINE: Just this one');
  assert.deepEqual(out, { headline: 'Just this one' });
});

test('an empty value is skipped rather than clearing the field', () => {
  const out = parseConceptFields('HEADLINE: Kept\n\nBODY:\n\nCTA: Buy');
  assert.equal(out.headline, 'Kept');
  assert.ok(!('body' in out), 'an empty BODY must not overwrite the draft');
});

test('prose with no labels returns null, so the caller can say so', () => {
  assert.equal(parseConceptFields("Sure! Here's a thought about the headline."), null);
  assert.equal(parseConceptFields(''), null);
  assert.equal(parseConceptFields(null), null);
});

test('the first value wins when a label repeats', () => {
  // Claude sometimes restates the concept after explaining it. The revision
  // comes first; the echo is commentary.
  const out = parseConceptFields('HEADLINE: First\n\nCTA: Go\n\nHEADLINE: Second');
  assert.equal(out.headline, 'First');
});

test('a label on its own line still finds its value underneath', () => {
  // The fix for the swallowing bug also makes this shape work, which a model
  // produces often enough to matter.
  const out = parseConceptFields('HEADLINE:\nEnamel bowls built to outlive you\n\nCTA: Shop');
  assert.equal(out.headline, 'Enamel bowls built to outlive you');
  assert.equal(out.cta, 'Shop');
});
