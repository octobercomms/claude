import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../context/AuthContext';

export default function ClientsPage() {
  const { readOnly, user } = useAuth();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newClient, setNewClient] = useState({ name: '', slug: '' });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  // Filter — default to Active so the day-to-day list stays tidy. Inactive
  // clients are historical records the AM keeps around for the editorial-log
  // / publications history, not for active work.
  const [filter, setFilter] = useState('active'); // 'active' | 'archived' | 'all'

  useEffect(() => {
    api.get('/clients').then(setClients).finally(() => setLoading(false));
  }, []);

  const visible = clients.filter(c => {
    if (filter === 'active') return c.active;
    if (filter === 'archived') return !c.active;
    return true;
  });
  const archivedCount = clients.filter(c => !c.active).length;

  function autoSlug(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  async function handleCreate(e) {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      const created = await api.post('/clients', newClient);
      setClients(prev => [...prev, created]);
      setShowNew(false);
      setNewClient({ name: '', slug: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  // A client (read-only) login must never see the all-clients directory or the
  // "+ New Client" action — bounce them into their own client (or dashboard).
  if (readOnly) return <Navigate to={user?.client_id ? `/clients/${user.client_id}/sales-traffic` : '/dashboard'} replace />;

  if (loading) return <div style={{ color: 'var(--text-subtle)', padding: 40 }}>Loading…</div>;

  return (
    <div>
      <div className="kicker"><span className="pip" />Client directory</div>
      <header className="hero">
        <div>
          <h1 className="display">Clients</h1>
        </div>
        <div className="hero-actions" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {['active', 'archived', 'all'].map(k => (
            <button key={k} type="button"
              onClick={() => setFilter(k)}
              className={`btn btn-sm ${filter === k ? 'btn-primary' : 'btn-secondary'}`}
              style={{ textTransform: 'capitalize' }}>
              {k}
              {k === 'archived' && archivedCount ? ` (${archivedCount})` : ''}
            </button>
          ))}
          <button onClick={() => setShowNew(true)} className="btn btn-primary btn-sm" style={{ marginLeft: 6 }}>+ New Client</button>
        </div>
      </header>

      {showNew && (
        <div className="card">
          <h3 style={{ margin: '0 0 16px', fontSize: 15 }}>New Client</h3>
          <form onSubmit={handleCreate} >
            {error && <div className="text-negative">{error}</div>}
            <div >
              <div className="field">
                <label className="field-label">Client Name</label>
                <input
                  className="input" value={newClient.name} required
                  onChange={e => setNewClient(p => ({ ...p, name: e.target.value, slug: autoSlug(e.target.value) }))}
                />
              </div>
              <div className="field">
                <label className="field-label">Slug</label>
                <input
                  className="input" value={newClient.slug} required
                  onChange={e => setNewClient(p => ({ ...p, slug: e.target.value }))}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={creating}>{creating ? 'Creating…' : 'Create'}</button>
              <button type="button" onClick={() => setShowNew(false)} className="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              {['Name', 'Slug', 'Status', ''].map(h => <th key={h} >{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {visible.map(c => (
              <tr key={c.id} style={{ opacity: c.active ? 1 : 0.7 }}>
                <td ><strong>{c.name}</strong></td>
                <td><code className="text-subtle" style={{ fontSize: 12 }}>{c.slug}</code></td>
                <td>
                  <span className={c.active ? 'text-positive' : 'text-subtle'} style={{ fontSize: 12 }}>
                    {c.active ? 'Active' : 'Archived'}
                  </span>
                </td>
                <td className="num">
                  <Link to={`/clients/${c.id}/sales-traffic`} className="text-accent" style={{ fontWeight: 600 }}>Manage →</Link>
                </td>
              </tr>
            ))}
            {!visible.length && (
              <tr><td colSpan={4} style={{ padding: 24, color: 'var(--text-subtle)', textAlign: 'center' }}>
                No {filter === 'archived' ? 'archived' : filter === 'active' ? 'active' : ''} clients.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

