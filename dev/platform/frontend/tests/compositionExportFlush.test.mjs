/**
 * Anything that hands the composition to the backend must flush the save.
 *
 * The render route reads `data` out of the database row and takes only
 * format, resolution and quality from the request body. The timeline on
 * screen is never sent. The editor autosaves 1500ms after a change, so a
 * render started inside that window encodes the PREVIOUS cut and reports
 * success — a file that looks fine and is of the wrong edit, which is the
 * worst shape of bug this editor can have.
 *
 * Three handoffs already awaited a save (transcribe, switch composition,
 * create new) and Export did not, which is the one a person reaches for
 * straight after making a change.
 *
 * This reads the page's own source. That is blunt, and it is the only thing
 * that fails when the await is dropped again: a unit test of `doSave` cannot
 * see whether the button calls it, and the whole shape of the bug is in
 * whether two things are joined up. Same reasoning as
 * backend/tests/composition-render-route.test.js, and as
 * strategist-weekly.test.js before it.
 *
 *   node --test tests/compositionExportFlush.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  join(here, '..', 'src', 'pages', 'CompositionEditorPage.jsx'),
  'utf8'
);
const lines = src.split('\n');

/** The source around a line, for asserting that two things sit together. */
function near(needle, before = 2, after = 3) {
  const i = lines.findIndex((l) => l.includes(needle));
  assert.ok(i >= 0, `expected to find "${needle}" in CompositionEditorPage.jsx`);
  return lines.slice(Math.max(0, i - before), i + after + 1).join('\n');
}

describe('flushSave', () => {
  it('exists, cancels the pending autosave and awaits the write', () => {
    const fn = src.match(/const flushSave = useCallback\(async \(id\) => \{[\s\S]*?\}, \[doSave\]\);/);
    assert.ok(fn, 'the page defines a flushSave helper');
    assert.match(
      fn[0], /clearTimeout\(saveTimerRef\.current\)/,
      'it cancels the pending autosave, or the timer fires again afterwards'
    );
    assert.match(
      fn[0], /await doSave\(id\)/,
      'it awaits the write, or the caller races the PUT it just started'
    );
  });
});

describe('the Export button', () => {
  it('flushes the save before opening the modal', () => {
    const handler = near('setExportOpen(true)');
    assert.match(
      handler, /await flushSave\(compId\)/,
      'Export must flush the save first and await it. Without that, a render '
      + 'started within 1500ms of a change encodes the previous cut and reports '
      + `success, because the backend renders the row and not the screen.\n\n${handler}`
    );
  });
});

describe('the other backend handoffs still flush', () => {
  // These three were already correct. Pinned so a later refactor cannot
  // quietly take the await off one of them, which is how Export came to be
  // the odd one out in the first place.
  const handoffs = [
    ['transcribe', 'const transcribeSource = useCallback'],
    ['switch composition', 'const switchComposition = useCallback'],
    ['create new', 'const createNew = useCallback'],
  ];

  for (const [name, declaration] of handoffs) {
    it(`${name} awaits a save before calling the backend`, () => {
      const start = src.indexOf(declaration);
      assert.ok(start >= 0, `expected to find ${declaration}`);
      // The body up to the next top-level useCallback declaration.
      const rest = src.slice(start + declaration.length);
      const end = rest.search(/\n  const \w+ = useCallback/);
      const body = end >= 0 ? rest.slice(0, end) : rest;
      assert.match(
        body, /await (doSave|flushSave)\(/,
        `${name} must not hand work to the backend on a stale row`
      );
    });
  }
});
