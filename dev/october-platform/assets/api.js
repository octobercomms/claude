/**
 * REST client for the October Events plugin (oe/v1).
 *
 * Auth uses a WordPress Application Password (Users → Profile → Application
 * Passwords) sent as HTTP Basic auth — no cookies, works cross-origin. Stored
 * locally in the browser only.
 */
const KEY = 'oe_platform_creds';      // legacy single connection (migrated)
const SITES = 'oe_platform_sites';    // [{ id, base, user, apppw, label }]
const ACTIVE = 'oe_platform_active';  // active site id

function hostOf(base) { return String(base || '').replace(/^https?:\/\//, '').replace(/\/wp-json\/?$/, '').replace(/\/+$/, ''); }
function loadSites() { try { return JSON.parse(localStorage.getItem(SITES) || 'null') || []; } catch (e) { return []; } }
function saveSites(list) { localStorage.setItem(SITES, JSON.stringify(list)); }

/** All connected sites (migrating a legacy single connection on first read). */
export function getSites() {
  let list = loadSites();
  if (!list.length) {
    try {
      const old = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (old && old.base) {
        list = [{ id: 's' + Date.now(), base: old.base, user: old.user, apppw: old.apppw, label: hostOf(old.base) }];
        saveSites(list); localStorage.setItem(ACTIVE, list[0].id); localStorage.removeItem(KEY);
      }
    } catch (e) { /* ignore */ }
  }
  return list;
}
export function activeId() { return localStorage.getItem(ACTIVE) || ''; }
export function getCreds() { const list = getSites(); return list.find((s) => s.id === activeId()) || list[0] || null; }
export function setActiveSite(id) { localStorage.setItem(ACTIVE, id); }
export function setSiteLabel(id, label) { const list = getSites(); const s = list.find((x) => x.id === id); if (s && label) { s.label = label; saveSites(list); } }

/** Add or update a connection and make it active (used by the login form). */
export function setCreds(c) {
  const list = getSites();
  const i = list.findIndex((s) => s.base === c.base && s.user === c.user);
  if (i >= 0) {
    list[i] = Object.assign(list[i], { apppw: c.apppw, label: c.label || list[i].label || hostOf(c.base) });
    saveSites(list); setActiveSite(list[i].id);
  } else {
    const site = { id: 's' + Date.now(), base: c.base, user: c.user, apppw: c.apppw, label: c.label || hostOf(c.base) };
    list.push(site); saveSites(list); setActiveSite(site.id);
  }
  return getCreds();
}

/** Remove a site (defaults to the active one — i.e. "sign out of this site"). */
export function clearCreds(id) {
  const target = id || activeId();
  const list = getSites().filter((s) => s.id !== target);
  saveSites(list);
  if (activeId() === target) { setActiveSite(list[0] ? list[0].id : ''); }
}

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
  listContacts: (search, offset, list) => request('/contacts?search=' + encodeURIComponent(search || '') + '&offset=' + (offset || 0) + (list ? '&list=' + list : '')),
  updateContact: (id, status) => request('/contact/' + id, { method: 'POST', body: JSON.stringify({ status }) }),
  editContact: (id, fields) => request('/contact/' + id, { method: 'POST', body: JSON.stringify(fields) }),
  deleteContact: (id) => request('/contact/' + id, { method: 'DELETE' }),
  contactActivity: (id) => request('/contact/' + id + '/activity'),

  /* Lists (oe/v1/lists). */
  listLists: () => request('/lists'),
  createList: (name, description) => request('/lists', { method: 'POST', body: JSON.stringify({ name, description: description || '' }) }),
  updateList: (id, name, description) => request('/lists/' + id, { method: 'POST', body: JSON.stringify({ name, description: description || '' }) }),
  deleteList: (id) => request('/lists/' + id, { method: 'DELETE' }),
  listMember: (id, contactId, action) => request('/lists/' + id + '/members', { method: 'POST', body: JSON.stringify({ contact_id: contactId, action }) }),

  /* Headline KPIs for the dashboard (oe/v1/stats). */
  stats: () => request('/stats'),

  /* Staff AI assistant (oe/v1/assistant) — tool-use over live festival data. */
  assistant: (messages) => request('/assistant', { method: 'POST', body: JSON.stringify({ messages }) }),

  /* WordPress media library (core REST) for the email image picker. */
  listMedia: () => requestWP('/media?media_type=image&per_page=30&_fields=id,source_url,alt_text,title'),
};
