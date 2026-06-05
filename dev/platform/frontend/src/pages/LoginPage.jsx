import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      login(data.token);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.logoArea}>
        <img src="/logo-black.gif" alt="October" style={styles.logo} />
      </div>
      <div className="card">
        <div style={styles.cardHeader}>
          <div className="caption">Marketing Intelligence</div>
        </div>
        <form onSubmit={handleSubmit} style={styles.form}>
          {error && <div style={styles.error}>{error}</div>}
          <div style={styles.field}>
            <label className="field-label">Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="input"
              autoFocus
              required
            />
          </div>
          <div style={styles.field}>
            <label className="field-label">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="input"
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', background: '#000000',
    gap: 32,
  },
  logoArea: { width: 70 },
  logo: { width: '100%', height: 'auto', display: 'block' },
  card: {
    background: 'white', borderRadius: 4, padding: '36px 40px',
    width: '100%', maxWidth: 360, boxShadow: '0 8px 48px rgba(0,0,0,0.6)',
  },
  cardHeader: { marginBottom: 28 },
  cardTitle: { fontSize: 11, color: '#999', letterSpacing: 2, textTransform: 'uppercase', fontWeight: 400 },
  form: { display: 'flex', flexDirection: 'column', gap: 20 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 11, fontWeight: 600, color: '#444', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    padding: '10px 12px', border: '2px solid var(--accent)', borderRadius: 4,
    fontSize: 14, outline: 'none', fontFamily: 'Brockmann, sans-serif',
  },
  btn: {
    padding: '12px', background: 'var(--accent)', color: '#1a1a1a', border: 'none',
    borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', marginTop: 4,
    fontFamily: 'Brockmann, sans-serif', letterSpacing: 0.5,
  },
  error: { background: '#fff0f0', color: '#c62828', padding: '10px 12px', borderRadius: 4, fontSize: 13, border: '1px solid #ffcdd2' },
};
