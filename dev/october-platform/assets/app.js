/**
 * October Events — staff platform.
 *
 * A no-build vanilla SPA on the October "Marketing Intelligence" design system
 * (dark sidebar, cream canvas, yellow accent). Views:
 *  - Dashboard:  stat cards + Getting started + workspace cards.
 *  - Tasks:      the shared department task board (oe/v1/tasks).
 *  - Volunteers: shift signups + decisions (oe/v1/volunteers).
 */
import { api, getCreds, setCreds, clearCreds, getSites, setActiveSite, setSiteLabel, activeId } from './api.js';

const app = document.getElementById('app');
const STATUS = { confirmed: 'Confirmed', in_progress: 'In progress', draft: 'Draft' };

/* Task statuses, in board (column) order. Labels mirror the plugin. */
const TASK_STATUS = { todo: 'To do', doing: 'In progress', blocked: 'Blocked', done: 'Done' };
const TASK_ORDER = ['todo', 'doing', 'blocked', 'done'];

/* Volunteer signup statuses. Labels mirror the plugin. */
const VOL_STATUS = { pending: 'Pending', confirmed: 'Confirmed', declined: 'Declined', no_show: 'No-show' };
const VOL_ORDER = ['pending', 'confirmed', 'declined', 'no_show'];

let route = 'overview';

/* Hash routing: each page has a URL like …/#/events, so a refresh (or a shared
   link) lands on the same place. No server rewrites needed — works on static
   hosting. */
const ROUTES = ['overview', 'tasks', 'volunteers', 'email', 'contacts', 'assistant'];
function routeFromHash() {
  const h = (location.hash || '').replace(/^#\/?/, '');
  return ROUTES.indexOf(h) >= 0 ? h : 'overview';
}
function navigate(r) {
  route = ROUTES.indexOf(r) >= 0 ? r : 'overview';
  const want = '#/' + route;
  if (location.hash !== want) { location.hash = want; } // fires hashchange → no double render
  render();
}
window.addEventListener('hashchange', () => {
  if (!getCreds()) { return; }            // ignore while on the login screen
  const r = routeFromHash();
  if (r !== route) { route = r; render(); }
});
let taskMeta = null; // { departments, statuses, counts } — cached after first load
let assistantThread = []; // staff AI chat history for this session: [{role, content}]

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
  logo_light: '',   // white surfaces (login card) — falls back to a text wordmark
  logo_dark: '',    // dark sidebar — falls back to a text wordmark
  font_family: '',                          // optional custom family name
  font_css: '',                             // optional stylesheet URL that defines the font
  font_url: '',                             // optional uploaded REGULAR-weight font file (woff2/woff/ttf/otf)
  font_url_bold: '',                        // optional uploaded BOLD-weight font file
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
  // Uploaded font file(s) → register as @font-face under the family name. Two
  // weights are supported: a regular for body and a bold for headings.
  const family = t.font_family || ((t.font_url || t.font_url_bold) ? 'BrandFont' : '');
  if ((t.font_url || t.font_url_bold) && !document.getElementById('oe-font-face')) {
    const fmt = (u) => (/\.woff2($|\?)/i.test(u) ? 'woff2' : (/\.woff($|\?)/i.test(u) ? 'woff' : (/\.otf($|\?)/i.test(u) ? 'opentype' : 'truetype')));
    let css = '';
    if (t.font_url) {
      css += '@font-face{font-family:"' + family + '";src:url("' + t.font_url + '") format("' + fmt(t.font_url) + '");font-weight:' + (t.font_url_bold ? '100 500' : '400 800') + ';font-style:normal;font-display:swap}';
    }
    if (t.font_url_bold) {
      css += '@font-face{font-family:"' + family + '";src:url("' + t.font_url_bold + '") format("' + fmt(t.font_url_bold) + '");font-weight:600 900;font-style:normal;font-display:swap}';
    }
    const st = document.createElement('style');
    st.id = 'oe-font-face';
    st.textContent = css;
    document.head.appendChild(st);
  }
  if (family) { r.setProperty('--font', '"' + family + '",-apple-system,BlinkMacSystemFont,system-ui,sans-serif'); }
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
      if (b.brand_name) { setSiteLabel(activeId(), b.brand_name); }
    }
  } catch (e) { /* keep current theme */ }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }
function money(n, cur) {
  const v = Number(n || 0);
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || 'USD', maximumFractionDigits: 0 }).format(v); }
  catch (e) { return (cur ? cur + ' ' : '') + Math.round(v).toLocaleString(); }
}

/* ---------------------------------------------------------------- */
/* Boot                                                             */
/* ---------------------------------------------------------------- */
async function boot() {
  applyTheme(theme);
  if (!getCreds()) { return renderLogin(); }
  try {
    await api.ping();
    refreshBrand(); // non-blocking: theme the app from the connected site
    route = routeFromHash(); // restore the page from the URL on load/refresh
    render();
  } catch (e) {
    renderLogin(e.status === 401 || e.status === 403
      ? 'Those credentials were rejected. Check the username and application password.'
      : 'Could not reach the site. Check the URL.');
  }
}

/* A feature is on unless the site's brand payload explicitly disables it. */
function featOn(key) { return !(theme.features && theme.features[key] === false); }
/* Map a route to the feature that gates it (unlisted routes are always on). */
const ROUTE_FEATURE = { volunteers: 'volunteers', email: 'contacts', contacts: 'contacts' };
function routeAllowed(r) { return !ROUTE_FEATURE[r] || featOn(ROUTE_FEATURE[r]); }

function render() {
  // A disabled module's route falls back to the dashboard.
  if (!routeAllowed(route)) { route = 'overview'; }
  if (route === 'tasks') { return renderTasks(); }
  if (route === 'volunteers') { return renderVolunteers(); }
  if (route === 'email') { return renderEmail(); }
  if (route === 'contacts') { return renderContacts(); }
  if (route === 'assistant') { return renderAssistant(); }
  return renderOverview();
}

/* App shell: dark sidebar (logo + nav + account) and a main content area.
   Returns the <main> element for the active view to fill. */
function shell(active) {
  app.innerHTML = '';
  const cur = getCreds() || {};
  const user = cur.user || '';
  const sites = getSites();
  const activeLabel = (sites.find((s) => s.id === activeId()) || cur).label || theme.brand_name;
  const link = (key, lbl) => `<button class="oe-navlink ${active === key ? 'on' : ''}" data-route="${key}">${lbl}</button>`;
  const wrap = el(`
    <div class="oe-shell">
      <aside class="oe-side">
        <div class="oe-brand">
          ${theme.logo_dark
            ? `<img src="${esc(theme.logo_dark)}" alt="${esc(theme.brand_name)}">`
            : `<span class="oe-brand-text">${esc(theme.brand_name)}</span>`}
        </div>
        <nav class="oe-nav">
          ${link('overview', 'Dashboard')}
          ${link('tasks', 'Tasks')}
          ${featOn('volunteers') ? link('volunteers', 'Volunteers') : ''}
          ${featOn('contacts') ? link('email', 'Email') : ''}
          ${featOn('contacts') ? link('contacts', 'Contacts') : ''}
          ${link('assistant', 'Assistant')}
        </nav>
        <div class="oe-side-foot">
          ${sites.length > 1 ? `<button class="oe-site-switch" id="b-sites"><span>${esc(activeLabel)}</span><span class="oe-site-caret">⇆</span></button>` : ''}
          <div class="oe-side-user">Signed in as <strong>${esc(user)}</strong></div>
          <button class="btn btn-ghost btn-block" id="b-add">+ Add a site</button>
          <button class="btn btn-ghost btn-block" id="b-refresh">Refresh</button>
          <button class="btn btn-ghost btn-block" id="b-out">Sign out of this site</button>
        </div>
      </aside>
      <main class="oe-main"></main>
    </div>`);
  app.appendChild(wrap);
  wrap.querySelectorAll('[data-route]').forEach((b) =>
    b.addEventListener('click', () => navigate(b.getAttribute('data-route'))));
  wrap.querySelector('#b-refresh').addEventListener('click', render);
  wrap.querySelector('#b-add').addEventListener('click', () => renderLogin(null, true));
  wrap.querySelector('#b-out').addEventListener('click', () => {
    clearCreds();
    if (getCreds()) { boot(); } else { renderLogin(); }
  });
  const switchBtn = wrap.querySelector('#b-sites');
  if (switchBtn) { switchBtn.addEventListener('click', () => openSiteSwitcher()); }
  return wrap.querySelector('.oe-main');
}

/* Multi-site switcher — pick another connected site, or remove one. */
function openSiteSwitcher() {
  const sites = getSites();
  const modal = el(`<div class="oe-drawer-wrap"><div class="oe-drawer-bg"></div>
    <aside class="oe-drawer"><div class="oe-drawer-head"><h2>Switch site</h2><button class="btn btn-small" data-close>Close</button></div>
      <div class="oe-switch-list"></div>
      <div style="padding:16px 20px"><button class="btn btn-primary btn-small" id="sw-add">+ Connect another site</button></div>
    </aside></div>`);
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('[data-close]').addEventListener('click', close);
  modal.querySelector('.oe-drawer-bg').addEventListener('click', close);
  const list = modal.querySelector('.oe-switch-list');
  sites.forEach((s) => {
    const row = el(`<div class="oe-switch-row ${s.id === activeId() ? 'on' : ''}">
      <button class="oe-switch-pick"><span class="oe-switch-name">${esc(s.label || hostLabel(s.base))}</span><span class="muted small">${esc(s.user)}</span></button>
      <button class="btn btn-small oe-switch-del" title="Remove">✕</button></div>`);
    row.querySelector('.oe-switch-pick').addEventListener('click', () => { setActiveSite(s.id); close(); boot(); });
    row.querySelector('.oe-switch-del').addEventListener('click', () => {
      if (confirm('Remove ' + (s.label || s.base) + '?')) { clearCreds(s.id); close(); if (getCreds()) { boot(); } else { renderLogin(); } }
    });
    list.appendChild(row);
  });
  modal.querySelector('#sw-add').addEventListener('click', () => { close(); renderLogin(null, true); });
}
function hostLabel(base) { return String(base || '').replace(/^https?:\/\//, '').replace(/\/wp-json\/?$/, ''); }

/* Per-page "what you can do" guide bento (dismissible, remembered per page). */
const GUIDES = {
  overview: { title: 'Your festival, at a glance', text: 'Everything the team is working on, pulled live from the site — and a checklist to get set up.',
    steps: [['Tickets & revenue', 'Live sales, at a glance'], ['Tasks', 'Open, blocked and done across departments'], ['Volunteers', 'Shift coverage and who needs a decision'], ['Getting started', 'Ticks itself off as you set things up']] },
  tasks: { title: 'Run the team’s work', text: 'A shared board across every department — add, assign and move tasks.',
    steps: [['Add a task', 'Title + department, top of the board'], ['Move it across', 'To do → In progress → Blocked → Done'], ['Edit details', 'Due date, assignee, notes'], ['See it everywhere', 'Same board in the plugin']] },
  volunteers: { title: 'Staff every shift', text: 'Manage signups for each opportunity and keep coverage on track.',
    steps: [['Open an opportunity', 'See its shifts and signups'], ['Decide on signups', 'Confirm / decline / no-show'], ['Check people in', 'On the day'], ['Add manually', 'Place a volunteer on a shift']] },
  email: { title: 'Send beautiful, on-brand email', text: 'Build a campaign block by block — or brief the AI co-pilot — then send to an audience.',
    steps: [['New campaign', 'Subject, preheader, audience'], ['Build it', 'Blocks + images, or “Draft with AI”'], ['Send a test', 'Preview in your inbox'], ['Schedule / send', 'Tracked, with unsubscribe']] },
  contacts: { title: 'Your audience, unified', text: 'Contacts build themselves from accounts, ticket buyers, volunteers and submitters — no imports.',
    steps: [['Search', 'Find anyone by name or email'], ['See the source', 'How each contact arrived'], ['Manage consent', 'Unsubscribe / re-subscribe'], ['Use in email', 'Audiences come from here']] },
  assistant: { title: 'Ask anything about your festival', text: 'A staff assistant with live access to your data — events, ticket sales, individual orders, failed payments, contacts, volunteers and campaigns. It looks things up and answers with real numbers.',
    steps: [['Ask in plain English', '“How many tickets sold today?”'], ['Chase a customer', '“Find the order for jane@…”'], ['Spot problems', '“Any failed payments this week?”'], ['Volunteer coverage', '“Which shifts still need people?”']] },
};

function pageGuide(key) {
  const g = GUIDES[key];
  if (!g) { return document.createComment('no-guide'); }
  // Self-replacing: toggling collapsed/expanded swaps just this node in place,
  // rather than re-rendering the whole page.
  function build() {
    if (localStorage.getItem('oe_guide_' + key) === '1') {
      const strip = el('<button class="oe-guide-show">ⓘ What you can do on this page</button>');
      strip.addEventListener('click', () => { localStorage.removeItem('oe_guide_' + key); strip.replaceWith(build()); });
      return strip;
    }
    const steps = g.steps.map((s, i) =>
      `<div class="oe-guide-step"><span class="n">${i + 1}</span><span class="l">${esc(s[0])}</span><span class="d">${esc(s[1])}</span></div>`).join('');
    const node = el(`
      <section class="oe-guide">
        <button class="oe-guide-x" title="Hide">×</button>
        <div class="oe-guide-kicker">What you can do here</div>
        <h2>${esc(g.title)}</h2>
        <p>${esc(g.text)}</p>
        <div class="oe-guide-steps">${steps}</div>
      </section>`);
    node.querySelector('.oe-guide-x').addEventListener('click', () => { localStorage.setItem('oe_guide_' + key, '1'); node.replaceWith(build()); });
    return node;
  }
  return build();
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
function renderLogin(error, addMode) {
  const prev = addMode ? {} : (getCreds() || {});
  app.innerHTML = '';
  const view = el(`
    <div class="oe-login">
      <div class="oe-login-card">
        ${theme.logo_light ? `<img class="oe-login-logo" src="${esc(theme.logo_light)}" alt="${esc(theme.brand_name)}">` : ''}
        <h1>${esc(theme.brand_name)}</h1>
        <p class="muted">Planning — sign in with your WordPress account.</p>
        ${error ? `<div class="oe-error">${esc(error)}</div>` : ''}
        <label>Site URL<input id="l-base" type="url" placeholder="https://atlantadesignfestival.net" value="${esc(prev.base ? prev.base.replace(/\/wp-json$/, '') : '')}"></label>
        <label>Username<input id="l-user" type="text" autocomplete="username" value="${esc(prev.user || '')}"></label>
        <label>Application password<input id="l-pw" type="password" autocomplete="current-password" placeholder="xxxx xxxx xxxx xxxx"></label>
        <p class="muted small">Create one in WordPress under <em>Users → Profile → Application Passwords</em>.</p>
        <button id="l-go" class="btn btn-primary">${addMode ? 'Connect site' : 'Sign in'}</button>
        ${addMode && getCreds() ? '<button id="l-cancel" class="btn btn-small" style="margin-top:8px">Cancel</button>' : ''}
        <div id="l-msg" class="oe-result"></div>
      </div>
    </div>`);
  app.appendChild(view);
  const cancel = view.querySelector('#l-cancel');
  if (cancel) { cancel.addEventListener('click', () => boot()); }

  view.querySelector('#l-go').addEventListener('click', async () => {
    const site = view.querySelector('#l-base').value.trim().replace(/\/+$/, '');
    const user = view.querySelector('#l-user').value.trim();
    const apppw = view.querySelector('#l-pw').value.trim();
    const msg = view.querySelector('#l-msg');
    if (!site || !user || !apppw) { msg.textContent = 'Fill in all three fields.'; return; }
    msg.textContent = 'Connecting…';
    // Don't lose an already-saved site if this attempt fails transiently.
    const base = site + '/wp-json';
    const existed = getSites().some((s) => s.base === base && s.user === user);
    setCreds({ base, user, apppw });
    try { await api.ping(); boot(); }
    catch (e) {
      if (!existed) { clearCreds(); } // only drop a brand-new connection that didn't work
      renderLogin(e.status === 401 || e.status === 403 ? 'Credentials rejected.' : 'Could not connect to that site.');
    }
  });
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
  main.appendChild(pageGuide('tasks'));
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
  main.appendChild(pageGuide('volunteers'));

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

  // Pull the boards + KPIs in parallel; tolerate any single one failing.
  const [tasks, opps, kpis] = await Promise.all([
    api.listTasks().catch(() => null),
    api.listOpportunities().catch(() => null),
    api.stats().catch(() => null),
  ]);
  if (tasks === null && opps === null && kpis === null) {
    return renderLogin('Session expired — sign in again.');
  }

  // Derive the numbers once.
  const tk = tasks || [];
  const op = opps || [];
  const k = kpis || {};
  const eventsTotal = Number(k.events_total || 0);
  const eventsLive = Number(k.events_live || 0);
  const openTasks = tk.filter((t) => t.status === 'todo' || t.status === 'doing').length;
  const blocked = tk.filter((t) => t.status === 'blocked').length;
  const doneTasks = tk.filter((t) => t.status === 'done').length;
  let capacity = 0; let filled = 0; let pending = 0;
  op.forEach((o) => { capacity += o.capacity; filled += o.filled; pending += o.pending; });
  const shortfall = Math.max(0, capacity - filled);
  const attention = blocked + pending;

  main.innerHTML = '';
  main.appendChild(pageHeader(
    'OVERVIEW · ' + eventsTotal + ' EVENTS · ' + (attention ? 'NEEDS ATTENTION' : 'ALL ON TRACK'),
    'Dashboard'
  ));
  main.appendChild(pageGuide('overview'));

  // Headline KPI cards — the festival's key numbers (first one highlighted, like OMI).
  const cur = k.currency || '';
  const yr = k.year ? String(k.year) : '';
  const stats = el('<div class="oe-stats"></div>');
  stats.appendChild(statCard('Tickets sold', kpis ? String(k.tickets_year) : '—', yr ? yr + ' to date' : 'this year', true));
  stats.appendChild(statCard('Revenue', kpis ? money(k.revenue_year, cur) : '—', yr ? yr + ' to date' : 'this year', false));
  stats.appendChild(statCard('Subscribers', kpis ? String(k.subscribers) : '—', 'on the email list', false));
  stats.appendChild(statCard('Events live', kpis ? (eventsLive + '/' + eventsTotal) : '—', 'published on the site', false));
  main.appendChild(stats);

  // Getting started checklist.
  main.appendChild(gettingStarted([
    { label: 'Add a team task', done: tk.length > 0, route: 'tasks', cta: 'Open Tasks' },
    { label: 'Set up a volunteer opportunity with shifts', done: capacity > 0, route: 'volunteers', cta: 'Open Volunteers' },
    { label: 'Connect email sending (Amazon SES)', soon: true },
  ]));

  // Module cards (the boards).
  main.appendChild(el('<h2 class="oe-section-title">Workspaces</h2>'));
  const mods = el('<div class="oe-mods"></div>');
  mods.appendChild(moduleCard('tasks', 'Tasks', blocked ? 'amber' : 'green', tasks,
    [[openTasks, 'open'], [doneTasks, 'done']]));
  if (featOn('volunteers')) {
    mods.appendChild(moduleCard('volunteers', 'Volunteers', shortfall ? 'amber' : 'green', opps,
      [[filled + '/' + capacity, 'filled'], [pending, 'to review']]));
  }
  main.appendChild(mods);

  main.querySelectorAll('[data-goto]').forEach((c) =>
    c.addEventListener('click', () => navigate(c.getAttribute('data-goto'))));
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
/* Email — campaigns list + 4-step wizard (Brief → Draft → Refine → Send) */
/* ---------------------------------------------------------------- */
const CAMPAIGN_STATUS = { draft: 'Draft', scheduled: 'Scheduled', sending: 'Sending', sent: 'Sent', paused: 'Paused' };

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
  main.appendChild(pageGuide('email'));

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
  grid.querySelectorAll('[data-cdel]').forEach((b) =>
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const id = parseInt(b.getAttribute('data-cdel'), 10);
      const card = b.closest('[data-copen]');
      const name = card ? card.querySelector('h3').textContent : 'this campaign';
      if (!confirm('Delete "' + name + '"? This cannot be undone.')) { return; }
      b.disabled = true;
      try { await api.deleteCampaign(id); renderEmail(); }
      catch (e) { b.disabled = false; alert(e.message || 'Could not delete the campaign.'); }
    }));
}

function campaignCard(c) {
  const s = c.stats || {};
  return el(`
    <article class="mod" data-copen="${c.id}">
      <div class="mod-head"><h3>${esc(c.name || '(untitled)')}</h3>
        <span class="mod-head-r"><span class="chip">${esc(CAMPAIGN_STATUS[c.status] || c.status)}</span>
        <button class="mod-del" data-cdel="${c.id}" title="Delete campaign" aria-label="Delete campaign">✕</button></span></div>
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
  // Content model: AI / simple drafts are an array of blocks; a hand-refined
  // email is stored as a GrapesJS project. The wizard converts blocks → canvas
  // one-way (Refine), so there's never a confusing two-way toggle.
  let blocks = [];
  let gjsData = null;    // saved GrapesJS project data, when refined by hand
  try {
    const parsed = JSON.parse(rec.body_json || '[]');
    if (Array.isArray(parsed)) { blocks = parsed; }
    else if (parsed && parsed.__mode === 'advanced') { gjsData = parsed.gjs || null; }
  } catch (e) { blocks = []; }

  main.innerHTML = '';
  main.appendChild(pageHeader('EMAIL · ' + (id ? 'EDIT CAMPAIGN' : 'NEW CAMPAIGN'), rec.name || 'Untitled campaign'));

  // Single source of truth for the campaign fields; per-step inputs bind to it.
  const draft = {
    name: rec.name || '', subject: rec.subject || '',
    preheader: rec.preheader || '', audience: rec.audience || 'subscribed',
  };
  const bound = [];
  function bindInput(node, key) { node.value = draft[key]; node.addEventListener('input', () => { draft[key] = node.value; }); bound.push({ node, key }); return node; }
  function syncInputs() { bound.forEach(({ node, key }) => { if (node.value !== draft[key]) { node.value = draft[key]; } }); }

  // Audience is multi-select: draft.audience is a comma-separated list of keys
  // ("subscribed", "list:3", "source:brevo"). A campaign can target several.
  const audienceBoxes = [];
  function audienceKeys() { return draft.audience ? draft.audience.split(',').map((s) => s.trim()).filter(Boolean) : []; }
  function syncAudience(except) {
    const keys = audienceKeys();
    audienceBoxes.forEach((box) => {
      if (box === except) { return; }
      box.querySelectorAll('input[type=checkbox]').forEach((cb) => { cb.checked = keys.indexOf(cb.value) !== -1; });
    });
  }
  function buildAudience(onChange) {
    const box = el('<div class="oe-audience"></div>');
    const keys = audienceKeys();
    audiences.forEach((a) => {
      const row = el('<label class="oe-aud"><input type="checkbox"><span class="oe-aud-l"></span><span class="oe-aud-n"></span></label>');
      const cb = row.querySelector('input');
      cb.value = a.key; cb.checked = keys.indexOf(a.key) !== -1;
      row.querySelector('.oe-aud-l').textContent = a.label;
      row.querySelector('.oe-aud-n').textContent = a.count;
      box.appendChild(row);
    });
    box.addEventListener('change', () => {
      const picked = [];
      box.querySelectorAll('input[type=checkbox]').forEach((cb) => { if (cb.checked) { picked.push(cb.value); } });
      draft.audience = picked.join(',');
      syncAudience(box);
      if (onChange) { onChange(); }
    });
    audienceBoxes.push(box);
    return box;
  }
  function selectedAudienceCount() {
    const keys = audienceKeys();
    return audiences.reduce((n, a) => (keys.indexOf(a.key) !== -1 ? n + (a.count || 0) : n), 0);
  }

  let gjsEditor = null;
  const history = [];

  function collect() {
    const base = { name: draft.name.trim(), subject: draft.subject.trim(), preheader: draft.preheader.trim(), audience: draft.audience };
    if (gjsEditor) {
      let html = '';
      try { html = gjsEditor.runCommand('gjs-get-inlined-html') || ''; }
      catch (e) { html = gjsEditor.getHtml() + '<style>' + gjsEditor.getCss() + '</style>'; }
      base.body_html = html;
      base.body_json = JSON.stringify({ __mode: 'advanced', gjs: gjsEditor.getProjectData() });
    } else {
      base.body_json = JSON.stringify(blocks);
      base.body_html = blocksToHtml(blocks, false);
    }
    return base;
  }
  async function save(noteEl) {
    if (noteEl) { noteEl.textContent = 'Saving…'; }
    try {
      if (rec.id) { await api.updateCampaign(rec.id, collect()); }
      else { const created = await api.createCampaign(collect()); rec.id = created.id; id = created.id; }
      if (noteEl) { noteEl.textContent = 'Saved.'; }
      return true;
    } catch (e) { if (noteEl) { noteEl.textContent = e.message || 'Could not save.'; } return false; }
  }

  // --- Step progress ---------------------------------------------------------
  const STEPS = [['brief', 'Brief'], ['draft', 'Draft'], ['refine', 'Refine'], ['send', 'Send']];
  let step = id ? 'refine' : 'brief';
  const visited = new Set([step, 'brief']); // Brief stays reachable so you can always re-draft with AI.
  if (id) { visited.add('send'); }

  const prog = el('<div class="oe-wsteps"></div>');
  STEPS.forEach(([key, label], i) => {
    const chip = el(`<button class="oe-wstep" data-step="${key}"><span class="oe-wstep-n">${i + 1}</span>${esc(label)}</button>`);
    chip.addEventListener('click', () => { if (visited.has(key)) { showStep(key); } });
    prog.appendChild(chip);
  });
  main.appendChild(prog);

  const wrap = el('<div class="oe-wiz"></div>');
  main.appendChild(wrap);
  const backLink = el('<a class="oe-cmp-back" style="display:inline-block;margin-top:20px">← All campaigns</a>');
  backLink.addEventListener('click', () => navigate('email'));
  main.appendChild(backLink);

  /* ── Step 1 · Brief ─────────────────────────────────────────────────────── */
  const pBrief = el(`<section class="oe-wpanel">
    <h2 class="oe-wtitle">What's this email?</h2>
    <p class="oe-wsub">Choose who it's going to, then brief the co-pilot in a sentence — it drafts the whole email from your real, confirmed events. Or start from a blank canvas.</p></section>`);
  const briefAud = el('<div class="oe-wfield"><span>Audience <em class="muted small">choose one or more</em></span></div>');
  briefAud.appendChild(buildAudience());
  pBrief.appendChild(briefAud);
  const briefField = el(`<label class="oe-wfield"><span>Brief the co-pilot ✦</span>
    <textarea class="oe-wbrief" rows="3" placeholder="e.g. September newsletter: lead with the opening party, include the confirmed tours, warm but plain tone."></textarea></label>`);
  pBrief.appendChild(briefField);
  pBrief.appendChild(el('<p class="oe-copilot-hint muted small">It writes in your house voice and only uses real confirmed events &amp; links — anything unverified becomes a visible [TODO].</p>'));
  const briefNav = el('<div class="oe-wnav"></div>');
  const draftBtn = el('<button class="btn btn-primary" data-draft>Draft with AI →</button>');
  const blankBtn = el('<button class="btn" data-blank>Start from blank →</button>');
  const briefMsg = el('<div class="oe-result"></div>');
  briefNav.appendChild(draftBtn); briefNav.appendChild(blankBtn); briefNav.appendChild(briefMsg);
  pBrief.appendChild(briefNav);
  wrap.appendChild(pBrief);

  async function runDraft(briefText, msgEl, btn) {
    if (!briefText) { msgEl.textContent = 'Tell the co-pilot what the email should say.'; return false; }
    if (btn) { btn.disabled = true; }
    msgEl.textContent = 'Drafting…';
    try {
      const r = await api.copilot({ brief: briefText, blocks, history });
      if (!r.ok) { msgEl.textContent = r.reply || 'Could not draft.'; return false; }
      if (r.name && !draft.name.trim()) { draft.name = r.name; }
      if (r.subject) { draft.subject = r.subject; }
      if (r.preheader) { draft.preheader = r.preheader; }
      if (Array.isArray(r.blocks)) { blocks = r.blocks; }
      history.push({ role: 'user', content: briefText });
      history.push({ role: 'assistant', content: r.reply || '' });
      // A fresh draft supersedes any canvas built earlier.
      gjsData = null;
      if (gjsEditor) { try { gjsEditor.setComponents(blocksToHtml(blocks, false)); } catch (e) { /* noop */ } }
      syncInputs();
      msgEl.textContent = r.reply || 'Draft ready.';
      return true;
    } catch (e) { msgEl.textContent = e.message || 'Error'; return false; }
    finally { if (btn) { btn.disabled = false; } }
  }
  draftBtn.addEventListener('click', async () => {
    const ok = await runDraft(briefField.querySelector('textarea').value.trim(), briefMsg, draftBtn);
    if (ok) { showStep('draft'); }
  });
  blankBtn.addEventListener('click', () => showStep('refine'));

  /* ── Step 2 · Draft ─────────────────────────────────────────────────────── */
  const pDraft = el(`<section class="oe-wpanel">
    <h2 class="oe-wtitle">Here's your draft</h2>
    <p class="oe-wsub">The co-pilot wrote the name, subject and email below. Tweak the details, ask it to revise, or open it in the editor to refine by hand.</p></section>`);
  const dGrid = el('<div class="oe-wgrid"></div>');
  const fName = el('<label class="oe-wfield"><span>Campaign name</span></label>'); fName.appendChild(bindInput(el('<input placeholder="e.g. September Newsletter">'), 'name'));
  const fSubj = el('<label class="oe-wfield"><span>Subject line</span></label>'); fSubj.appendChild(bindInput(el('<input placeholder="The subject readers see">'), 'subject'));
  const fPre = el('<label class="oe-wfield"><span>Preheader <em class="muted small">inbox preview</em></span></label>'); fPre.appendChild(bindInput(el('<input placeholder="Preview text after the subject">'), 'preheader'));
  dGrid.appendChild(fName); dGrid.appendChild(fSubj); dGrid.appendChild(fPre);
  pDraft.appendChild(dGrid);
  pDraft.appendChild(el('<div class="oe-cmp-label">Preview</div>'));
  const draftPreview = el('<div class="oe-preview"></div>');
  pDraft.appendChild(draftPreview);
  const reField = el(`<label class="oe-wfield" style="margin-top:18px"><span>Ask for a revision ✦</span>
    <textarea class="oe-wbrief" rows="2" placeholder="e.g. shorten the intro, add the volunteer call-out, friendlier sign-off."></textarea></label>`);
  pDraft.appendChild(reField);
  const draftNav = el('<div class="oe-wnav"></div>');
  const dBack = el('<button class="btn" data-back>← Brief</button>');
  const reBtn = el('<button class="btn" data-rebrief>Revise ✦</button>');
  const toRefineBtn = el('<button class="btn btn-primary" data-refine>Edit this email →</button>');
  const draftMsg = el('<div class="oe-result"></div>');
  draftNav.appendChild(dBack); draftNav.appendChild(reBtn); draftNav.appendChild(toRefineBtn); draftNav.appendChild(draftMsg);
  pDraft.appendChild(draftNav);
  wrap.appendChild(pDraft);

  function paintDraftPreview() { draftPreview.innerHTML = blocksToHtml(blocks, true); }
  dBack.addEventListener('click', () => showStep('brief'));
  reBtn.addEventListener('click', async () => {
    const ta = reField.querySelector('textarea');
    const ok = await runDraft(ta.value.trim(), draftMsg, reBtn);
    if (ok) { ta.value = ''; paintDraftPreview(); }
  });
  toRefineBtn.addEventListener('click', () => showStep('refine'));

  /* ── Step 3 · Refine (drag & drop) ──────────────────────────────────────── */
  const pRefine = el(`<section class="oe-wpanel oe-wpanel-wide">
    <h2 class="oe-wtitle">Refine your email</h2>
    <p class="oe-wsub">Drag, edit and style by hand — you're in full control here, the co-pilot steps out. (You can always polish the copy later, even with Claude on the web.)</p></section>`);
  const gjsWrap = el('<div class="oe-gjs"><div class="oe-gjs-canvas"></div></div>');
  pRefine.appendChild(gjsWrap);
  const refineNav = el('<div class="oe-wnav"></div>');
  const rBack = el('<button class="btn" data-back>← Back</button>');
  const rSave = el('<button class="btn" data-save>Save draft</button>');
  const toSendBtn = el('<button class="btn btn-primary" data-send>Continue to send →</button>');
  const refineMsg = el('<div class="oe-result"></div>');
  refineNav.appendChild(rBack); refineNav.appendChild(rSave); refineNav.appendChild(toSendBtn); refineNav.appendChild(refineMsg);
  pRefine.appendChild(refineNav);
  wrap.appendChild(pRefine);

  rBack.addEventListener('click', () => showStep(visited.has('draft') ? 'draft' : 'brief'));
  rSave.addEventListener('click', () => save(refineMsg));
  toSendBtn.addEventListener('click', async () => { if (await save(refineMsg)) { refineMsg.textContent = ''; showStep('send'); } });

  async function ensureGjs() {
    if (gjsEditor) { return gjsEditor; }
    refineMsg.textContent = 'Loading editor…';
    let grapesjs;
    try { grapesjs = await loadGrapes(); }
    catch (e) { refineMsg.textContent = 'Could not load the editor.'; throw e; }
    const preset = window['grapesjs-preset-newsletter'];
    if (preset && grapesjs.plugins && grapesjs.plugins.get && !grapesjs.plugins.get('grapesjs-preset-newsletter')) {
      grapesjs.plugins.add('grapesjs-preset-newsletter', preset);
    }
    gjsEditor = grapesjs.init({
      container: gjsWrap.querySelector('.oe-gjs-canvas'),
      height: '68vh',
      fromElement: false,
      storageManager: false,
      assetManager: { upload: false },
      plugins: preset ? ['grapesjs-preset-newsletter'] : [],
      pluginsOpts: preset ? { 'grapesjs-preset-newsletter': {} } : {},
    });
    // Seed from a saved canvas, otherwise convert the AI / simple blocks to HTML.
    if (gjsData) {
      try { gjsEditor.loadProjectData(gjsData); }
      catch (e) { gjsEditor.setComponents(blocksToHtml(blocks, false)); }
    } else {
      gjsEditor.setComponents(blocksToHtml(blocks, false));
    }
    refineMsg.textContent = '';
    // Surface the WP media library in the editor's image picker — fetched in the
    // background so a slow/large library never blocks the editor from loading.
    api.listMedia().then((items) => {
      const assets = (items || []).map((m) => m.source_url).filter(Boolean);
      if (assets.length && gjsEditor && gjsEditor.AssetManager) {
        try { gjsEditor.AssetManager.add(assets); } catch (e) { /* noop */ }
      }
    }).catch(() => { /* media is optional */ });
    return gjsEditor;
  }

  /* ── Step 4 · Send ──────────────────────────────────────────────────────── */
  const pSend = el(`<section class="oe-wpanel">
    <h2 class="oe-wtitle">Review &amp; send</h2>
    <p class="oe-wsub">A last check. Send yourself a test, then send to the audience or come back later — it stays a draft until you do.</p></section>`);
  const sGrid = el('<div class="oe-wgrid"></div>');
  const sSubj = el('<label class="oe-wfield"><span>Subject line</span></label>'); sSubj.appendChild(bindInput(el('<input placeholder="The subject readers see">'), 'subject'));
  const sName = el('<label class="oe-wfield"><span>Campaign name <em class="muted small">internal</em></span></label>'); sName.appendChild(bindInput(el('<input placeholder="e.g. September Newsletter">'), 'name'));
  const sPre = el('<label class="oe-wfield"><span>Preheader</span></label>'); sPre.appendChild(bindInput(el('<input placeholder="Inbox preview text">'), 'preheader'));
  const sAud = el('<div class="oe-wfield oe-wfield-full"><span>Audience <em class="muted small">choose one or more</em></span></div>'); sAud.appendChild(buildAudience(() => paintSend()));
  sGrid.appendChild(sSubj); sGrid.appendChild(sName); sGrid.appendChild(sPre); sGrid.appendChild(sAud);
  pSend.appendChild(sGrid);
  const sendCount = el('<div class="oe-wcount"></div>');
  pSend.appendChild(sendCount);
  const sendNav = el('<div class="oe-wnav"></div>');
  const sBack = el('<button class="btn" data-back>← Edit</button>');
  const testBtn = el('<button class="btn" data-test>Send test…</button>');
  const sendBtn = el('<button class="btn btn-primary" data-send>Send now</button>');
  const sendMsg = el('<div class="oe-result"></div>');
  sendNav.appendChild(sBack); sendNav.appendChild(testBtn); sendNav.appendChild(sendBtn); sendNav.appendChild(sendMsg);
  pSend.appendChild(sendNav);
  if (id) {
    const del = el('<button class="btn btn-link-danger" data-del style="margin-top:18px">Delete this campaign</button>');
    del.addEventListener('click', async () => {
      if (!confirm('Delete "' + (draft.name || 'this campaign') + '"? This cannot be undone.')) { return; }
      sendMsg.textContent = 'Deleting…';
      try { await api.deleteCampaign(rec.id); navigate('email'); }
      catch (e) { sendMsg.textContent = e.message || 'Could not delete.'; }
    });
    pSend.appendChild(del);
  }
  wrap.appendChild(pSend);

  function paintSend() {
    const n = selectedAudienceCount();
    sendCount.innerHTML = audienceKeys().length
      ? 'Sending to up to <strong>' + n + '</strong> recipient' + (n === 1 ? '' : 's') + '. <span class="muted small">Overlaps and unsubscribes are removed automatically.</span>'
      : '<span class="muted">Choose at least one audience above.</span>';
  }
  sBack.addEventListener('click', () => showStep('refine'));
  testBtn.addEventListener('click', async () => {
    if (!(await save(sendMsg))) { return; }
    const email = prompt('Send a test to which email address?');
    if (!email) { return; }
    sendMsg.textContent = 'Sending test…';
    try { const r = await api.testCampaign(rec.id, email); sendMsg.textContent = r.ok ? 'Test sent to ' + email + '.' : 'Test failed — is SES configured?'; }
    catch (e) { sendMsg.textContent = e.message || 'Error'; }
  });
  sendBtn.addEventListener('click', async () => {
    if (!draft.subject.trim()) { sendMsg.textContent = 'Add a subject line first.'; return; }
    if (!audienceKeys().length) { sendMsg.textContent = 'Choose at least one audience.'; return; }
    if (!(await save(sendMsg))) { return; }
    if (!confirm('Send "' + (draft.name || 'this campaign') + '" to up to ' + selectedAudienceCount() + ' recipient(s)?')) { return; }
    sendMsg.textContent = 'Queuing…';
    try { const r = await api.sendCampaign(rec.id); sendMsg.textContent = 'Queued ' + r.queued + ' — sending in the background.'; setTimeout(() => navigate('email'), 1400); }
    catch (e) { sendMsg.textContent = e.message || 'Error'; }
  });

  /* ── Step controller ────────────────────────────────────────────────────── */
  const panels = { brief: pBrief, draft: pDraft, refine: pRefine, send: pSend };
  function showStep(s) {
    step = s; visited.add(s);
    Object.keys(panels).forEach((k) => { panels[k].style.display = k === s ? '' : 'none'; });
    prog.querySelectorAll('.oe-wstep').forEach((c) => {
      const k = c.getAttribute('data-step');
      c.classList.toggle('on', k === s);
      c.classList.toggle('done', visited.has(k) && k !== s);
      c.classList.toggle('avail', visited.has(k));
    });
    syncInputs();
    syncAudience();
    if (s === 'draft') { paintDraftPreview(); }
    if (s === 'refine') { ensureGjs().catch(() => {}); }
    if (s === 'send') { paintSend(); }
    if (window.scrollTo) { window.scrollTo(0, 0); }
  }
  showStep(step);
}

/* Lazily load the self-hosted GrapesJS bundle (UMD) only when the advanced
   editor is first opened, so it never weighs on initial page load. */
let _grapesPromise = null;
function loadGrapes() {
  if (_grapesPromise) { return _grapesPromise; }
  _grapesPromise = new Promise((resolve, reject) => {
    if (!document.getElementById('gjs-css')) {
      const link = document.createElement('link');
      link.id = 'gjs-css'; link.rel = 'stylesheet';
      link.href = './assets/vendor/grapes.min.css';
      document.head.appendChild(link);
    }
    loadScriptOnce('./assets/vendor/grapes.min.js')
      .then(() => loadScriptOnce('./assets/vendor/preset-newsletter.min.js'))
      .then(() => {
        if (window.grapesjs) { resolve(window.grapesjs); }
        else { reject(new Error('GrapesJS did not load')); }
      })
      .catch(reject);
  });
  return _grapesPromise;
}
function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[data-src="' + src + '"]')) { return resolve(); }
    const s = document.createElement('script');
    s.src = src; s.setAttribute('data-src', src);
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

function blocksToHtml(blocks, isPreview) {
  const accent = (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#E7CD41').trim();
  const al = (b) => (['left', 'center', 'right'].indexOf(b.align) >= 0 ? b.align : 'left');
  const rows = blocks.map((b) => {
    if (b.type === 'heading') {
      const size = b.level === 'h1' ? '28px' : (b.level === 'h3' ? '18px' : '22px');
      return `<tr><td style="padding:8px 0;text-align:${al(b)}"><div style="font-family:Arial,Helvetica,sans-serif;font-size:${size};font-weight:bold;color:#1a1a1a;line-height:1.25">${esc(b.text || '')}</div></td></tr>`;
    }
    if (b.type === 'text') {
      return `<tr><td style="padding:8px 0;text-align:${al(b)}"><div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#333">${esc(b.text || '').replace(/\n/g, '<br>')}</div></td></tr>`;
    }
    if (b.type === 'image') {
      if (!b.url) { return isPreview ? '<tr><td style="padding:8px 0"><div style="background:#f3f3f3;border:1px dashed #ccc;border-radius:8px;padding:34px;text-align:center;color:#999;font-family:Arial">Image — pick from the media library</div></td></tr>' : ''; }
      const img = `<img src="${esc(b.url)}" alt="${esc(b.alt || '')}" style="max-width:100%;border-radius:8px;display:inline-block">`;
      return `<tr><td align="${al(b)}" style="padding:8px 0">${b.href ? `<a href="${esc(b.href)}">${img}</a>` : img}</td></tr>`;
    }
    if (b.type === 'button') {
      return `<tr><td style="padding:12px 0;text-align:${al(b)}"><a href="${esc(b.href || '#')}" style="display:inline-block;background:${accent};color:#1a1a1a;font-family:Arial,Helvetica,sans-serif;font-weight:bold;font-size:15px;text-decoration:none;padding:12px 24px;border-radius:999px">${esc(b.label || 'Button')}</a></td></tr>`;
    }
    if (b.type === 'columns') {
      const cells = (Array.isArray(b.cols) ? b.cols : []).map((c) => {
        let inner = '';
        if (c.url) {
          const img = `<img src="${esc(c.url)}" alt="${esc(c.alt || '')}" width="270" style="width:100%;max-width:270px;border-radius:8px;display:block">`;
          inner += c.href ? `<a href="${esc(c.href)}">${img}</a>` : img;
        } else if (isPreview) {
          inner += '<div style="background:#f3f3f3;border:1px dashed #ccc;border-radius:8px;padding:24px;text-align:center;color:#999;font-family:Arial;font-size:12px">Image</div>';
        }
        if (c.text) { inner += `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#333;margin-top:8px">${esc(c.text).replace(/\n/g, '<br>')}</div>`; }
        return `<div style="display:inline-block;width:270px;max-width:46%;vertical-align:top;text-align:left;margin:0 6px 12px">${inner}</div>`;
      }).join('');
      return `<tr><td style="padding:8px 0"><div style="font-size:0;text-align:center">${cells}</div></td></tr>`;
    }
    if (b.type === 'social') {
      const links = (Array.isArray(b.items) ? b.items : []).filter((s) => s.url).map((s) => {
        const inner = s.icon
          ? `<img src="${esc(s.icon)}" alt="${esc(s.label || '')}" width="28" height="28" style="display:inline-block;border:0">`
          : `<span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1a1a1a;text-decoration:underline">${esc(s.label || 'link')}</span>`;
        return `<a href="${esc(s.url)}" style="display:inline-block;margin:0 7px;text-decoration:none">${inner}</a>`;
      }).join('');
      return `<tr><td align="center" style="padding:14px 0">${links}</td></tr>`;
    }
    if (b.type === 'divider') { return '<tr><td style="padding:12px 0"><hr style="border:none;border-top:1px solid #e3e2db"></td></tr>'; }
    if (b.type === 'spacer') { return '<tr><td style="height:24px;line-height:24px">&nbsp;</td></tr>'; }
    return '';
  }).join('');
  const inner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${isPreview ? '#f3f3f3' : '#faf9f5'};padding:${isPreview ? '0' : '20px'}"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;border-radius:12px"><tr><td style="padding:24px">${inner}</td></tr></table></td></tr></table>`;
}

/* ---------------------------------------------------------------- */
/* Contacts                                                         */
/* ---------------------------------------------------------------- */
const CONTACT_STATUS = { subscribed: 'Subscribed', unsubscribed: 'Unsubscribed' };

async function renderContacts() {
  const main = shell('contacts');
  main.appendChild(el('<div class="oe-loading">Loading contacts…</div>'));
  let counts = { total: 0, subscribed: 0, unsubscribed: 0, sms: 0 };
  try { counts = await api.contactsMeta(); }
  catch (e) {
    if (e.status === 401 || e.status === 403) { return renderLogin('Session expired — sign in again.'); }
    main.innerHTML = '<div class="oe-error" style="margin:24px 0">Could not load contacts.</div>';
    return;
  }
  main.innerHTML = '';
  main.appendChild(pageHeader('CONTACTS · ' + counts.total + ' TOTAL · ' + counts.subscribed + ' SUBSCRIBED', 'Contacts'));
  main.appendChild(pageGuide('contacts'));

  const stats = el('<div class="oe-stats" style="margin-bottom:24px"></div>');
  stats.appendChild(statCard('Total', String(counts.total), 'contacts', true));
  stats.appendChild(statCard('Subscribed', String(counts.subscribed), 'can receive email', false, 'green'));
  stats.appendChild(statCard('Unsubscribed', String(counts.unsubscribed), 'opted out', false, counts.unsubscribed ? 'amber' : ''));
  stats.appendChild(statCard('SMS opt-in', String(counts.sms), 'phone consented', false));
  main.appendChild(stats);

  // Sub-tabs: the contact table, and list management (both read/write for staff).
  let tab = 'contacts';
  const tabBar = el('<div class="oe-subtabs"></div>');
  const body = el('<div class="oe-subtab-body"></div>');
  [['contacts', 'Contacts'], ['lists', 'Lists'], ['growth', 'Growth']].forEach(([key, label]) => {
    const b = el(`<button class="oe-subtab" data-tab="${key}">${label}</button>`);
    b.addEventListener('click', () => showTab(key));
    tabBar.appendChild(b);
  });
  main.appendChild(tabBar);
  main.appendChild(body);
  function showTab(t) {
    tab = t;
    tabBar.querySelectorAll('.oe-subtab').forEach((b) => b.classList.toggle('on', b.getAttribute('data-tab') === t));
    body.innerHTML = '';
    if (t === 'lists') { renderListsTab(body); }
    else if (t === 'growth') { renderGrowthTab(body); }
    else { renderContactsTab(body); }
  }
  showTab('contacts');
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabel(m) {
  const parts = String(m || '').split('-');
  if (parts.length !== 2) { return m; }
  return MONTH_NAMES[parseInt(parts[1], 10) - 1] + " '" + parts[0].slice(2);
}

async function renderGrowthTab(container) {
  container.innerHTML = '<div class="oe-loading">Loading…</div>';
  let data = [];
  try { data = await api.contactsGrowth(); } catch (e) { container.innerHTML = '<p class="oe-error">Could not load growth.</p>'; return; }
  if (!Array.isArray(data)) { data = []; }
  container.innerHTML = '';
  container.appendChild(el('<p class="muted small" style="margin:0 0 18px;max-width:64ch">New contacts by the month we first recorded them — excluding the one-time Brevo/CSV imports. Growth from here is the signal to watch.</p>'));
  if (!data.length) {
    container.appendChild(el('<p class="muted" style="padding:16px 0">No subscriber activity recorded yet.</p>'));
    return;
  }
  const total = data.reduce((n, d) => n + (d.count || 0), 0);
  const max = Math.max(1, ...data.map((d) => d.count || 0));
  const chart = el('<div class="oe-bars"></div>');
  data.forEach((d) => {
    const h = Math.max(2, Math.round(((d.count || 0) / max) * 100));
    const col = el('<div class="oe-bar-col"></div>');
    col.innerHTML = '<div class="oe-bar-v">' + (d.count || 0) + '</div>'
      + '<div class="oe-bar" style="height:' + h + '%"></div>'
      + '<div class="oe-bar-x">' + esc(monthLabel(d.month)) + '</div>';
    chart.appendChild(col);
  });
  container.appendChild(chart);
  container.appendChild(el('<p class="muted small" style="margin-top:14px">' + total + ' contacts added across ' + data.length + ' month' + (data.length === 1 ? '' : 's') + '.</p>'));
}

function renderContactsTab(container) {
  const search = el('<input class="oe-contacts-search" type="search" placeholder="Search by name or email…">');
  container.appendChild(search);
  const wrap = el('<div class="oe-contacts-table"></div>');
  container.appendChild(wrap);

  let timer = null;
  async function load(term) {
    wrap.innerHTML = '<div class="oe-loading">Loading…</div>';
    let rows = [];
    try { rows = await api.listContacts(term || '', 0); } catch (e) { wrap.innerHTML = '<p class="oe-error">Could not load.</p>'; return; }
    if (!Array.isArray(rows)) { rows = []; }
    if (!rows.length) { wrap.innerHTML = '<p class="muted" style="padding:16px 0">' + (term ? 'No contacts match that.' : 'No contacts yet.') + '</p>'; return; }
    // Build rows as HTML inside a real <tbody> — a <tr> created via a <div>
    // wrapper gets stripped by the parser, so insert into table context instead.
    const table = el('<table class="oe-ctable"><thead><tr><th>Email</th><th>Name</th><th>Company</th><th>Source</th><th>Status</th><th></th></tr></thead><tbody></tbody></table>');
    const tbody = table.querySelector('tbody');
    const byId = {};
    rows.forEach((r) => { byId[r.id] = r; });
    tbody.innerHTML = rows.map(contactRowHtml).join('');
    wrap.innerHTML = '';
    wrap.appendChild(table);
    // Consent toggle (delegated by data attributes).
    tbody.querySelectorAll('button[data-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try { await api.updateContact(btn.getAttribute('data-id'), btn.getAttribute('data-to')); load(search.value.trim()); }
        catch (e) { btn.disabled = false; alert(e.message || 'Could not update.'); }
      });
    });
    tbody.querySelectorAll('button[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => openContactDrawer(byId[btn.getAttribute('data-view')], () => load(search.value.trim())));
    });
  }
  function contactRowHtml(c) {
    const sub = c.status === 'subscribed';
    return '<tr>'
      + '<td>' + esc(c.email) + '</td>'
      + '<td>' + esc(c.name || '') + '</td>'
      + '<td>' + esc(c.company || '') + '</td>'
      + '<td><span class="t-dept">' + esc(c.source || '—') + '</span></td>'
      + '<td><span class="' + (sub ? 'c-sub' : 'c-unsub') + '">' + esc(CONTACT_STATUS[c.status] || c.status) + '</span></td>'
      + '<td class="oe-rowacts"><button class="btn btn-small" data-view="' + esc(c.id) + '">Details</button>'
      + '<button class="btn btn-small" data-id="' + esc(c.id) + '" data-to="' + (sub ? 'unsubscribed' : 'subscribed') + '">' + (sub ? 'Unsubscribe' : 'Re-subscribe') + '</button></td>'
      + '</tr>';
  }
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => load(search.value.trim()), 300); });
  load('');
}

// Per-contact drawer: edit profile fields, toggle consent, see CRM activity
// (lists, source, join date, email engagement), and delete.
function openContactDrawer(c, onClose) {
  if (!c) { return; }
  const modal = el('<div class="oe-drawer-wrap"><div class="oe-drawer-bg"></div>'
    + '<aside class="oe-drawer oe-drawer-wide"><div class="oe-drawer-head"><h2>' + esc(c.name || c.email) + '</h2>'
    + '<button class="btn btn-small" data-close>Close</button></div>'
    + '<div class="oe-drawer-body"></div></aside></div>');
  document.body.appendChild(modal);
  let changed = false;
  const close = () => { modal.remove(); if (onClose && changed) { onClose(); } };
  modal.querySelector('[data-close]').addEventListener('click', close);
  modal.querySelector('.oe-drawer-bg').addEventListener('click', close);
  const bodyEl = modal.querySelector('.oe-drawer-body');

  bodyEl.appendChild(el('<div class="oe-cmeta"><span class="muted small">Email</span><div>' + esc(c.email) + '</div></div>'));

  // Editable profile fields.
  const grid = el('<div class="oe-wgrid"></div>');
  const inputs = {};
  [['name', 'Name'], ['company', 'Company'], ['tags', 'Tags'], ['phone', 'Phone']].forEach(([key, label]) => {
    const w = el('<label class="oe-wfield"><span>' + esc(label) + '</span></label>');
    const i = el('<input>'); i.value = c[key] || ''; w.appendChild(i); inputs[key] = i; grid.appendChild(w);
  });
  bodyEl.appendChild(grid);

  const sub = c.status === 'subscribed';
  const actions = el('<div class="oe-wnav"></div>');
  const saveBtn = el('<button class="btn btn-primary">Save changes</button>');
  const statusBtn = el('<button class="btn">' + (sub ? 'Unsubscribe' : 'Re-subscribe') + '</button>');
  const msg = el('<div class="oe-result"></div>');
  actions.appendChild(saveBtn); actions.appendChild(statusBtn); actions.appendChild(msg);
  bodyEl.appendChild(actions);

  saveBtn.addEventListener('click', async () => {
    msg.textContent = 'Saving…';
    const fields = { name: inputs.name.value, company: inputs.company.value, tags: inputs.tags.value, phone: inputs.phone.value };
    try { await api.editContact(c.id, fields); Object.assign(c, fields); changed = true; msg.textContent = 'Saved.'; }
    catch (e) { msg.textContent = e.message || 'Could not save.'; }
  });
  statusBtn.addEventListener('click', async () => {
    const to = c.status === 'subscribed' ? 'unsubscribed' : 'subscribed';
    statusBtn.disabled = true; msg.textContent = 'Updating…';
    try { await api.updateContact(c.id, to); c.status = to; changed = true; statusBtn.textContent = to === 'subscribed' ? 'Unsubscribe' : 'Re-subscribe'; statusBtn.disabled = false; msg.textContent = 'Updated.'; }
    catch (e) { statusBtn.disabled = false; msg.textContent = e.message || 'Error'; }
  });

  // Activity report.
  bodyEl.appendChild(el('<div class="oe-cmp-label">Activity</div>'));
  const act = el('<div class="oe-activity"><div class="oe-loading">Loading activity…</div></div>');
  bodyEl.appendChild(act);
  api.contactActivity(c.id).then((a) => {
    act.innerHTML = '';
    const eng = a.engagement || { received: 0, opened: 0, clicked: 0 };
    const meta = el('<div class="oe-act-meta"></div>');
    meta.innerHTML = '<div><span class="muted small">Joined</span><div>' + esc((a.joined || '').slice(0, 10) || '—') + '</div></div>'
      + '<div><span class="muted small">Source</span><div>' + esc(a.source || '—') + '</div></div>'
      + '<div><span class="muted small">Status</span><div>' + esc(a.status || '—') + '</div></div>';
    act.appendChild(meta);
    const lists = Array.isArray(a.lists) ? a.lists : [];
    const chips = el('<div class="oe-chips"></div>');
    chips.innerHTML = lists.length ? lists.map((n) => '<span class="oe-chip">' + esc(n) + '</span>').join('') : '<span class="muted small">In no lists.</span>';
    act.appendChild(el('<div class="oe-act-sub muted small">Lists</div>'));
    act.appendChild(chips);
    act.appendChild(el('<div class="oe-act-sub muted small">Email engagement</div>'));
    act.appendChild(el('<div class="oe-act-eng">Received <strong>' + eng.received + '</strong> · Opened <strong>' + eng.opened + '</strong> · Clicked <strong>' + eng.clicked + '</strong></div>'));
    const camps = Array.isArray(a.campaigns) ? a.campaigns : [];
    if (camps.length) {
      const t = el('<table class="oe-ctable" style="margin-top:10px"><thead><tr><th>Campaign</th><th>Sent</th><th>Open</th><th>Click</th></tr></thead><tbody></tbody></table>');
      t.querySelector('tbody').innerHTML = camps.map((m) => '<tr><td>' + esc(m.campaign || '—') + '</td>'
        + '<td>' + esc((m.sent_at || '').slice(0, 10) || '—') + '</td>'
        + '<td>' + (m.opened ? '✓' : '·') + '</td><td>' + (m.clicked ? '✓' : '·') + '</td></tr>').join('');
      act.appendChild(t);
    }
  }).catch(() => { act.innerHTML = '<p class="muted small">Could not load activity.</p>'; });

  // Delete.
  const del = el('<button class="btn btn-link-danger" style="margin-top:18px">Delete this contact</button>');
  del.addEventListener('click', async () => {
    if (!confirm('Delete ' + (c.name || c.email) + '? This removes them from all lists and cannot be undone.')) { return; }
    msg.textContent = 'Deleting…';
    try { await api.deleteContact(c.id); changed = true; close(); }
    catch (e) { msg.textContent = e.message || 'Could not delete.'; }
  });
  bodyEl.appendChild(del);
}

async function renderListsTab(container) {
  container.innerHTML = '<div class="oe-loading">Loading lists…</div>';
  let lists = [];
  try { lists = await api.listLists(); } catch (e) { container.innerHTML = '<p class="oe-error">Could not load lists.</p>'; return; }
  container.innerHTML = '';
  const bar = el('<div class="oe-listbar"><button class="btn btn-primary" data-new>+ New list</button></div>');
  bar.querySelector('[data-new]').addEventListener('click', async () => {
    const name = prompt('Name the new list:');
    if (!name || !name.trim()) { return; }
    try { await api.createList(name.trim(), ''); renderListsTab(container); }
    catch (e) { alert(e.message || 'Could not create the list.'); }
  });
  container.appendChild(bar);

  if (!Array.isArray(lists) || !lists.length) {
    container.appendChild(el('<p class="muted" style="padding:16px 0">No lists yet — create one, or import a Brevo export from the plugin.</p>'));
    return;
  }
  const table = el('<table class="oe-ctable"><thead><tr><th>List</th><th>Type</th><th>Members</th><th></th></tr></thead><tbody></tbody></table>');
  const tbody = table.querySelector('tbody');
  lists.forEach((l) => {
    const tr = el('<tr>'
      + '<td><strong>' + esc(l.name) + '</strong>' + (l.description ? '<div class="muted small">' + esc(l.description) + '</div>' : '') + '</td>'
      + '<td><span class="t-dept">' + (l.type === 'dynamic' ? 'segment' : 'list') + '</span></td>'
      + '<td>' + (l.member_count || 0) + '</td>'
      + '<td class="oe-rowacts"><button class="btn btn-small" data-view>View contacts</button>'
      + '<button class="btn btn-small" data-rename>Rename</button>'
      + '<button class="btn btn-small btn-link-danger" data-del>Delete</button></td></tr>');
    tr.querySelector('[data-view]').addEventListener('click', () => openListMembers(l, () => renderListsTab(container)));
    tr.querySelector('[data-rename]').addEventListener('click', async () => {
      const name = prompt('Rename list:', l.name);
      if (!name || !name.trim() || name.trim() === l.name) { return; }
      try { await api.updateList(l.id, name.trim(), l.description || ''); renderListsTab(container); }
      catch (e) { alert(e.message || 'Could not rename.'); }
    });
    tr.querySelector('[data-del]').addEventListener('click', async () => {
      if (!confirm('Delete list "' + l.name + '"? The contacts stay — only the list and its memberships are removed.')) { return; }
      try { await api.deleteList(l.id); renderListsTab(container); }
      catch (e) { alert(e.message || 'Could not delete.'); }
    });
    tbody.appendChild(tr);
  });
  container.appendChild(table);
}

// Drawer to view/manage the contacts in a single list. Empty search shows the
// current members; typing searches all contacts so you can add them.
function openListMembers(list, onClose) {
  const modal = el('<div class="oe-drawer-wrap"><div class="oe-drawer-bg"></div>'
    + '<aside class="oe-drawer oe-drawer-wide"><div class="oe-drawer-head"><h2>' + esc(list.name) + ' — contacts</h2>'
    + '<button class="btn btn-small" data-close>Close</button></div>'
    + '<div class="oe-drawer-body"><input class="oe-contacts-search" type="search" placeholder="Search to add a contact, or browse members below…">'
    + '<div class="oe-listmem"></div></div></aside></div>');
  document.body.appendChild(modal);
  const close = () => { modal.remove(); if (onClose) { onClose(); } };
  modal.querySelector('[data-close]').addEventListener('click', close);
  modal.querySelector('.oe-drawer-bg').addEventListener('click', close);
  const memWrap = modal.querySelector('.oe-listmem');
  const searchEl = modal.querySelector('input');

  function memberTable(rows, mode) {
    const table = el('<table class="oe-ctable"><thead><tr><th>Email</th><th>Name</th><th></th></tr></thead><tbody></tbody></table>');
    const tbody = table.querySelector('tbody');
    rows.forEach((c) => {
      const inList = Array.isArray(c.lists) && c.lists.indexOf(list.id) !== -1;
      const tr = el('<tr><td>' + esc(c.email) + '</td><td>' + esc(c.name || '') + '</td><td></td></tr>');
      const cell = tr.querySelector('td:last-child');
      if (mode === 'members') {
        const rm = el('<button class="btn btn-small btn-link-danger">Remove</button>');
        rm.addEventListener('click', async () => { rm.disabled = true; try { await api.listMember(list.id, c.id, 'remove'); loadMembers(); } catch (e) { rm.disabled = false; alert(e.message || 'Error'); } });
        cell.appendChild(rm);
      } else {
        const add = el('<button class="btn btn-small"' + (inList ? ' disabled' : '') + '>' + (inList ? 'In list' : 'Add') + '</button>');
        if (!inList) { add.addEventListener('click', async () => { add.disabled = true; try { await api.listMember(list.id, c.id, 'add'); add.textContent = 'Added'; } catch (e) { add.disabled = false; alert(e.message || 'Error'); } }); }
        cell.appendChild(add);
      }
      tbody.appendChild(tr);
    });
    return table;
  }
  async function loadMembers() {
    memWrap.innerHTML = '<div class="oe-loading">Loading…</div>';
    let rows = [];
    try { rows = await api.listContacts('', 0, list.id); } catch (e) { memWrap.innerHTML = '<p class="oe-error">Could not load.</p>'; return; }
    memWrap.innerHTML = '';
    if (!rows.length) { memWrap.appendChild(el('<p class="muted" style="padding:12px 0">No contacts in this list yet — search above to add some.</p>')); return; }
    memWrap.appendChild(memberTable(rows, 'members'));
  }
  async function doSearch(term) {
    memWrap.innerHTML = '<div class="oe-loading">Searching…</div>';
    let rows = [];
    try { rows = await api.listContacts(term, 0); } catch (e) { memWrap.innerHTML = '<p class="oe-error">Could not search.</p>'; return; }
    memWrap.innerHTML = '';
    if (!rows.length) { memWrap.appendChild(el('<p class="muted" style="padding:12px 0">No contacts match that.</p>')); return; }
    memWrap.appendChild(memberTable(rows, 'add'));
  }
  let timer = null;
  searchEl.addEventListener('input', () => {
    clearTimeout(timer);
    const term = searchEl.value.trim();
    timer = setTimeout(() => { if (term) { doSearch(term); } else { loadMembers(); } }, 300);
  });
  loadMembers();
}

/* ---------------------------------------------------------------- */
/* AI assistant — staff chat with tool-access to live data          */
/* ---------------------------------------------------------------- */
const ASSISTANT_SUGGESTIONS = [
  'How many tickets sold today, and all-time?',
  'Which events still need work before they can go live?',
  'Any failed card payments recently?',
  'What’s our volunteer coverage looking like?',
];

/* Tiny, safe markdown: escapes first, then adds bold, inline code, bullets and breaks. */
function assistantFormat(text) {
  let s = esc(String(text || ''));
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  const lines = s.split(/\n/);
  let out = '';
  let inList = false;
  lines.forEach((ln) => {
    const m = ln.match(/^\s*[-*•]\s+(.*)$/);
    if (m) {
      if (!inList) { out += '<ul>'; inList = true; }
      out += '<li>' + m[1] + '</li>';
    } else {
      if (inList) { out += '</ul>'; inList = false; }
      out += ln.trim() === '' ? '' : '<p>' + ln + '</p>';
    }
  });
  if (inList) { out += '</ul>'; }
  return out || '<p></p>';
}

function renderAssistant() {
  const main = shell('assistant');
  main.appendChild(pageHeader('ASSISTANT · LIVE FESTIVAL DATA', 'Assistant'));
  main.appendChild(pageGuide('assistant'));

  const panel = el(`
    <section class="oe-chat">
      <div class="oe-chat-log" id="chat-log"></div>
      <form class="oe-chat-bar" id="chat-form">
        <input id="chat-input" type="text" autocomplete="off" placeholder="Ask about events, tickets, orders, payments, contacts, volunteers…">
        <button class="btn btn-primary" type="submit" id="chat-send">Ask</button>
      </form>
      <p class="oe-chat-foot muted small">Staff only · the assistant reads live data but can’t change anything. Always double-check before acting on numbers.</p>
    </section>`);
  main.appendChild(panel);

  const log = panel.querySelector('#chat-log');
  const form = panel.querySelector('#chat-form');
  const input = panel.querySelector('#chat-input');
  const send = panel.querySelector('#chat-send');

  function bubble(role, content) {
    const who = role === 'assistant' ? 'ai' : 'me';
    const b = el(`<div class="oe-msg oe-msg-${who}"><div class="oe-msg-body"></div></div>`);
    b.querySelector('.oe-msg-body').innerHTML =
      role === 'assistant' ? assistantFormat(content) : '<p>' + esc(content) + '</p>';
    return b;
  }
  // Append one bubble (clearing the intro if it's still showing) — avoids
  // repainting and re-formatting the whole transcript on every message.
  function appendMsg(role, content) {
    const intro = log.querySelector('.oe-chat-empty');
    if (intro) { intro.remove(); }
    log.appendChild(bubble(role, content));
    log.scrollTop = log.scrollHeight;
  }
  // Full render — only used on entering the view (intro, or replay an existing thread).
  function paint() {
    log.innerHTML = '';
    if (!assistantThread.length) {
      const intro = el(`<div class="oe-chat-empty">
        <h3>What can I help you find?</h3>
        <p class="muted">I look things up in your live data and answer with real numbers.</p>
        <div class="oe-chat-chips"></div>
      </div>`);
      const chips = intro.querySelector('.oe-chat-chips');
      ASSISTANT_SUGGESTIONS.forEach((q) => {
        const c = el(`<button class="oe-chip" type="button">${esc(q)}</button>`);
        c.addEventListener('click', () => { input.value = q; submit(); });
        chips.appendChild(c);
      });
      log.appendChild(intro);
      return;
    }
    assistantThread.forEach((m) => log.appendChild(bubble(m.role, m.content)));
    log.scrollTop = log.scrollHeight;
  }

  let busy = false;
  async function submit() {
    if (busy) { return; }
    const q = input.value.trim();
    if (!q) { return; }
    busy = true;
    input.value = '';
    send.disabled = true;
    assistantThread.push({ role: 'user', content: q });
    appendMsg('user', q);
    const thinking = el('<div class="oe-msg oe-msg-ai"><div class="oe-msg-body oe-typing"><span></span><span></span><span></span></div></div>');
    log.appendChild(thinking);
    log.scrollTop = log.scrollHeight;
    try {
      const r = await api.assistant(assistantThread);
      const reply = (r && r.reply) || 'Sorry — no answer came back.';
      assistantThread.push({ role: 'assistant', content: reply });
      thinking.remove();
      appendMsg('assistant', reply);
    } catch (e) {
      thinking.remove();
      if (e.status === 401 || e.status === 403) { return renderLogin('Session expired — sign in again.'); }
      const msg = 'Sorry — I hit an error (' + (e.message || 'request failed') + ').';
      assistantThread.push({ role: 'assistant', content: msg });
      appendMsg('assistant', msg);
    } finally {
      busy = false;
      send.disabled = false;
      input.focus();
    }
  }
  form.addEventListener('submit', (ev) => { ev.preventDefault(); submit(); });
  paint();
  input.focus();
}

boot();
