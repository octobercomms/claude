/**
 * useCompositionHistory — undo/redo for the composition editor.
 *
 * Drop-in replacement for useState: returns { state, setState, ... } where
 * setState pushes the previous state onto the undo stack, and undo/redo walk
 * that stack.
 *
 * Compositions can be large (hundreds of items), so:
 *   - `maxHistory` caps the undo stack to prevent memory bloat.
 *   - Batch mode (startBatch / commitBatch / discardBatch) lets the editor
 *     suppress history pushes during drags.  Between start and commit, setState
 *     updates the live state but does NOT record intermediate snapshots.
 *     commitBatch pushes the pre-batch snapshot once; discardBatch reverts to it.
 *
 * Deep copies use structuredClone where available, falling back to
 * JSON round-trip.  The clone is taken when the snapshot enters a stack, so
 * the caller can mutate the objects it passes in without corrupting history.
 */
import { useCallback, useRef, useState } from 'react';
import {
  deepClone,
  createHistoryCore,
  coreSetState,
  coreUndo,
  coreRedo,
  coreResetHistory,
  coreStartBatch,
  coreCommitBatch,
  coreDiscardBatch,
} from './compositionHistoryCore.js';

// Re-export core for consumers that need the pure logic directly.
export {
  createHistoryCore,
  coreSetState,
  coreUndo,
  coreRedo,
  coreResetHistory,
  coreStartBatch,
  coreCommitBatch,
  coreDiscardBatch,
};

// ── React hook ────────────────────────────────────────────────────────

export function useCompositionHistory(initialState, maxHistory = 50) {
  const coreRef = useRef(null);
  if (coreRef.current === null) {
    coreRef.current = createHistoryCore(initialState, maxHistory);
  }

  // React state drives re-renders; the core is the source of truth.
  const [state, setReactState] = useState(() => coreRef.current.current);

  const setState = useCallback((newState) => {
    // Support updater-function form like useState.
    const resolved = typeof newState === 'function'
      ? newState(coreRef.current.current)
      : newState;
    coreSetState(coreRef.current, resolved);
    setReactState(deepClone(coreRef.current.current));
  }, []);

  const undo = useCallback(() => {
    if (coreRef.current.undoStack.length === 0) return;
    const prev = coreUndo(coreRef.current);
    setReactState(deepClone(prev));
  }, []);

  const redo = useCallback(() => {
    if (coreRef.current.redoStack.length === 0) return;
    const next = coreRedo(coreRef.current);
    setReactState(deepClone(next));
  }, []);

  const canUndo = coreRef.current.undoStack.length > 0;
  const canRedo = coreRef.current.redoStack.length > 0;

  const resetHistory = useCallback((newState) => {
    coreResetHistory(coreRef.current, newState);
    setReactState(deepClone(coreRef.current.current));
  }, []);

  const startBatch = useCallback(() => {
    coreStartBatch(coreRef.current);
  }, []);

  const commitBatch = useCallback(() => {
    coreCommitBatch(coreRef.current);
    setReactState(deepClone(coreRef.current.current));
  }, []);

  const discardBatch = useCallback(() => {
    coreDiscardBatch(coreRef.current);
    setReactState(deepClone(coreRef.current.current));
  }, []);

  return {
    state,
    setState,
    undo,
    redo,
    canUndo,
    canRedo,
    resetHistory,
    startBatch,
    commitBatch,
    discardBatch,
  };
}
