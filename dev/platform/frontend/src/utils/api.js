const BASE = '/api';

function getToken() {
  return localStorage.getItem('token');
}

async function request(path, options = {}) {
  const token = getToken();
  // FormData sets its own Content-Type with boundary — don't force JSON.
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        ...(isForm ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch (err) {
    // Network-level failure (DNS, offline, CORS preflight) — surface as
    // "couldn't reach the server" rather than letting the caller see the
    // raw TypeError.
    throw new Error('Could not reach the server — check your connection or try again in a moment.');
  }

  if (res.status === 401) {
    localStorage.removeItem('token');
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  // Detect HTML responses on what should be JSON endpoints. Happens when
  // nginx serves the SPA index.html for /api/* — usually because the
  // backend is down and the nginx error_page directive falls back to
  // the SPA. Without this branch the JSON parse below blew up with a
  // cryptic "Unexpected token '<'" that gave no clue what was wrong.
  const contentType = res.headers.get('content-type') || '';
  const looksHtml = contentType.includes('text/html');

  if (!res.ok) {
    // 413 comes back as nginx's HTML error page (it rejects oversized bodies
    // before they reach the backend), so it trips the looksHtml branch below
    // and used to read as "backend may be offline" — misleading. Call it what
    // it is: the upload is too large.
    if (res.status === 413) {
      throw new Error('That file is too large to upload. Try a smaller file or split it into shorter clips.');
    }
    if (looksHtml) {
      throw new Error(`Server returned HTML (HTTP ${res.status}) — the backend may be offline. Check pm2 / nginx.`);
    }
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  if (looksHtml) {
    throw new Error('Server returned HTML on a JSON endpoint — the backend may be offline (nginx is likely serving the SPA fallback).');
  }

  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  postForm: (path, formData) => request(path, { method: 'POST', body: formData }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: 'DELETE' }),

  // Raw fetch for CSV etc
  raw: (path) => fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  }),
};
