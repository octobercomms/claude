import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';

export default function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newClient, setNewClient] = useState({ name: '', slug: '' });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/clients').then(setClients).finally(() => setLoading(false));
  }, []);

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

  if (loading) return <div style={{ color: '#888', padding: 40 }}>Loading…</div>;

  return (
    <div>
      <header className="hero">
        <div>
          <h1 className="display">Clients</h1>
        </div>
        <div className="hero-actions">
          <button onClick={() => setShowNew(true)} className="btn btn-primary btn-sm">+ New Client</button>
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
            {clients.map(c => (
              <tr key={c.id}>
                <td ><strong>{c.name}</strong></td>
                <td><code className="text-subtle" style={{ fontSize: 12 }}>{c.slug}</code></td>
                <td>
                  <span className={c.active ? 'text-positive' : 'text-subtle'} style={{ fontSize: 12 }}>
                    {c.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="num">
                  <Link to={`/clients/${c.id}/sales-traffic`} className="text-accent" style={{ fontWeight: 600 }}>Manage →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

