import React, { useState, useEffect } from 'react';
import { primaryBtn, secondaryBtn } from '../styles/theme';

// Small modal for "draft + accept" flows where Claude writes something and
// the user reviews / edits before saving. Used by Complete with Claude
// (briefing) and Suggest with Claude (monthly focus).
export default function AIDraftModal({ title, hint, draft, onAccept, onClose }) {
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
    <div style={styles.overlay} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={styles.modal}>
        <div style={styles.header}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{title}</h2>
          <button type="button" onClick={onClose} style={styles.closeBtn}>×</button>
        </div>
        {hint && <p style={styles.hint}>{hint}</p>}
        <textarea
          autoFocus
          style={styles.textarea}
          value={text}
          onChange={e => setText(e.target.value)}
        />
        <div style={styles.footer}>
          <button type="button" onClick={onClose} style={secondaryBtn}>Cancel</button>
          <button type="button" onClick={handleAccept} disabled={saving || !text.trim()} style={primaryBtn}>
            {saving ? 'Saving…' : 'Accept and Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 20px 20px', zIndex: 1000, overflowY: 'auto' },
  modal: { background: '#fff', borderRadius: 8, width: '100%', maxWidth: 720, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  closeBtn: { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#888', lineHeight: 1, padding: 4 },
  hint: { fontSize: 12, color: '#666', margin: '0 0 12px', lineHeight: 1.5 },
  textarea: { width: '100%', minHeight: 200, padding: '10px 12px', fontSize: 13, lineHeight: 1.6, border: '2px solid var(--accent)', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
};
