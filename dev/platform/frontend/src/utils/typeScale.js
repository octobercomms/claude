// Applying the type scale at runtime.
//
// The five size tokens and ten weight tokens in index.css are read 204 and 10
// times respectively through var(), so setting them on :root changes the whole
// interface. Nothing here knows which tokens exist — the list comes from the
// server with the saved values, so adding a token to the design system does not
// mean editing this file.
//
// Order matters. The cached scale is applied synchronously at boot, before
// React mounts, because applying it after the first paint is a visible jump:
// every heading and table on screen resizes a beat after it appears. The fetch
// then reconciles, which is normally a no-op.

const CACHE_KEY = 'omi:type-scale';

function isSize(token) {
  return token.startsWith('--fs-');
}

export function applyScale(values) {
  if (!values || typeof values !== 'object') return;
  const root = document.documentElement;
  for (const [token, value] of Object.entries(values)) {
    // Only our own tokens, and only numbers. These values round-trip through
    // localStorage, where anything could have been written, and setProperty
    // takes a raw string.
    if (!/^--f[sw]-[a-z0-9-]+$/.test(token)) continue;
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    root.style.setProperty(token, isSize(token) ? `${n}px` : String(n));
  }
}

// Drop every override, back to whatever index.css declares. Used when a user
// resets, and on logout so the next person on a shared browser does not inherit
// the last one's scale.
export function clearScale() {
  const root = document.documentElement;
  for (const token of Array.from(root.style)) {
    if (/^--f[sw]-/.test(token)) root.style.removeProperty(token);
  }
}

export function cacheScale(values) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(values || {})); } catch { /* private mode */ }
}

export function forgetScale() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
  clearScale();
}

// Called from main.jsx before React mounts.
export function applyCachedScale() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) applyScale(JSON.parse(raw));
  } catch { /* nothing cached, or unreadable — index.css defaults stand */ }
}

// Called once the user is known. Reconciles the cache with the server and
// leaves the cache correct for the next boot.
export async function loadScale() {
  try {
    const r = await fetch('/api/ui/type-scale', { credentials: 'include' });
    if (!r.ok) return null;
    const data = await r.json();
    // Reset first: a token the user has just stopped overriding is absent from
    // `effective`... except that `effective` always carries every token, which
    // is why it is the field applied here rather than the overrides alone.
    clearScale();
    applyScale(data.effective);
    cacheScale(data.effective);
    return data;
  } catch {
    return null;
  }
}
