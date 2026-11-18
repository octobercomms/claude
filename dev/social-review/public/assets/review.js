import { fitPhones, renderGrid, renderPost, watchFit } from './ig.js';

const out = document.getElementById('out');
const title = document.getElementById('title');
const sub = document.getElementById('sub');
const mark = document.getElementById('mark');
const tabs = document.getElementById('tabs');
const intro = document.getElementById('intro');

// /r/<slug> shows the whole review. /r/<slug>/<postId> shows one post, which is
// what gets pasted next to its caption in the content schedule.
const parts = location.pathname.replace(/^\/r\//, '').replace(/\/+$/, '').split('/');
const slug = decodeURIComponent(parts[0] || '');
const focusId = parts[1] ? decodeURIComponent(parts[1]) : null;

let data = null;
let view = 'feed';
let refit = () => {};

const COLS_KEY = 'ocsr_cols';
const colsSelect = document.getElementById('cols');

function applyCols(n) {
  out.style.setProperty('--cols', String(n));
  try { localStorage.setItem(COLS_KEY, String(n)); } catch { /* private window */ }
  refit();
}

const LABEL = { reel: 'Reel', carousel: 'Carousel', post: 'Single post' };

function paint() {
  out.innerHTML = '';
  if (!data || !data.posts.length) {
    out.innerHTML = '<p class="empty">Nothing has been added to this review yet.</p>';
    return;
  }
  const ctx = { handle: data.handle, avatar: data.avatar, showWarnings: false, fileBase: slug };

  if (focusId) {
    const index = data.posts.findIndex((p) => p.id === focusId);
    if (index === -1) {
      out.className = '';
      out.innerHTML = `<p class="empty">That post is no longer in this review.
        <a href="/r/${encodeURIComponent(slug)}">See the current set</a>.</p>`;
      return;
    }
    const post = data.posts[index];
    out.className = 'solo';
    out.appendChild(renderPost(post, ctx, index + 1));
    fitPhones(out);
    const aside = document.createElement('div');
    aside.className = 'solo-aside';
    aside.innerHTML = `<h2>Post ${index + 1} of ${data.posts.length}</h2>
      ${post.archived ? '<p><b>Signed off.</b> It is no longer in the running set.</p>' : ''}
      <p>${LABEL[post.type] || 'Post'}${post.type === 'carousel' ? `, ${post.media.length} slides` : ''}.
      This link always points at this post, even if the running order changes.</p>
      <p><a href="/r/${encodeURIComponent(slug)}">See all ${data.posts.length} posts</a></p>`;
    out.appendChild(aside);
    return;
  }

  // Signed-off posts leave the running set. A link already sent to someone
  // still opens its own post, which is the branch above.
  const live = data.posts.filter((p) => !p.archived);
  if (!live.length) {
    out.className = '';
    out.innerHTML = '<p class="empty">Everything in this review has been signed off.</p>';
    return;
  }

  if (view === 'grid') {
    out.className = '';
    out.appendChild(renderGrid(live, ctx));
  } else {
    out.className = 'feed';
    live.forEach((post, i) => out.appendChild(renderPost(post, ctx, i + 1)));
    fitPhones(out);
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
colsSelect.addEventListener('change', (e) => applyCols(e.currentTarget.value));

// Same trap as the admin: a client sent a deployment-specific link would be
// looking at an old build for ever. Send them to the live one instead.
const snapshot = /^[0-9a-f]{8}\.(.+\.pages\.dev)$/i.exec(location.hostname);
if (snapshot) {
  location.replace(`${location.protocol}//${snapshot[1]}${location.pathname}${location.search}`);
}

(async () => {
  if (!slug) { sub.textContent = 'No review in this link.'; return; }
  try {
    const res = await fetch(`/api/public/${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error(res.status === 404 ? 'That link is not valid any more.' : 'Could not load this review.');
    data = await res.json();
  } catch (err) {
    sub.textContent = err.message;
    out.innerHTML = '<p class="empty">Ask for a fresh link.</p>';
    intro.remove();
    return;
  }

  title.textContent = data.title;
  mark.textContent = (data.title || '?').trim().charAt(0);
  document.title = `${data.title} — ${data.brand || 'content review'}`;

  if (focusId) {
    tabs.hidden = true;
    intro.innerHTML = 'A single post from this set, rendered at the crop Instagram applies. '
      + '<b>Safe zones</b> shades the areas Instagram\'s own buttons and caption sit over.';
  }

  refit = watchFit(out);
  try {
    const saved = localStorage.getItem(COLS_KEY);
    if (saved) colsSelect.value = saved;
  } catch { /* private window */ }
  applyCols(colsSelect.value);
  if (focusId) colsSelect.closest('.cols').hidden = true;

  const counts = data.posts.reduce((acc, p) => ({ ...acc, [p.type]: (acc[p.type] || 0) + 1 }), {});
  const signedOff = data.posts.filter((p) => p.archived).length;
  sub.textContent = [
    Object.entries(counts).map(([type, n]) => `${n} ${type}${n > 1 ? 's' : ''}`).join(', ') || 'Empty',
    signedOff ? `${signedOff} signed off` : '',
  ].filter(Boolean).join(' · ');
  paint();
})();
