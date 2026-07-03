import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { roWrite } from '../utils/readOnly';

// Internal Strategist reports for ads — Manus-style briefing notes.
// Three-column working layout: left rail lists past reports newest
// first; the middle column carries the bulk of the briefing (executive
// summary, campaign + platform breakdown, what-changed, scorecard) and
// the right column isolates the actions checklist + recommendations so
// "what to do this week" reads on its own. Recipients + send/PDF live
// in a full-width bar above the columns.
export default function StrategistPanel({ clientId, hasMeta, hasGoogle }) {
  const toast = useToast();
  const { readOnly } = useAuth();
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

  const completed = selected && selected.status === 'completed';
  const briefing = completed ? splitBriefing(selected.markdown || '') : null;
  const recsSection = briefing ? briefing.sections.find(s => s.num === 5) : null;
  const scorecardSection = briefing ? briefing.sections.find(s => s.num === 6) : null;
  const middleSections = briefing ? briefing.sections.filter(s => s.num !== 5 && s.num !== 6) : [];
  const hasActionables = completed && (recsSection || scorecardSection || actions.length > 0);

  return (
    <div>
      <div className="modal-head">
        <div>
          <h2 className="h2">Strategist briefing</h2>
          <p className="body mt-3">
            A structured analyst note on this client's Meta + Google Ads. Compares the last period
            against the previous one and tells you what to action next. Auto-generated every Monday at 07:00.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={period} onChange={e => setPeriod(parseInt(e.target.value, 10))} className="input">
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <button className="btn btn-primary" {...roWrite(readOnly, { onClick: generate, disabled: generating })}>
            {generating ? 'Generating…' : '+ Generate report'}
          </button>
        </div>
      </div>

      {!reports && <div style={{ color: 'var(--text-subtle)', padding: 20 }}>Loading…</div>}
      {reports && reports.length === 0 && !generating && (
        <div className="empty">
          No reports yet for this client. Click <strong>Generate report</strong> to produce the first one — Claude will read the last {period} days of ad performance and write a Manus-style briefing.
        </div>
      )}

      {reports && reports.length > 0 && (
        <>
          {/* Top bar — Monday email recipients + send / PDF, full width. */}
          {completed && (
            <div className="card strategist-topbar">
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
                    style={{ flex: 1, padding: '6px 10px', fontSize: 13, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}
                  />
                  {recipientsDirty && (
                    <button onClick={saveRecipients} disabled={savingRecipients} className="btn btn-secondary btn-sm">
                      {savingRecipients ? 'Saving…' : 'Save'}
                    </button>
                  )}
                </div>
              </div>
              <button className="btn btn-secondary btn-sm" {...roWrite(readOnly, { onClick: sendBriefingEmail, disabled: emailing || !selected, title: 'Send this briefing as an email now (uses the recipients above)' })}>
                {emailing ? 'Sending…' : '✉ Send to email'}
              </button>
              <button onClick={savePdf} className="btn btn-secondary btn-sm" title="Save a PDF copy with the standard report header + footer">
                ↓ Save PDF
              </button>
            </div>
          )}

          {/* Zone 1 — analytical body: list + sections 1–4. */}
          <div className="strategist-main">
            <div>
              <div className="strategist-col-head">Briefings</div>
              <div className="strategist-list">
                {reports.map(r => (
                  <button key={r.id} onClick={() => setSelectedId(r.id)}
                    className={`briefing-card${selectedId === r.id ? ' active' : ''}`}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span className="briefing-date">{fmtDate(r.period_start)} – {fmtDate(r.period_end)}</span>
                      {!r.read_at && r.status === 'completed' && <span className="briefing-dot" />}
                    </div>
                    <div className="briefing-meta">
                      {r.status === 'generating' && '· Generating…'}
                      {r.status === 'failed' && <span style={{ color: 'var(--negative)' }}>✗ Failed</span>}
                      {r.status === 'completed' && (
                        <>
                          {r.trigger === 'weekly' ? 'weekly · ' : 'manual · '}
                          {fmtRelative(r.generated_at)}
                        </>
                      )}
                    </div>
                    <span className="briefing-del" onClick={(e) => destroy(r.id, e)} title="Delete">×</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="card">
              {!selected && <div style={{ color: 'var(--text-subtle)' }}>Pick a briefing on the left.</div>}
              {selected && selected.status === 'generating' && (
                <div style={{ color: 'var(--text-subtle)' }}>Generating… this usually takes 30–60 seconds.</div>
              )}
              {selected && selected.status === 'failed' && (
                <div style={{ padding: 12, background: 'var(--negative-soft)', border: '1px solid #f5c6cb', borderRadius: 'var(--r-sm)', color: 'var(--negative)', fontSize: 13 }}>
                  Generation failed: {selected.error_message || 'unknown error'}
                </div>
              )}
              {completed && (
                <div className="body-sm">
                  {briefing.preamble && (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                      {briefing.preamble}
                    </ReactMarkdown>
                  )}
                  {middleSections.map(s => (
                    <ReactMarkdown key={s.num} remarkPlugins={[remarkGfm]} components={mdComponents}>
                      {s.md}
                    </ReactMarkdown>
                  ))}
                  {/* Fallback: a report that didn't parse into numbered
                      sections still renders in full here. */}
                  {briefing.sections.length === 0 && briefing.preamble === '' && (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                      {selected.markdown || ''}
                    </ReactMarkdown>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Zone 2 — actionable output: recommendations beside the
              interactive summary scorecard. */}
          {hasActionables && (
            <div className="strategist-actionables">
              <div className="card body-sm">
                {actions.length > 0 && (
                  <div style={{ border: '1px solid #E7CD41', background: 'var(--warning-soft)', borderRadius: 'var(--r-sm)', padding: '12px 14px', marginBottom: 'var(--s4)' }}>
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
                {recsSection && (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                    {stripSectionNumber(recsSection.md)}
                  </ReactMarkdown>
                )}
              </div>

              {scorecardSection && (
                <ScorecardCard reportId={selected.id} section={scorecardSection.md} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Split a briefing's markdown into its numbered top-level sections
// ("## 5. Recommendations" → { num: 5, md }). Anything before the first
// numbered heading (title, period line) is returned as the preamble.
// Tolerant of 1–4 leading hashes so older reports still parse.
function splitBriefing(md) {
  if (!md) return { preamble: '', sections: [] };
  const headingRe = /^#{1,4}\s+(\d+)\.\s+.+$/;
  const preamble = [];
  const sections = [];
  let cur = null;
  for (const line of md.split('\n')) {
    const m = line.match(headingRe);
    if (m) {
      if (cur) sections.push(cur);
      cur = { num: parseInt(m[1], 10), lines: [line] };
    } else if (cur) {
      cur.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (cur) sections.push(cur);
  return {
    preamble: preamble.join('\n').trim(),
    sections: sections.map(s => ({ num: s.num, md: s.lines.join('\n') })),
  };
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

// Strip a leading "N. " from a section's heading so isolated sections
// read as clean titles ("## 5. Recommendations" → "## Recommendations").
function stripSectionNumber(md) {
  return md.replace(/^(#{1,4}\s+)\d+\.\s+/, '$1');
}

// Parse the first GFM table out of a markdown chunk into { headers, rows }.
function parseMarkdownTable(md) {
  const lines = md.split('\n').map(l => l.trim()).filter(Boolean);
  const tableLines = lines.filter(l => l.startsWith('|'));
  if (tableLines.length < 2) return null;
  const splitRow = (l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim().replace(/\*\*/g, '').replace(/`/g, ''));
  if (!/^[\s|:-]+$/.test(tableLines[1])) return null;  // 2nd line must be the --- separator
  const headers = splitRow(tableLines[0]);
  const rows = tableLines.slice(2).map(splitRow).filter(r => r.some(Boolean));
  if (!rows.length) return null;
  return { headers, rows };
}

// Interactive Summary Scorecard — the section-6 table rendered with a
// checkbox per row. Ticking a row greys it out; state is remembered per
// report in localStorage (no backend needed for a per-AM working list).
function ScorecardCard({ reportId, section }) {
  const table = parseMarkdownTable(section);
  const storageKey = `strategist_scorecard_${reportId}`;
  const [done, setDone] = useState(new Set());

  useEffect(() => {
    try { setDone(new Set(JSON.parse(localStorage.getItem(storageKey) || '[]'))); }
    catch { setDone(new Set()); }
  }, [storageKey]);

  function toggle(i) {
    setDone(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }

  if (!table) {
    return (
      <div className="card body-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
          {stripSectionNumber(section)}
        </ReactMarkdown>
      </div>
    );
  }

  const doneCount = table.rows.filter((_, i) => done.has(i)).length;
  return (
    <div className="card">
      <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 4px' }}>Summary Scorecard</h2>
      <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 12 }}>
        {doneCount} of {table.rows.length} actioned
      </div>
      <div className="md-table-wrap">
        <table className="scorecard-table">
          <thead>
            <tr>
              <th className="scorecard-check" />
              {table.headers.map((h, i) => <th key={i}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i} className={`scorecard-row${done.has(i) ? ' done' : ''}`}>
                <td className="scorecard-check">
                  <input type="checkbox" checked={done.has(i)} onChange={() => toggle(i)} style={{ cursor: 'pointer' }} />
                </td>
                {row.map((cell, j) => (
                  <td key={j} className={j === 0 ? 'scorecard-area' : ''}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
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
  table: ({ node, ...p }) => <div className="md-table-wrap"><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} {...p} /></div>,
  th: ({ node, ...p }) => <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #1a1a1a', fontWeight: 700, fontSize: 12 }} {...p} />,
  td: ({ node, ...p }) => <td style={{ padding: '6px 10px', borderBottom: '1px solid #eee', verticalAlign: 'top' }} {...p} />,
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid #e8e8e8', margin: '20px 0' }} />,
  blockquote: ({ node, ...p }) => <blockquote style={{ borderLeft: '3px solid #E7CD41', paddingLeft: 14, color: 'var(--text-muted)', margin: '10px 0' }} {...p} />,
  code: ({ node, inline, ...p }) => inline
    ? <code style={{ background: 'var(--surface-sunken)', padding: '1px 6px', borderRadius: 'var(--r-sm)', fontSize: 12 }} {...p} />
    : <pre style={{ background: 'var(--surface-sunken)', padding: 12, borderRadius: 'var(--r-sm)', fontSize: 12, overflowX: 'auto' }}><code {...p} /></pre>,
};

