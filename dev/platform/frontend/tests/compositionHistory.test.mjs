/**
 * Tests for the composition-history undo/redo core logic.
 *
 * The core functions are pure — no React required — so they run under
 * `node --test` like the rest of the frontend unit tests.
 */
import test from 'node:test';
import assert from 'node:assert';
import {
  createHistoryCore,
  coreSetState,
  coreUndo,
  coreRedo,
  coreResetHistory,
  coreStartBatch,
  coreCommitBatch,
  coreDiscardBatch,
} from '../src/hooks/compositionHistoryCore.js';

// ── Helpers ───────────────────────────────────────────────────────────

/** A minimal composition-shaped object for testing. */
function makeComp(label, itemCount = 0) {
  const items = [];
  for (let i = 0; i < itemCount; i++) items.push({ id: `i${i}`, at: i, len: 1 });
  return {
    version: 1,
    label,   // handy for assertions
    size: { width: 1080, height: 1920 },
    fps: 30,
    sources: {},
    tracks: [{ id: 't1', kind: 'video', items }],
  };
}

// ── Basic push / undo / redo ──────────────────────────────────────────

test('initial state is a deep clone of what was passed in', () => {
  const init = makeComp('init');
  const core = createHistoryCore(init);
  assert.deepStrictEqual(core.current, init);
  // Mutating the original must not affect the core.
  init.label = 'mutated';
  assert.equal(core.current.label, 'init');
});

test('setState pushes previous state onto undo stack and clears redo', () => {
  const core = createHistoryCore(makeComp('A'));

  coreSetState(core, makeComp('B'));
  assert.equal(core.current.label, 'B');
  assert.equal(core.undoStack.length, 1);
  assert.equal(core.undoStack[0].label, 'A');
  assert.equal(core.redoStack.length, 0);

  coreSetState(core, makeComp('C'));
  assert.equal(core.current.label, 'C');
  assert.equal(core.undoStack.length, 2);
  assert.equal(core.undoStack[1].label, 'B');
});

test('undo pops undo stack, pushes current to redo', () => {
  const core = createHistoryCore(makeComp('A'));
  coreSetState(core, makeComp('B'));
  coreSetState(core, makeComp('C'));

  const prev = coreUndo(core);
  assert.equal(prev.label, 'B');
  assert.equal(core.current.label, 'B');
  assert.equal(core.undoStack.length, 1);
  assert.equal(core.redoStack.length, 1);
  assert.equal(core.redoStack[0].label, 'C');
});

test('redo pops redo stack, pushes current to undo', () => {
  const core = createHistoryCore(makeComp('A'));
  coreSetState(core, makeComp('B'));
  coreUndo(core);

  const next = coreRedo(core);
  assert.equal(next.label, 'B');
  assert.equal(core.current.label, 'B');
  assert.equal(core.undoStack.length, 1);
  assert.equal(core.redoStack.length, 0);
});

test('full undo/redo cycle: A -> B -> C, undo twice, redo twice', () => {
  const core = createHistoryCore(makeComp('A'));
  coreSetState(core, makeComp('B'));
  coreSetState(core, makeComp('C'));

  coreUndo(core);
  assert.equal(core.current.label, 'B');
  coreUndo(core);
  assert.equal(core.current.label, 'A');

  // At the beginning — undo does nothing.
  const same = coreUndo(core);
  assert.equal(same.label, 'A');

  coreRedo(core);
  assert.equal(core.current.label, 'B');
  coreRedo(core);
  assert.equal(core.current.label, 'C');

  // At the end — redo does nothing.
  const still = coreRedo(core);
  assert.equal(still.label, 'C');
});

test('a new setState after undo clears the redo stack', () => {
  const core = createHistoryCore(makeComp('A'));
  coreSetState(core, makeComp('B'));
  coreSetState(core, makeComp('C'));

  coreUndo(core);
  assert.equal(core.current.label, 'B');
  assert.equal(core.redoStack.length, 1);

  // Branch: new edit from B should erase the C future.
  coreSetState(core, makeComp('D'));
  assert.equal(core.current.label, 'D');
  assert.equal(core.redoStack.length, 0);
});

// ── Max history cap ───────────────────────────────────────────────────

test('undo stack is capped at maxHistory', () => {
  const core = createHistoryCore(makeComp('s0'), 5);

  for (let i = 1; i <= 10; i++) {
    coreSetState(core, makeComp(`s${i}`));
  }

  assert.equal(core.undoStack.length, 5);
  assert.equal(core.current.label, 's10');
  // Oldest kept should be s5 (s0-s4 were evicted).
  assert.equal(core.undoStack[0].label, 's5');
});

test('can undo exactly maxHistory times', () => {
  const MAX = 3;
  const core = createHistoryCore(makeComp('s0'), MAX);
  for (let i = 1; i <= 6; i++) coreSetState(core, makeComp(`s${i}`));

  // Undo 3 times (the max).
  for (let i = 0; i < MAX; i++) coreUndo(core);
  assert.equal(core.undoStack.length, 0);
  assert.equal(core.current.label, 's3');
});

// ── canUndo / canRedo flags ───────────────────────────────────────────

test('canUndo / canRedo flags are correct at every step', () => {
  const core = createHistoryCore(makeComp('A'));
  assert.equal(core.undoStack.length, 0, 'initially no undo');
  assert.equal(core.redoStack.length, 0, 'initially no redo');

  coreSetState(core, makeComp('B'));
  assert.equal(core.undoStack.length > 0, true, 'canUndo after edit');
  assert.equal(core.redoStack.length === 0, true, 'no redo after edit');

  coreUndo(core);
  assert.equal(core.undoStack.length === 0, true, 'no undo at start');
  assert.equal(core.redoStack.length > 0, true, 'canRedo after undo');

  coreRedo(core);
  assert.equal(core.undoStack.length > 0, true, 'canUndo after redo');
  assert.equal(core.redoStack.length === 0, true, 'no redo at end');
});

// ── resetHistory ──────────────────────────────────────────────────────

test('resetHistory clears both stacks and sets new state', () => {
  const core = createHistoryCore(makeComp('A'));
  coreSetState(core, makeComp('B'));
  coreSetState(core, makeComp('C'));
  coreUndo(core);  // redo stack has C

  coreResetHistory(core, makeComp('fresh'));
  assert.equal(core.current.label, 'fresh');
  assert.equal(core.undoStack.length, 0);
  assert.equal(core.redoStack.length, 0);
});

test('resetHistory clears an active batch', () => {
  const core = createHistoryCore(makeComp('A'));
  coreStartBatch(core);
  coreSetState(core, makeComp('drag'));

  coreResetHistory(core, makeComp('loaded'));
  assert.equal(core.batching, false);
  assert.equal(core.batchAnchor, null);
  assert.equal(core.current.label, 'loaded');
});

// ── Batch mode ────────────────────────────────────────────────────────

test('intermediate states during a batch are NOT recorded in history', () => {
  const core = createHistoryCore(makeComp('A'));
  coreSetState(core, makeComp('B'));

  coreStartBatch(core);
  // Simulate a drag with many intermediate frames.
  for (let i = 0; i < 20; i++) {
    coreSetState(core, makeComp(`drag-${i}`));
  }
  // Current should be the last drag frame.
  assert.equal(core.current.label, 'drag-19');
  // Undo stack should still have only 1 entry (from the A -> B push),
  // because batch mode suppresses pushes.
  assert.equal(core.undoStack.length, 1);

  coreCommitBatch(core);
  // After commit, undo stack grows by exactly one (the pre-batch anchor = B).
  assert.equal(core.undoStack.length, 2);
  assert.equal(core.undoStack[1].label, 'B');

  // Undo should go back to B (pre-drag).
  coreUndo(core);
  assert.equal(core.current.label, 'B');
});

test('discardBatch reverts to the pre-batch state', () => {
  const core = createHistoryCore(makeComp('A'));
  coreSetState(core, makeComp('B'));

  coreStartBatch(core);
  coreSetState(core, makeComp('drag-1'));
  coreSetState(core, makeComp('drag-2'));

  coreDiscardBatch(core);
  assert.equal(core.current.label, 'B');
  // No new entry on undo stack.
  assert.equal(core.undoStack.length, 1);
  assert.equal(core.batching, false);
});

test('startBatch is idempotent: calling it twice keeps the first anchor', () => {
  const core = createHistoryCore(makeComp('A'));
  coreStartBatch(core);
  coreSetState(core, makeComp('mid'));
  // Second startBatch should be ignored — anchor stays at A.
  coreStartBatch(core);
  coreCommitBatch(core);

  coreUndo(core);
  assert.equal(core.current.label, 'A');
});

test('commitBatch clears the redo stack', () => {
  const core = createHistoryCore(makeComp('A'));
  coreSetState(core, makeComp('B'));
  coreUndo(core);
  // redo has B
  assert.equal(core.redoStack.length, 1);

  coreStartBatch(core);
  coreSetState(core, makeComp('drag'));
  coreCommitBatch(core);

  // Redo should be cleared — new branch.
  assert.equal(core.redoStack.length, 0);
});

// ── Deep-clone safety ─────────────────────────────────────────────────

test('mutations to state passed to setState do not corrupt history', () => {
  const core = createHistoryCore(makeComp('A'));
  const obj = makeComp('B', 3);
  coreSetState(core, obj);

  // Mutate the object we passed in.
  obj.tracks[0].items.push({ id: 'sneaky', at: 99, len: 1 });
  obj.label = 'MUTATED';

  // The core's copy should be unaffected.
  assert.equal(core.current.label, 'B');
  assert.equal(core.current.tracks[0].items.length, 3);

  // The undo entry (A) should also be clean.
  assert.equal(core.undoStack[0].label, 'A');
});

test('compositions with nested arrays survive clone round-trips', () => {
  const big = makeComp('big', 100);
  const core = createHistoryCore(big);
  coreSetState(core, makeComp('next', 50));
  coreUndo(core);

  assert.equal(core.current.tracks[0].items.length, 100);
  assert.equal(core.current.label, 'big');
});
