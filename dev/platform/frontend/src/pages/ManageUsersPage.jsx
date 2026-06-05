import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { primaryBtn, secondaryBtn, dangerBtn, COLORS } from '../styles/theme';
import { useAuth } from '../context/AuthContext';

// Admin-only user management. Lists all users; supports add, password reset,
// per-user client visibility assignment, and delete.
//
// `embedded` true means we're being rendered inside the Settings page as a
// tab — drop the h1 and outer max-width wrapper so the Settings shell owns
// the page chrome.
export default function ManageUsersPage({ embedded = false } = {}) {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [u, c] = await Promise.all([api.get('/users'), api.get('/clients')]);
      setUsers(u);
      setClients(c);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function handleDelete(target) {
    if (!confirm(`Delete user "${target.username}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/users/${target.id}`);
      refresh();
    } catch (e) {
      alert(e.message);
    }
  }

  if (user?.role !== 'admin') {
    return <div style={{ padding: 32, color: '#666' }}>Admin only.</div>;
  }

  return (
    <div style={embedded ? undefined : { maxWidth: 980 }}>
      <div style={styles.header}>
        {!embedded && <h1 style={styles.title}>Manage users</h1>}
        {embedded && <div style={{ fontSize: 16, fontWeight: 700 }}>Users &amp; access</div>}
        <button type="button" style={primaryBtn} onClick={() => setShowCreate(true)}>+ Add user</button>
      </div>
      <p style={styles.hint}>
        Viewers see only the clients you assign them. Admins see everything and can manage users.
        The primary admin (set via <code>ADMIN_USERNAME</code>) is synced from environment on every boot.
      </p>

      {error && <div style={styles.error}>{error}</div>}
      {loading ? (
        <div style={{ color: '#888', padding: 20 }}>Loading…</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={styles.th}>Username</th>
              <th style={styles.th}>Role</th>
              <th style={styles.th}>Clients</th>
              <th style={styles.th}>Created</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const assigned = (u.client_ids || []).map(id => clients.find(c => c.id === id)?.name).filter(Boolean);
              const isSelf = u.id === user.id;
              return (
                <tr key={u.id}>
                  <td style={styles.td}><strong>{u.username}</strong>{isSelf && <span style={styles.tagSelf}>you</span>}</td>
                  <td style={styles.td}><span style={u.role === 'admin' ? styles.tagAdmin : styles.tagViewer}>{u.role}</span></td>
                  <td style={styles.td}>
                    {u.role === 'admin'
                      ? <span style={{ color: '#888' }}>all</span>
                      : assigned.length ? assigned.join(', ') : <span style={{ color: '#bbb' }}>(none)</span>}
                  </td>
                  <td style={styles.td}>{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                  <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button type="button" style={{ ...secondaryBtn, padding: '5px 14px', fontSize: 12, marginRight: 6 }} onClick={() => setEditing(u)}>Edit</button>
                    {!isSelf && (
                      <button type="button" style={{ ...dangerBtn, padding: '5px 14px', fontSize: 12 }} onClick={() => handleDelete(u)}>Delete</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!users.length && (
              <tr><td colSpan={5} style={{ ...styles.td, color: '#888', textAlign: 'center' }}>No users yet.</td></tr>
            )}
          </tbody>
        </table>
      )}

      {showCreate && (
        <UserModal
          mode="create"
          clients={clients}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); refresh(); }}
        />
      )}
      {editing && (
        <UserModal
          mode="edit"
          target={editing}
          clients={clients}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

function UserModal({ mode, target, clients, onClose, onSaved }) {
  const [username, setUsername] = useState(target?.username || '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(target?.role || 'viewer');
  const [clientIds, setClientIds] = useState(new Set(target?.client_ids || []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function toggleClient(id) {
    setClientIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        role,
        clientIds: Array.from(clientIds),
        ...(password ? { password } : {}),
      };
      if (mode === 'create') {
        if (!username.trim()) throw new Error('username required');
        if (!password) throw new Error('password required');
        await api.post('/users', { username: username.trim(), ...payload });
      } else {
        await api.put(`/users/${target.id}`, payload);
      }
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 700 }}>
          {mode === 'create' ? 'Add user' : `Edit ${target.username}`}
        </h2>

        <label className="field-label">Username</label>
        <input
          style={{ ...styles.input, ...(mode === 'edit' ? { background: '#f6f6f6', color: '#888' } : {}) }}
          value={username}
          onChange={e => setUsername(e.target.value)}
          disabled={mode === 'edit'}
          placeholder="e.g. demo"
        />

        <label className="field-label">Password{mode === 'edit' ? ' (leave blank to keep current)' : ''}</label>
        <input
          className="input"
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder={mode === 'edit' ? '(unchanged)' : 'set a password'}
        />

        <label className="field-label">Role</label>
        <select className="input" value={role} onChange={e => setRole(e.target.value)}>
          <option value="viewer">Viewer (sees only assigned clients)</option>
          <option value="admin">Admin (sees everything, manages users)</option>
        </select>

        {role === 'viewer' && (
          <>
            <label className="field-label">Assigned clients</label>
            <div style={styles.clientList}>
              {clients.map(c => (
                <label key={c.id} style={styles.clientRow}>
                  <input
                    type="checkbox"
                    checked={clientIds.has(c.id)}
                    onChange={() => toggleClient(c.id)}
                  />
                  <span>{c.name}</span>
                </label>
              ))}
              {!clients.length && <div style={{ color: '#888', padding: 8 }}>No clients in the system yet.</div>}
            </div>
          </>
        )}

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.footer}>
          <button type="button" style={secondaryBtn} onClick={onClose}>Cancel</button>
          <button type="button" style={primaryBtn} onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: 22, fontWeight: 700, margin: 0 },
  hint: { fontSize: 12, color: '#666', margin: '0 0 18px', lineHeight: 1.5 },
  table: { width: '100%', borderCollapse: 'collapse', background: '#fff', border: '2px solid var(--accent)', borderRadius: 4 },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#888', borderBottom: '1px solid #eee' },
  td: { padding: '12px', fontSize: 13, borderBottom: '1px solid #f4f4f4', verticalAlign: 'middle' },
  tagAdmin: { fontSize: 11, fontWeight: 700, background: COLORS.yellow, color: COLORS.dark, padding: '2px 8px', borderRadius: 999 },
  tagViewer: { fontSize: 11, fontWeight: 600, background: '#eef2ff', color: '#3949ab', padding: '2px 8px', borderRadius: 999 },
  tagSelf: { fontSize: 10, marginLeft: 6, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 20px', zIndex: 1000, overflowY: 'auto' },
  modal: { background: '#fff', borderRadius: 8, width: '100%', maxWidth: 480, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12, marginBottom: 6 },
  input: { width: '100%', padding: '8px 10px', fontSize: 13, border: '2px solid var(--accent)', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box' },
  clientList: { border: '2px solid var(--accent)', borderRadius: 4, maxHeight: 200, overflowY: 'auto', padding: 4, background: '#fafafa' },
  clientRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', fontSize: 13, cursor: 'pointer' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 },
  error: { color: '#c62828', fontSize: 12, marginTop: 10, padding: 8, background: '#fdecea', borderRadius: 4 },
};
