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
      <div className="auth-page" style={{ background: "var(--surface-raised)" }}>
        <div className="card">
          <div className="caption mb-5">October Marketing Intelligence</div>
          <h1 className="h2 mb-3">Something went wrong here.</h1>
          <p className="body mb-5">
            A part of the page hit an unexpected error. Your work is safe — nothing was lost. You can either
            retry this view or reload the whole page.
          </p>
          <details style={{ marginBottom: 20 }}>
            <summary className="body-sm text-subtle" style={{ cursor: "pointer", userSelect: "none" }}>Error detail (for support)</summary>
            <pre className="card" style={{ padding: 12, marginTop: 8, fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word", overflow: "auto" }}>{msg}</pre>
          </details>
          <div className="row">
            <button type="button" onClick={this.handleReset} className="btn btn-primary">Try again</button>
            <button type="button" onClick={this.handleReload} className="btn btn-secondary">Reload page</button>
          </div>
        </div>
      </div>
    );
  }
}

