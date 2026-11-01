// The media-desk assistant: a chat that reads the media database and proposes
// changes you tick and apply.
//
// It was a row in the Database panel, which meant leaving the list you were
// looking at in order to ask about it — the same fault the client analyst had
// as a tab inside Data. It is a panel over whatever Database screen you are
// on now, so the records stay visible while you ask, and the changes it
// proposes are about the rows behind it.
//
// Lifted out of SettingsPage unchanged apart from its chrome: the card and
// the "Media-desk assistant" heading are gone, because the panel it now sits
// in already says both.

import React, { useState } from 'react';
import { api } from '../../utils/api';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { roWrite } from '../../utils/readOnly';

export default function MediaAssistant() {
  const { readOnly } = useAuth();
  const toast = useToast();
  const [messages, setMessages] = useState([]);      // {role, content}
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [actions, setActions] = useState([]);        // proposed, awaiting approval
  const [sel, setSel] = useState(() => new Set());   // which proposed actions are ticked
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(null);

  async function send() {
    const text = input.trim();
    if (text.length < 2) return;
    const history = messages;
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setInput(''); setBusy(true); setActions([]); setSel(new Set()); setApplied(null);
    try {
      const r = await api.post('/pr/assistant/message', { history, message: text });
      setMessages((m) => [...m, { role: 'assistant', content: r.reply || '(no reply)' }]);
      const list = Array.isArray(r.actions) ? r.actions : [];
      setActions(list);
      setSel(new Set(list.map((_, i) => i)));   // everything ticked by default
    } catch (e) { setMessages((m) => [...m, { role: 'assistant', content: `Error: ${e.message}` }]); }
    finally { setBusy(false); }
  }
  function toggleAction(i) { setSel((p) => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; }); }
  async function apply() {
    const chosen = actions.filter((_, i) => sel.has(i));
    if (!chosen.length) { toast('Tick at least one change to apply.', 'info'); return; }
    setApplying(true);
    try {
      const r = await api.post('/pr/assistant/apply', { actions: chosen });
      setApplied(r.results || []);
      setActions([]); setSel(new Set());
      const ok = (r.results || []).filter((x) => x.ok).length;
      toast(`Applied ${ok} of ${(r.results || []).length} change${(r.results || []).length === 1 ? '' : 's'}.`, ok ? 'success' : 'info');
    } catch (e) { toast(e.message, 'error'); }
    finally { setApplying(false); }
  }

  const actionLabel = (a) => {
    if (a.type === 'add_publication') return `Add publication “${a.name}”${a.url ? ` (${a.url})` : ''}${a.rss_url ? ' · feed ✓' : ''}`;
    if (a.type === 'add_journalist') return `Add journalist “${a.name}”${a.outlet ? ` at ${a.outlet}` : ''}${a.email ? ` · ${a.email}` : ''}${a.client_name ? ` → ${a.client_name}` : ''}`;
    if (a.type === 'tag_contact') return `Tag ${a.contact_name || a.contact_id} with ${(a.tags || []).join(', ')}`;
    return a.type;
  };

  return (
    <div className="stack stack-md">
        <p className="body-sm text-muted" style={{ marginTop: 0 }}>
          Paste websites, journalist names, or notes — e.g. “add these three sites: …”, “here’s a journalist: Jane Smith at Dezeen, covers hospitality”, or “tag everyone at Vogue as luxury”. Claude researches it and <strong>proposes changes for you to approve</strong>. Nothing is saved until you say so.
        </p>

        {messages.length > 0 && (
          <div style={{ maxHeight: 340, overflow: 'auto', border: '1px solid var(--card-border, #eee)', borderRadius: 'var(--r-sm)', padding: 'var(--s3)', marginBottom: 'var(--s3)' }}>
            {messages.map((m, i) => (
              <div key={i} style={{ marginBottom: 'var(--s2)', textAlign: m.role === 'user' ? 'right' : 'left' }}>
                <span style={{ display: 'inline-block', maxWidth: '85%', padding: 'var(--s2) var(--s3)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-body)', whiteSpace: 'pre-wrap',
                  background: m.role === 'user' ? 'var(--accent, #2d6cdf)' : 'var(--surface-raised, #f4f4f5)',
                  color: m.role === 'user' ? '#fff' : 'var(--text)' }}>{m.content}</span>
              </div>
            ))}
            {busy && <div className="body-sm text-muted">Researching…</div>}
          </div>
        )}

        {actions.length > 0 && (
          <div style={{ border: '1px solid var(--accent, #2d6cdf)', borderRadius: 'var(--r-sm)', padding: 'var(--s3)', marginBottom: 'var(--s3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--s2)' }}>
              <div style={{ fontWeight: 600, fontSize: 'var(--fs-body)' }}>Proposed changes — untick anything you don’t want</div>
              <button className="btn btn-secondary btn-sm" onClick={() => setSel(sel.size === actions.length ? new Set() : new Set(actions.map((_, i) => i)))}>
                {sel.size === actions.length ? 'Untick all' : 'Tick all'}
              </button>
            </div>
            {actions.map((a, i) => (
              <label key={i} style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'flex-start', fontSize: 'var(--fs-body)', padding: 'var(--s1) 0', borderTop: i ? '1px solid #f2f2f2' : 'none', cursor: 'pointer', opacity: sel.has(i) ? 1 : 0.5 }}>
                <input type="checkbox" checked={sel.has(i)} onChange={() => toggleAction(i)} style={{ marginTop: 'var(--s1)' }} />
                <span>{actionLabel(a)}{a.why ? <span className="text-muted" style={{ fontSize: 'var(--fs-caption)' }}> — {a.why}</span> : null}</span>
              </label>
            ))}
            <div style={{ marginTop: 'var(--s2)' }}>
              <button className="btn btn-primary btn-sm" {...roWrite(readOnly, { onClick: apply, disabled: applying || sel.size === 0 })}>{applying ? 'Applying…' : `Approve & apply ${sel.size}`}</button>{' '}
              <button className="btn btn-secondary btn-sm" onClick={() => { setActions([]); setSel(new Set()); }}>Discard all</button>
            </div>
          </div>
        )}

        {applied && (
          <div style={{ marginBottom: 'var(--s3)', fontSize: 'var(--fs-body)' }}>
            {applied.map((r, i) => (
              <div key={i} style={{ color: r.ok ? 'var(--positive, #157a3f)' : 'var(--danger, #c62828)' }}>
                {r.ok ? '✓' : '✕'} {actionLabel(r)} — {r.detail}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'flex-end' }}>
          <textarea className="input" rows={2} value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
            placeholder="Dump websites, contacts, or notes…  (⌘/Ctrl+Enter to send)" style={{ flex: 1 }} />
          <button className="btn btn-primary" {...roWrite(readOnly, { onClick: send, disabled: busy || input.trim().length < 2 })}>{busy ? '…' : 'Send'}</button>
        </div>
    </div>
  );
}
