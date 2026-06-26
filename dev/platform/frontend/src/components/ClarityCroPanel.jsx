// Sales & Traffic → CRO / Funnel. Connects a client's free Microsoft Clarity
// project and turns its behaviour signals (rage clicks, dead clicks, excessive
// scroll, quick-backs, scroll depth, errors) into prioritised, concrete CRO
// fixes from Claude — the "your ads are fine, your funnel leaks" diagnosis.
//
// The results read as an action checklist: a severity donut + fix-progress at
// the top, then collapsible cards (critical open by default) with a checkbox
// that persists done-state server-side so the whole team shares one list.

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

const PRI = {
  critical: { label: 'Critical', color: '#b3261e', bg: 'rgba(179,38,30,0.10)' },
  high:     { label: 'High',     color: '#d1581e', bg: 'rgba(209,88,30,0.10)' },
  medium:   { label: 'Medium',   color: '#9a6b00', bg: 'rgba(154,107,0,0.10)' },
};
const ORDER = ['critical', 'high', 'medium'];
const CLAMP2 = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' };

function fmt(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ts; }
}
function shortUrl(u) {
  try { const x = new URL(u); return x.host.replace(/^www\./, '') + x.pathname + x.search; } catch { return u; }
}

function PriChip({ p }) {
  return <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, color: p.color, background: p.bg, padding: '2px 8px', borderRadius: 999, flex: '0 0 auto' }}>{p.label}</span>;
}

export default function ClarityCroPanel({ clientId }) {
  const toast = useToast();
  const [config, setConfig] = useState(null);
  const [report, setReport] = useState(null);
  const [running, setRunning] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState({});

  async function load() {
    try {
      const [c, r] = await Promise.all([
        api.get(`/clarity/clients/${clientId}/config`),
        api.get(`/clarity/clients/${clientId}/report`),
      ]);
      setConfig(c); setReport(r.report || null);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoaded(true); }
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [clientId]);

  // Open critical findings by default when a (new) report loads.
  useEffect(() => {
    if (report?.findings) {
      const init = {};
      report.findings.forEach((f, i) => { init[i] = f.priority === 'critical'; });
      setExpanded(init);
    }
  }, [report?.id]);

  async function runScan() {
    setRunning(true);
    try {
      const r = await api.post(`/clarity/clients/${clientId}/report/run`, {});
      setReport(r.report);
      toast('CRO scan complete.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setRunning(false); }
  }

  async function toggleDone(i, next) {
    setReport(r => ({ ...r, findings: r.findings.map((f, idx) => idx === i ? { ...f, done: next } : f) }));
    try {
      await api.patch(`/clarity/clients/${clientId}/report/${report.id}/findings/${i}`, { done: next });
    } catch (e) {
      toast(e.message, 'error');
      setReport(r => ({ ...r, findings: r.findings.map((f, idx) => idx === i ? { ...f, done: !next } : f) }));
    }
  }

  if (!loaded) return <div className="text-subtle" style={{ padding: 20 }}>Loading…</div>;

  const findings = report?.findings || [];
  const total = findings.length;
  const doneCount = findings.filter(f => f.done).length;
  const counts = { critical: 0, high: 0, medium: 0 };
  findings.forEach(f => { counts[f.priority] = (counts[f.priority] || 0) + 1; });
  const sevData = ORDER.map(k => ({ name: PRI[k].label, value: counts[k], color: PRI[k].color })).filter(d => d.value > 0);
  const pct = total ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div>
      <p className="body mb-4" style={{ maxWidth: 760 }}>
        Microsoft Clarity is a free behaviour-analytics tool (heatmaps + session recordings). Claude reads the signals
        that reveal where your funnel leaks — rage clicks, dead clicks, excessive scrolling, quick-backs — and returns
        prioritised, concrete fixes. Perfect for "the ads are working but it's not converting".
      </p>

      {!config?.connected ? (
        <div className="callout">
          <strong>Microsoft Clarity isn't connected yet.</strong> Connect it under{' '}
          <Link to={`/clients/${clientId}?tab=connectors`} style={{ textDecoration: 'underline', fontWeight: 700 }}>Setup → Connectors</Link>
          {' '}(Behaviour Analytics), then come back here to run the CRO scan.
        </div>
      ) : (
        <>
          <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div className="caption">Microsoft Clarity</div>
              <div className="body-sm" style={{ marginTop: 2 }}>
                <span style={{ color: 'var(--positive, #1a7f37)', fontWeight: 600 }}>Connected</span>
                {report && <span className="text-subtle"> · last scan {fmt(report.generated_at)}</span>}
              </div>
            </div>
            <button className="btn btn-primary" onClick={runScan} disabled={running}>{running ? 'Scanning…' : (report ? 'Re-scan funnel' : 'Run CRO scan')}</button>
          </div>

          {!report ? (
            <p className="body-sm text-subtle" style={{ marginTop: 14 }}>No scan yet — run a CRO scan to pull the last 3 days of behaviour data and get prioritised fixes.</p>
          ) : (
            <>
              {/* Overview: summary + severity donut + fix progress */}
              <div className="grid grid-2" style={{ marginTop: 16, alignItems: 'stretch' }}>
                <div className="card">
                  <div className="caption caption-muted" style={{ marginBottom: 8 }}>Funnel health</div>
                  <p className="body" style={{ margin: 0 }}>{report.summary || '—'}</p>
                </div>
                <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                  <div style={{ position: 'relative', width: 132, height: 132, flex: '0 0 auto' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={sevData.length ? sevData : [{ name: 'none', value: 1, color: 'var(--card-border)' }]}
                          dataKey="value" nameKey="name" innerRadius={46} outerRadius={64} paddingAngle={sevData.length > 1 ? 2 : 0} stroke="none">
                          {(sevData.length ? sevData : [{ color: 'var(--card-border)' }]).map((d, i) => <Cell key={i} fill={d.color} />)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                      <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1 }}>{total}</div>
                      <div className="body-xs text-subtle">issue{total === 1 ? '' : 's'}</div>
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    {ORDER.filter(k => counts[k]).map(k => (
                      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 999, background: PRI[k].color, flex: '0 0 auto' }} />
                        <span className="body-sm">{PRI[k].label}</span>
                        <span className="body-sm text-subtle" style={{ marginLeft: 'auto', fontWeight: 700 }}>{counts[k]}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--card-border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                        <span className="body-sm" style={{ fontWeight: 600 }}>Fixes done</span>
                        <span className="body-sm text-subtle">{doneCount} / {total}</span>
                      </div>
                      <div style={{ height: 8, borderRadius: 999, background: 'var(--surface-sunken)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--positive)', borderRadius: 999, transition: 'width .25s ease' }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action list */}
              <div className="section-head" style={{ marginTop: 24 }}>
                <div className="caption">Action points</div>
                <span className="body-xs text-subtle">Tick each fix as you ship it</span>
              </div>
              <div className="stack stack-sm">
                {findings.map((f, i) => {
                  const p = PRI[f.priority] || PRI.medium;
                  const open = !!expanded[i];
                  return (
                    <div key={i} className="card" style={{ padding: 0, overflow: 'hidden', borderLeft: `4px solid ${p.color}`, opacity: f.done ? 0.6 : 1, transition: 'opacity .15s' }}>
                      <div onClick={() => setExpanded(e => ({ ...e, [i]: !e[i] }))}
                        style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={!!f.done}
                          onChange={e => toggleDone(i, e.target.checked)} onClick={e => e.stopPropagation()}
                          style={{ marginTop: 2, width: 18, height: 18, accentColor: 'var(--accent)', flex: '0 0 auto', cursor: 'pointer' }} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
                            <PriChip p={p} />
                            {f.url && <a href={f.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                              className="body-xs" title={f.url}
                              style={{ color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{shortUrl(f.url)}</a>}
                          </div>
                          <div className="body-sm" style={{ textDecoration: f.done ? 'line-through' : 'none', ...(open ? {} : CLAMP2) }}>{f.issue}</div>
                          {open && f.fix && (
                            <div className="body-sm" style={{ marginTop: 10, padding: '10px 12px', background: 'var(--surface-sunken)', borderRadius: 'var(--r-sm)' }}>
                              <strong style={{ color: p.color }}>Fix:</strong> {f.fix}
                            </div>
                          )}
                        </div>
                        <span style={{ flex: '0 0 auto', color: 'var(--text-subtle)', fontSize: 12, marginTop: 2, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▾</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
