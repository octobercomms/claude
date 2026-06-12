/**
 * October Events — planning platform.
 *
 * A no-build vanilla SPA on the October "Marketing Intelligence" design system
 * (dark sidebar, cream canvas, yellow accent). Views:
 *  - Dashboard:  stat cards + Getting started + workspace cards.
 *  - Events:     the confirm→green readiness board (oe/v1/planning).
 *  - Tasks:      the shared department task board (oe/v1/tasks).
 *  - Volunteers: shift signups + decisions (oe/v1/volunteers).
 */
import { api, getCreds, setCreds, clearCreds } from './api.js';

const app = document.getElementById('app');
const STATUS = { confirmed: 'Confirmed', in_progress: 'In progress', draft: 'Draft' };

/* Task statuses, in board (column) order. Labels mirror the plugin. */
const TASK_STATUS = { todo: 'To do', doing: 'In progress', blocked: 'Blocked', done: 'Done' };
const TASK_ORDER = ['todo', 'doing', 'blocked', 'done'];

/* Volunteer signup statuses. Labels mirror the plugin. */
const VOL_STATUS = { pending: 'Pending', confirmed: 'Confirmed', declined: 'Declined', no_show: 'No-show' };
const VOL_ORDER = ['pending', 'confirmed', 'declined', 'no_show'];

let route = 'overview';
let taskMeta = null; // { departments, statuses, counts } — cached after first load

/* ---------------------------------------------------------------- */
/* Theme (per-site, overridable from the plugin: Settings → Branding) */
/* ---------------------------------------------------------------- */
const THEME_KEY = 'oe_platform_theme';
const THEME_DEFAULTS = {
  brand_name: 'October Events',
  accent: '#E7CD41',
  accent_on: '#1a1a1a',
  sidebar_bg: '#0b0b0c',
  page_bg: '#faf9f5',
  logo_light: './assets/logo-black.gif',   // for white surfaces (login card)
  logo_dark: './assets/logo-yellow.gif',   // for the dark sidebar
  font_family: '',                          // optional custom family
  font_css: '',                             // optional @font-face / Google Fonts URL
};
let theme = loadTheme();

function loadTheme() {
  try {
    const saved = JSON.parse(localStorage.getItem(THEME_KEY) || 'null');
    return Object.assign({}, THEME_DEFAULTS, saved || {});
  } catch (e) { return Object.assign({}, THEME_DEFAULTS); }
}

function applyTheme(t) {
  const r = document.documentElement.style;
  if (t.accent) { r.setProperty('--accent', t.accent); }
  if (t.accent_on) { r.setProperty('--accent-on', t.accent_on); }
  if (t.sidebar_bg) { r.setProperty('--sidebar-bg', t.sidebar_bg); }
  if (t.page_bg) { r.setProperty('--page-bg', t.page_bg); }
  if (t.accent) { r.setProperty('--accent-soft', hexToSoft(t.accent)); }
  if (t.font_family) { r.setProperty('--font', '"' + t.font_family + '",-apple-system,BlinkMacSystemFont,system-ui,sans-serif'); }
  if (t.font_css && !document.getElementById('oe-font-css')) {
    const link = document.createElement('link');
    link.id = 'oe-font-css'; link.rel = 'stylesheet'; link.href = t.font_css;
    document.head.appendChild(link);
  }
}

function hexToSoft(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) { return 'rgba(231,205,65,0.12)'; }
  return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',0.12)';
}

/* Pull the site's branding once connected; cache it so the login screen of a
   returning user is already themed. Falls back silently to defaults. */
async function refreshBrand() {
  try {
    const b = await api.getBrand();
    if (b && typeof b === 'object') {
      theme = Object.assign({}, THEME_DEFAULTS, b);
      localStorage.setItem(THEME_KEY, JSON.stringify(theme));
      applyTheme(theme);
    }
  } catch (e) { /* keep current theme */ }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }

/* ---------------------------------------------------------------- */
/* Boot                                                             */
/* ---------------------------------------------------------------- */
async function boot() {
  applyTheme(theme);
  if (!getCreds()) { return renderLogin(); }
  try {
    await api.ping();
    refreshBrand(); // non-blocking: theme the app from the connected site
    render();
  } catch (e) {
    renderLogin(e.status === 401 || e.status === 403
      ? 'Those credentials were rejected. Check the username and application password.'
      : 'Could not reach the site. Check the URL.');
  }
}

function render() {
  if (route === 'tasks') { return renderTasks(); }
  if (route === 'volunteers') { return renderVolunteers(); }
  if (route === 'events') { return renderBoard(); }
  if (route === 'email') { return renderEmail(); }
  return renderOverview();
}

/* App shell: dark sidebar (logo + nav + account) and a main content area.
   Returns the <main> element for the active view to fill. */
function shell(active) {
  app.innerHTML = '';
  const user = (getCreds() || {}).user || '';
  const link = (key, lbl) => `<button class="oe-navlink ${active === key ? 'on' : ''}" data-route="${key}">${lbl}</button>`;
  const wrap = el(`
    <div class="oe-shell">
      <aside class="oe-side">
        <div class="oe-brand">
          <img src="${esc(theme.logo_dark)}" alt="${esc(theme.brand_name)}">
          <div class="oe-brand-name">${esc(theme.brand_name)}</div>
        </div>
        <nav class="oe-nav">
          ${link('overview', 'Dashboard')}
          ${link('events', 'Events')}
          ${link('tasks', 'Tasks')}
          ${link('volunteers', 'Volunteers')}
          ${link('email', 'Email')}
        </nav>
        <div class="oe-side-foot">
          <div class="oe-side-user">Signed in as <strong>${esc(user)}</strong></div>
          <button class="btn btn-ghost btn-block" id="b-refresh">Refresh</button>
          <button class="btn btn-ghost btn-block" id="b-out">Sign out</button>
        </div>
      </aside>
      <main class="oe-main"></main>
    </div>`);
  app.appendChild(wrap);
  wrap.querySelectorAll('[data-route]').forEach((b) =>
    b.addEventListener('click', () => { route = b.getAttribute('data-route'); render(); }));
  wrap.querySelector('#b-refresh').addEventListener('click', render);
  wrap.querySelector('#b-out').addEventListener('click', () => { clearCreds(); renderLogin(); });
  return wrap.querySelector('.oe-main');
}

/* Page header: small-caps overline + big title + today's date. */
function pageHeader(overline, title) {
  return el(`
    <header class="oe-head">
      <div class="oe-overline">${esc(overline)}</div>
      <div class="oe-head-row"><h1>${esc(title)}</h1><div class="oe-date">${esc(dateString())}</div></div>
    </header>`);
}

function dateString() {
  try {
    return new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) { return ''; }
}

/* ---------------------------------------------------------------- */
/* Login                                                            */
/* ---------------------------------------------------------------- */
function renderLogin(error) {
  const prev = getCreds() || {};
  app.innerHTML = '';
  const view = el(`
    <div class="oe-login">
      <div class="oe-login-card">
        <img class="oe-login-logo" src="${esc(theme.logo_light)}" alt="${esc(theme.brand_name)}">
        <h1>${esc(theme.brand_name)}</h1>
        <p class="muted">Planning — sign in with your WordPress account.</p>
        ${error ? `<div class="oe-error">${esc(error)}</div>` : ''}
        <label>Site URL<input id="l-base" type="url" placeholder="https://atlantadesignfestival.net" value="${esc(prev.base ? prev.base.replace(/\/wp-json$/, '') : '')}"></label>
        <label>Username<input id="l-user" type="text" autocomplete="username" value="${esc(prev.user || '')}"></label>
        <label>Application password<input id="l-pw" type="password" autocomplete="current-password" placeholder="xxxx xxxx xxxx xxxx"></label>
        <p class="muted small">Create one in WordPress under <em>Users → Profile → Application Passwords</em>.</p>
        <button id="l-go" class="btn btn-primary">Sign in</button>
        <div id="l-msg" class="oe-result"></div>
      </div>
    </div>`);
  app.appendChild(view);

  view.querySelector('#l-go').addEventListener('click', async () => {
    const site = view.querySelector('#l-base').value.trim().replace(/\/+$/, '');
    const user = view.querySelector('#l-user').value.trim();
    const apppw = view.querySelector('#l-pw').value.trim();
    const msg = view.querySelector('#l-msg');
    if (!site || !user || !apppw) { msg.textContent = 'Fill in all three fields.'; return; }
    msg.textContent = 'Connecting…';
    setCreds({ base: site + '/wp-json', user, apppw });
    try { await api.ping(); boot(); }
    catch (e) { clearCreds(); renderLogin(e.status === 401 || e.status === 403 ? 'Credentials rejected.' : 'Could not connect to that site.'); }
  });
}

/* ---------------------------------------------------------------- */
/* Board                                                            */
/* ---------------------------------------------------------------- */
async function renderBoard() {
  const main = shell('events');
  main.appendChild(el('<div class="oe-loading">Loading events…</div>'));
  let events = [];
  try { events = await api.listEvents(); }
  catch (e) { return renderLogin('Session expired — sign in again.'); }

  const groups = { confirmed: [], in_progress: [], draft: [] };
  events.forEach((e) => { (groups[e.status] || groups.draft).push(e); });

  const green = groups.confirmed.length;
  main.innerHTML = '';
  main.appendChild(pageHeader('PLANNING · ' + events.length + ' EVENTS · ' + green + ' GREEN', 'Events'));

  const board = el('<div class="oe-board"></div>');
  ['in_progress', 'draft', 'confirmed'].forEach((status) => {
    const col = el(`<section class="oe-col oe-col-${status}">
      <h2>${STATUS[status]} <span class="count">${groups[status].length}</span></h2>
      <div class="oe-cards"></div></section>`);
    const cards = col.querySelector('.oe-cards');
    if (!groups[status].length) { cards.appendChild(el('<p class="muted small">None.</p>')); }
    groups[status].forEach((e) => cards.appendChild(card(e)));
    board.appendChild(col);
  });
  main.appendChild(board);

  main.querySelectorAll('[data-open]').forEach((c) =>
    c.addEventListener('click', () => openEditor(parseInt(c.getAttribute('data-open'), 10))));
}

function card(e) {
  const green = e.percent >= 100;
  const needs = e.missing && e.missing.length ? `<div class="needs">Needs: ${esc(e.missing.join(', '))}</div>` : '';
  return el(`
    <article class="oe-card" data-open="${e.id}">
      <div class="oe-card-title">${esc(e.title || '(untitled)')}</div>
      <div class="meter"><span style="width:${e.percent}%;background:${green ? '#1a7f37' : '#d8531f'}"></span></div>
      <div class="oe-card-meta">
        <span class="pct">${e.percent}%</span>
        ${e.live ? '<span class="live">● live</span>' : ''}
      </div>
      ${needs}
    </article>`);
}

/* ---------------------------------------------------------------- */
/* Editor drawer                                                    */
/* ---------------------------------------------------------------- */
async function openEditor(id) {
  let rec;
  try { rec = await api.getEvent(id); } catch (e) { alert('Could not load that event.'); return; }

  const f = rec.fields || {};
  const sessionLines = (rec.sessions || []).map((s) =>
    `${s.title || ''} | ${s.time || ''} | ${(s.speakers || []).join(', ')}`).join('\n');

  const drawer = el(`
    <div class="oe-drawer-wrap">
      <div class="oe-drawer-bg"></div>
      <aside class="oe-drawer">
        <div class="oe-drawer-head">
          <h2>${esc(rec.title || '(untitled)')}</h2>
          <button class="btn btn-small" data-close>Close</button>
        </div>
        <div id="d-ready"></div>
        <div class="oe-form">
          <label>Event title<input name="name" value="${esc(f.name || '')}"></label>
          <label>Dates &amp; times<input name="start_datetime" value="${esc(f.start_datetime || '')}" placeholder="Sun 28 Sept 2026, 10:30am–1:00pm"></label>
          <label>End (optional)<input name="end_datetime" value="${esc(f.end_datetime || '')}"></label>
          <label>Price<input name="price" value="${esc(f.price || '')}" placeholder="Free / $25 / From $10"></label>
          <label>Location<input name="location" value="${esc(f.location || '')}"></label>
          <label>Organiser<input name="organiser" value="${esc(f.organiser || '')}"></label>
          <label>Description<textarea name="description" rows="3">${esc(f.description || '')}</textarea></label>
          <label class="row"><input type="checkbox" name="ticket_required" ${f.ticket_required === '1' ? 'checked' : ''}> Requires a ticket</label>
          <label>Sessions <span class="muted small">title | time | speakers</span>
            <textarea name="sessions" rows="4">${esc(sessionLines)}</textarea></label>
          <label>Internal notes<textarea name="notes" rows="2" placeholder="Not published">${esc(f.notes || '')}</textarea></label>
        </div>
        <div class="oe-drawer-foot">
          <button class="btn" data-save>Save</button>
          <button class="btn btn-primary" data-confirm>Confirm — go green</button>
          <div id="d-msg" class="oe-result"></div>
        </div>
      </aside>
    </div>`);
  document.body.appendChild(drawer);

  function paintReady(readiness) {
    const box = drawer.querySelector('#d-ready');
    const items = (readiness.required || []).map((k) => {
      const ok = !(readiness.missing || []).includes(k);
      return `<li class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '○'} ${esc(label(k))}</li>`;
    }).join('');
    box.innerHTML = `<div class="ready"><div class="ready-head">${readiness.percent}% ready</div><ul>${items}</ul></div>`;
    drawer.querySelector('[data-confirm]').disabled = !readiness.complete;
  }
  paintReady(rec.readiness || { required: [], missing: [], percent: 0 });

  const close = () => { drawer.remove(); renderBoard(); };
  drawer.querySelector('[data-close]').addEventListener('click', close);
  drawer.querySelector('.oe-drawer-bg').addEventListener('click', close);

  function collect() {
    const fields = {};
    drawer.querySelectorAll('.oe-form [name]').forEach((inp) => {
      if (inp.name === 'sessions') { return; }
      fields[inp.name] = inp.type === 'checkbox' ? (inp.checked ? '1' : '0') : inp.value;
    });
    const sessions = drawer.querySelector('[name="sessions"]').value.split('\n').map((line) => {
      const p = line.split('|').map((x) => x.trim());
      if (!p[0]) { return null; }
      return { title: p[0], time: p[1] || '', speakers: (p[2] || '').split(',').map((x) => x.trim()).filter(Boolean) };
    }).filter(Boolean);
    return { fields, sessions };
  }

  drawer.querySelector('[data-save]').addEventListener('click', async () => {
    const msg = drawer.querySelector('#d-msg'); msg.textContent = 'Saving…';
    try { const updated = await api.updateEvent(id, collect()); paintReady(updated.readiness); msg.textContent = 'Saved.'; }
    catch (e) { msg.textContent = e.message || 'Error'; }
  });

  drawer.querySelector('[data-confirm]').addEventListener('click', async () => {
    const msg = drawer.querySelector('#d-msg'); msg.textContent = 'Saving & confirming…';
    try {
      await api.updateEvent(id, collect());
      await api.confirmEvent(id);
      msg.textContent = 'Confirmed — it\'s green and live.';
      setTimeout(close, 700);
    } catch (e) {
      msg.textContent = e.body && e.body.missing && e.body.missing.length
        ? 'Still needs: ' + e.body.missing.join(', ') : (e.message || 'Error');
    }
  });
}

function label(k) {
  return ({ name: 'Event title', start_datetime: 'Dates & times', end_datetime: 'End date & time',
    price: 'Price', location: 'Location', description: 'Description', organiser: 'Organiser', image: 'Image' }[k])
    || k.replace(/_/g, ' ');
}

/* ---------------------------------------------------------------- */
/* Tasks board                                                      */
/* ---------------------------------------------------------------- */
async function renderTasks() {
  const main = shell('tasks');
  main.appendChild(el('<div class="oe-loading">Loading tasks…</div>'));

  let tasks = [];
  try {
    if (!taskMeta) { taskMeta = await api.tasksMeta(); }
    tasks = await api.listTasks();
  } catch (e) {
    if (e.status === 401 || e.status === 403) { return renderLogin('Session expired — sign in again.'); }
    main.innerHTML = '<div class="oe-error" style="margin:24px 0">Could not load tasks.</div>';
    return;
  }

  const departments = (taskMeta && taskMeta.departments) || [];
  const open = tasks.filter((t) => t.status === 'todo' || t.status === 'doing').length;
  main.innerHTML = '';
  main.appendChild(pageHeader('TASKS · ' + tasks.length + ' TOTAL · ' + open + ' OPEN', 'Tasks'));
  main.appendChild(taskAddForm(departments));

  const groups = {};
  TASK_ORDER.forEach((s) => { groups[s] = []; });
  tasks.forEach((t) => { (groups[t.status] || groups.todo).push(t); });

  const board = el('<div class="oe-board oe-tasks-board"></div>');
  TASK_ORDER.forEach((status) => {
    const col = el(`<section class="oe-col oe-tcol-${status}">
      <h2>${TASK_STATUS[status]} <span class="count">${groups[status].length}</span></h2>
      <div class="oe-cards"></div></section>`);
    const cards = col.querySelector('.oe-cards');
    if (!groups[status].length) { cards.appendChild(el('<p class="muted small">None.</p>')); }
    groups[status].forEach((t) => cards.appendChild(taskCard(t, departments)));
    board.appendChild(col);
  });
  main.appendChild(board);
}

function taskAddForm(departments) {
  const opts = departments.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
  const form = el(`
    <form class="oe-task-add">
      <input name="title" placeholder="Add a task…" required>
      <select name="department">${opts}</select>
      <input name="due_date" type="date" title="Due date">
      <button class="btn btn-primary btn-small" type="submit">Add</button>
      <span class="oe-result" id="t-add-msg"></span>
    </form>`);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const title = form.querySelector('[name="title"]').value.trim();
    const msg = form.querySelector('#t-add-msg');
    if (!title) { return; }
    msg.textContent = 'Adding…';
    try {
      await api.createTask({
        title,
        department: form.querySelector('[name="department"]').value,
        due_date: form.querySelector('[name="due_date"]').value,
        status: 'todo',
      });
      renderTasks();
    } catch (e) { msg.textContent = e.message || 'Error'; }
  });
  return form;
}

function taskCard(t, departments) {
  const due = t.due_date ? `<span class="t-due">${esc(t.due_date)}</span>` : '';
  const who = t.assignee ? `<span class="t-who">${esc(t.assignee)}</span>` : '';
  const statusOpts = TASK_ORDER.map((s) =>
    `<option value="${s}" ${t.status === s ? 'selected' : ''}>${TASK_STATUS[s]}</option>`).join('');
  const card = el(`
    <article class="oe-card oe-task-card">
      <div class="oe-card-title">${esc(t.title || '(untitled)')}</div>
      <div class="t-chips">
        <span class="t-dept">${esc(t.department || 'Uncategorized')}</span>
        ${who}${due}
      </div>
      <div class="t-actions">
        <select class="t-status">${statusOpts}</select>
        <button class="btn btn-small t-edit">Edit</button>
      </div>
    </article>`);
  card.querySelector('.t-status').addEventListener('change', async (ev) => {
    try { await api.updateTask(t.id, { ...t, status: ev.target.value }); renderTasks(); }
    catch (e) { alert(e.message || 'Could not update status.'); }
  });
  card.querySelector('.t-edit').addEventListener('click', () => openTaskEditor(t, departments));
  return card;
}

function openTaskEditor(t, departments) {
  const deptOpts = departments.map((d) =>
    `<option value="${esc(d)}" ${t.department === d ? 'selected' : ''}>${esc(d)}</option>`).join('');
  const statusOpts = TASK_ORDER.map((s) =>
    `<option value="${s}" ${t.status === s ? 'selected' : ''}>${TASK_STATUS[s]}</option>`).join('');
  const drawer = el(`
    <div class="oe-drawer-wrap">
      <div class="oe-drawer-bg"></div>
      <aside class="oe-drawer">
        <div class="oe-drawer-head">
          <h2>Edit task</h2>
          <button class="btn btn-small" data-close>Close</button>
        </div>
        <div class="oe-form">
          <label>Title<input name="title" value="${esc(t.title || '')}"></label>
          <label>Department<select name="department">${deptOpts}</select></label>
          <label>Status<select name="status">${statusOpts}</select></label>
          <label>Due date<input name="due_date" type="date" value="${esc((t.due_date || '').slice(0, 10))}"></label>
          <label>Assignee<input name="assignee" value="${esc(t.assignee || '')}"></label>
          <label>Notes<textarea name="notes" rows="3">${esc(t.notes || '')}</textarea></label>
        </div>
        <div class="oe-drawer-foot">
          <button class="btn btn-primary" data-save>Save</button>
          <button class="btn t-delete" data-delete>Delete</button>
          <div id="t-msg" class="oe-result"></div>
        </div>
      </aside>
    </div>`);
  document.body.appendChild(drawer);

  const close = () => { drawer.remove(); renderTasks(); };
  drawer.querySelector('[data-close]').addEventListener('click', close);
  drawer.querySelector('.oe-drawer-bg').addEventListener('click', close);

  drawer.querySelector('[data-save]').addEventListener('click', async () => {
    const msg = drawer.querySelector('#t-msg'); msg.textContent = 'Saving…';
    const payload = {};
    drawer.querySelectorAll('.oe-form [name]').forEach((inp) => { payload[inp.name] = inp.value; });
    if (!payload.title.trim()) { msg.textContent = 'A title is required.'; return; }
    try { await api.updateTask(t.id, payload); close(); }
    catch (e) { msg.textContent = e.message || 'Error'; }
  });

  drawer.querySelector('[data-delete]').addEventListener('click', async () => {
    if (!confirm('Delete this task?')) { return; }
    try { await api.deleteTask(t.id); close(); }
    catch (e) { drawer.querySelector('#t-msg').textContent = e.message || 'Error'; }
  });
}

/* ---------------------------------------------------------------- */
/* Volunteers                                                       */
/* ---------------------------------------------------------------- */
async function renderVolunteers() {
  const main = shell('volunteers');
  main.appendChild(el('<div class="oe-loading">Loading volunteer opportunities…</div>'));

  let opps = [];
  try { opps = await api.listOpportunities(); }
  catch (e) {
    if (e.status === 401 || e.status === 403) { return renderLogin('Session expired — sign in again.'); }
    main.innerHTML = '<div class="oe-error" style="margin:24px 0">Could not load volunteers.</div>';
    return;
  }

  let capacity = 0; let filled = 0;
  opps.forEach((o) => { capacity += o.capacity; filled += o.filled; });
  main.innerHTML = '';
  main.appendChild(pageHeader('VOLUNTEERS · ' + opps.length + ' OPPORTUNITIES · ' + filled + '/' + capacity + ' FILLED', 'Volunteers'));

  if (!opps.length) {
    main.appendChild(emptyState('No volunteer opportunities yet.',
      'Create a volunteer opportunity in WordPress (Volunteer → Add new) and define its shifts — they\'ll appear here to manage signups.'));
    return;
  }

  const grid = el('<div class="oe-vol-grid"></div>');
  opps.forEach((o) => grid.appendChild(oppCard(o)));
  main.appendChild(grid);

  grid.querySelectorAll('[data-vopen]').forEach((c) =>
    c.addEventListener('click', () => openOpportunity(parseInt(c.getAttribute('data-vopen'), 10))));
}

/* Reusable empty-state card. */
function emptyState(title, body) {
  return el(`<div class="oe-empty"><div class="oe-empty-title">${esc(title)}</div><p class="muted">${esc(body)}</p></div>`);
}

function oppCard(o) {
  const pct = o.capacity > 0 ? Math.min(100, Math.round((o.filled / o.capacity) * 100)) : 0;
  const full = o.capacity > 0 && o.filled >= o.capacity;
  const meta = [o.role, o.location].filter(Boolean).map(esc).join(' · ');
  const pending = o.pending ? `<span class="v-pending">${o.pending} to review</span>` : '';
  return el(`
    <article class="oe-card oe-vol-card" data-vopen="${o.id}">
      <div class="oe-card-title">${esc(o.title)}</div>
      ${meta ? `<div class="muted small">${meta}</div>` : ''}
      <div class="meter"><span style="width:${pct}%;background:${full ? '#1a7f37' : '#d8531f'}"></span></div>
      <div class="oe-card-meta">
        <span>${o.filled} / ${o.capacity} across ${o.shifts} shift${o.shifts === 1 ? '' : 's'}</span>
        ${o.open ? '' : '<span class="v-closed">closed</span>'}
      </div>
      ${pending}
    </article>`);
}

async function openOpportunity(id) {
  let rec;
  try { rec = await api.getOpportunity(id); } catch (e) { alert('Could not load that opportunity.'); return; }

  const drawer = el(`
    <div class="oe-drawer-wrap">
      <div class="oe-drawer-bg"></div>
      <aside class="oe-drawer oe-drawer-wide">
        <div class="oe-drawer-head">
          <h2>${esc(rec.title)}</h2>
          <button class="btn btn-small" data-close>Close</button>
        </div>
        <div class="oe-vol-body"></div>
      </aside>
    </div>`);
  document.body.appendChild(drawer);

  const close = () => { drawer.remove(); renderVolunteers(); };
  drawer.querySelector('[data-close]').addEventListener('click', close);
  drawer.querySelector('.oe-drawer-bg').addEventListener('click', close);

  const body = drawer.querySelector('.oe-vol-body');

  function paint(detail) {
    body.innerHTML = '';
    const meta = [detail.role, detail.location].filter(Boolean).map(esc).join(' · ');
    if (meta) { body.appendChild(el(`<p class="muted" style="margin:0 20px">${meta}</p>`)); }
    if (!detail.shifts_detail.length) { body.appendChild(el('<p class="muted small" style="margin:16px 20px">No shifts defined yet.</p>')); }
    detail.shifts_detail.forEach((s) => body.appendChild(shiftBlock(detail.id, s, replace)));
  }
  /* Re-render with a fresh detail payload returned by any mutation. */
  function replace(detail) { paint(detail); }
  paint(rec);
}

function shiftBlock(oppId, shift, replace) {
  const when = [shift.start, shift.end].filter(Boolean).join(' → ');
  const block = el(`
    <section class="v-shift">
      <div class="v-shift-head">
        <strong>${esc(shift.label || '(shift)')}</strong>
        <span class="muted small">${esc(when)} · ${shift.signups.filter((x) => x.status === 'pending' || x.status === 'confirmed').length}/${shift.capacity}${shift.full ? ' · full' : ''}</span>
      </div>
      <div class="v-signups"></div>
      <form class="v-add">
        <input name="name" placeholder="Name" required>
        <input name="email" type="email" placeholder="Email" required>
        <input name="phone" placeholder="Phone (optional)">
        <button class="btn btn-small btn-primary" type="submit">Add</button>
        <span class="oe-result v-add-msg"></span>
      </form>
    </section>`);

  const list = block.querySelector('.v-signups');
  if (!shift.signups.length) { list.appendChild(el('<p class="muted small">No signups yet.</p>')); }
  shift.signups.forEach((su) => list.appendChild(signupRow(su, replace)));

  const form = block.querySelector('.v-add');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const msg = form.querySelector('.v-add-msg');
    const name = form.querySelector('[name="name"]').value.trim();
    const email = form.querySelector('[name="email"]').value.trim();
    if (!name || !email) { return; }
    msg.textContent = 'Adding…';
    try {
      const detail = await api.addSignup(oppId, {
        shift_id: shift.id, name, email,
        phone: form.querySelector('[name="phone"]').value.trim(),
      });
      replace(detail);
    } catch (e) { msg.textContent = e.message || 'Error'; }
  });
  return block;
}

function signupRow(su, replace) {
  const opts = VOL_ORDER.map((s) =>
    `<option value="${s}" ${su.status === s ? 'selected' : ''}>${VOL_STATUS[s]}</option>`).join('');
  const row = el(`
    <div class="v-row">
      <div class="v-who">
        <span class="v-name">${esc(su.name)}</span>
        <span class="muted small">${esc(su.email)}${su.phone ? ' · ' + esc(su.phone) : ''}</span>
      </div>
      <label class="v-checkin" title="Checked in"><input type="checkbox" ${su.checked_in ? 'checked' : ''}> in</label>
      <select class="v-status">${opts}</select>
      <button class="btn btn-small v-remove" title="Remove">✕</button>
    </div>`);

  row.querySelector('.v-status').addEventListener('change', async (ev) => {
    try { replace(await api.updateSignup(su.id, { status: ev.target.value })); }
    catch (e) { alert(e.message || 'Could not update.'); }
  });
  row.querySelector('.v-checkin input').addEventListener('change', async (ev) => {
    try { replace(await api.updateSignup(su.id, { checked_in: ev.target.checked })); }
    catch (e) { alert(e.message || 'Could not update check-in.'); }
  });
  row.querySelector('.v-remove').addEventListener('click', async () => {
    if (!confirm('Remove ' + su.name + ' from this shift?')) { return; }
    try { replace(await api.deleteSignup(su.id)); }
    catch (e) { alert(e.message || 'Could not remove.'); }
  });
  return row;
}

/* ---------------------------------------------------------------- */
/* Overview                                                         */
/* ---------------------------------------------------------------- */
async function renderOverview() {
  const main = shell('overview');
  main.appendChild(el('<div class="oe-loading">Loading dashboard…</div>'));

  // Pull all three boards in parallel; tolerate any single one failing.
  const [events, tasks, opps] = await Promise.all([
    api.listEvents().catch(() => null),
    api.listTasks().catch(() => null),
    api.listOpportunities().catch(() => null),
  ]);
  if (events === null && tasks === null && opps === null) {
    return renderLogin('Session expired — sign in again.');
  }

  // Derive the numbers once.
  const ev = events || [];
  const tk = tasks || [];
  const op = opps || [];
  const total = ev.length;
  const green = ev.filter((e) => e.status === 'confirmed').length;
  const prog = ev.filter((e) => e.status === 'in_progress').length;
  const openTasks = tk.filter((t) => t.status === 'todo' || t.status === 'doing').length;
  const blocked = tk.filter((t) => t.status === 'blocked').length;
  const doneTasks = tk.filter((t) => t.status === 'done').length;
  let capacity = 0; let filled = 0; let pending = 0;
  op.forEach((o) => { capacity += o.capacity; filled += o.filled; pending += o.pending; });
  const shortfall = Math.max(0, capacity - filled);
  const attention = blocked + pending;

  main.innerHTML = '';
  main.appendChild(pageHeader(
    'OVERVIEW · ' + total + ' EVENTS · ' + (attention ? 'NEEDS ATTENTION' : 'ALL ON TRACK'),
    'Dashboard'
  ));

  // Stat cards (first one highlighted dark, like OMI).
  const stats = el('<div class="oe-stats"></div>');
  stats.appendChild(statCard('Events ready', green + '/' + (total || 0), 'confirmed & green', true));
  stats.appendChild(statCard('Open tasks', String(openTasks), blocked ? blocked + ' blocked' : 'none blocked', false, blocked ? 'amber' : ''));
  stats.appendChild(statCard('Volunteer slots', filled + '/' + (capacity || 0),
    capacity === 0 ? 'no shifts yet' : (shortfall ? shortfall + ' still open' : 'fully staffed'),
    false, capacity === 0 ? '' : (shortfall ? 'amber' : 'green')));
  stats.appendChild(statCard('Needs attention', String(attention), attention ? 'to action' : 'all clear', false, attention ? 'amber' : 'green'));
  main.appendChild(stats);

  // Getting started checklist.
  main.appendChild(gettingStarted([
    { label: 'Confirm your first event to green', done: green > 0, route: 'events', cta: 'Open Events' },
    { label: 'Add a team task', done: tk.length > 0, route: 'tasks', cta: 'Open Tasks' },
    { label: 'Set up a volunteer opportunity with shifts', done: capacity > 0, route: 'volunteers', cta: 'Open Volunteers' },
    { label: 'Connect email sending (Amazon SES)', soon: true },
  ]));

  // Module cards (the three boards).
  main.appendChild(el('<h2 class="oe-section-title">Workspaces</h2>'));
  const mods = el('<div class="oe-mods"></div>');
  mods.appendChild(moduleCard('events', 'Events', green > 0 ? 'green' : 'amber', events,
    [[green + '/' + total, 'confirmed'], [prog, 'in progress']]));
  mods.appendChild(moduleCard('tasks', 'Tasks', blocked ? 'amber' : 'green', tasks,
    [[openTasks, 'open'], [doneTasks, 'done']]));
  mods.appendChild(moduleCard('volunteers', 'Volunteers', shortfall ? 'amber' : 'green', opps,
    [[filled + '/' + capacity, 'filled'], [pending, 'to review']]));
  main.appendChild(mods);

  main.querySelectorAll('[data-goto]').forEach((c) =>
    c.addEventListener('click', () => { route = c.getAttribute('data-goto'); render(); }));
}

function statCard(label, value, sub, dark, dot) {
  return el(`
    <div class="stat ${dark ? 'stat-dark' : ''}">
      <div class="stat-k">${esc(label)}</div>
      <div class="stat-v">${esc(value)}</div>
      <div class="stat-s">${dot ? `<i class="dot dot-${dot}"></i>` : ''}${esc(sub)}</div>
    </div>`);
}

function gettingStarted(steps) {
  const done = steps.filter((s) => s.done).length;
  const total = steps.filter((s) => !s.soon).length;
  const box = el(`
    <section class="gs">
      <div class="gs-head">
        <h2>Getting started</h2>
        <span class="gs-prog">${done} of ${total} done</span>
      </div>
      <div class="gs-list"></div>
    </section>`);
  const list = box.querySelector('.gs-list');
  steps.forEach((s) => {
    const item = el(`
      <div class="gs-item ${s.done ? 'is-done' : ''} ${s.soon ? 'is-soon' : ''}">
        <span class="gs-check">${s.done ? '✓' : ''}</span>
        <span class="gs-label">${esc(s.label)}</span>
        ${s.soon ? '<span class="gs-soon">soon</span>'
          : (s.done ? '' : `<button class="btn btn-small btn-primary" data-goto="${s.route}">${esc(s.cta)}</button>`)}
      </div>`);
    list.appendChild(item);
  });
  return box;
}

function moduleCard(routeKey, name, dot, data, rows) {
  const unavailable = data === null;
  const stats = unavailable
    ? '<div class="mod-row"><span class="muted small">Couldn\'t load.</span></div>'
    : rows.map((r) => `<div class="mod-row"><span class="mod-n">${esc(String(r[0]))}</span><span class="mod-l">${esc(r[1])}</span></div>`).join('');
  return el(`
    <article class="mod" data-goto="${routeKey}">
      <div class="mod-head">
        <h3>${esc(name)}</h3>
        <i class="dot dot-${unavailable ? 'amber' : dot}"></i>
      </div>
      <div class="mod-body">${stats}</div>
      <div class="mod-foot">Open <span class="mod-arrow">→</span></div>
    </article>`);
}

/* ---------------------------------------------------------------- */
/* Email — campaigns list + block builder                           */
/* ---------------------------------------------------------------- */
const CAMPAIGN_STATUS = { draft: 'Draft', scheduled: 'Scheduled', sending: 'Sending', sent: 'Sent', paused: 'Paused' };
const BLOCK_DEFS = {
  heading: { label: 'Heading', make: () => ({ type: 'heading', text: 'Your headline', level: 'h2' }) },
  text:    { label: 'Text',    make: () => ({ type: 'text', text: 'Write something here…' }) },
  image:   { label: 'Image',   make: () => ({ type: 'image', url: '', alt: '', href: '' }) },
  button:  { label: 'Button',  make: () => ({ type: 'button', label: 'Read more', href: 'https://' }) },
  divider: { label: 'Divider', make: () => ({ type: 'divider' }) },
  spacer:  { label: 'Spacer',  make: () => ({ type: 'spacer' }) },
};

async function renderEmail() {
  const main = shell('email');
  main.appendChild(el('<div class="oe-loading">Loading campaigns…</div>'));
  let campaigns = [];
  try { campaigns = await api.listCampaigns(); }
  catch (e) {
    if (e.status === 401 || e.status === 403) { return renderLogin('Session expired — sign in again.'); }
    main.innerHTML = '<div class="oe-error" style="margin:24px 0">Could not load campaigns.</div>';
    return;
  }
  main.innerHTML = '';
  main.appendChild(pageHeader('EMAIL · ' + campaigns.length + ' CAMPAIGN' + (campaigns.length === 1 ? '' : 'S'), 'Email'));

  const bar = el('<div style="margin-bottom:20px"><button class="btn btn-primary" id="c-new">+ New campaign</button></div>');
  bar.querySelector('#c-new').addEventListener('click', () => openCampaign(null));
  main.appendChild(bar);

  if (!campaigns.length) {
    main.appendChild(emptyState('No campaigns yet.', 'Create your first campaign — write it block by block, pick an audience, send a test, then schedule or send.'));
    return;
  }
  const grid = el('<div class="oe-mods"></div>');
  campaigns.forEach((c) => grid.appendChild(campaignCard(c)));
  main.appendChild(grid);
  grid.querySelectorAll('[data-copen]').forEach((c) =>
    c.addEventListener('click', () => openCampaign(parseInt(c.getAttribute('data-copen'), 10))));
}

function campaignCard(c) {
  const s = c.stats || {};
  return el(`
    <article class="mod" data-copen="${c.id}">
      <div class="mod-head"><h3>${esc(c.name || '(untitled)')}</h3><span class="chip">${esc(CAMPAIGN_STATUS[c.status] || c.status)}</span></div>
      <div class="muted small" style="margin-bottom:14px">${esc(c.subject || 'No subject')}</div>
      <div class="mod-body">
        <div class="mod-row"><span class="mod-n">${s.sent || 0}</span><span class="mod-l">sent</span></div>
        <div class="mod-row"><span class="mod-n">${s.opened || 0}</span><span class="mod-l">opened</span></div>
        <div class="mod-row"><span class="mod-n">${s.clicked || 0}</span><span class="mod-l">clicked</span></div>
      </div>
      <div class="mod-foot">Edit <span class="mod-arrow">→</span></div>
    </article>`);
}

async function openCampaign(id) {
  const main = shell('email');
  main.appendChild(el('<div class="oe-loading">Loading…</div>'));
  let rec = { id: 0, name: '', subject: '', preheader: '', audience: 'subscribed', body_json: '[]', status: 'draft', stats: {} };
  let audiences = [{ key: 'subscribed', label: 'All subscribers', count: 0 }];
  try {
    if (id) { rec = await api.getCampaign(id); }
    audiences = await api.audiences();
  } catch (e) {
    if (e.status === 401 || e.status === 403) { return renderLogin('Session expired — sign in again.'); }
  }
  let blocks = [];
  try { blocks = JSON.parse(rec.body_json || '[]'); if (!Array.isArray(blocks)) { blocks = []; } } catch (e) { blocks = []; }

  main.innerHTML = '';
  main.appendChild(pageHeader('EMAIL · ' + (id ? 'EDIT CAMPAIGN' : 'NEW CAMPAIGN'), rec.name || 'Untitled campaign'));

  const layout = el('<div class="oe-cmp"></div>');
  const left = el('<div class="oe-cmp-edit"></div>');
  const right = el('<div class="oe-cmp-side"></div>');
  layout.appendChild(left); layout.appendChild(right);
  main.appendChild(layout);

  const audOpts = audiences.map((a) => `<option value="${esc(a.key)}" ${rec.audience === a.key ? 'selected' : ''}>${esc(a.label)} (${a.count})</option>`).join('');
  const meta = el(`<div class="oe-form" style="padding:0;gap:14px">
    <label>Campaign name<input name="name" value="${esc(rec.name || '')}"></label>
    <label>Subject line<input name="subject" value="${esc(rec.subject || '')}"></label>
    <label>Preheader <span class="muted small">preview text</span><input name="preheader" value="${esc(rec.preheader || '')}"></label>
    <label>Audience<select name="audience">${audOpts}</select></label>
  </div>`);
  left.appendChild(meta);

  left.appendChild(el('<div class="oe-cmp-label">Content blocks</div>'));
  const toolbar = el('<div class="oe-blocktools"></div>');
  Object.keys(BLOCK_DEFS).forEach((k) => {
    const b = el(`<button class="btn btn-small">+ ${esc(BLOCK_DEFS[k].label)}</button>`);
    b.addEventListener('click', () => { blocks.push(BLOCK_DEFS[k].make()); paintBlocks(); });
    toolbar.appendChild(b);
  });
  left.appendChild(toolbar);
  const blockList = el('<div class="oe-blocks"></div>');
  left.appendChild(blockList);

  const actions = el(`<div class="oe-cmp-actions">
    <button class="btn" data-save>Save</button>
    <button class="btn" data-test>Send test…</button>
    <button class="btn btn-primary" data-send>Send / schedule…</button>
    <div class="oe-result" id="c-msg"></div>
    <a class="oe-cmp-back" data-back>← All campaigns</a>
  </div>`);
  right.appendChild(actions);
  right.appendChild(el('<div class="oe-cmp-label">Preview</div>'));
  const preview = el('<div class="oe-preview"></div>');
  right.appendChild(preview);

  function field(label, inner) { return el(`<label class="oe-bf">${label ? `<span>${esc(label)}</span>` : ''}${inner}</label>`); }

  function blockEditor(b, i) {
    const card = el(`<div class="oe-block">
      <div class="oe-block-head"><span class="oe-block-type">${esc(b.type)}</span>
        <span class="oe-block-ctrls"><button data-up title="Move up">↑</button><button data-down title="Move down">↓</button><button data-del title="Remove">✕</button></span></div>
      <div class="oe-block-body"></div></div>`);
    const body = card.querySelector('.oe-block-body');
    if (b.type === 'heading') {
      body.appendChild(field('Text', `<input value="${esc(b.text || '')}" data-f="text">`));
      body.appendChild(field('Level', `<select data-f="level"><option value="h1" ${b.level === 'h1' ? 'selected' : ''}>H1</option><option value="h2" ${b.level !== 'h1' && b.level !== 'h3' ? 'selected' : ''}>H2</option><option value="h3" ${b.level === 'h3' ? 'selected' : ''}>H3</option></select>`));
    } else if (b.type === 'text') {
      body.appendChild(field('', `<textarea rows="3" data-f="text">${esc(b.text || '')}</textarea>`));
    } else if (b.type === 'image') {
      body.appendChild(field('Image URL', `<input value="${esc(b.url || '')}" data-f="url" placeholder="https://…">`));
      const pick = el('<button class="btn btn-small">Choose from media library</button>');
      pick.addEventListener('click', () => openMediaPicker((url) => { b.url = url; paintBlocks(); }));
      body.appendChild(pick);
      body.appendChild(field('Alt text', `<input value="${esc(b.alt || '')}" data-f="alt">`));
      body.appendChild(field('Links to (optional)', `<input value="${esc(b.href || '')}" data-f="href" placeholder="https://…">`));
      if (b.url) { body.appendChild(el(`<img src="${esc(b.url)}" class="oe-block-thumb" alt="">`)); }
    } else if (b.type === 'button') {
      body.appendChild(field('Label', `<input value="${esc(b.label || '')}" data-f="label">`));
      body.appendChild(field('Links to', `<input value="${esc(b.href || '')}" data-f="href" placeholder="https://…">`));
    } else {
      body.appendChild(el('<p class="muted small" style="margin:0">No options.</p>'));
    }
    body.querySelectorAll('[data-f]').forEach((inp) => {
      const upd = () => { b[inp.getAttribute('data-f')] = inp.value; paintPreview(); };
      inp.addEventListener('input', upd); inp.addEventListener('change', upd);
    });
    card.querySelector('[data-up]').addEventListener('click', () => { if (i > 0) { const t = blocks[i - 1]; blocks[i - 1] = blocks[i]; blocks[i] = t; paintBlocks(); } });
    card.querySelector('[data-down]').addEventListener('click', () => { if (i < blocks.length - 1) { const t = blocks[i + 1]; blocks[i + 1] = blocks[i]; blocks[i] = t; paintBlocks(); } });
    card.querySelector('[data-del]').addEventListener('click', () => { blocks.splice(i, 1); paintBlocks(); });
    return card;
  }

  function paintBlocks() {
    blockList.innerHTML = '';
    if (!blocks.length) { blockList.appendChild(el('<p class="muted small">No blocks yet — add one above.</p>')); }
    blocks.forEach((b, i) => blockList.appendChild(blockEditor(b, i)));
    paintPreview();
  }
  function paintPreview() { preview.innerHTML = blocksToHtml(blocks, true); }

  function collect() {
    return {
      name: meta.querySelector('[name="name"]').value.trim(),
      subject: meta.querySelector('[name="subject"]').value.trim(),
      preheader: meta.querySelector('[name="preheader"]').value.trim(),
      audience: meta.querySelector('[name="audience"]').value,
      body_json: JSON.stringify(blocks),
      body_html: blocksToHtml(blocks, false),
    };
  }
  async function save() {
    const msg = actions.querySelector('#c-msg'); msg.textContent = 'Saving…';
    try {
      if (rec.id) { await api.updateCampaign(rec.id, collect()); }
      else { const created = await api.createCampaign(collect()); rec.id = created.id; id = created.id; }
      msg.textContent = 'Saved.'; return true;
    } catch (e) { msg.textContent = e.message || 'Error'; return false; }
  }

  actions.querySelector('[data-save]').addEventListener('click', save);
  actions.querySelector('[data-back]').addEventListener('click', () => { route = 'email'; render(); });
  actions.querySelector('[data-test]').addEventListener('click', async () => {
    if (!(await save())) { return; }
    const email = prompt('Send a test to which email address?');
    if (!email) { return; }
    const msg = actions.querySelector('#c-msg'); msg.textContent = 'Sending test…';
    try { const r = await api.testCampaign(rec.id, email); msg.textContent = r.ok ? 'Test sent to ' + email + '.' : 'Test failed — is SES configured?'; }
    catch (e) { msg.textContent = e.message || 'Error'; }
  });
  actions.querySelector('[data-send]').addEventListener('click', async () => {
    if (!(await save())) { return; }
    const aud = audiences.find((a) => a.key === collect().audience);
    if (!confirm('Send "' + (rec.name || 'this campaign') + '" to ' + (aud ? aud.count : 'the selected') + ' recipient(s)?')) { return; }
    const msg = actions.querySelector('#c-msg'); msg.textContent = 'Queuing…';
    try { const r = await api.sendCampaign(rec.id); msg.textContent = 'Queued ' + r.queued + ' — sending in the background.'; setTimeout(() => { route = 'email'; render(); }, 1400); }
    catch (e) { msg.textContent = e.message || 'Error'; }
  });

  paintBlocks();
}

function blocksToHtml(blocks, isPreview) {
  const accent = (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#E7CD41').trim();
  const rows = blocks.map((b) => {
    if (b.type === 'heading') {
      const size = b.level === 'h1' ? '28px' : (b.level === 'h3' ? '18px' : '22px');
      return `<tr><td style="padding:8px 0"><div style="font-family:Arial,Helvetica,sans-serif;font-size:${size};font-weight:bold;color:#1a1a1a;line-height:1.25">${esc(b.text || '')}</div></td></tr>`;
    }
    if (b.type === 'text') {
      return `<tr><td style="padding:8px 0"><div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#333">${esc(b.text || '').replace(/\n/g, '<br>')}</div></td></tr>`;
    }
    if (b.type === 'image') {
      if (!b.url) { return isPreview ? '<tr><td style="padding:8px 0"><div style="background:#f3f3f3;border:1px dashed #ccc;border-radius:8px;padding:34px;text-align:center;color:#999;font-family:Arial">Image — pick from the media library</div></td></tr>' : ''; }
      const img = `<img src="${esc(b.url)}" alt="${esc(b.alt || '')}" style="max-width:100%;border-radius:8px;display:block">`;
      return `<tr><td style="padding:8px 0">${b.href ? `<a href="${esc(b.href)}">${img}</a>` : img}</td></tr>`;
    }
    if (b.type === 'button') {
      return `<tr><td style="padding:12px 0"><a href="${esc(b.href || '#')}" style="display:inline-block;background:${accent};color:#1a1a1a;font-family:Arial,Helvetica,sans-serif;font-weight:bold;font-size:15px;text-decoration:none;padding:12px 24px;border-radius:999px">${esc(b.label || 'Button')}</a></td></tr>`;
    }
    if (b.type === 'divider') { return '<tr><td style="padding:12px 0"><hr style="border:none;border-top:1px solid #e3e2db"></td></tr>'; }
    if (b.type === 'spacer') { return '<tr><td style="height:24px;line-height:24px">&nbsp;</td></tr>'; }
    return '';
  }).join('');
  const inner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${isPreview ? '#f3f3f3' : '#faf9f5'};padding:${isPreview ? '0' : '20px'}"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;border-radius:12px"><tr><td style="padding:24px">${inner}</td></tr></table></td></tr></table>`;
}

async function openMediaPicker(onPick) {
  const modal = el(`<div class="oe-drawer-wrap"><div class="oe-drawer-bg"></div>
    <aside class="oe-drawer oe-drawer-wide"><div class="oe-drawer-head"><h2>Media library</h2><button class="btn btn-small" data-close>Close</button></div>
    <div class="oe-media"><div class="oe-loading">Loading…</div></div></aside></div>`);
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('[data-close]').addEventListener('click', close);
  modal.querySelector('.oe-drawer-bg').addEventListener('click', close);
  const wrap = modal.querySelector('.oe-media');
  try {
    const items = await api.listMedia();
    wrap.innerHTML = '';
    if (!items || !items.length) { wrap.appendChild(el('<p class="muted">No images in the media library yet.</p>')); return; }
    const grid = el('<div class="oe-media-grid"></div>');
    items.forEach((m) => {
      const cell = el(`<button class="oe-media-cell"><img src="${esc(m.source_url)}" alt="" loading="lazy"></button>`);
      cell.addEventListener('click', () => { onPick(m.source_url); close(); });
      grid.appendChild(cell);
    });
    wrap.appendChild(grid);
  } catch (e) {
    wrap.innerHTML = '<p class="oe-error">Could not load media — ' + esc(e.message || 'error') + '</p>';
  }
}

boot();
