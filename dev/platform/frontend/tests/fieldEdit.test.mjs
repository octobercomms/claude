import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldState, shouldCommit } from '../src/utils/fieldEdit.js';

test('an untouched field is neither dirty nor clashing', () => {
  const s = fieldState({ draft: 'a', current: 'a', atFocus: 'a', focused: true });
  assert.deepEqual(s, { dirty: false, clash: false });
});

test('typing makes it dirty and nothing else', () => {
  // The assertion that matters here is the clash one. Without it, comparing
  // the record against the draft instead of against the focus value passes
  // every other test in this file — and that version warns "Claude rewrote
  // this" on every keystroke, because your own typing makes the draft differ
  // from the record. A mutation proved exactly that.
  const s = fieldState({ draft: 'ab', current: 'a', atFocus: 'a', focused: true });
  assert.equal(s.dirty, true);
  assert.equal(s.clash, false, 'your own typing is not somebody else changing it');
});

test('a change arriving while you type something else is a clash', () => {
  // You focused on "a", typed "ab"; Claude rewrote the record to "zzz".
  const s = fieldState({ draft: 'ab', current: 'zzz', atFocus: 'a', focused: true });
  assert.equal(s.clash, true, 'neither value can be chosen without losing the other');
});

test('a change arriving while you have typed nothing is not a clash', () => {
  // Nothing of yours to lose, so the field simply follows the record.
  const s = fieldState({ draft: 'zzz', current: 'zzz', atFocus: 'a', focused: true });
  assert.equal(s.clash, false);
});

test('your own edit is never a clash with itself', () => {
  // The record catching up to what you saved must not read as somebody else.
  const s = fieldState({ draft: 'ab', current: 'ab', atFocus: 'a', focused: true });
  assert.deepEqual(s, { dirty: false, clash: false });
});

test('a clash needs the field to be focused', () => {
  // Not focused means nothing is being typed, so there is nothing to protect
  // and the field should just take the new value.
  const s = fieldState({ draft: 'ab', current: 'zzz', atFocus: 'a', focused: false });
  assert.equal(s.clash, false);
  assert.equal(s.dirty, true, 'still dirty: there is unsaved text');
});

test('null and undefined read as empty, not as a difference', () => {
  // A post with no hook yet arrives as null from the API, and the box holds
  // ''. Treating those as different would mark every empty field unsaved and
  // PATCH on every blur.
  assert.equal(fieldState({ draft: '', current: null, atFocus: undefined, focused: true }).dirty, false);
  assert.equal(shouldCommit({ draft: '', current: null }), false);
});

test('leaving a field with nothing typed writes nothing', () => {
  // This field blurs on every click elsewhere on the screen. A write per blur
  // would be a write per glance.
  assert.equal(shouldCommit({ draft: 'a', current: 'a' }), false);
  assert.equal(shouldCommit({ draft: 'a', current: 'b' }), true);
});

test('clearing a field is a real edit, not an empty one', () => {
  // Deleting a caption has to save. An emptiness check instead of a
  // difference check would make a caption impossible to remove.
  assert.equal(shouldCommit({ draft: '', current: 'something' }), true);
  assert.equal(fieldState({ draft: '', current: 'something', atFocus: 'something', focused: true }).dirty, true);
});
