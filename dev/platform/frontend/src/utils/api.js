import { READ_ONLY_MSG } from './readOnly';
import { bounceToLogin } from './bounceToLogin';

const BASE = '/api';

// Read-only (client login) guard, set from AuthContext when the user loads.
// The universal safety net: a client login can't fire any mutating request —
// every write across the whole app is stopped here with a friendly message
// (not a raw 403), regardless of whether that particular button was disabled.
let _readOnly = false;
export function setApiReadOnly(v) { _readOnly = !!v; }

async function request(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  // Visualise is the one module a read-only (client) login may write to, when
  // granted can_use_visualise — see docs/omi/visualise-studio.md §6. The server
  // enforces the capability; this just stops the client-side guard from
  // pre-empting those writes. All other non-GET client requests stay blocked.
  if (_readOnly && !['GET', 'HEAD', 'OPTIONS'].includes(method) && !path.startsWith('/auth/') && !path.startsWith('/visualise')) {
    throw new Error(READ_ONLY_MSG);
  }
  // FormData sets its own Content-Type with boundary — don't force JSON.
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      // Session lives in an httpOnly cookie — send it with every request.
      credentials: 'include',
      headers: {
        ...(isForm ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
    });
  } catch (err) {
    // Network-level failure (DNS, offline, CORS preflight) — surface as
    // "couldn't reach the server" rather than letting the caller see the
    // raw TypeError.
    throw new Error('Could not reach the server — check your connection or try again in a moment.');
  }

  // A redirected POST is a GET, silently.
  //
  // fetch follows 301/302/303 by default and the spec turns the method into
  // GET when it does, dropping the body. The call then returns whatever the
  // GET endpoint answers with, which for a create endpoint is the list — and
  // the caller is left reading a list where it expected the thing it just
  // made. On 26 Oct 2026 a recording failed to save with "the server did not
  // return somewhere to upload to (keys: 0, 1, 2, 3)", which is the shape of
  // a four-item array: the recordings list, answered to a create.
  //
  // Whether that is what happened is not provable after the fact, because
  // nothing recorded it. It is now: a mutating request that came back from a
  // different URL says so, by name.
  if (res.redirected && !['GET', 'HEAD'].includes(method)) {
    throw new Error(
      `The ${method} to ${BASE}${path} was redirected to ${res.url}, which turns it into a GET `
      + 'and drops what was sent. Nothing was saved. This is a server routing fault, not your input.'
    );
  }

  if (res.status === 401) {
    // Cookie missing/expired — bounce to login. Nothing to clear client-side
    // (the token is httpOnly and owned by the server). On a page that has no
    // session by design, bounceToLogin stays put and the error is thrown for
    // the caller to handle: navigating to a page you are already on is how
    // the login screen spent an afternoon reloading itself.
    bounceToLogin();
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

  // Same as postForm, but reports how much has gone up.
  //
  // fetch cannot do this: it exposes no upload-progress event, so a 600MB
  // recording sat behind a motionless "Uploading…" for minutes with no way to
  // tell a working upload from a stalled one. XMLHttpRequest still has
  // upload.onprogress, which is the only reason it is used here.
  //
  // onProgress receives { loaded, total, percent }, where percent is null when
  // the browser cannot determine the total (lengthComputable false).
  postFormProgress(path, formData, onProgress) {
    if (_readOnly) return Promise.reject(new Error(READ_ONLY_MSG));
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}${path}`);
      xhr.withCredentials = true;           // the session cookie, as fetch's credentials:'include'
      xhr.upload.onprogress = (e) => {
        if (typeof onProgress !== 'function') return;
        onProgress({
          loaded: e.loaded,
          total: e.lengthComputable ? e.total : null,
          percent: e.lengthComputable && e.total > 0
            ? Math.min(100, Math.round((e.loaded / e.total) * 100))
            : null,
        });
      };
      xhr.onload = () => {
        // 413 arrives as nginx's HTML error page, exactly as it does through
        // fetch, so it gets the same plain-English message rather than a
        // JSON parse failure.
        if (xhr.status === 413) {
          return reject(new Error('That file is too large to upload. Try a smaller file or split it into shorter clips.'));
        }
        if (xhr.status === 401) {
          bounceToLogin();
          return reject(new Error('Session expired'));
        }
        let body = null;
        try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
        if (xhr.status >= 200 && xhr.status < 300) return resolve(body);
        reject(new Error((body && body.error) || `HTTP ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('Could not reach the server — check your connection or try again in a moment.'));
      xhr.onabort = () => reject(new Error('Upload cancelled.'));
      xhr.send(formData);
    });
  },
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path, body) => request(path, { method: 'DELETE', ...(body ? { body: JSON.stringify(body) } : {}) }),

  // Raw fetch for CSV etc — the session cookie authenticates it.
  raw: (path) => fetch(`${BASE}${path}`, { credentials: 'include' }),

  // A file download that can also report on itself.
  //
  // A plain <a download> is enough when all you need is the bytes, and the
  // resize panel rightly still uses one: the session lives in an httpOnly
  // cookie, so a same-origin link authenticates without any help from here.
  // What a link cannot do is read the response headers. An export that
  // leaves out assets whose provider links have expired has to say how many,
  // and it has to say it at download time rather than inside the file, so
  // this hands back the blob along with the filename and the counts.
  //
  // An error body is still JSON, so a failure reads as a sentence rather
  // than downloading a zip-shaped file containing {"error": "..."}.
  // `body` makes it a POST, which is what a download that spends has to be:
  // the auth middleware blocks every non-GET for the read-only client role,
  // and that is the single guarantee a client login cannot run up a bill.
  async download(path, body = null) {
    const res = await fetch(`${BASE}${path}`, {
      credentials: 'include',
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    if (res.status === 401) { bounceToLogin(); throw new Error('Session expired'); }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const disp = res.headers.get('content-disposition') || '';
    const m = disp.match(/filename="?([^"]+)"?/);
    const num = (h) => { const v = parseInt(res.headers.get(h), 10); return Number.isFinite(v) ? v : 0; };
    return {
      blob: await res.blob(),
      filename: m ? m[1] : null,
      assets: num('X-Export-Assets'),
      missing: num('X-Export-Missing'),
      // Shared's export also says how many posts went in, because "4 assets"
      // does not tell you whether it took the four you ticked or the whole
      // batch of nine. Paid does not send it and 0 is the right answer there.
      posts: num('X-Export-Posts'),
      // The social report says what it covered without being opened: a
      // report that quietly left out half an account is the failure here.
      report: {
        posts: num('X-Report-Posts'),
        viaOmi: num('X-Report-Via-Omi'),
        connected: res.headers.get('X-Report-Connected') === '1',
      },
    };
  },
};
