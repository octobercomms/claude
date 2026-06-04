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
    <div className="suite-social">
      <header className="hero">
        <div className="row between wrap">
          <h1 className="display">Clients</h1>
          <button onClick={() => setShowNew(true)} className="btn btn-primary">+ New Client</button>
        </div>
      </header>

      {showNew && (
        <div style={styles.newCard}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15 }}>New Client</h3>
          <form onSubmit={handleCreate} style={styles.form}>
            {error && <div style={styles.error}>{error}</div>}
            <div style={styles.row}>
              <div style={styles.field}>
                <label style={styles.label}>Client Name</label>
                <input
                  style={styles.input} value={newClient.name} required
                  onChange={e => setNewClient(p => ({ ...p, name: e.target.value, slug: autoSlug(e.target.value) }))}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Slug</label>
                <input
                  style={styles.input} value={newClient.slug} required
                  onChange={e => setNewClient(p => ({ ...p, slug: e.target.value }))}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" style={styles.btn} disabled={creating}>{creating ? 'Creating…' : 'Create'}</button>
              <button type="button" onClick={() => setShowNew(false)} style={styles.btnGhost}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              {['Name', 'Slug', 'Status', ''].map(h => <th key={h} style={styles.th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {clients.map(c => (
              <tr key={c.id}>
                <td style={styles.td}><strong>{c.name}</strong></td>
                <td style={styles.td}><code style={{ fontSize: 12, color: '#888' }}>{c.slug}</code></td>
                <td style={styles.td}>
                  <span style={{ color: c.active ? '#2e7d32' : '#999', fontSize: 12, fontWeight: 600 }}>
                    {c.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ ...styles.td, textAlign: 'right' }}>
                  <Link to={`/clients/${c.id}/sales-traffic`} style={styles.linkBtn}>Manage →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const styles = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  pageTitle: { fontSize: 32, fontWeight: 700, margin: 0, letterSpacing: -0.6 },
  btn: { background: 'var(--accent)', color: 'var(--accent-on)', border: '2px solid var(--accent)', borderRadius: 999, padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  btnGhost: { background: 'var(--accent-soft)', color: '#1a1a1a', border: '2px solid var(--accent)', borderRadius: 999, padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  newCard: { background: 'var(--accent-soft)', border: '2px solid var(--accent)', borderRadius: 14, padding: 24, marginBottom: 24 },
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: 1.2 },
  input: { padding: '10px 12px', border: '2px solid var(--accent)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', background: 'var(--accent-soft)' },
  error: { color: '#c62828', fontSize: 13, background: '#fff0f0', padding: '10px 14px', borderRadius: 8, border: '2px solid #c62828' },
  tableWrap: { background: 'var(--accent-soft)', border: '2px solid var(--accent)', borderRadius: 14, overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { padding: '12px 16px', textAlign: 'left', background: '#fafafa', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2, color: '#888', borderBottom: '2px solid #1a1a1a' },
  td: { padding: '12px 16px', borderBottom: '2px solid #f3f3f3' },
  linkBtn: { color: '#1a1a1a', textDecoration: 'none', fontWeight: 600, fontSize: 12 },
};
