import { renderGrid, renderPost } from './ig.js';

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
    const aside = document.createElement('div');
    aside.className = 'solo-aside';
    aside.innerHTML = `<h2>Post ${index + 1} of ${data.posts.length}</h2>
      <p>${LABEL[post.type] || 'Post'}${post.type === 'carousel' ? `, ${post.media.length} slides` : ''}.
      This link always points at this post, even if the running order changes.</p>
      <p><a href="/r/${encodeURIComponent(slug)}">See all ${data.posts.length} posts</a></p>`;
    out.appendChild(aside);
    return;
  }

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

  const counts = data.posts.reduce((acc, p) => ({ ...acc, [p.type]: (acc[p.type] || 0) + 1 }), {});
  sub.textContent = Object.entries(counts)
    .map(([type, n]) => `${n} ${type}${n > 1 ? 's' : ''}`).join(', ') || 'Empty';
  paint();
})();
