import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
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
  const [showInvite, setShowInvite] = useState(false);
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
    return <div className="text-subtle" style={{ padding: 32 }}>Admin only.</div>;
  }

  return (
    <div style={embedded ? undefined : { maxWidth: 980 }}>
      <div className="row between center mb-2">
        {!embedded && <h1 className="h2">Manage users</h1>}
        {embedded && <div className="h3">Users &amp; access</div>}
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowInvite(true)}>✉ Invite client</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>+ Add user</button>
        </div>
      </div>
      <p className="body-sm text-muted mb-5">
        Viewers see only the clients you assign them. Admins see everything and can manage users.
        The primary admin (set via <code>ADMIN_USERNAME</code>) is synced from environment on every boot.
      </p>

      {error && <div className="callout callout-danger">{error}</div>}
      {loading ? (
        <div className="text-subtle" style={{ padding: 20 }}>Loading…</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Clients</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const assigned = (u.client_ids || []).map(id => clients.find(c => c.id === id)?.name).filter(Boolean);
                const isSelf = u.id === user.id;
                return (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.username}</strong>
                      {isSelf && <span className="caption" style={{ marginLeft: 6 }}>you</span>}
                    </td>
                    <td>
                      <span className={`chip chip-${u.role === 'admin' ? 'accent' : 'neutral'}`}>{u.role}</span>
                    </td>
                    <td>
                      {u.role === 'admin'
                        ? <span className="text-subtle">all</span>
                        : assigned.length ? assigned.join(', ') : <span className="text-subtle">(none)</span>}
                    </td>
                    <td>{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(u)} style={{ marginRight: 6 }}>Edit</button>
                      {!isSelf && (
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => handleDelete(u)}>Delete</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!users.length && (
                <tr><td colSpan={5} className="text-subtle" style={{ textAlign: 'center' }}>No users yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
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
      {showInvite && (
        <InviteClientModal
          clients={clients}
          onClose={() => setShowInvite(false)}
          onDone={() => { refresh(); }}
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="h2">{mode === 'create' ? 'Add user' : `Edit ${target.username}`}</h2>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="field">
          <label className="field-label">Username</label>
          <input
            className="input"
            value={username}
            onChange={e => setUsername(e.target.value)}
            disabled={mode === 'edit'}
            placeholder="e.g. demo"
            style={mode === 'edit' ? { background: 'var(--surface-sunken)', color: 'var(--text-subtle)' } : undefined}
          />
        </div>

        <div className="field">
          <label className="field-label">Password{mode === 'edit' ? ' (leave blank to keep current)' : ''}</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder={mode === 'edit' ? '(unchanged)' : 'set a password'}
          />
        </div>

        <div className="field">
          <label className="field-label">Role</label>
          <select className="input" value={role} onChange={e => setRole(e.target.value)}>
            <option value="viewer">Viewer (agency — read/write on assigned clients)</option>
            <option value="client">Client (read-only — their own account, can't spend credits)</option>
            <option value="admin">Admin (sees everything, manages users)</option>
          </select>
          {role === 'client' && (
            <p className="body-xs text-subtle" style={{ marginTop: 6 }}>
              A client login can browse everything on their assigned account but cannot change anything or trigger any AI generation — every write is blocked server-side.
            </p>
          )}
        </div>

        {(role === 'viewer' || role === 'client') && (
          <div className="field">
            <label className="field-label">Assigned client{role === 'client' ? '' : 's'}</label>
            <div style={{ border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', maxHeight: 200, overflowY: 'auto', padding: 4, background: 'var(--surface-raised)' }}>
              {clients.map(c => (
                <label key={c.id} className="row center" style={{ gap: 8, padding: '6px 8px', fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={clientIds.has(c.id)}
                    onChange={() => toggleClient(c.id)}
                  />
                  <span>{c.name}</span>
                </label>
              ))}
              {!clients.length && <div className="text-subtle" style={{ padding: 8 }}>No clients in the system yet.</div>}
            </div>
          </div>
        )}

        {error && <div className="callout callout-danger">{error}</div>}

        <div className="row end mt-5">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Invite a read-only client by email. Creates a client-role login and emails
// them a set-password link; shows the link so the AM can copy it too.
function InviteClientModal({ clients, onClose, onDone }) {
  const [email, setEmail] = useState('');
  const [clientIds, setClientIds] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  function toggle(id) {
    setClientIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function send() {
    setError(null);
    if (!email.trim()) return setError('Enter an email address.');
    if (!clientIds.size) return setError('Assign at least one client.');
    setSaving(true);
    try {
      const res = await api.post('/users/invite', { email: email.trim(), clientIds: [...clientIds] });
      setResult(res);
      onDone();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="h2">Invite a client</h2>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>

        {result ? (
          <div>
            <div className="callout" style={{ marginBottom: 12 }}>
              {result.emailed
                ? <>Invite emailed to <strong>{result.user.email}</strong>. They'll set a password and land on their read-only dashboard.</>
                : <>User created, but the email didn't send{result.emailError ? ` (${result.emailError})` : ''}. Copy the link below and send it to them.</>}
            </div>
            <label className="field-label">Set-password link</label>
            <input className="input" readOnly value={result.link} onFocus={e => e.target.select()} style={{ fontSize: 12 }} />
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard?.writeText(result.link)}>Copy link</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <>
            {error && <div className="callout callout-warning" style={{ marginBottom: 12, fontSize: 13 }}>{error}</div>}
            <div className="field">
              <label className="field-label">Client's email</label>
              <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" autoFocus />
              <p className="body-xs text-subtle" style={{ marginTop: 6 }}>They log in with this email. Read-only — they can view everything but change nothing and spend nothing.</p>
            </div>
            <div className="field">
              <label className="field-label">Give them access to</label>
              <div style={{ border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', maxHeight: 200, overflowY: 'auto', padding: 4, background: 'var(--surface-raised)' }}>
                {clients.map(c => (
                  <label key={c.id} className="row center" style={{ gap: 8, padding: '6px 8px', fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={clientIds.has(c.id)} onChange={() => toggle(c.id)} />
                    <span>{c.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button type="button" className="btn btn-primary" onClick={send} disabled={saving}>{saving ? 'Sending…' : '✉ Send invite'}</button>
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
