import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import GoogleAdsPlaybook from './GoogleAdsPlaybook';

// Internal Strategist reports for ads — Manus-style briefing notes. Left
// rail lists past reports newest first; right pane renders the selected
// report in markdown with table support via remark-gfm.
export default function StrategistPanel({ clientId, hasMeta, hasGoogle }) {
  const toast = useToast();
  const [reports, setReports] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [period, setPeriod] = useState(7);
  const [actions, setActions] = useState([]);
  const [recipients, setRecipients] = useState('');
  const [recipientsDirty, setRecipientsDirty] = useState(false);
  const [savingRecipients, setSavingRecipients] = useState(false);
  const [emailing, setEmailing] = useState(false);

  useEffect(() => {
    api.get(`/strategist/clients/${clientId}/reports`)
      .then(r => { setReports(r); if (r.length) setSelectedId(r[0].id); })
      .catch(e => toast(e.message, 'error'));
  }, [clientId, toast]);

  useEffect(() => {
    if (!selectedId) { setSelected(null); setActions([]); return; }
    api.get(`/strategist/reports/${selectedId}`)
      .then(setSelected)
      .catch(e => toast(e.message, 'error'));
    api.get(`/strategist/reports/${selectedId}/actions`)
      .then(setActions)
      .catch(() => setActions([]));
  }, [selectedId, toast]);

  // Load the client's saved strategist_recipients so the AM can edit
  // them inline (no need to know about the env var or SQL).
  useEffect(() => {
    api.get(`/clients/${clientId}`).then(c => {
      setRecipients(c.strategist_recipients || '');
      setRecipientsDirty(false);
    }).catch(() => {});
  }, [clientId]);

  async function saveRecipients() {
    setSavingRecipients(true);
    try {
      await api.put(`/clients/${clientId}`, { strategist_recipients: recipients });
      setRecipientsDirty(false);
      toast('Recipients saved', 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSavingRecipients(false);
    }
  }

  async function sendBriefingEmail() {
    if (!selected) return;
    setEmailing(true);
    try {
      const res = await api.post(`/strategist/reports/${selected.id}/email`, {});
      toast(`Sent to ${(res.sent_to || []).join(', ') || 'recipients'}`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setEmailing(false);
    }
  }

  async function toggleAction(action) {
    const next = !action.done;
    setActions(prev => prev.map(a => a.id === action.id ? { ...a, done: next, done_at: next ? new Date().toISOString() : null } : a));
    try {
      await api.patch(`/strategist/actions/${action.id}`, { done: next });
    } catch (e) {
      setActions(prev => prev.map(a => a.id === action.id ? { ...a, done: action.done, done_at: action.done_at } : a));
      toast(e.message, 'error');
    }
  }

  useEffect(() => {
    if (selected && selected.status === 'completed' && !selected.read_at) {
      api.post(`/strategist/reports/${selected.id}/read`, {}).catch(() => {});
    }
  }, [selected]);

  async function generate() {
    if (!hasMeta && !hasGoogle) {
      toast('Connect Meta Ads or Google Ads first.', 'error');
      return;
    }
    setGenerating(true);
    try {
      const fresh = await api.post(`/strategist/clients/${clientId}/reports/generate`, { period_days: period });
      const list = await api.get(`/strategist/clients/${clientId}/reports`);
      setReports(list);
      setSelectedId(fresh.id);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setGenerating(false);
    }
  }

  async function savePdf() {
    if (!selected || selected.status !== 'completed') return;
    try {
      const res = await api.raw(`/strategist/reports/${selected.id}/pdf`);
      if (!res.ok) throw new Error(`PDF download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `strategist-${selected.period_end}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function destroy(id, e) {
    e.stopPropagation();
    if (!confirm('Delete this Strategist report? This cannot be undone.')) return;
    try {
      await api.delete(`/strategist/reports/${id}`);
      const list = await api.get(`/strategist/clients/${clientId}/reports`);
      setReports(list);
      if (selectedId === id) setSelectedId(list[0]?.id || null);
    } catch (e2) { toast(e2.message, 'error'); }
  }

  return (
    <div>
      <div className="modal-head">
        <div>
          <div className="caption">Internal · for the AM</div>
          <h2 className="h2">Strategist briefing</h2>
          <p className="body mt-3">
            A private, structured analyst note on this client's Meta + Google Ads. Compares the last period
            against the previous one and tells you what to action next. Auto-generated every Monday at 07:00.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={period} onChange={e => setPeriod(parseInt(e.target.value, 10))} className="input">
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <button onClick={generate} disabled={generating} className="btn btn-primary">
            {generating ? 'Generating…' : '+ Generate report'}
          </button>
        </div>
      </div>

      {hasGoogle && <GoogleAdsPlaybook />}

      {!reports && <div style={{ color: 'var(--text-subtle)', padding: 20 }}>Loading…</div>}
      {reports && reports.length === 0 && !generating && (
        <div className="empty">
          No reports yet for this client. Click <strong>Generate report</strong> to produce the first one — Claude will read the last {period} days of ad performance and write a Manus-style briefing.
        </div>
      )}

      {reports && reports.length > 0 && (
        <div className="grid">
          <div className="stack stack-sm">
            {reports.map(r => (
              <button key={r.id} onClick={() => setSelectedId(r.id)}
                className={`card ${selectedId === r.id ? '' : 'plain'}`}
                style={{ textAlign: 'left', cursor: 'pointer', padding: 'var(--s3) var(--s4)', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: 12 }}>
                    {fmtDate(r.period_start)} – {fmtDate(r.period_end)}
                  </strong>
                  {!r.read_at && r.status === 'completed' && <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "var(--r-pill)", background: "var(--accent)", marginLeft: 6 }} />}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>
                  {r.status === 'generating' && '· Generating…'}
                  {r.status === 'failed' && <span style={{ color: 'var(--negative)' }}>✗ Failed</span>}
                  {r.status === 'completed' && (
                    <>
                      {r.trigger === 'weekly' ? 'weekly · ' : 'manual · '}
                      {fmtRelative(r.generated_at)}
                    </>
                  )}
                </div>
                <button onClick={(e) => destroy(r.id, e)} className="text-negative" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px" }} title="Delete">×</button>
              </button>
            ))}
          </div>

          <div className="card mt-4">
            {!selected && <div style={{ color: 'var(--text-subtle)' }}>Pick a report on the left.</div>}
            {selected && selected.status === 'generating' && (
              <div style={{ color: 'var(--text-subtle)' }}>Generating… this usually takes 30–60 seconds.</div>
            )}
            {selected && selected.status === 'failed' && (
              <div style={{ padding: 12, background: 'var(--negative-soft)', border: '1px solid #f5c6cb', borderRadius: 'var(--r-sm)', color: 'var(--negative)', fontSize: 13 }}>
                Generation failed: {selected.error_message || 'unknown error'}
              </div>
            )}
            {selected && selected.status === 'completed' && (
              <>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 280 }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                      Monday email recipients
                    </label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        type="text"
                        value={recipients}
                        onChange={e => { setRecipients(e.target.value); setRecipientsDirty(true); }}
                        placeholder="email@example.com, another@example.com"
                        style={{ flex: 1, padding: '6px 10px', fontSize: 13, border: 'var(--border-w) solid var(--accent)', borderRadius: 'var(--r-sm)' }}
                      />
                      {recipientsDirty && (
                        <button onClick={saveRecipients} disabled={savingRecipients} className="btn btn-secondary btn-sm">
                          {savingRecipients ? 'Saving…' : 'Save'}
                        </button>
                      )}
                    </div>
                  </div>
                  <button onClick={sendBriefingEmail} disabled={emailing || !selected} className="btn btn-secondary btn-sm" title="Send this briefing as an email now (uses the recipients above)">
                    {emailing ? 'Sending…' : '✉ Send to email'}
                  </button>
                  <button onClick={savePdf} className="btn btn-secondary btn-sm" title="Save a PDF copy with the standard report header + footer">
                    ↓ Save PDF
                  </button>
                </div>
                {actions.length > 0 && (
                  <div style={{ border: '1px solid #E7CD41', background: 'var(--warning-soft)', padding: '12px 16px', borderRadius: 'var(--r-sm)', marginBottom: 18 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                      Actions for the week — {actions.filter(a => a.done).length} of {actions.length} done
                    </div>
                    <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                      {actions.map(a => (
                        <li key={a.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid #f0e7c0' }}>
                          <input type="checkbox" checked={a.done} onChange={() => toggleAction(a)} style={{ marginTop: 3, cursor: 'pointer' }} />
                          <div style={{ flex: 1, fontSize: 13, lineHeight: 1.4, color: a.done ? 'var(--text-subtle)' : 'var(--text)', textDecoration: a.done ? 'line-through' : 'none' }}>
                            {a.text}
                            {a.done && a.done_at && (
                              <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2, textDecoration: 'none' }}>
                                ✓ done {new Date(a.done_at).toLocaleDateString('en-GB')}
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                <div className="body-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                    {selected.markdown || ''}
                  </ReactMarkdown>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
function fmtRelative(d) {
  const diff = Date.now() - new Date(d).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Inline styles that give the markdown a tighter, document feel instead
// of the default browser margins react-markdown emits.
const mdComponents = {
  h1: ({ node, ...p }) => <h1 style={{ fontSize: 22, fontWeight: 700, margin: '24px 0 12px' }} {...p} />,
  h2: ({ node, ...p }) => <h2 style={{ fontSize: 17, fontWeight: 700, margin: '24px 0 10px', paddingBottom: 6, borderBottom: '1px solid #e8e8e8' }} {...p} />,
  h3: ({ node, ...p }) => <h3 style={{ fontSize: 14, fontWeight: 700, margin: '18px 0 8px', color: 'var(--text)' }} {...p} />,
  p: ({ node, ...p }) => <p style={{ margin: '0 0 12px', lineHeight: 1.6, fontSize: 14, color: 'var(--text)' }} {...p} />,
  ul: ({ node, ...p }) => <ul style={{ margin: '0 0 12px', paddingLeft: 22 }} {...p} />,
  ol: ({ node, ...p }) => <ol style={{ margin: '0 0 12px', paddingLeft: 22 }} {...p} />,
  li: ({ node, ...p }) => <li style={{ marginBottom: 6, lineHeight: 1.6, fontSize: 14 }} {...p} />,
  strong: ({ node, ...p }) => <strong style={{ color: 'var(--text)' }} {...p} />,
  table: ({ node, ...p }) => <table style={{ width: '100%', borderCollapse: 'collapse', margin: '8px 0 18px', fontSize: 13 }} {...p} />,
  th: ({ node, ...p }) => <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #1a1a1a', fontWeight: 700, fontSize: 12 }} {...p} />,
  td: ({ node, ...p }) => <td style={{ padding: '6px 10px', borderBottom: '1px solid #eee', verticalAlign: 'top' }} {...p} />,
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid #e8e8e8', margin: '20px 0' }} />,
  blockquote: ({ node, ...p }) => <blockquote style={{ borderLeft: '3px solid #E7CD41', paddingLeft: 14, color: 'var(--text-muted)', margin: '10px 0' }} {...p} />,
  code: ({ node, inline, ...p }) => inline
    ? <code style={{ background: 'var(--surface-sunken)', padding: '1px 6px', borderRadius: 'var(--r-sm)', fontSize: 12 }} {...p} />
    : <pre style={{ background: 'var(--surface-sunken)', padding: 12, borderRadius: 'var(--r-sm)', fontSize: 12, overflowX: 'auto' }}><code {...p} /></pre>,
};

