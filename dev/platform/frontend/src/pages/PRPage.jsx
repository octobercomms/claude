import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

const TABS = [
  { key: 'log', label: 'Editorial Log' },
  { key: 'journalists', label: 'Journalists' },
  { key: 'clients', label: 'Clients' },
];

function fmtDate(d) {
  if (!d) return '—';
  const t = new Date(d);
  return isNaN(t) ? d : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function PRPage() {
  const toast = useToast();
  const [tab, setTab] = useState('log');
  const [stats, setStats] = useState(null);
  const [notConnected, setNotConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  // data per tab
  const [log, setLog] = useState([]);
  const [journalists, setJournalists] = useState([]);
  const [clients, setClients] = useState([]);
  const [clientFilter, setClientFilter] = useState('');

  useEffect(() => {
    api.get('/pr/stats')
      .then(setStats)
      .catch((e) => {
        if (/not connected/i.test(e.message)) setNotConnected(true);
        else toast(e.message, 'error');
      });
  }, []);

  // Load client list once (for the filter dropdown).
  useEffect(() => {
    api.get('/pr/clients').then((r) => setClients(r.items || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (notConnected) { setLoading(false); return; }
    setLoading(true);
    const q = clientFilter ? `?client=${encodeURIComponent(clientFilter)}` : '';
    const req =
      tab === 'log' ? api.get(`/pr/editorial-log${q}`).then((r) => setLog(r.items || []))
      : tab === 'journalists' ? api.get(`/pr/journalists${q}`).then((r) => setJournalists(r.items || []))
      : Promise.resolve();
    req.catch((e) => toast(e.message, 'error')).finally(() => setLoading(false));
  }, [tab, clientFilter, notConnected]);

  if (notConnected) {
    return (
      <div className="suite-pr">
        <header className="hero"><h1 className="display">PR</h1></header>
        <div className="card" style={{ padding: 32 }}>
          <h3>PR module not connected</h3>
          <p style={{ color: 'var(--text-subtle)' }}>
            Add <code>OMI_BASE</code> and <code>OMI_KEY</code> (the PR API key from October Outreach → Settings)
            in the platform settings to surface the editorial log, journalists and client coverage here.
          </p>
        </div>
      </div>
    );
  }

  const statCards = stats ? [
    { label: 'Log entries', value: stats.log_entries },
    { label: 'Published', value: stats.published },
    { label: 'Pending review', value: stats.pending_review },
    { label: 'Journalists', value: stats.journalists },
    { label: 'Outlets', value: stats.outlets },
    { label: 'Clients', value: stats.clients },
  ] : [];

  return (
    <div className="suite-pr">
      <header className="hero"><h1 className="display">PR</h1></header>

      {stats && (
        <div className="card" style={{ display: 'flex', gap: 'var(--s6)', flexWrap: 'wrap', marginBottom: 'var(--s4)' }}>
          {statCards.map((s) => (
            <div key={s.label}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{s.value ?? '—'}</div>
              <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--s4)', alignItems: 'center', marginBottom: 'var(--s4)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={'btn ' + (tab === t.key ? 'btn-primary' : 'btn-secondary')}>{t.label}</button>
          ))}
        </div>
        {(tab === 'log' || tab === 'journalists') && (
          <select className="input" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} style={{ width: 220 }}>
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        )}
      </div>

      <div className="card">
        {loading ? (
          <p style={{ color: 'var(--text-subtle)', padding: 24 }}>Loading…</p>
        ) : tab === 'log' ? (
          <table className="table">
            <thead><tr><th>Client</th><th>Publication</th><th>Journalist</th><th>Status</th><th>Date</th><th>Story</th></tr></thead>
            <tbody>
              {log.map((r) => (
                <tr key={r.id}>
                  <td>{r.client || '—'}</td>
                  <td>{r.outlet || '—'}</td>
                  <td>{r.journalist || '—'}</td>
                  <td><span className="chip">{r.status_label || r.status}</span></td>
                  <td>{fmtDate(r.issue_date)}</td>
                  <td>{r.story_url ? <a href={r.story_url} target="_blank" rel="noreferrer">{(r.story_title || 'View').slice(0, 60)}</a> : (r.story_title || '—')}</td>
                </tr>
              ))}
              {!log.length && <tr><td colSpan={6} style={{ color: 'var(--text-subtle)', padding: 24 }}>No coverage yet.</td></tr>}
            </tbody>
          </table>
        ) : tab === 'journalists' ? (
          <table className="table">
            <thead><tr><th>Journalist</th><th>Outlet</th><th>Published</th><th>Hit rate</th><th>Last featured</th><th>Relationship</th></tr></thead>
            <tbody>
              {journalists.map((j) => (
                <tr key={j.id}>
                  <td>{j.name}</td>
                  <td>{j.outlet || '—'}</td>
                  <td>{j.published}</td>
                  <td>{j.hit_rate == null ? '—' : Math.round(j.hit_rate * 100) + '%'}</td>
                  <td>{fmtDate(j.last_featured)}</td>
                  <td><span className="chip chip-accent">{j.strength} · {j.strength_label}</span>{j.gone_quiet ? <span className="chip" style={{ marginLeft: 6 }}>quiet</span> : null}</td>
                </tr>
              ))}
              {!journalists.length && <tr><td colSpan={6} style={{ color: 'var(--text-subtle)', padding: 24 }}>No journalists yet.</td></tr>}
            </tbody>
          </table>
        ) : (
          <table className="table">
            <thead><tr><th>Client</th><th>Published</th><th>Portal</th></tr></thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.published}</td>
                  <td>{c.portal_url ? <a href={c.portal_url} target="_blank" rel="noreferrer">Open portal →</a> : '—'}</td>
                </tr>
              ))}
              {!clients.length && <tr><td colSpan={3} style={{ color: 'var(--text-subtle)', padding: 24 }}>No clients yet.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
