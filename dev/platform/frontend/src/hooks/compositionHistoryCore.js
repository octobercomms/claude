/**
 * compositionHistoryCore — pure undo/redo stack logic.
 *
 * No React dependency.  The useCompositionHistory hook wraps these functions;
 * they are also exported for direct unit testing under `node --test`.
 */

// ── Deep-clone helper ─────────────────────────────────────────────────

export function deepClone(obj) {
  if (typeof structuredClone === 'function') return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

// ── Core stack management ─────────────────────────────────────────────

export function createHistoryCore(initialState, maxHistory = 50) {
  return {
    current: deepClone(initialState),
    undoStack: [],
    redoStack: [],
    maxHistory,
    batching: false,
    batchAnchor: null,
  };
}

export function coreSetState(core, newState) {
  if (core.batching) {
    core.current = deepClone(newState);
    return;
  }
  core.undoStack.push(deepClone(core.current));
  if (core.undoStack.length > core.maxHistory) {
    core.undoStack.shift();
  }
  core.current = deepClone(newState);
  core.redoStack.length = 0;
}

export function coreUndo(core) {
  if (core.undoStack.length === 0) return core.current;
  core.redoStack.push(deepClone(core.current));
  core.current = core.undoStack.pop();
  return core.current;
}

export function coreRedo(core) {
  if (core.redoStack.length === 0) return core.current;
  core.undoStack.push(deepClone(core.current));
  core.current = core.redoStack.pop();
  return core.current;
}

export function coreResetHistory(core, newState) {
  core.current = deepClone(newState);
  core.undoStack.length = 0;
  core.redoStack.length = 0;
  core.batching = false;
  core.batchAnchor = null;
}

export function coreStartBatch(core) {
  if (core.batching) return;
  core.batching = true;
  core.batchAnchor = deepClone(core.current);
}

export function coreCommitBatch(core) {
  if (!core.batching) return;
  core.batching = false;
  core.undoStack.push(core.batchAnchor);
  if (core.undoStack.length > core.maxHistory) {
    core.undoStack.shift();
  }
  core.batchAnchor = null;
  core.redoStack.length = 0;
}

export function coreDiscardBatch(core) {
  if (!core.batching) return;
  core.batching = false;
  core.current = core.batchAnchor;
  core.batchAnchor = null;
}
