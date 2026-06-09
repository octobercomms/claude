import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

function fmtDate(d) {
  if (!d) return '—';
  const t = new Date(d);
  return isNaN(t) ? d : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Client-scoped PR coverage — a tab within a client (like Organic / Paid / Email).
export default function ClientPRPage() {
  const { id } = useParams();
  const toast = useToast();
  const [client, setClient] = useState(null);
  const [tab, setTab] = useState('coverage');
  const [log, setLog] = useState([]);
  const [journalists, setJournalists] = useState([]);
  const [portal, setPortal] = useState(null);
  const [notConnected, setNotConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/clients/${id}`).then(setClient).catch((e) => toast(e.message, 'error'));
  }, [id]);

  useEffect(() => {
    if (!client) return;
    const name = client.name || '';
    const q = `?client=${encodeURIComponent(name)}`;
    setLoading(true);
    Promise.all([
      api.get(`/pr/editorial-log${q}`).then((r) => setLog(r.items || [])),
      api.get(`/pr/journalists${q}`).then((r) => setJournalists(r.items || [])),
      api.get('/pr/clients').then((r) => {
        const match = (r.items || []).find((c) => (c.name || '').toLowerCase() === name.toLowerCase());
        setPortal(match || null);
      }),
    ])
      .catch((e) => {
        if (/not connected/i.test(e.message)) setNotConnected(true);
        else toast(e.message, 'error');
      })
      .finally(() => setLoading(false));
  }, [client]);

  if (notConnected) {
    return (
      <div className="suite-client-pr">
        <div className="kicker"><span className="pip" /><span>{client?.name && <><span className="kicker-name">{client.name}</span> • </>}Press coverage</span></div>
        <header className="hero"><h1 className="display">PR</h1></header>
        <div className="card" style={{ padding: 32 }}>
          <h3>PR module not connected</h3>
          <p style={{ color: 'var(--text-subtle)' }}>
            Set <code>OMI_BASE</code> and <code>OMI_KEY</code> (the PR API key from October Outreach → Settings)
            in the platform settings to surface this client's coverage here.
          </p>
        </div>
      </div>
    );
  }

  const published = log.filter((r) => r.status === 'published' || r.status === 'download').length;

  return (
    <div className="suite-client-pr">
      <div className="kicker"><span className="pip" /><span>{client?.name && <><span className="kicker-name">{client.name}</span> • </>}Press coverage &amp; journalists</span></div>
      <header className="hero" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
        <h1 className="display">PR</h1>
        {portal && portal.portal_url && (
          <a className="btn btn-secondary" href={portal.portal_url} target="_blank" rel="noreferrer">Open client coverage page →</a>
        )}
      </header>

      <div className="card" style={{ display: 'flex', gap: 'var(--s6)', flexWrap: 'wrap', marginBottom: 'var(--s4)' }}>
        <div><div style={{ fontSize: 28, fontWeight: 700 }}>{published}</div><div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Published</div></div>
        <div><div style={{ fontSize: 28, fontWeight: 700 }}>{log.length}</div><div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Tracked</div></div>
        <div><div style={{ fontSize: 28, fontWeight: 700 }}>{journalists.length}</div><div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Journalists</div></div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--s4)' }}>
        <button onClick={() => setTab('coverage')} className={'btn ' + (tab === 'coverage' ? 'btn-primary' : 'btn-secondary')}>Coverage</button>
        <button onClick={() => setTab('journalists')} className={'btn ' + (tab === 'journalists' ? 'btn-primary' : 'btn-secondary')}>Journalists</button>
      </div>

      <div className="card">
        {loading ? (
          <p style={{ color: 'var(--text-subtle)', padding: 24 }}>Loading…</p>
        ) : tab === 'coverage' ? (
          <table className="table">
            <thead><tr><th>Publication</th><th>Journalist</th><th>Status</th><th>Date</th><th>Story</th></tr></thead>
            <tbody>
              {log.map((r) => (
                <tr key={r.id}>
                  <td>{r.outlet || '—'}</td>
                  <td>{r.journalist || '—'}</td>
                  <td><span className="chip">{r.status_label || r.status}</span></td>
                  <td>{fmtDate(r.issue_date)}</td>
                  <td>{r.story_url ? <a href={r.story_url} target="_blank" rel="noreferrer">{(r.story_title || 'View').slice(0, 60)}</a> : (r.story_title || '—')}</td>
                </tr>
              ))}
              {!log.length && <tr><td colSpan={5} style={{ color: 'var(--text-subtle)', padding: 24 }}>No coverage logged for {client?.name || 'this client'} yet. (Check the client name matches your editorial log.)</td></tr>}
            </tbody>
          </table>
        ) : (
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
              {!journalists.length && <tr><td colSpan={6} style={{ color: 'var(--text-subtle)', padding: 24 }}>No journalists have covered {client?.name || 'this client'} yet.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
