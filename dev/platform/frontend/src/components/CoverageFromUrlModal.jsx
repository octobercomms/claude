// PR → Coverage → "From a link". Paste a coverage URL; the app fetches the page
// and AI-extracts publication / journalist / headline / date. If the client has
// open (pending) entries on the same outlet, you're asked to merge into one or
// log it as new — never auto-merged.

import React, { useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

export default function CoverageFromUrlModal({ clientId, onClose, onSaved }) {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [step, setStep] = useState('input'); // input → review
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState({ publication: '', journalist: '', title: '', date: '', url: '' });
  const [matches, setMatches] = useState([]);
  const [choice, setChoice] = useState('new'); // 'new' or a match id

  async function extract() {
    if (!/^https?:\/\//i.test(url.trim())) { toast('Paste a full http(s) URL.', 'error'); return; }
    setLoading(true);
    try {
      const r = await api.post(`/pr/clients/${clientId}/coverage/extract`, { url: url.trim() });
      setFields({ ...r.fields });
      setMatches(r.matches || []);
      setChoice('new');
      setStep('review');
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }

  async function save() {
    if (!fields.publication && !fields.title) { toast('Need at least a publication or headline.', 'error'); return; }
    setSaving(true);
    try {
      const body = { fields };
      if (choice !== 'new') body.merge_id = choice;
      const r = await api.post(`/pr/clients/${clientId}/coverage/log`, body);
      toast(r.merged ? 'Merged into the existing entry and marked published.' : 'Logged as published.', 'success');
      onSaved && onSaved();
      onClose();
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  }

  const setF = (k, v) => setFields(prev => ({ ...prev, [k]: v }));

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 16px', zIndex: 1000, overflow: 'auto' }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{ width: 'min(640px, 100%)', background: 'var(--surface)', }}>
        <div className="row between center" style={{ marginBottom: 'var(--s3)' }}>
          <div className="h3" style={{ margin: 0 }}>Log coverage from a link</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {step === 'input' && (
          <>
            <p className="body-sm text-muted" style={{ marginTop: 0 }}>Paste the URL of a published article. We'll read the page and pull out the publication, journalist, headline and date.</p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input className="input" style={{ flex: 1 }} placeholder="https://…" value={url}
                onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && extract()} autoFocus />
              <button className="btn btn-primary" onClick={extract} disabled={loading}>{loading ? 'Reading…' : 'Extract'}</button>
            </div>
            <p className="body-xs text-subtle" style={{ marginTop: 8 }}>Paywalled or login-walled pages may not extract — you can still fill the fields in by hand after.</p>
          </>
        )}

        {step === 'review' && (
          <>
            <div className="stack stack-sm">
              <Field label="Publication" value={fields.publication} onChange={v => setF('publication', v)} />
              <Field label="Journalist" value={fields.journalist} onChange={v => setF('journalist', v)} />
              <Field label="Headline" value={fields.title} onChange={v => setF('title', v)} />
              <Field label="Date" value={fields.date} onChange={v => setF('date', v)} placeholder="YYYY-MM-DD" />
            </div>

            {matches.length > 0 && (
              <div style={{ marginTop: 'var(--s4)' }}>
                <div className="callout callout-warning" style={{ marginBottom: 8 }}>
                  This client already has {matches.length} open {matches.length === 1 ? 'entry' : 'entries'} on this outlet. Merge into one, or log as new?
                </div>
                <label style={radioRow}>
                  <input type="radio" name="merge" checked={choice === 'new'} onChange={() => setChoice('new')} />
                  <span><strong>Log as a new published entry</strong></span>
                </label>
                {matches.map(m => (
                  <label key={m.id} style={radioRow}>
                    <input type="radio" name="merge" checked={choice === m.id} onChange={() => setChoice(m.id)} />
                    <span>
                      <strong>Merge into:</strong> {m.story_title || '(untitled)'} · <span className="text-subtle">{m.outlet}{m.contact ? ` · ${m.contact}` : ''} · {m.status}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            <div className="row" style={{ gap: 8, marginTop: 'var(--s4)' }}>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : (choice === 'new' ? 'Log as published' : 'Merge & mark published')}
              </button>
              <button className="btn btn-secondary" onClick={() => setStep('input')} disabled={saving}>Back</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <input className="input" value={value || ''} placeholder={placeholder || ''} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

const radioRow = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', cursor: 'pointer' };
