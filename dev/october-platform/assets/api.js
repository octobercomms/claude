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

async function call(ns, path, opts = {}) {
  const c = getCreds();
  if (!c) { throw new Error('not_connected'); }
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  headers.Authorization = authHeader(c);
  const base = c.base.replace(/\/+$/, '');
  const res = await fetch(base + ns + path, { ...opts, headers });
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
function request(path, opts) { return call('/oe/v1', path, opts); }   // plugin API
function requestWP(path, opts) { return call('/wp/v2', path, opts); } // core WP API

export const api = {
  /** Per-site branding/theme (public endpoint; safe to call once connected). */
  getBrand: () => request('/brand'),
  /** Validate credentials by hitting a protected endpoint. */
  ping: () => request('/planning/events'),
  listEvents: () => request('/planning/events'),
  getEvent: (id) => request('/planning/event/' + id),
  updateEvent: (id, payload) => request('/planning/event/' + id, { method: 'POST', body: JSON.stringify(payload) }),
  confirmEvent: (id) => request('/planning/event/' + id + '/confirm', { method: 'POST' }),

  /* Shared tasks (oe/v1/tasks) — the team's department-grouped board. */
  tasksMeta: () => request('/tasks/meta'),
  listTasks: () => request('/tasks'),
  createTask: (payload) => request('/tasks', { method: 'POST', body: JSON.stringify(payload) }),
  updateTask: (id, payload) => request('/task/' + id, { method: 'POST', body: JSON.stringify(payload) }),
  deleteTask: (id) => request('/task/' + id, { method: 'DELETE' }),

  /* Volunteer management (oe/v1/volunteers) — opportunities, shifts, signups. */
  listOpportunities: () => request('/volunteers/opportunities'),
  getOpportunity: (id) => request('/volunteers/opportunity/' + id),
  addSignup: (id, payload) => request('/volunteers/opportunity/' + id + '/signup', { method: 'POST', body: JSON.stringify(payload) }),
  updateSignup: (id, payload) => request('/volunteers/signup/' + id, { method: 'POST', body: JSON.stringify(payload) }),
  deleteSignup: (id) => request('/volunteers/signup/' + id, { method: 'DELETE' }),

  /* Email campaigns (oe/v1/campaigns). */
  listCampaigns: () => request('/campaigns'),
  getCampaign: (id) => request('/campaigns/' + id),
  createCampaign: (payload) => request('/campaigns', { method: 'POST', body: JSON.stringify(payload) }),
  updateCampaign: (id, payload) => request('/campaigns/' + id, { method: 'POST', body: JSON.stringify(payload) }),
  deleteCampaign: (id) => request('/campaigns/' + id, { method: 'DELETE' }),
  testCampaign: (id, email) => request('/campaigns/' + id + '/test', { method: 'POST', body: JSON.stringify({ email }) }),
  sendCampaign: (id) => request('/campaigns/' + id + '/send', { method: 'POST' }),
  audiences: () => request('/audiences'),
  copilot: (payload) => request('/campaigns/copilot', { method: 'POST', body: JSON.stringify(payload) }),

  /* Contacts (oe/v1/contacts). */
  contactsMeta: () => request('/contacts/meta'),
  listContacts: (search, offset) => request('/contacts?search=' + encodeURIComponent(search || '') + '&offset=' + (offset || 0)),
  updateContact: (id, status) => request('/contact/' + id, { method: 'POST', body: JSON.stringify({ status }) }),

  /* WordPress media library (core REST) for the email image picker. */
  listMedia: () => requestWP('/media?media_type=image&per_page=30&_fields=id,source_url,alt_text,title'),
};
