// Top-level React error boundary. Catches any error thrown during
// render / lifecycle / event handlers below it and shows a fallback
// page instead of letting React unmount the whole tree (which would
// leave the user staring at a blank white screen).
//
// On catch we also POST the error to the backend so production crashes
// surface in the same place as backend errors (forensic + daily digest)
// rather than only in the user's console.

import React from 'react';
import { api } from '../utils/api';

export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Best-effort report — don't await, don't surface failures here
    // (we're already in an error state and the user shouldn't see a
    // cascade of errors).
    try {
      api.post('/_internal/log-frontend-error', {
        message: String(error?.message || error),
        stack: String(error?.stack || ''),
        component_stack: String(info?.componentStack || ''),
        url: window.location?.href || null,
        user_agent: navigator.userAgent || null,
      }).catch(() => {});
    } catch { /* ignore */ }
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    const msg = String(this.state.error?.message || this.state.error || 'Unknown error');
    return (
      <div style={styles.wrap}>
        <div style={styles.card}>
          <div style={styles.brand}>October Marketing Intelligence</div>
          <h1 style={styles.h1}>Something went wrong here.</h1>
          <p style={styles.p}>
            A part of the page hit an unexpected error. Your work is safe — nothing was lost. You can either
            retry this view or reload the whole page.
          </p>
          <details style={styles.details}>
            <summary style={styles.summary}>Error detail (for support)</summary>
            <pre style={styles.pre}>{msg}</pre>
          </details>
          <div style={styles.row}>
            <button type="button" onClick={this.handleReset} style={styles.primary}>Try again</button>
            <button type="button" onClick={this.handleReload} style={styles.secondary}>Reload page</button>
          </div>
        </div>
      </div>
    );
  }
}

const styles = {
  wrap: { minHeight: '100vh', background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { background: '#fff', border: '2px solid var(--accent)', borderRadius: 8, padding: '32px 36px', maxWidth: 560, boxShadow: '0 2px 16px rgba(0,0,0,0.04)' },
  brand: { fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 18 },
  h1: { margin: '0 0 12px', fontSize: 22, color: '#1a1a1a' },
  p: { margin: '0 0 20px', fontSize: 14, color: '#555', lineHeight: 1.6 },
  details: { marginBottom: 20 },
  summary: { fontSize: 12, color: '#888', cursor: 'pointer', userSelect: 'none' },
  pre: { fontSize: 11, color: '#555', background: '#f5f5f5', padding: 12, borderRadius: 4, overflow: 'auto', marginTop: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  row: { display: 'flex', gap: 8 },
  primary: { background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 4, padding: '10px 18px', fontSize: 13, cursor: 'pointer' },
  secondary: { background: '#fff', color: '#555', border: '2px solid var(--accent)', borderRadius: 4, padding: '10px 18px', fontSize: 13, cursor: 'pointer' },
};
