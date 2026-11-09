// Sharing a reel, from the editor's side.
//
// The backend guards are in `backend/tests/approval-renders.test.js` and they
// are the ones that matter for safety. These two are about intent, and both
// pin a decision a later edit would plausibly reverse while believing it was
// fixing something.
//
//   node --test tests/shareReel.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (p) => readFileSync(path.join(SRC, p), 'utf8');
const modal = read('components/video/ShareReelModal.jsx');
const editor = read('pages/CompositionEditorPage.jsx');

test('a link carries renders, not the composition', () => {
  // The distinction is the whole design: a composition keeps being edited, a
  // render is the file that was made. Sharing the composition would mean what
  // the client approved on Tuesday is not what they see on Thursday.
  assert.match(modal, /scope: 'render_list'/);
  assert.match(modal, /render_ids: chosen/);
  assert.ok(!/scope: 'composition/.test(modal),
    'the dialog is sharing a composition, so what the client sees would change '
    + 'under them every time somebody edits it');
  // It reads the finished renders rather than assuming one exists.
  assert.match(modal, /compositions\/\$\{compId\}\/renders/);
  assert.match(modal, /needs an export first/,
    'with no finished render the dialog has to say so rather than mint a link '
    + 'onto an empty page');
});

test('Share does not flush the unsaved edit, and Export does', () => {
  // Export must flush or it encodes the previous cut and reports success —
  // the fault PR #2008 fixed, guarded by compositionExportFlush.test.mjs.
  // Share must NOT, because a link carries files that already exist, and
  // flushing would imply the edit in front of you is part of what is being
  // sent. Someone tidying these two buttons into one handler would reverse
  // this, which is why it is written down here as well as in a comment.
  const exportBtn = editor.slice(editor.indexOf('setExportOpen(true)') - 200,
    editor.indexOf('setExportOpen(true)') + 60);
  assert.match(exportBtn, /flushSave\(compId\)/, 'Export stopped flushing before it renders');

  const shareIdx = editor.indexOf('setShareOpen(true)');
  assert.ok(shareIdx > 0, 'the Share button is gone');
  const shareBtn = editor.slice(shareIdx - 120, shareIdx + 60);
  assert.ok(!/flushSave/.test(shareBtn),
    'Share now flushes the autosave, which tells the operator the unsaved edit '
    + 'is part of what the client will see. It is not: the link carries renders.');
});
