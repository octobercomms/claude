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
export function setActiveSite(id) { localStorage.setItem(ACTIVE, id); bust(); /* drop the previous site's cached data */ }
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

/* ---- GET cache + in-flight dedup ----------------------------------------
   A short-lived memo so the dashboard and a per-section view don't refetch the
   same list, and so simultaneous reads share one in-flight request instead of
   firing N identical ones. Writes bust the relevant prefix so the next read is
   fresh. Keyed by full path (incl. query string). */
const GET_TTL = 30000;
const getCache = new Map(); // path -> { at, promise }
function cachedGet(req, path) {
  const hit = getCache.get(path);
  if (hit && (Date.now() - hit.at) < GET_TTL) { return hit.promise; }
  const promise = req(path).catch((err) => { getCache.delete(path); throw err; });
  getCache.set(path, { at: Date.now(), promise });
  return promise;
}
/** Drop cached GETs whose path starts with any of these prefixes. */
export function bust(...prefixes) {
  if (!prefixes.length) { getCache.clear(); return; }
  for (const k of getCache.keys()) {
    if (prefixes.some((p) => k.indexOf(p) === 0)) { getCache.delete(k); }
  }
}
/** Run a write, then bust the caches it invalidates. */
function afterWrite(promise, prefixes) {
  return promise.then((r) => { bust(...prefixes); return r; });
}
const cget = (path) => cachedGet(request, path);     // cached oe/v1 GET
const cgetWP = (path) => cachedGet(requestWP, path); // cached wp/v2 GET

export const api = {
  /** Per-site branding/theme (public endpoint; safe to call once connected). */
  getBrand: () => cget('/brand'),
  /** Validate credentials by hitting a protected endpoint (never cached). */
  ping: () => request('/planning/events'),
  listEvents: () => cget('/planning/events'),
  getEvent: (id) => cget('/planning/event/' + id),
  updateEvent: (id, payload) => afterWrite(request('/planning/event/' + id, { method: 'POST', body: JSON.stringify(payload) }), ['/planning', '/stats']),
  confirmEvent: (id) => afterWrite(request('/planning/event/' + id + '/confirm', { method: 'POST' }), ['/planning', '/stats']),

  /* Shared tasks (oe/v1/tasks) — the team's department-grouped board. */
  tasksMeta: () => cget('/tasks/meta'),
  listTasks: () => cget('/tasks'),
  createTask: (payload) => afterWrite(request('/tasks', { method: 'POST', body: JSON.stringify(payload) }), ['/task']),
  updateTask: (id, payload) => afterWrite(request('/task/' + id, { method: 'POST', body: JSON.stringify(payload) }), ['/task']),
  deleteTask: (id) => afterWrite(request('/task/' + id, { method: 'DELETE' }), ['/task']),

  /* Volunteer management (oe/v1/volunteers) — opportunities, shifts, signups. */
  listOpportunities: () => cget('/volunteers/opportunities'),
  getOpportunity: (id) => cget('/volunteers/opportunity/' + id),
  addSignup: (id, payload) => afterWrite(request('/volunteers/opportunity/' + id + '/signup', { method: 'POST', body: JSON.stringify(payload) }), ['/volunteers', '/stats']),
  updateSignup: (id, payload) => afterWrite(request('/volunteers/signup/' + id, { method: 'POST', body: JSON.stringify(payload) }), ['/volunteers', '/stats']),
  deleteSignup: (id) => afterWrite(request('/volunteers/signup/' + id, { method: 'DELETE' }), ['/volunteers', '/stats']),

  /* Email campaigns (oe/v1/campaigns). */
  listCampaigns: () => cget('/campaigns'),
  getCampaign: (id) => cget('/campaigns/' + id),
  createCampaign: (payload) => afterWrite(request('/campaigns', { method: 'POST', body: JSON.stringify(payload) }), ['/campaigns']),
  updateCampaign: (id, payload) => afterWrite(request('/campaigns/' + id, { method: 'POST', body: JSON.stringify(payload) }), ['/campaigns']),
  deleteCampaign: (id) => afterWrite(request('/campaigns/' + id, { method: 'DELETE' }), ['/campaigns']),
  testCampaign: (id, email) => request('/campaigns/' + id + '/test', { method: 'POST', body: JSON.stringify({ email }) }),
  sendCampaign: (id) => afterWrite(request('/campaigns/' + id + '/send', { method: 'POST' }), ['/campaigns']),
  audiences: () => cget('/audiences'),
  copilot: (payload) => request('/campaigns/copilot', { method: 'POST', body: JSON.stringify(payload) }),

  /* Contacts (oe/v1/contacts). */
  contactsMeta: () => cget('/contacts/meta'),
  contactsGrowth: () => cget('/contacts/growth'),
  listContacts: (search, offset, list) => cget('/contacts?search=' + encodeURIComponent(search || '') + '&offset=' + (offset || 0) + (list ? '&list=' + list : '')),
  updateContact: (id, status) => afterWrite(request('/contact/' + id, { method: 'POST', body: JSON.stringify({ status }) }), ['/contact', '/stats']),
  editContact: (id, fields) => afterWrite(request('/contact/' + id, { method: 'POST', body: JSON.stringify(fields) }), ['/contact']),
  deleteContact: (id) => afterWrite(request('/contact/' + id, { method: 'DELETE' }), ['/contact', '/stats']),
  contactActivity: (id) => cget('/contact/' + id + '/activity'),

  /* Lists (oe/v1/lists). */
  listLists: () => cget('/lists'),
  createList: (name, description) => afterWrite(request('/lists', { method: 'POST', body: JSON.stringify({ name, description: description || '' }) }), ['/lists']),
  updateList: (id, name, description) => afterWrite(request('/lists/' + id, { method: 'POST', body: JSON.stringify({ name, description: description || '' }) }), ['/lists']),
  deleteList: (id) => afterWrite(request('/lists/' + id, { method: 'DELETE' }), ['/lists']),
  listMember: (id, contactId, action) => afterWrite(request('/lists/' + id + '/members', { method: 'POST', body: JSON.stringify({ contact_id: contactId, action }) }), ['/lists', '/contact']),

  /* Headline KPIs for the dashboard (oe/v1/stats). */
  stats: () => cget('/stats'),

  /* Staff AI assistant (oe/v1/assistant) — tool-use over live festival data. */
  assistant: (messages) => request('/assistant', { method: 'POST', body: JSON.stringify({ messages }) }),

  /* WordPress media library (core REST) for the email image picker. */
  listMedia: () => cgetWP('/media?media_type=image&per_page=30&_fields=id,source_url,alt_text,title'),
};
