import React, { useState, useEffect } from 'react';
import { roWrite } from '../utils/readOnly';
import { useAuth } from '../context/AuthContext';

// Small modal for "draft + accept" flows where Claude writes something and
// the user reviews / edits before saving. Used by Complete with Claude
// (briefing) and Suggest with Claude (monthly focus).
export default function AIDraftModal({ title, hint, draft, onAccept, onClose }) {
  const { readOnly } = useAuth();
  const [text, setText] = useState(draft || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setText(draft || ''); }, [draft]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleAccept() {
    setSaving(true);
    try { await onAccept(text); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="modal">
        <div className="modal-head">
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{title}</h2>
          <button type="button" onClick={onClose} className="modal-close">×</button>
        </div>
        {hint && <p className="body-sm text-muted">{hint}</p>}
        <textarea
          autoFocus
          className="textarea"
          value={text}
          onChange={e => setText(e.target.value)}
        />
        <div className="row end">
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button type="button" {...roWrite(readOnly, { onClick: handleAccept, disabled: saving || !text.trim() })} className="btn btn-primary">
            {saving ? 'Saving…' : 'Accept and Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

