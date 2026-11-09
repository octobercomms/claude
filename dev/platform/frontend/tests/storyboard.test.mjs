/**
 * The refine round trip, which was eating the thing it revised.
 *
 * A storyboard frame is an object: `{ style, description, on_screen_text,
 * duration_sec, voiceover }`. `style` is the A-to-G grammar the renderer
 * dispatches on — `renderStoryboardReel` keeps only A, C and G, and
 * `resolveFrame` throws on anything else.
 *
 * The refine chat sent Claude the frame descriptions as numbered lines, read
 * the revision back as an array of plain STRINGS, and PUT that array into the
 * same JSONB column. Every other field on every frame went with it. The post
 * then answered `No A/C/G frames to stitch` — five seconds after it had
 * rendered fine — and nothing could get the fields back.
 *
 * The fault lived in a twenty-line function inside a 2,700-line page
 * component, which is why nothing caught it and why the merge is a shared
 * module now. These are the assertions that would have.
 *
 *   node --test tests/storyboard.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as SB from '../../shared/storyboard.mjs';

/** A storyboard as the generator writes one. */
const board = () => [
  {
    style: 'A', description: 'wide of the finished extension',
    on_screen_text: 'NINETY GRAND', duration_sec: 3,
  },
  {
    style: 'C', description: 'detail of the glazing',
    on_screen_text: 'DIRECT', duration_sec: 2,
  },
  {
    style: 'G', description: 'end card',
    on_screen_text: 'octobercomms.com', voiceover: 'Book a call',
  },
];

// ── the fault ─────────────────────────────────────────────────────────

describe('a revision never loses a field it was not shown', () => {
  it('keeps the style, the duration and the voiceover', () => {
    // THE WHOLE FAULT, in one assertion. The old round trip returned
    // ['wide of the finished extension', ...] and wrote it.
    const { storyboard } = SB.mergeRevision(board(), '1. a wider shot of the extension');
    assert.equal(storyboard[0].style, 'A');
    assert.equal(storyboard[0].duration_sec, 3);
    assert.equal(storyboard[0].on_screen_text, 'NINETY GRAND');
    assert.equal(storyboard[0].description, 'a wider shot of the extension');
    assert.equal(storyboard[2].voiceover, 'Book a call');
  });

  it('leaves the frames the revision did not mention exactly as they were', () => {
    const before = board();
    const { storyboard } = SB.mergeRevision(before, '2. the glazing, closer');
    assert.deepEqual(storyboard[0], before[0]);
    assert.deepEqual(storyboard[2], before[2]);
    assert.equal(storyboard[1].description, 'the glazing, closer');
  });

  it('matches on the frame NUMBER, not the position in the list', () => {
    // A revision that returns three of five frames revises those three. By
    // position, returning only frame 3 would have rewritten frame 1.
    const { storyboard } = SB.mergeRevision(board(), '3. a tighter end card');
    assert.equal(storyboard[0].description, 'wide of the finished extension');
    assert.equal(storyboard[2].description, 'a tighter end card');
    assert.equal(storyboard[2].style, 'G');
  });

  it('leaves the storyboard alone when nothing changed', () => {
    // `null` rather than the same array, so a caller can tell "no change"
    // from "change to nothing". The second is what used to be written.
    const same = SB.mergeRevision(board(), SB.toLines(board()));
    assert.equal(same.storyboard, null);
    assert.equal(same.changed, 0);
  });

  it('counts only the frames that really moved', () => {
    const r = SB.mergeRevision(board(), '1. a wider shot\n2. detail of the glazing');
    assert.equal(r.changed, 1, 'the second line repeated what was there');
  });
});

// ── what a line may change ────────────────────────────────────────────

describe('what a revised line can say', () => {
  it('changes the on-screen words when the line carries them', () => {
    // And this is why the prompt sends them: the AM had no way to change the
    // words that actually appear on screen through the one chat that exists
    // for revising the post.
    const { storyboard } = SB.mergeRevision(
      board(), '1. [A] wide of the extension — on screen: "90K, NOT 180K"'
    );
    assert.equal(storyboard[0].on_screen_text, '90K, NOT 180K');
    assert.equal(storyboard[0].description, 'wide of the extension');
  });

  it('leaves the on-screen words alone when the line does not mention them', () => {
    const { storyboard } = SB.mergeRevision(board(), '1. a wider shot');
    assert.equal(storyboard[0].on_screen_text, 'NINETY GRAND');
  });

  it('changes the style when the line carries one', () => {
    const { storyboard } = SB.mergeRevision(board(), '2. [A] the glazing as a title card');
    assert.equal(storyboard[1].style, 'A');
  });

  it('can empty the on-screen words, which is a real edit', () => {
    const { storyboard } = SB.mergeRevision(board(), '1. wide — on screen: ""');
    assert.equal(storyboard[0].on_screen_text, '');
  });

  it('ignores a line with no frame number rather than guessing where it goes', () => {
    const r = SB.mergeRevision(board(), 'I made the hook punchier.\n1. a wider shot');
    assert.equal(r.changed, 1);
    assert.match(r.notes.join(' '), /no frame number/);
    assert.equal(r.storyboard[0].description, 'a wider shot');
  });

  it('adds a frame past the end, and says it cannot be rendered', () => {
    // A new frame has no style, so no reel will include it. Said rather than
    // discovered when a reel comes out a frame short.
    const r = SB.mergeRevision(board(), '4. a final beat on the brickwork');
    assert.equal(r.storyboard.length, 4);
    assert.equal(r.storyboard[3].style, undefined);
    assert.match(r.notes.join(' '), /frame 4 is new/);
    assert.match(r.notes.join(' '), /no reel will render it/);
  });

  it('fills a hole rather than leaving a sparse array', () => {
    // A sparse array serialises to JSON with nulls in it, and every reader
    // downstream would need a guard for them.
    const r = SB.mergeRevision(board(), '6. a late beat');
    assert.equal(r.storyboard.length, 6);
    assert.deepEqual(r.storyboard[4], { description: '' });
    assert.ok(r.storyboard.every((f) => f && typeof f === 'object'));
    assert.match(r.notes.join(' '), /frame 5 was skipped/);
  });

  it('answers null for a revision with nothing in it', () => {
    assert.equal(SB.mergeRevision(board(), '').storyboard, null);
    assert.equal(SB.mergeRevision(board(), 'Looks good to me.').storyboard, null);
  });
});

// ── the prompt ────────────────────────────────────────────────────────

describe('the storyboard as the prompt shows it', () => {
  it('carries the style and the on-screen words', () => {
    const lines = SB.toLines(board()).split('\n');
    assert.equal(lines[0], '1. [A] wide of the finished extension — on screen: "NINETY GRAND"');
    assert.equal(lines.length, 3);
  });

  it('round-trips: what it shows, read back, is what it started with', () => {
    // The strongest statement about a round trip there is. The old one could
    // not pass this, which is the point.
    const before = board();
    const merged = SB.mergeRevision(before, SB.toLines(before));
    assert.equal(merged.storyboard, null, 'nothing changed');
    const forced = SB.mergeRevision(
      before.map((f) => ({ ...f, description: 'placeholder' })),
      SB.toLines(before)
    );
    assert.deepEqual(forced.storyboard, before);
  });

  it('says so rather than printing undefined for a frame with no description', () => {
    const lines = SB.toLines([{ style: 'A', on_screen_text: 'HELLO' }]);
    assert.equal(lines, '1. [A] (no description) — on screen: "HELLO"');
  });

  it('reads a damaged storyboard of plain strings without throwing', () => {
    assert.equal(SB.toLines(['a wide shot', 'a detail']), '1. a wide shot\n2. a detail');
  });
});

// ── telling the operator ──────────────────────────────────────────────

describe('spotting a storyboard that has already been damaged', () => {
  it('knows a good one from a damaged one', () => {
    assert.equal(SB.isDegraded(board()), false);
    assert.equal(SB.isDegraded(['a wide shot', 'a detail']), true);
    assert.equal(SB.isDegraded([{ description: 'no style here' }]), true);
  });

  it('says nothing about an empty storyboard, because there is nothing to judge', () => {
    assert.equal(SB.isDegraded([]), null);
    assert.equal(SB.isDegraded(null), null);
    assert.equal(SB.isDegraded(undefined), null);
  });

  it('calls a half-damaged storyboard damaged', () => {
    // One frame without a style means a reel comes out short, which is the
    // same class of quiet wrongness.
    assert.equal(SB.isDegraded([board()[0], 'a plain string']), true);
  });

  it('counts what a reel could actually render', () => {
    assert.equal(SB.renderableCount(board()), 3);
    assert.equal(SB.renderableCount(['a', 'b']), 0);
    assert.equal(SB.renderableCount([{ style: 'B', description: 'filmed' }]), 0);
    assert.equal(SB.renderableCount([{ style: 'A' }, { style: 'B' }, { style: 'G' }]), 2);
  });
});
