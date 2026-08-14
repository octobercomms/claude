import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import StrategistChat from './StrategistChat';

// Unified cross-PESO Strategist briefing. Left rail lists past briefings; the
// main column shows the client-level synthesis, a pillar filter, the account-wide
// task checklist (crucial vs nice, pillar-tagged) and the per-pillar expert
// sections. Agency-only. See services/strategist/briefing.js.

const PILLARS = [
  { key: 'all', label: 'All' },
  { key: 'paid', label: 'Paid' },
  { key: 'earned', label: 'Earned' },
  { key: 'shared', label: 'Shared' },
  { key: 'owned', label: 'Owned' },
];
const PILLAR_LABEL = { paid: 'Paid', earned: 'Earned', shared: 'Shared', owned: 'Owned', cross: 'Account-wide' };

export default function StrategistBriefingPanel({ clientId }) {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [days, setDays] = useState(30);
  const [pillar, setPillar] = useState('all');
  const [active, setActive] = useState(true);
  const [recipients, setRecipients] = useState('');
  const [recipientsDirty, setRecipientsDirty] = useState(false);
  const [openSections, setOpenSections] = useState(() => new Set(['synthesis']));
  const [downloading, setDownloading] = useState(null);
  const [view, setView] = useState('briefing'); // 'briefing' | 'chat'
  const [steer, setSteer] = useState([]);
  const [steerText, setSteerText] = useState('');

  const loadList = () => api.get(`/strategist/clients/${clientId}/briefings`)
    .then(r => { setList(r); if (r.length && !selectedId) setSelectedId(r[0].id); })
    .catch(e => toast(e.message, 'error'));

  useEffect(() => { loadList(); /* eslint-disable-line */ }, [clientId]);
  useEffect(() => {
    api.get(`/clients/${clientId}`).then(c => {
      setRecipients(c.strategist_recipients || '');
      setActive(c.strategist_active !== false);
      setRecipientsDirty(false);
    }).catch(() => {});
  }, [clientId]);

  const loadSteer = () => api.get(`/strategist/clients/${clientId}/steer`).then(setSteer).catch(() => {});
  // Reload steer whenever the Briefing view is shown — the chat can add notes.
  useEffect(() => { if (view === 'briefing') loadSteer(); /* eslint-disable-line */ }, [clientId, view]);

  async function addSteer() {
    const text = steerText.trim();
    if (!text) return;
    try {
      const n = await api.post(`/strategist/clients/${clientId}/steer`, { text, source: 'note' });
      setSteer(s => [n, ...s]); setSteerText('');
    } catch (e) { toast(e.message, 'error'); }
  }
  async function removeSteer(id) {
    try { await api.delete(`/strategist/steer/${id}`); setSteer(s => s.filter(n => n.id !== id)); }
    catch (e) { toast(e.message, 'error'); }
  }

  useEffect(() => {
    if (!selectedId) { setSelected(null); return; }
    api.get(`/strategist/briefings/${selectedId}`).then(setSelected).catch(e => toast(e.message, 'error'));
  }, [selectedId, toast]);

  useEffect(() => {
    if (selected && selected.status === 'completed' && !selected.read_at) {
      api.post(`/strategist/briefings/${selected.id}/read`, {}).catch(() => {});
    }
  }, [selected]);

  async function generate() {
    setGenerating(true);
    try {
      const fresh = await api.post(`/strategist/clients/${clientId}/briefing/generate`, { days });
      await loadList();
      setSelectedId(fresh.id);
      // Poll if it came back still generating (long runs).
      if (fresh.status !== 'completed') {
        const poll = setInterval(async () => {
          try {
            const r = await api.get(`/strategist/briefings/${fresh.id}`);
            if (r.status !== 'generating') { clearInterval(poll); setSelected(r); loadList(); }
          } catch { clearInterval(poll); }
        }, 5000);
      }
    } catch (e) { toast(e.message, 'error'); }
    finally { setGenerating(false); }
  }

  async function toggleAction(a) {
    const next = !a.done;
    setSelected(s => ({ ...s, recommendations: s.recommendations.map(r => r.id === a.id ? { ...r, done: next } : r) }));
    try { await api.patch(`/strategist/briefing-actions/${a.id}`, { done: next }); }
    catch (e) { toast(e.message, 'error'); setSelected(s => ({ ...s, recommendations: s.recommendations.map(r => r.id === a.id ? { ...r, done: a.done } : r) })); }
  }

  async function toggleActive() {
    const next = !active;
    setActive(next);
    try { await api.put(`/strategist/clients/${clientId}/active`, { active: next }); toast(next ? 'Weekly briefing on' : 'Weekly briefing paused'); }
    catch (e) { setActive(!next); toast(e.message, 'error'); }
  }

  async function saveRecipients() {
    try { await api.put(`/clients/${clientId}`, { strategist_recipients: recipients }); setRecipientsDirty(false); toast('Recipients saved'); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function destroy(id, e) {
    e.stopPropagation();
    if (!confirm('Delete this briefing?')) return;
    try { await api.delete(`/strategist/briefings/${id}`); const l = await api.get(`/strategist/clients/${clientId}/briefings`); setList(l); if (selectedId === id) setSelectedId(l[0]?.id || null); }
    catch (e2) { toast(e2.message, 'error'); }
  }

  function toggleSection(key) {
    setOpenSections(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  // Download the briefing as a branded document. audience=internal is the
  // verbatim briefing + data appendix (PDF); audience=client is a Claude
  // reframe as a client-facing progress report (Word, editable). The client
  // reframe is generated on first download (~20s) then cached.
  async function downloadReport(audience, format) {
    const key = `${audience}.${format}`;
    setDownloading(key);
    try {
      const res = await api.raw(`/strategist/briefings/${selected.id}/export.${format}?audience=${audience}`);
      if (!res.ok) { const err = await res.json().catch(() => ({ error: res.statusText })); throw new Error(err.error || `HTTP ${res.status}`); }
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const m = cd.match(/filename="([^"]+)"/);
      const filename = m ? m[1] : `strategist.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { toast(`Download failed: ${e.message}`, 'error'); }
    finally { setDownloading(null); }
  }

  const completed = selected && selected.status === 'completed';
  const sections = (completed && Array.isArray(selected.sections)) ? selected.sections : [];
  const recs = (completed && Array.isArray(selected.recommendations)) ? selected.recommendations : [];
  const visibleSections = pillar === 'all' ? sections : sections.filter(s => s.pillar === pillar);
  const visibleRecs = pillar === 'all' ? recs : recs.filter(r => r.pillar === pillar);
  const crucial = visibleRecs.filter(r => r.priority === 'crucial');
  const nice = visibleRecs.filter(r => r.priority !== 'crucial');

  return (
    <div>
      <div className="modal-head">
        <div>
          <h2 className="h2">Strategist</h2>
          <p className="body mt-3">One expert briefing across the whole account — Paid, Earned, Shared and Owned — with the priorities that matter most this month. Emailed to you every Monday.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {view === 'briefing' && <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }} title="Include this client in the Monday email">
              <input type="checkbox" checked={active} onChange={toggleActive} /> Weekly email
            </label>
            <select value={days} onChange={e => setDays(parseInt(e.target.value, 10))} className="input">
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <button className="btn btn-primary" onClick={generate} disabled={generating}>
              {generating ? 'Generating…' : '+ Generate briefing'}
            </button>
          </>}
        </div>
      </div>

      {/* Briefing ↔ Ask toggle */}
      <div className="row" style={{ gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {[{ key: 'briefing', label: 'Briefing' }, { key: 'chat', label: 'Ask the strategist' }].map(v => (
          <button key={v.key} onClick={() => setView(v.key)}
            style={{ padding: '6px 16px', borderRadius: 'var(--r-pill)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              border: 'var(--border-w) solid ' + (view === v.key ? 'var(--text)' : 'var(--card-border)'),
              background: view === v.key ? 'var(--text)' : 'var(--surface)', color: view === v.key ? '#fff' : 'var(--text)' }}>
            {v.label}
          </button>
        ))}
      </div>

      {view === 'chat' && <StrategistChat clientId={clientId} />}
      {view === 'briefing' && <>{renderBriefingView()}</>}
    </div>
  );

  function renderBriefingView() {
    return (
      <>

      {/* Steer the next briefing — the account lead's own thoughts inform generation */}
      <div className="card body-sm" style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
          Steer the next briefing
        </div>
        <p className="caption" style={{ color: 'var(--text-subtle)', margin: '0 0 8px' }}>
          Your thoughts, decisions and priorities. The strategist reads these and weights them when it next generates — add here, or use “Add to briefing” in Ask the strategist.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <textarea value={steerText} onChange={e => setSteerText(e.target.value)} rows={2}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addSteer(); } }}
            placeholder="e.g. We're pushing the autumn collection — lean into SEO and social, ease off paid until stock lands."
            style={{ flex: 1, resize: 'vertical', padding: '8px 10px', fontSize: 13, fontFamily: 'inherit',
              border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }} />
          <button className="btn btn-secondary btn-sm" disabled={!steerText.trim()} onClick={addSteer}>Add</button>
        </div>
        {steer.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {steer.map(n => (
              <div key={n.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, lineHeight: 1.45 }}>
                <span style={{ flex: 1 }}>
                  {n.source === 'chat' && <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-subtle)', marginRight: 6 }}>from chat</span>}
                  {n.text}
                </span>
                <button onClick={() => removeSteer(n.id)} title="Remove"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {!list && <div style={{ color: 'var(--text-subtle)', padding: 20 }}>Loading…</div>}
      {list && list.length === 0 && !generating && (
        <div className="empty">No briefings yet. Click <strong>Generate briefing</strong> — Claude reviews the last {days} days across every pillar and writes your strategist's take. Takes a minute or two.</div>
      )}

      {list && list.length > 0 && (
        <div className="strategist-main">
          <div>
            <div className="strategist-col-head">Briefings</div>
            <div className="strategist-list">
              {list.map(r => (
                <button key={r.id} onClick={() => setSelectedId(r.id)} className={`briefing-card${selectedId === r.id ? ' active' : ''}`}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="briefing-date">{fmtDate(r.period_start)} – {fmtDate(r.period_end)}</span>
                    {!r.read_at && r.status === 'completed' && <span className="briefing-dot" />}
                  </div>
                  <div className="briefing-meta">
                    {r.status === 'generating' && '· Generating…'}
                    {r.status === 'failed' && <span style={{ color: 'var(--negative)' }}>✗ Failed</span>}
                    {r.status === 'completed' && <>{r.trigger === 'weekly_cron' ? 'weekly · ' : 'manual · '}{fmtRelative(r.generated_at)}</>}
                  </div>
                  <span className="briefing-del" onClick={(e) => destroy(r.id, e)} title="Delete">×</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            {!selected && <div className="card" style={{ color: 'var(--text-subtle)' }}>Pick a briefing on the left.</div>}
            {selected && selected.status === 'generating' && <div className="card" style={{ color: 'var(--text-subtle)' }}>Generating… five expert passes, usually a minute or two.</div>}
            {selected && selected.status === 'failed' && (
              <div className="card" style={{ color: 'var(--negative)', fontSize: 13 }}>Generation failed: {selected.error_message || 'unknown error'}</div>
            )}
            {completed && (<>
              {/* Downloads — internal briefing (PDF) + client-facing draft (Word) */}
              <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="btn btn-secondary btn-sm" disabled={!!downloading} onClick={() => downloadReport('internal', 'pdf')}
                  title="The full briefing — synthesis, per-pillar analysis, task list and the data behind it.">
                  {downloading === 'internal.pdf' ? 'Preparing…' : '↓ Briefing (PDF)'}
                </button>
                <button className="btn btn-secondary btn-sm" disabled={!!downloading} onClick={() => downloadReport('client', 'docx')}
                  title="A client-ready progress report you can edit in Word before sending. First download takes ~20s while Claude writes it.">
                  {downloading === 'client.docx' ? 'Writing client draft…' : '↓ Client draft (Word)'}
                </button>
                <span className="caption" style={{ color: 'var(--text-subtle)' }}>Client draft is reframed for the client — edit before sending.</span>
              </div>

              {/* Synthesis */}
              <div className="card body-sm" style={{ marginBottom: 14 }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{selected.synthesis || ''}</ReactMarkdown>
              </div>

              {/* Pillar filter */}
              <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                {PILLARS.map(p => (
                  <button key={p.key} onClick={() => setPillar(p.key)}
                    style={{ padding: '5px 14px', borderRadius: 'var(--r-pill)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                      border: 'var(--border-w) solid ' + (pillar === p.key ? 'var(--text)' : 'var(--card-border)'),
                      background: pillar === p.key ? 'var(--text)' : 'var(--surface)', color: pillar === p.key ? '#fff' : 'var(--text)' }}>
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Task list */}
              {visibleRecs.length > 0 && (
                <div className="card body-sm" style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                    Task list — {visibleRecs.filter(r => r.done).length} of {visibleRecs.length} done
                  </div>
                  {crucial.length > 0 && <div className="caption" style={{ margin: '4px 0 4px' }}>Crucial</div>}
                  {crucial.map(r => <RecRow key={r.id} r={r} onToggle={toggleAction} pillarFilter={pillar} />)}
                  {nice.length > 0 && <div className="caption" style={{ margin: '12px 0 4px' }}>Nice to have</div>}
                  {nice.map(r => <RecRow key={r.id} r={r} onToggle={toggleAction} pillarFilter={pillar} />)}
                </div>
              )}

              {/* Per-pillar sections */}
              {visibleSections.map(s => (
                <div className="card body-sm" key={s.pillar} style={{ marginBottom: 10 }}>
                  <button onClick={() => toggleSection(s.pillar)} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, fontSize: 15, cursor: 'pointer', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18, width: 16, display: 'inline-block' }}>{openSections.has(s.pillar) ? '−' : '+'}</span>
                    {PILLAR_LABEL[s.pillar] || s.pillar}
                    {!s.ok && <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-subtle)' }}>· no data</span>}
                  </button>
                  {openSections.has(s.pillar) && s.ok && (
                    <div style={{ marginTop: 10 }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{s.markdown || ''}</ReactMarkdown>
                    </div>
                  )}
                </div>
              ))}

              {/* Monday recipients */}
              <div className="card" style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 260 }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Monday email recipients</label>
                  <input type="text" value={recipients} onChange={e => { setRecipients(e.target.value); setRecipientsDirty(true); }} placeholder="you@octobercomms.com"
                    style={{ width: '100%', padding: '6px 10px', fontSize: 13, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }} />
                </div>
                {recipientsDirty && <button onClick={saveRecipients} className="btn btn-secondary btn-sm">Save</button>}
              </div>
            </>)}
          </div>
        </div>
      )}
      </>
    );
  }
}

function RecRow({ r, onToggle, pillarFilter }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--card-border)' }}>
      <input type="checkbox" checked={r.done} onChange={() => onToggle(r)} style={{ marginTop: 3, cursor: 'pointer' }} />
      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.45, color: r.done ? 'var(--text-subtle)' : 'var(--text)', textDecoration: r.done ? 'line-through' : 'none' }}>
        {pillarFilter === 'all' && r.pillar && (
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-subtle)', marginRight: 6 }}>
            {PILLAR_LABEL[r.pillar] || r.pillar}
          </span>
        )}
        {r.text}
      </div>
    </div>
  );
}

function fmtDate(d) { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
function fmtRelative(d) {
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (days < 1) return 'today'; if (days < 2) return 'yesterday'; if (days < 14) return `${days} days ago`;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const mdComponents = {
  h1: ({ node, ...p }) => <h1 style={{ fontSize: 20, fontWeight: 700, margin: '18px 0 10px' }} {...p} />,
  h2: ({ node, ...p }) => <h2 style={{ fontSize: 16, fontWeight: 700, margin: '20px 0 10px', paddingBottom: 6, borderBottom: '1px solid var(--card-border)' }} {...p} />,
  h3: ({ node, ...p }) => <h3 style={{ fontSize: 14, fontWeight: 700, margin: '16px 0 8px' }} {...p} />,
  p: ({ node, ...p }) => <p style={{ margin: '0 0 12px', lineHeight: 1.6, fontSize: 14 }} {...p} />,
  ul: ({ node, ...p }) => <ul style={{ margin: '0 0 12px', paddingLeft: 22 }} {...p} />,
  ol: ({ node, ...p }) => <ol style={{ margin: '0 0 12px', paddingLeft: 22 }} {...p} />,
  li: ({ node, ...p }) => <li style={{ marginBottom: 6, lineHeight: 1.55, fontSize: 14 }} {...p} />,
  table: ({ node, ...p }) => <div className="md-table-wrap"><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} {...p} /></div>,
  th: ({ node, ...p }) => <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid var(--text)', fontWeight: 700, fontSize: 12 }} {...p} />,
  td: ({ node, ...p }) => <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--card-border)', verticalAlign: 'top' }} {...p} />,
};
