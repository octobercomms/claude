import React, { useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';

// Modal — conversational template builder for a client's weekly or monthly
// report. The AM describes what they want; Claude proposes a JSON template
// via the propose_template tool; the AM iterates and finally locks it.
//
// We keep chat history client-side. Only the locked template is persisted.
export default function ReportTemplateChat({ clientId, clientName, reportType, onClose, onSaved }) {
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [proposed, setProposed] = useState(null);
  const [saved, setSaved] = useState(null);
  const [connectors, setConnectors] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [attachment, setAttachment] = useState(null);
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    api.get(`/clients/${clientId}/report-template/${reportType}`)
      .then(r => {
        setSaved(r.template);
        setConnectors(r.available_connectors || []);
        // Seed the preview pane with the locked template (if any) so the
        // AM can edit it directly — toggle narratives, delete sections —
        // without having to round-trip through chat just to surface it.
        // proposedDiffers stays false until they actually change something.
        setProposed(r.template || r.default_template);
      })
      .catch(e => setError(e.message));
  }, [clientId, reportType]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history, proposed]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function send() {
    // Allow an attachment-only turn — the AM can drop a PDF without
    // any prompt text and we'll ask Claude to recreate it as-is.
    const text = input.trim();
    if (!text && !attachment) return;
    if (sending) return;
    const displayContent = attachment
      ? (text ? `${text}\n\n[attached: ${attachment.name}]` : `[attached: ${attachment.name}]`)
      : text;
    const next = [...history, { role: 'user', content: displayContent }];
    setHistory(next);
    setInput('');
    const sentAttachment = attachment;
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setSending(true);
    setError(null);
    try {
      let result;
      if (sentAttachment) {
        const form = new FormData();
        form.append('history', JSON.stringify(next));
        form.append('attachment', sentAttachment);
        result = await api.postForm(`/clients/${clientId}/report-template/${reportType}/chat`, form);
      } else {
        result = await api.post(`/clients/${clientId}/report-template/${reportType}/chat`, { history: next });
      }
      const { reply, proposed: p } = result;
      setHistory([...next, { role: 'assistant', content: reply || '(no reply)' }]);
      if (p) setProposed(p);
    } catch (e) {
      setError(e.message);
      setHistory(next.slice(0, -1));
      setInput(text);
      if (sentAttachment) setAttachment(sentAttachment);
    } finally {
      setSending(false);
    }
  }

  function onFilePicked(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const ok = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!ok.includes(f.type)) {
      setError(`Unsupported file type: ${f.type || 'unknown'}. Attach a PDF or image.`);
      e.target.value = '';
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      setError('File is too large (max 25MB).');
      e.target.value = '';
      return;
    }
    setError(null);
    setAttachment(f);
  }

  async function lockAndSave() {
    if (!proposed) return;
    setSaving(true);
    setError(null);
    try {
      await api.put(`/clients/${clientId}/report-template/${reportType}`, { template: proposed });
      setSaved(proposed);
      onSaved?.(proposed);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const proposedDiffers = proposed && JSON.stringify(proposed) !== JSON.stringify(saved);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="modal modal-wide">
        <div className="modal-head">
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
            {reportType === 'weekly' ? 'Weekly' : 'Monthly'} report template — {clientName}
          </h2>
          <button type="button" onClick={onClose} className="modal-close">×</button>
        </div>
        <p className="body-sm text-muted">
          Describe the report you want. Claude will draft a template (sections, layout, sources) on the right.
          Iterate until it's right, then lock to save.
        </p>

        <div className="row" style={{ gap: 16, flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1.2, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div className="card" style={{ flex: 1, padding: 10, overflowY: "auto", minHeight: 220, maxHeight: "50vh" }} ref={scrollRef}>
              {!history.length && (
                <div className="body-sm text-muted">
                  Tell Claude what to include. Examples:
                  <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: 12 }}>
                    <li>"B2C revenue summary across all stores, then B2B, then Google Ads ROAS."</li>
                    <li>"Same as last month, but add a Meta Ads block and drop the SEO table."</li>
                    <li>"Just three things: total spend, total revenue, and net per channel."</li>
                  </ul>
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                    Or attach a PDF/image of an old report (📎) and Claude will recreate it as a template.
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-subtle)' }}>
                    Connectors available: {connectors.length ? connectors.map(c => `${c.type}${c.storeLabel ? ` (${c.storeLabel})` : ''}`).join(', ') : '(none configured)'}
                  </div>
                </div>
              )}
              {history.map((m, i) => (
                <div key={i} className={`chat-bubble ${m.role === "user" ? "user" : "assistant"}`} style={{ marginBottom: 10 }}>
                  <div className="caption mb-2" style={{ fontSize: 10 }}>{m.role === 'user' ? 'You' : 'Claude'}</div>
                  <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.content}</div>
                </div>
              ))}
              {sending && <div className="chat-bubble assistant" style={{ marginBottom: 10 }}><div className="caption mb-2" style={{ fontSize: 10 }}>Claude</div><div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>Thinking…</div></div>}
            </div>
            {attachment && (
              <div className="chip chip-accent" style={{ marginTop: 8 }}>
                <span style={{ fontSize: 12 }}>📎 {attachment.name} <span style={{ color: 'var(--text-subtle)' }}>({Math.round(attachment.size / 1024)}KB)</span></span>
                <button type="button" onClick={() => { setAttachment(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="btn-ghost" style={{ fontSize: 16, padding: "0 2px" }} title="Remove attachment">×</button>
              </div>
            )}
            <div className="chat-input-row">
              <textarea
                className="textarea"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
                placeholder={attachment ? 'Optional — describe how to use this file, or just send' : 'Describe a change, or attach a PDF/image. ⌘↩ to send'}
                disabled={sending}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp,image/gif"
                  onChange={onFilePicked}
                  style={{ display: 'none' }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending || !!attachment}
                  className="btn btn-secondary btn-sm"
                  title="Attach a sample report (PDF or image) for Claude to recreate"
                >
                  📎
                </button>
                <button type="button" onClick={send} disabled={(!input.trim() && !attachment) || sending} className="btn btn-primary">
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </div>

          <div className="card" style={{ flex: 1, padding: 12, overflowY: "auto", maxHeight: "60vh", position: "relative" }}>
            <div className="caption mb-2">
              {sending
                ? <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><GeneratingDots /> Generating draft…</span>
                : proposed ? (proposedDiffers ? 'Draft — not yet locked' : 'Locked template') : 'No draft yet'}
            </div>
            {sending && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.6)", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--r-md)" }} />
            )}
            {proposed ? (
              <TemplatePreview template={proposed} onChange={setProposed} />
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                {saved ? 'A template is locked. Ask Claude to change it.' : 'Ask Claude for a starting point.'}
              </div>
            )}
          </div>
        </div>

        {error && <div className="callout callout-danger">{error}</div>}

        <div className="row end">
          <button type="button" onClick={onClose} className="btn btn-secondary">Close</button>
          <button
            type="button"
            onClick={lockAndSave}
            disabled={!proposed || !proposedDiffers || saving || sending}
            className="btn btn-primary"
            title={sending ? 'Wait for Claude to finish' : !proposed ? 'No draft yet' : !proposedDiffers ? 'No changes to lock' : 'Save this template as the locked blueprint'}
          >
            {saving ? 'Saving…' : 'Lock & Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function GeneratingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: '50%', background: 'var(--text-subtle)', display: 'inline-block',
          animation: 'pulse-dot 1.2s ease-in-out infinite',
          animationDelay: `${i * 0.2}s`,
        }} />
      ))}
      <style>{`@keyframes pulse-dot { 0%,80%,100%{opacity:0.2;transform:scale(0.8)} 40%{opacity:1;transform:scale(1)} }`}</style>
    </span>
  );
}

function TemplatePreview({ template, onChange }) {
  const sections = template.sections || [];
  function updateSection(id, patch) {
    onChange?.({ ...template, sections: sections.map(s => s.id === id ? { ...s, ...patch } : s) });
  }
  function removeSection(id) {
    onChange?.({ ...template, sections: sections.filter(s => s.id !== id) });
  }
  return (
    <div style={{ fontSize: 12 }}>
      {sections.map((s, i) => (
        <div key={s.id || i} className="card" style={{ padding: "8px 10px", marginBottom: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <strong>{s.title || s.id}</strong>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span className="chip chip-accent" style={{ fontSize: 10 }}>{s.type}</span>
              {onChange && (
                <button
                  type="button"
                  onClick={() => removeSection(s.id)}
                  className="text-negative" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, padding: "0 4px" }}
                  title="Remove this section"
                >×</button>
              )}
            </span>
          </div>
          {s.sources && (
            <div style={{ color: 'var(--text-muted)', marginTop: 3 }}>
              sources: {Array.isArray(s.sources)
                ? s.sources.map(src => typeof src === 'string' ? src : `${src.type}${src.storeLabel ? `:${src.storeLabel}` : ''}`).join(', ')
                : String(s.sources)}
            </div>
          )}
          {s.metrics && <div style={{ color: 'var(--text-muted)' }}>metrics: {s.metrics.join(', ')}{s.aggregate ? ` (${s.aggregate})` : ''}</div>}
          {s.dimension && <div style={{ color: 'var(--text-muted)' }}>dimension: {s.dimension} / {s.metric}</div>}
          {s.compare === 'yoy' && <div style={{ color: 'var(--positive)', marginTop: 2, fontWeight: 600 }}>compare: year-on-year</div>}
          {s.prompt && <div style={{ color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>"{s.prompt}"</div>}
          {/* Per-section auto-insight toggle — only relevant for non-narrative
              section types (narrative sections ARE the prose themselves). */}
          {onChange && s.type !== 'narrative' && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={s.insight !== false}
                onChange={e => updateSection(s.id, { insight: e.target.checked })}
              />
              auto-narrative above table
            </label>
          )}
        </div>
      ))}
      {!sections.length && <div style={{ color: 'var(--text-subtle)' }}>(empty)</div>}
    </div>
  );
}

