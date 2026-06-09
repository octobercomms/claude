import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

function fmtDate(d) {
  if (!d) return '—';
  const t = new Date(d);
  return isNaN(t) ? d : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Client-scoped PR coverage — native to the platform (no WordPress dependency).
export default function ClientPRPage() {
  const { id } = useParams();
  const toast = useToast();
  const fileRef = useRef(null);
  const [client, setClient] = useState(null);
  const [tab, setTab] = useState('coverage');
  const [stats, setStats] = useState(null);
  const [log, setLog] = useState([]);
  const [journalists, setJournalists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    api.get(`/clients/${id}`).then(setClient).catch((e) => toast(e.message, 'error'));
  }, [id]);

  function loadData() {
    setLoading(true);
    Promise.all([
      api.get(`/pr/clients/${id}/stats`).then(setStats),
      api.get(`/pr/clients/${id}/editorial-log`).then((r) => setLog(r.items || [])),
      api.get(`/pr/clients/${id}/journalists`).then((r) => setJournalists(r.items || [])),
    ]).catch((e) => toast(e.message, 'error')).finally(() => setLoading(false));
  }
  useEffect(() => { loadData(); }, [id]);

  async function handleImport(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.postForm(`/pr/clients/${id}/import`, fd);
      toast(`Imported ${r.imported} rows`, 'success');
      loadData();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="suite-client-pr">
      <div className="kicker"><span className="pip" /><span>{client?.name && <><span className="kicker-name">{client.name}</span> • </>}Press coverage &amp; journalists</span></div>
      <header className="hero" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
        <h1 className="display">PR</h1>
        <div>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleImport} style={{ display: 'none' }} />
          <button className="btn btn-secondary" disabled={importing} onClick={() => fileRef.current && fileRef.current.click()}>
            {importing ? 'Importing…' : '↑ Import editorial log CSV'}
          </button>
        </div>
      </header>

      <div className="card" style={{ display: 'flex', gap: 'var(--s6)', flexWrap: 'wrap', marginBottom: 'var(--s4)' }}>
        <div><div style={{ fontSize: 28, fontWeight: 700 }}>{stats ? stats.published : '—'}</div><div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Published</div></div>
        <div><div style={{ fontSize: 28, fontWeight: 700 }}>{stats ? stats.tracked : '—'}</div><div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Tracked</div></div>
        <div><div style={{ fontSize: 28, fontWeight: 700 }}>{stats ? stats.journalists : '—'}</div><div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Journalists</div></div>
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
              {!log.length && <tr><td colSpan={5} style={{ color: 'var(--text-subtle)', padding: 24 }}>No coverage yet. Import your editorial log CSV to get started.</td></tr>}
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
