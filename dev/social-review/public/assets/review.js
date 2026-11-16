import { renderGrid, renderPost } from './ig.js';

const out = document.getElementById('out');
const title = document.getElementById('title');
const sub = document.getElementById('sub');

const slug = decodeURIComponent(location.pathname.replace(/^\/r\//, '').replace(/\/+$/, ''));
let data = null;
let view = 'feed';

function paint() {
  out.innerHTML = '';
  if (!data || !data.posts.length) {
    out.innerHTML = '<p class="empty">Nothing has been added to this review yet.</p>';
    return;
  }
  const ctx = { handle: data.handle, avatar: data.avatar, showWarnings: false };
  if (view === 'grid') {
    out.className = '';
    out.appendChild(renderGrid(data.posts, ctx));
  } else {
    out.className = 'feed';
    data.posts.forEach((post, i) => out.appendChild(renderPost(post, ctx, i + 1)));
  }
}

function setView(next) {
  view = next;
  document.getElementById('tab-feed').setAttribute('aria-pressed', String(next === 'feed'));
  document.getElementById('tab-grid').setAttribute('aria-pressed', String(next === 'grid'));
  document.getElementById('toggle-safe').disabled = next === 'grid';
  paint();
}

function toggle(button, className) {
  const on = button.getAttribute('aria-pressed') !== 'true';
  button.setAttribute('aria-pressed', String(on));
  document.body.classList.toggle(className, on);
}

document.getElementById('tab-feed').addEventListener('click', () => setView('feed'));
document.getElementById('tab-grid').addEventListener('click', () => setView('grid'));
document.getElementById('toggle-ui').addEventListener('click', (e) => {
  toggle(e.currentTarget, 'hideui');
  e.currentTarget.textContent = document.body.classList.contains('hideui')
    ? 'Show Instagram UI' : 'Hide Instagram UI';
});
document.getElementById('toggle-safe').addEventListener('click', (e) => toggle(e.currentTarget, 'showsafe'));

(async () => {
  if (!slug) { sub.textContent = 'No review in this link.'; return; }
  try {
    const res = await fetch(`/api/public/${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error(res.status === 404 ? 'That link is not valid any more.' : 'Could not load this review.');
    data = await res.json();
  } catch (err) {
    sub.textContent = err.message;
    out.innerHTML = '<p class="empty">Ask October for a fresh link.</p>';
    document.getElementById('intro').remove();
    return;
  }
  title.textContent = data.title;
  document.title = `${data.title} — content review`;
  const counts = data.posts.reduce((acc, p) => ({ ...acc, [p.type]: (acc[p.type] || 0) + 1 }), {});
  sub.textContent = Object.entries(counts)
    .map(([type, n]) => `${n} ${type}${n > 1 ? 's' : ''}`).join(', ') || 'Empty';
  paint();
})();
