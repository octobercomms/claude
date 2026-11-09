// The editor's half of "a photograph can be added".
//
// The model, the render graph and the batch all handled a still for weeks.
// What refused photographs was two lines of UI: `accept="video/*"` on the file
// input and a filter on `video/` in the handler. Neither is visible to any
// model test, and both are the kind of line a later edit reintroduces while
// everything downstream stays correct.
//
// So this reads the page. Three of the four assertions below are about what
// the file must NOT contain, because the fault was a literal, not a missing
// feature.
//
//   node --test tests/stillUpload.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIP_ACCEPT, isStillMime, STILL_MIME_TYPES } from '../../shared/composition.mjs';
import { MOTION_NAMES, describeMotion, STILL_DEFAULT_LEN } from '../../shared/compositionTemplate.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const raw = readFileSync(path.join(SRC, 'pages', 'CompositionEditorPage.jsx'), 'utf8');

// Comments stripped, because three of the assertions below are "this literal
// must not appear" and the file explains the fault in prose directly above
// the fix. A test that cannot tell the fix from its own explanation fails on
// the explanation, which is how this one failed first time.
const page = raw.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

test('the clip input offers photographs, from the shared list', () => {
  // The claim is that the list is shared, not that the expression is bare.
  // It gained `,audio/*` on 9 November when the shelf became one door for
  // every file kind, and a guard pinned to the exact expression failed on an
  // addition that strengthened what it was guarding. That is the third guard
  // in this repo to break that way; the file it watches is the same one.
  assert.ok(/accept=\{[^}]*CLIP_ACCEPT[^}]*\}/.test(page),
    'the clip file input is not built from CLIP_ACCEPT');
  assert.ok(!/accept="video\/\*"/.test(page),
    'a literal accept="video/*" is back on an input — that single attribute is '
    + 'what stopped six photographs entering the editor');
  // The audio input keeps its own literal, and should: an audio-only
  // selection still has its own way in, and `audio/*` is not a list this
  // codebase curates the way it curates the photograph formats.
  assert.ok(/accept="audio\/\*"/.test(page), 'the audio input lost its accept');
  // And the shelf's input takes audio too, because one door means one door.
  assert.ok(/CLIP_ACCEPT\},audio\/\*/.test(page),
    'the shelf input no longer accepts audio, so "Add files" is not one door');
});

test('the upload handler gates on the shared predicate, not a literal', () => {
  assert.ok(/isStillMime\(/.test(page), 'the handler does not call isStillMime');
  // The old filter, which answered "Choose video files." to a photograph.
  assert.ok(!/filter\(f => f\.type\.startsWith\('video\/'\)\)/.test(page),
    'the video-only filter is back');
});

test('a still source is given no duration at all', () => {
  // The model rejects a clip source carrying 0 ("clip duration must be
  // positive") and permits the field to be absent. The first version of this
  // change wrote 0 and produced an invalid composition; a backend guard
  // covers the model's half, this covers the editor's.
  // Scoped to the CLIP path. The audio path writes the same expression and is
  // right to: an audio source may carry 0 (the model only requires a positive
  // duration on a clip), and its item length is already guarded with
  // `clip.duration || end || 10`.
  const clipPath = page.slice(page.indexOf('const wanted ='), page.indexOf('const onFileChange'));
  assert.ok(clipPath.length > 200, 'could not find the clip upload handler to read');
  assert.ok(!/duration: clip\.duration \|\| 0/.test(clipPath),
    'the clip handler writes `duration: clip.duration || 0` again, which is 0 for '
    + 'a photograph and for footage whose probe failed, and 0 is invalid on a clip');
  assert.ok(/Number\(clip\.duration\) > 0/.test(page),
    'the editor no longer guards the duration before writing it');
});

test('the camera-move chips come from the template vocabulary', () => {
  assert.ok(/MOTION_NAMES\.map/.test(page), 'the chips are not built from MOTION_NAMES');
  assert.ok(/transformFor\(name\)/.test(page), 'a chip is not writing transformFor()');
  assert.ok(/describeMotion\(name\)/.test(page), 'the chips carry no tooltip');
  // Turning a move off must clear every field the move set.
  assert.ok(/\{ scale: null, pos: null, beat: null \}/.test(page),
    'the Hold chip does not clear scale, pos and beat together');
  // No second vocabulary: the names must not be written out in the page.
  const inlined = MOTION_NAMES.filter(n => new RegExp(`['"]${n}['"]`).test(page));
  assert.deepEqual(inlined, [],
    `motion names are hardcoded in the page (${inlined.join(', ')}) — they belong `
    + 'only in MOTIONS, or the editor and the batch drift apart');
});

test('the shared vocabulary itself is whole', () => {
  assert.ok(MOTION_NAMES.length >= 6, `only ${MOTION_NAMES.length} motions`);
  for (const n of MOTION_NAMES) {
    assert.ok(describeMotion(n).length > 10, `${n} has no usable description`);
  }
  assert.ok(STILL_DEFAULT_LEN > 2 && STILL_DEFAULT_LEN < 4,
    `${STILL_DEFAULT_LEN}s: under two seconds a move reads as a glitch, over four as a slideshow`);
  assert.ok(STILL_MIME_TYPES.every(m => isStillMime(m) && CLIP_ACCEPT.includes(m)));
});
