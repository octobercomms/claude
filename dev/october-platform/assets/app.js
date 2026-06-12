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

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }

/* ---------------------------------------------------------------- */
/* Boot                                                             */
/* ---------------------------------------------------------------- */
async function boot() {
  if (!getCreds()) { return renderLogin(); }
  try {
    await api.ping();
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
          <div class="oe-logo"><span></span><span></span><span></span></div>
          <div class="oe-brand-name">October<br>Events</div>
        </div>
        <nav class="oe-nav">
          ${link('overview', 'Dashboard')}
          ${link('events', 'Events')}
          ${link('tasks', 'Tasks')}
          ${link('volunteers', 'Volunteers')}
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
        <div class="oe-logo oe-logo-ink"><span></span><span></span><span></span></div>
        <h1>October Events</h1>
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

boot();
