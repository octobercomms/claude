/**
 * October Events — planning platform (Phase 1: Elayne's Events board).
 *
 * A no-build vanilla SPA. Lists events from the plugin's oe/v1/planning API,
 * shows the confirm→green readiness, and lets you edit fields + confirm.
 */
import { api, getCreds, setCreds, clearCreds } from './api.js';

const app = document.getElementById('app');
const STATUS = { confirmed: 'Confirmed', in_progress: 'In progress', draft: 'Draft' };

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
    renderBoard();
  } catch (e) {
    renderLogin(e.status === 401 || e.status === 403
      ? 'Those credentials were rejected. Check the username and application password.'
      : 'Could not reach the site. Check the URL.');
  }
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
  app.innerHTML = '<div class="oe-loading">Loading events…</div>';
  let events = [];
  try { events = await api.listEvents(); }
  catch (e) { return renderLogin('Session expired — sign in again.'); }

  const groups = { confirmed: [], in_progress: [], draft: [] };
  events.forEach((e) => { (groups[e.status] || groups.draft).push(e); });

  app.innerHTML = '';
  app.appendChild(el(`
    <header class="oe-top">
      <div><strong>October Events</strong> · Planning</div>
      <div class="oe-top-actions">
        <span class="muted small">${esc((getCreds() || {}).user || '')}</span>
        <button id="b-refresh" class="btn btn-small">Refresh</button>
        <button id="b-out" class="btn btn-small">Sign out</button>
      </div>
    </header>`));

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
  app.appendChild(board);

  app.querySelector('#b-refresh').addEventListener('click', renderBoard);
  app.querySelector('#b-out').addEventListener('click', () => { clearCreds(); renderLogin(); });
  app.querySelectorAll('[data-open]').forEach((c) =>
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

boot();
