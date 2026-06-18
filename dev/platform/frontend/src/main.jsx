import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';
import './styles/tailwind.css';

// Browser-level safety nets — unhandled errors and promise rejections
// outside the React tree (event handlers attached imperatively, async
// code in setTimeouts, etc.) get reported to the backend too. Quietly
// best-effort.
// Filter out errors that didn't originate in our own code. Browser
// extensions (password managers, grammar checkers, outdated form-fillers)
// inject scripts that often throw — we'd otherwise log every one of
// them in the daily error digest as if it were ours. Cross-origin
// 'Script error.' is the standard sanitised message; same-origin
// errors get checked by stack / filename to make sure the trigger came
// from our own bundle.
function isOurError(e) {
  const filename = e?.filename || e?.error?.fileName || '';
  if (filename) {
    if (/^(chrome|moz|safari-web|safari|webkit)-extension:/i.test(filename)) return false;
    try {
      const u = new URL(filename, window.location.href);
      if (u.origin !== window.location.origin) return false;
    } catch { /* ignore */ }
  }
  // Cross-origin without a usable filename — browsers report these as
  // 'Script error.' with no stack. Treat as not ours.
  if (!filename && /^Script error\.?$/i.test(String(e?.message || ''))) return false;
  // Stack traces that reference extension URLs are also a giveaway.
  const stack = String(e?.error?.stack || e?.reason?.stack || '');
  if (/(chrome|moz|safari-web|safari|webkit)-extension:/i.test(stack)) return false;
  return true;
}

function reportToBackend(payload) {
  try {
    fetch('/api/_internal/log-frontend-error', {
      method: 'POST',
      credentials: 'include', // session cookie authenticates the report
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch { /* ignore */ }
}
window.addEventListener('error', e => {
  if (!isOurError(e)) return;
  reportToBackend({
    message: String(e?.message || e),
    stack: String(e?.error?.stack || ''),
    url: window.location?.href || null,
    user_agent: navigator.userAgent || null,
    source: 'window.error',
  });
});
window.addEventListener('unhandledrejection', e => {
  if (!isOurError(e)) return;
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
