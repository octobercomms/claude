import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

// Browser-level safety nets — unhandled errors and promise rejections
// outside the React tree (event handlers attached imperatively, async
// code in setTimeouts, etc.) get reported to the backend too. Quietly
// best-effort.
function reportToBackend(payload) {
  try {
    fetch('/api/_internal/log-frontend-error', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(localStorage.getItem('token') ? { Authorization: `Bearer ${localStorage.getItem('token')}` } : {}),
      },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch { /* ignore */ }
}
window.addEventListener('error', e => {
  reportToBackend({
    message: String(e?.message || e),
    stack: String(e?.error?.stack || ''),
    url: window.location?.href || null,
    user_agent: navigator.userAgent || null,
    source: 'window.error',
  });
});
window.addEventListener('unhandledrejection', e => {
  reportToBackend({
    message: String(e?.reason?.message || e?.reason || 'unhandled rejection'),
    stack: String(e?.reason?.stack || ''),
    url: window.location?.href || null,
    user_agent: navigator.userAgent || null,
    source: 'unhandledrejection',
  });
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
