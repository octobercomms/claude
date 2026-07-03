import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../utils/api';

// Public page an invited client lands on from their email. Validates the
// one-time token, lets them set a password, then points them at login.
export default function SetPasswordPage() {
  const { token } = useParams();
  const [email, setEmail] = useState(null);
  const [checking, setChecking] = useState(true);
  const [invalid, setInvalid] = useState('');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.get(`/auth/invite/${token}`)
      .then(info => setEmail(info.email))
      .catch(e => setInvalid(e.message))
      .finally(() => setChecking(false));
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (pw.length < 8) return setErr('Use at least 8 characters.');
    if (pw !== confirm) return setErr('Passwords don’t match.');
    setSaving(true);
    try {
      await api.post('/auth/set-password', { token, password: pw });
      setDone(true);
    } catch (e2) { setErr(e2.message); }
    finally { setSaving(false); }
  }

  const wrap = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--surface)' };
  const card = { width: '100%', maxWidth: 380, padding: 28, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-md)', background: 'var(--surface-raised)' };

  if (checking) return <div style={wrap}><div style={card}>Checking your link…</div></div>;

  if (invalid) return (
    <div style={wrap}>
      <div style={card}>
        <h1 className="h2" style={{ marginBottom: 8 }}>Link expired</h1>
        <p className="body-sm text-muted">{invalid}</p>
        <p className="body-sm text-muted" style={{ marginTop: 8 }}>Ask your account manager to send a fresh invite.</p>
      </div>
    </div>
  );

  if (done) return (
    <div style={wrap}>
      <div style={card}>
        <h1 className="h2" style={{ marginBottom: 8 }}>You’re all set 🎉</h1>
        <p className="body-sm text-muted" style={{ marginBottom: 16 }}>Your password is saved. Log in to see your dashboard.</p>
        <Link to="/login" className="btn btn-primary">Go to login →</Link>
      </div>
    </div>
  );

  return (
    <div style={wrap}>
      <form onSubmit={submit} style={card}>
        <h1 className="h2" style={{ marginBottom: 4 }}>Set your password</h1>
        <p className="body-sm text-muted" style={{ marginBottom: 16 }}>Signing in as <strong>{email}</strong></p>
        {err && <div className="callout callout-warning" style={{ marginBottom: 12, fontSize: 13 }}>{err}</div>}
        <label className="field-label">New password</label>
        <input className="input" type="password" value={pw} onChange={e => setPw(e.target.value)} autoFocus placeholder="At least 8 characters" style={{ marginBottom: 12 }} />
        <label className="field-label">Confirm password</label>
        <input className="input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} style={{ marginBottom: 16 }} />
        <button type="submit" className="btn btn-primary" disabled={saving} style={{ width: '100%' }}>{saving ? 'Saving…' : 'Set password'}</button>
      </form>
    </div>
  );
}
