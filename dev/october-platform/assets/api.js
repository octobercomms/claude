/**
 * REST client for the October Events plugin (oe/v1).
 *
 * Auth uses a WordPress Application Password (Users → Profile → Application
 * Passwords) sent as HTTP Basic auth — no cookies, works cross-origin. Stored
 * locally in the browser only.
 */
const KEY = 'oe_platform_creds';

export function getCreds() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
}
export function setCreds(c) { localStorage.setItem(KEY, JSON.stringify(c)); }
export function clearCreds() { localStorage.removeItem(KEY); }

function authHeader(c) {
  return 'Basic ' + btoa(c.user + ':' + c.apppw);
}

async function request(path, opts = {}) {
  const c = getCreds();
  if (!c) { throw new Error('not_connected'); }
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  headers.Authorization = authHeader(c);
  const base = c.base.replace(/\/+$/, '');
  const res = await fetch(base + '/oe/v1' + path, { ...opts, headers });
  let body = null;
  try { body = await res.json(); } catch (e) { /* may be empty */ }
  if (!res.ok) {
    const err = new Error((body && (body.error || body.message)) || ('HTTP ' + res.status));
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const api = {
  /** Validate credentials by hitting a protected endpoint. */
  ping: () => request('/planning/events'),
  listEvents: () => request('/planning/events'),
  getEvent: (id) => request('/planning/event/' + id),
  updateEvent: (id, payload) => request('/planning/event/' + id, { method: 'POST', body: JSON.stringify(payload) }),
  confirmEvent: (id) => request('/planning/event/' + id + '/confirm', { method: 'POST' }),
};
