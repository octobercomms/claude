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
      <div style={styles.card}>
        <div style={styles.header}>
          <div style={styles.brand}>OCTOBER</div>
          <div style={styles.subtitle}>Performance Marketing Platform</div>
        </div>
        <form onSubmit={handleSubmit} style={styles.form}>
          {error && <div style={styles.error}>{error}</div>}
          <div style={styles.field}>
            <label style={styles.label}>Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              style={styles.input}
              autoFocus
              required
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={styles.input}
              required
            />
          </div>
          <button type="submit" style={styles.btn} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a1a' },
  card: { background: 'white', borderRadius: 8, padding: '48px 40px', width: '100%', maxWidth: 380, boxShadow: '0 4px 32px rgba(0,0,0,0.3)' },
  header: { textAlign: 'center', marginBottom: 32 },
  brand: { fontSize: 22, fontWeight: 700, letterSpacing: 4, color: '#1a1a1a' },
  subtitle: { fontSize: 12, color: '#888', marginTop: 6, letterSpacing: 1 },
  form: { display: 'flex', flexDirection: 'column', gap: 20 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 12, fontWeight: 600, color: '#444', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { padding: '10px 12px', border: '1px solid #ddd', borderRadius: 4, fontSize: 14, outline: 'none' },
  btn: { padding: '12px', background: '#1a1a1a', color: 'white', border: 'none', borderRadius: 4, fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 8 },
  error: { background: '#fff0f0', color: '#c62828', padding: '10px 12px', borderRadius: 4, fontSize: 13, border: '1px solid #ffcdd2' },
};
