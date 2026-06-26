// Sales & Traffic → CRO / Funnel. Turns each connected Microsoft Clarity site's
// behaviour signals into prioritised, concrete CRO fixes from Claude.
//
// A client can have several Clarity sites (e.g. Falcon Enamelware DTC / Trade).
// A site selector switches between them; "All sites" shows a combined action
// list with a site flag on every finding. Scans run per site. Done-state on
// each fix persists server-side (shared team checklist).

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { getCountryFlag } from '../utils/connectorLabels';

const PRI = {
  critical: { label: 'Critical', color: '#b3261e', bg: 'rgba(179,38,30,0.10)', rank: 0 },
  high:     { label: 'High',     color: '#d1581e', bg: 'rgba(209,88,30,0.10)', rank: 1 },
  medium:   { label: 'Medium',   color: '#9a6b00', bg: 'rgba(154,107,0,0.10)', rank: 2 },
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
function statsOf(findings) {
  const counts = { critical: 0, high: 0, medium: 0 };
  findings.forEach(f => { counts[f.priority] = (counts[f.priority] || 0) + 1; });
  const total = findings.length;
  const done = findings.filter(f => f.done).length;
  const sevData = ORDER.map(k => ({ name: PRI[k].label, value: counts[k], color: PRI[k].color })).filter(d => d.value > 0);
  return { counts, total, done, pct: total ? Math.round((done / total) * 100) : 0, sevData };
}

function SiteChip({ label }) {
  const flag = getCountryFlag(label);
  return <span className="chip chip-neutral" style={{ fontSize: 10 }}>{flag ? `${flag} ` : ''}{label}</span>;
}

function Overview({ summary, findings }) {
  const { counts, total, done, pct, sevData } = statsOf(findings);
  return (
    <div className="grid grid-2" style={{ marginTop: 16, alignItems: 'stretch' }}>
      <div className="card">
        <div className="caption caption-muted" style={{ marginBottom: 8 }}>Funnel health</div>
        <p className="body" style={{ margin: 0 }}>{summary || '—'}</p>
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
              <span className="body-sm text-subtle">{done} / {total}</span>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: 'var(--surface-sunken)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: 'var(--positive)', borderRadius: 999, transition: 'width .25s ease' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FindingCard({ f, open, onToggleExpand, onToggleDone, showSite }) {
  const p = PRI[f.priority] || PRI.medium;
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', borderLeft: `4px solid ${p.color}`, opacity: f.done ? 0.6 : 1, transition: 'opacity .15s' }}>
      <div onClick={onToggleExpand} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', cursor: 'pointer' }}>
        <input type="checkbox" checked={!!f.done} onChange={e => onToggleDone(e.target.checked)} onClick={e => e.stopPropagation()}
          style={{ marginTop: 2, width: 18, height: 18, accentColor: 'var(--accent)', flex: '0 0 auto', cursor: 'pointer' }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, color: p.color, background: p.bg, padding: '2px 8px', borderRadius: 999, flex: '0 0 auto' }}>{p.label}</span>
            {showSite && f.site && <SiteChip label={f.site} />}
            {f.url && <a href={f.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="body-xs" title={f.url}
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
}

export default function ClarityCroPanel({ clientId }) {
  const toast = useToast();
  const [sites, setSites] = useState(null);
  const [reports, setReports] = useState([]);     // latest report per site
  const [selected, setSelected] = useState('all'); // 'all' | siteId
  const [running, setRunning] = useState(null);    // siteId currently scanning
  const [expanded, setExpanded] = useState({});    // key `${reportId}:${i}` -> bool
  const [loaded, setLoaded] = useState(false);

  async function load() {
    try {
      const [s, r] = await Promise.all([
        api.get(`/clarity/clients/${clientId}/sites`),
        api.get(`/clarity/clients/${clientId}/reports`),
      ]);
      const siteList = s.sites || [];
      setSites(siteList);
      setReports(r.reports || []);
      setSelected(siteList.length === 1 ? siteList[0].id : 'all');
    } catch (e) { toast(e.message, 'error'); setSites([]); }
    finally { setLoaded(true); }
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [clientId]);

  // Open critical findings by default when reports change.
  useEffect(() => {
    const init = {};
    reports.forEach(r => (r.findings || []).forEach((f, i) => { init[`${r.id}:${i}`] = f.priority === 'critical'; }));
    setExpanded(init);
  }, [reports]);

  async function runScan(siteId) {
    setRunning(siteId);
    try {
      const r = await api.post(`/clarity/clients/${clientId}/sites/${siteId}/report/run`, {});
      setReports(prev => {
        const others = prev.filter(x => x.clarity_id !== r.report.clarity_id);
        return [...others, r.report];
      });
      toast('CRO scan complete.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setRunning(null); }
  }

  async function toggleDone(reportId, i, next) {
    setReports(prev => prev.map(r => r.id === reportId ? { ...r, findings: r.findings.map((f, idx) => idx === i ? { ...f, done: next } : f) } : r));
    try {
      await api.patch(`/clarity/clients/${clientId}/report/${reportId}/findings/${i}`, { done: next });
    } catch (e) {
      toast(e.message, 'error');
      setReports(prev => prev.map(r => r.id === reportId ? { ...r, findings: r.findings.map((f, idx) => idx === i ? { ...f, done: !next } : f) } : r));
    }
  }

  if (!loaded) return <div className="text-subtle" style={{ padding: 20 }}>Loading…</div>;

  if (!sites.length) {
    return (
      <div>
        <p className="body mb-4" style={{ maxWidth: 760 }}>
          Microsoft Clarity reads behaviour signals — rage clicks, dead clicks, excessive scrolling, quick-backs — and Claude
          turns them into prioritised, concrete fixes. Perfect for "the ads are working but it's not converting".
        </p>
        <div className="callout">
          <strong>No Microsoft Clarity site connected yet.</strong> Add one under{' '}
          <Link to={`/clients/${clientId}?tab=connectors`} style={{ textDecoration: 'underline', fontWeight: 700 }}>Setup → Connectors</Link>
          {' '}(Behaviour Analytics) — you can connect several sites — then come back here to run the scan.
        </div>
      </div>
    );
  }

  const reportBySite = {};
  reports.forEach(r => { reportBySite[r.clarity_id] = r; });

  // Findings for the current view (a single site, or all sites tagged).
  const viewFindings = selected === 'all'
    ? reports.flatMap(r => (r.findings || []).map((f, i) => ({ ...f, site: r.site_label, reportId: r.id, idx: i })))
        .sort((a, b) => (PRI[a.priority]?.rank ?? 9) - (PRI[b.priority]?.rank ?? 9))
    : (reportBySite[selected]?.findings || []).map((f, i) => ({ ...f, reportId: reportBySite[selected].id, idx: i }));

  const selectedSite = selected !== 'all' ? sites.find(s => String(s.id) === String(selected)) : null;
  const selectedReport = selected !== 'all' ? reportBySite[selected] : null;
  const tabs = [{ key: 'all', label: 'All sites' }, ...sites.map(s => ({ key: String(s.id), label: s.label, flag: getCountryFlag(s.label) }))];

  return (
    <div>
      {/* Site selector */}
      {sites.length > 1 && (
        <div className="tabs" style={{ marginTop: 0 }}>
          {tabs.map(t => (
            <button key={t.key} className={`tab ${String(selected) === t.key ? 'active' : ''}`} onClick={() => setSelected(t.key === 'all' ? 'all' : Number(t.key))}>
              {t.flag ? `${t.flag} ` : ''}{t.label}
            </button>
          ))}
        </div>
      )}

      {/* Per-site header with the scan control */}
      {selected !== 'all' && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="caption">Microsoft Clarity{selectedSite ? ` · ${selectedSite.label}` : ''}</div>
            <div className="body-sm text-subtle" style={{ marginTop: 2 }}>
              {selectedReport ? `Last scan ${fmt(selectedReport.generated_at)}` : 'No scan yet'}
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => runScan(selected)} disabled={running === selected}>
            {running === selected ? 'Scanning…' : (selectedReport ? 'Re-scan funnel' : 'Run CRO scan')}
          </button>
        </div>
      )}

      {viewFindings.length === 0 ? (
        <p className="body-sm text-subtle" style={{ marginTop: 14 }}>
          {selected === 'all'
            ? 'No scans yet. Pick a site above and run a CRO scan to pull the last 3 days of behaviour data.'
            : 'No scan yet — run a CRO scan to pull the last 3 days of behaviour data and get prioritised fixes.'}
        </p>
      ) : (
        <>
          <Overview summary={selected === 'all' ? `Across ${reports.length} site${reports.length === 1 ? '' : 's'}.` : (selectedReport?.summary)} findings={viewFindings} />

          <div className="section-head" style={{ marginTop: 24 }}>
            <div className="caption">Action points</div>
            <span className="body-xs text-subtle">Tick each fix as you ship it</span>
          </div>
          <div className="stack stack-sm">
            {viewFindings.map(f => {
              const key = `${f.reportId}:${f.idx}`;
              return (
                <FindingCard key={key} f={f} showSite={selected === 'all'}
                  open={!!expanded[key]}
                  onToggleExpand={() => setExpanded(e => ({ ...e, [key]: !e[key] }))}
                  onToggleDone={(next) => toggleDone(f.reportId, f.idx, next)} />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
