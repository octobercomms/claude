import React, { useEffect, useState } from 'react';

// A destructive action you have to type to confirm.
//
// window.confirm() is one keystroke away from Enter, and OMI's worst button
// was behind one: "Delete all 2000 matching" on Database → Publications, which
// detaches every journalist and every coverage entry attached to those
// publications and cannot be undone. A dialog that an accidental Return
// dismisses into a 2000-row delete is not a guard.
//
// The word you type is the count itself. It is the one thing that cannot be
// muscle-memory, and typing it means reading it, which is the whole point:
// the number is what the operator needed to notice.
//
//   count   — how many records go. Typed back to confirm.
//   noun    — singular; pluralised with an s.
//   detail  — what else this touches, in the operator's own terms.
//   onConfirm / onClose
export default function DangerConfirm({ count, noun = 'record', detail, onConfirm, onClose, busy = false }) {
  const [typed, setTyped] = useState('');
  const expected = String(count);
  const armed = typed.trim() === expected;

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (armed && !busy) onConfirm(); }}
        style={{ maxWidth: 480 }}
      >
        <h2 className="h2" style={{ marginTop: 0 }}>
          Delete {count.toLocaleString()} {noun}{count === 1 ? '' : 's'}?
        </h2>
        {detail && (
          <p className="body-sm text-muted" style={{ lineHeight: 1.5 }}>{detail}</p>
        )}
        <p className="body-sm" style={{ color: 'var(--negative)', fontWeight: 700 }}>
          This cannot be undone.
        </p>
        <label className="field" style={{ marginTop: 'var(--s3)' }}>
          <span className="field-label">
            Type <strong>{expected}</strong> to confirm
          </span>
          <input
            className="input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={expected}
            autoComplete="off"
            autoFocus
            inputMode="numeric"
          />
        </label>
        <div style={{ display: 'flex', gap: 'var(--s2)', justifyContent: 'flex-end', marginTop: 'var(--s4)' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-danger" disabled={!armed || busy}>
            {busy ? 'Deleting…' : `Delete ${count.toLocaleString()}`}
          </button>
        </div>
      </form>
    </div>
  );
}
