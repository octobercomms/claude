import React, { useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import { primaryBtn, secondaryBtn } from '../styles/theme';

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
  const scrollRef = useRef(null);

  useEffect(() => {
    api.get(`/clients/${clientId}/report-template/${reportType}`)
      .then(r => {
        setSaved(r.template);
        setConnectors(r.available_connectors || []);
        if (!r.template) setProposed(r.default_template);
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
    if (!input.trim() || sending) return;
    const next = [...history, { role: 'user', content: input.trim() }];
    setHistory(next);
    setInput('');
    setSending(true);
    setError(null);
    try {
      const { reply, proposed: p } = await api.post(`/clients/${clientId}/report-template/${reportType}/chat`, { history: next });
      setHistory([...next, { role: 'assistant', content: reply || '(no reply)' }]);
      if (p) setProposed(p);
    } catch (e) {
      setError(e.message);
      setHistory(next.slice(0, -1));
      setInput(next[next.length - 1].content);
    } finally {
      setSending(false);
    }
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
    <div style={styles.overlay} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={styles.modal}>
        <div style={styles.header}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
            {reportType === 'weekly' ? 'Weekly' : 'Monthly'} report template — {clientName}
          </h2>
          <button type="button" onClick={onClose} style={styles.closeBtn}>×</button>
        </div>
        <p style={styles.hint}>
          Describe the report you want. Claude will draft a template (sections, layout, sources) on the right.
          Iterate until it's right, then lock to save.
        </p>

        <div style={styles.split}>
          <div style={styles.chatPane}>
            <div style={styles.history} ref={scrollRef}>
              {!history.length && (
                <div style={styles.kicker}>
                  Tell Claude what to include. Examples:
                  <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: 12 }}>
                    <li>"B2C revenue summary across all stores, then B2B, then Google Ads ROAS."</li>
                    <li>"Same as last month, but add a Meta Ads block and drop the SEO table."</li>
                    <li>"Just three things: total spend, total revenue, and net per channel."</li>
                  </ul>
                  <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
                    Connectors available: {connectors.length ? connectors.map(c => `${c.type}${c.storeLabel ? ` (${c.storeLabel})` : ''}`).join(', ') : '(none configured)'}
                  </div>
                </div>
              )}
              {history.map((m, i) => (
                <div key={i} style={m.role === 'user' ? styles.userMsg : styles.assistantMsg}>
                  <div style={styles.msgRole}>{m.role === 'user' ? 'You' : 'Claude'}</div>
                  <div style={styles.msgBody}>{m.content}</div>
                </div>
              ))}
              {sending && <div style={styles.assistantMsg}><div style={styles.msgRole}>Claude</div><div style={styles.msgBody}>Thinking…</div></div>}
            </div>
            <div style={styles.inputRow}>
              <textarea
                style={styles.textarea}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
                placeholder="Describe a change, or press ⌘↩ to send"
                disabled={sending}
              />
              <button type="button" onClick={send} disabled={!input.trim() || sending} style={primaryBtn}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>

          <div style={{ ...styles.previewPane, position: 'relative' }}>
            <div style={styles.previewTitle}>
              {sending
                ? <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><GeneratingDots /> Generating draft…</span>
                : proposed ? (proposedDiffers ? 'Draft — not yet locked' : 'Locked template') : 'No draft yet'}
            </div>
            {sending && (
              <div style={styles.generatingOverlay} />
            )}
            {proposed ? (
              <TemplatePreview template={proposed} />
            ) : (
              <div style={{ fontSize: 12, color: '#888' }}>
                {saved ? 'A template is locked. Ask Claude to change it.' : 'Ask Claude for a starting point.'}
              </div>
            )}
          </div>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.footer}>
          <button type="button" onClick={onClose} style={secondaryBtn}>Close</button>
          <button
            type="button"
            onClick={lockAndSave}
            disabled={!proposed || !proposedDiffers || saving || sending}
            style={primaryBtn}
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
          width: 5, height: 5, borderRadius: '50%', background: '#888', display: 'inline-block',
          animation: 'pulse-dot 1.2s ease-in-out infinite',
          animationDelay: `${i * 0.2}s`,
        }} />
      ))}
      <style>{`@keyframes pulse-dot { 0%,80%,100%{opacity:0.2;transform:scale(0.8)} 40%{opacity:1;transform:scale(1)} }`}</style>
    </span>
  );
}

function TemplatePreview({ template }) {
  const sections = template.sections || [];
  return (
    <div style={{ fontSize: 12 }}>
      {sections.map((s, i) => (
        <div key={s.id || i} style={styles.sectionCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong>{s.title || s.id}</strong>
            <span style={styles.sectionType}>{s.type}</span>
          </div>
          {s.sources && (
            <div style={{ color: '#666', marginTop: 3 }}>
              sources: {Array.isArray(s.sources)
                ? s.sources.map(src => typeof src === 'string' ? src : `${src.type}${src.storeLabel ? `:${src.storeLabel}` : ''}`).join(', ')
                : String(s.sources)}
            </div>
          )}
          {s.metrics && <div style={{ color: '#666' }}>metrics: {s.metrics.join(', ')}{s.aggregate ? ` (${s.aggregate})` : ''}</div>}
          {s.dimension && <div style={{ color: '#666' }}>dimension: {s.dimension} / {s.metric}</div>}
          {s.compare === 'yoy' && <div style={{ color: '#2e7d32', marginTop: 2, fontWeight: 600 }}>compare: year-on-year</div>}
          {s.prompt && <div style={{ color: '#666', marginTop: 4, fontStyle: 'italic' }}>"{s.prompt}"</div>}
        </div>
      ))}
      {!sections.length && <div style={{ color: '#888' }}>(empty)</div>}
    </div>
  );
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px 20px', zIndex: 1000, overflowY: 'auto' },
  modal: { background: '#fff', borderRadius: 8, width: '100%', maxWidth: 1080, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 60px)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  closeBtn: { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#888', lineHeight: 1, padding: 4 },
  hint: { fontSize: 12, color: '#666', margin: '0 0 12px', lineHeight: 1.5 },
  split: { display: 'flex', gap: 16, flex: 1, minHeight: 0 },
  chatPane: { flex: 1.2, display: 'flex', flexDirection: 'column', minHeight: 0 },
  previewPane: { flex: 1, padding: 12, background: '#fafafa', border: '1px solid #eee', borderRadius: 4, overflowY: 'auto', maxHeight: '60vh' },
  previewTitle: { fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  history: { flex: 1, border: '1px solid #eee', borderRadius: 4, padding: 10, overflowY: 'auto', minHeight: 220, maxHeight: '50vh', background: '#fff' },
  kicker: { fontSize: 13, color: '#666', padding: 4 },
  userMsg: { marginBottom: 10, padding: '6px 10px', background: '#fff7d6', borderRadius: 4 },
  assistantMsg: { marginBottom: 10, padding: '6px 10px', background: '#f4f4f4', borderRadius: 4 },
  msgRole: { fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', marginBottom: 2 },
  msgBody: { fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  inputRow: { display: 'flex', gap: 8, marginTop: 8, alignItems: 'flex-start' },
  textarea: { flex: 1, minHeight: 60, maxHeight: 200, padding: '8px 10px', fontSize: 13, lineHeight: 1.5, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' },
  generatingOverlay: { position: 'absolute', inset: 0, background: 'rgba(250,250,250,0.55)', borderRadius: 4, pointerEvents: 'none', zIndex: 1 },
  sectionCard: { marginBottom: 8, padding: '6px 8px', background: '#fff', border: '1px solid #eee', borderRadius: 3 },
  sectionType: { fontSize: 10, color: '#888', fontFamily: 'monospace', textTransform: 'uppercase' },
  error: { color: '#c62828', fontSize: 12, marginTop: 10, padding: 8, background: '#fdecea', borderRadius: 4 },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14, borderTop: '1px solid #eee', paddingTop: 12 },
};
