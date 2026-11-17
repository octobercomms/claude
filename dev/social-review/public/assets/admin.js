import { cropWarnings, escapeHtml, icon, renderGrid, renderPost } from './ig.js';

const gate = document.getElementById('gate');
const app = document.getElementById('app');
const view = document.getElementById('view');
const crumb = document.getElementById('crumb');
const back = document.getElementById('back');

const api = async (path, options = {}) => {
  const res = await fetch(path, {
    ...options,
    headers: options.body instanceof FormData
      ? options.headers
      : { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
};

const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

/* ---------------- sign in ---------------- */

function applyBrand(brand) {
  const name = brand || 'Content Review';
  document.title = name;
  for (const id of ['brand', 'gate-brand']) {
    const node = document.getElementById(id);
    if (node) node.textContent = name;
  }
  const mark = document.getElementById('mark');
  if (mark) mark.textContent = name.trim().charAt(0);
}

function warnIfSnapshot() {
  if (!onSnapshot()) return;
  const live = `${liveOrigin()}/admin${location.hash}`;
  document.body.prepend(el(`<div class="snapshot-bar">
    <b>You are on a frozen copy of one old deployment.</b>
    Nothing deployed since will appear here, and links copied from this page
    point at this old build.
    <a href="${escapeHtml(live)}">Open the live site</a>
  </div>`));
}

async function boot() {
  warnIfSnapshot();
  const { signedIn, configured, brand } = await api('/api/session');
  applyBrand(brand);
  if (!configured) {
    gate.hidden = false;
    document.getElementById('gate-form').hidden = true;
    const err = document.getElementById('gate-err');
    err.hidden = false;
    err.textContent = 'TEAM_PASSWORD and AUTH_SECRET are not set on this Cloudflare project yet.';
    return;
  }
  if (signedIn) { app.hidden = false; route(); } else { gate.hidden = false; }
}

document.getElementById('gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('gate-err');
  const button = e.currentTarget.querySelector('button');
  err.hidden = true;
  button.disabled = true;
  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ password: document.getElementById('password').value }),
    });
    gate.hidden = true;
    app.hidden = false;
    route();
  } catch (error) {
    err.hidden = false;
    err.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.getElementById('signout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  location.reload();
});

back.addEventListener('click', () => { location.hash = ''; });
window.addEventListener('hashchange', route);

function route() {
  const slug = location.hash.replace(/^#\/?/, '');
  if (slug) showReview(slug); else showList();
}

/* ---------------- review list ---------------- */

async function showList() {
  back.hidden = true;
  crumb.textContent = 'All reviews';
  view.innerHTML = '<p class="empty">Loading</p>';

  const { reviews } = await api('/api/reviews');

  view.innerHTML = '';
  view.appendChild(el(`<div class="card">
    <form class="row" id="new-form">
      <input type="text" id="new-title" placeholder="Client and month, e.g. Hillcroft Gardens November" required
             style="flex:1 1 320px">
      <button class="btn primary" type="submit">Create review</button>
    </form>
    <p class="err" id="new-err" hidden></p>
  </div>`));

  document.getElementById('new-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('new-err');
    err.hidden = true;
    try {
      const { review } = await api('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({ title: document.getElementById('new-title').value }),
      });
      location.hash = `#/${review.slug}`;
    } catch (error) {
      err.hidden = false;
      err.textContent = error.message;
    }
  });

  if (!reviews.length) {
    view.appendChild(el('<p class="empty">No reviews yet. Create one above.</p>'));
    return;
  }

  for (const r of reviews) {
    const card = el(`<div class="card"><div class="row">
      <div>
        <h3>${escapeHtml(r.title)}</h3>
        <p class="meta">${r.postCount || 0} post${r.postCount === 1 ? '' : 's'}
          &middot; created ${new Date(r.created).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
      </div>
      <span class="spacer"></span>
      <a class="btn" href="/r/${encodeURIComponent(r.slug)}" target="_blank" rel="noopener">Open client view</a>
      <button class="btn primary" data-open>Manage</button>
    </div></div>`);
    card.querySelector('[data-open]').addEventListener('click', () => { location.hash = `#/${r.slug}`; });
    view.appendChild(card);
  }
}

/* ---------------- one review ---------------- */

/* Cloudflare gives every deployment its own frozen address, like
   https://d67bf8c7.socialfly.pages.dev. Open one of those and you are looking
   at that build for ever, however many times the site is deployed since. Worse,
   links copied there point at it too, so a client gets pinned to an old build.
   So links are always built against the live address, never location.origin. */

const SNAPSHOT_HOST = /^[0-9a-f]{8}\.(.+\.pages\.dev)$/i;

function liveOrigin() {
  const match = SNAPSHOT_HOST.exec(location.hostname);
  return match ? `${location.protocol}//${match[1]}` : location.origin;
}

export const onSnapshot = () => SNAPSHOT_HOST.test(location.hostname);

const shareUrl = (slug) => `${liveOrigin()}/r/${encodeURIComponent(slug)}`;
const postUrl = (slug, postId) => `${shareUrl(slug)}/${encodeURIComponent(postId)}`;

async function copy(text, button, restore) {
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Copy failed';
  }
  setTimeout(() => { button.textContent = restore || label; }, 1800);
}

// One line per post, ready to paste beside the captions in the content schedule.
const linkList = (review) => review.posts.map((post, i) => {
  const kind = post.type === 'reel' ? 'Reel'
    : post.type === 'carousel' ? `Carousel (${post.media.length} slides)` : 'Single post';
  return `${i + 1}. ${kind} — ${postUrl(review.slug, post.id)}`;
}).join('\n');

async function showReview(slug) {
  back.hidden = false;
  view.innerHTML = '<p class="empty">Loading</p>';

  let review;
  try {
    ({ review } = await api(`/api/reviews/${encodeURIComponent(slug)}`));
  } catch (error) {
    view.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
    return;
  }
  crumb.textContent = review.title;

  const render = () => {
    view.innerHTML = '';
    view.appendChild(settingsCard(review));
    view.appendChild(uploadCard(review, () => reload()));
    view.appendChild(postsCard(review, () => reload()));
    view.appendChild(previewSection(review));
  };

  const reload = async () => {
    ({ review } = await api(`/api/reviews/${encodeURIComponent(slug)}`));
    render();
  };

  render();
}

function settingsCard(review) {
  const card = el(`<div class="card">
    <div class="row">
      <h3>Client view</h3>
      <span class="spacer"></span>
      <button class="btn danger" data-del>Delete review</button>
    </div>
    <div class="link-row">
      <code>${escapeHtml(shareUrl(review.slug))}</code>
      <a class="btn" href="/r/${encodeURIComponent(review.slug)}" target="_blank" rel="noopener">Open</a>
      <button class="btn" data-copy>Copy link</button>
    </div>
    <div class="row" style="margin-top:10px">
      <button class="btn" data-copy-all ${review.posts.length ? '' : 'disabled'}>Copy all post links</button>
      <span style="font-size:13px;color:var(--muted)">One numbered line per post, for the content schedule.</span>
    </div>
    <div class="row" style="margin-top:14px">
      <label style="font-size:13px;color:var(--muted)">Instagram handle shown in the mockup</label>
      <input type="text" data-handle value="${escapeHtml(review.handle || '')}" placeholder="yourbrand" style="width:200px">
      <button class="btn" data-save-handle>Save</button>
      <span class="spacer"></span>
      <label class="btn" style="cursor:pointer">Set profile picture
        <input type="file" accept="image/*" data-avatar hidden></label>
    </div>
    <p class="ok" data-msg hidden></p>
  </div>`);

  const msg = card.querySelector('[data-msg]');
  const flash = (text, isError = false) => {
    msg.hidden = false;
    msg.className = isError ? 'err' : 'ok';
    msg.textContent = text;
    setTimeout(() => { msg.hidden = true; }, 3500);
  };

  card.querySelector('[data-copy]').addEventListener('click', (e) =>
    copy(shareUrl(review.slug), e.currentTarget, 'Copy link'));

  card.querySelector('[data-copy-all]').addEventListener('click', (e) =>
    copy(linkList(review), e.currentTarget, 'Copy all post links'));

  card.querySelector('[data-save-handle]').addEventListener('click', async () => {
    try {
      const { review: updated } = await api(`/api/reviews/${encodeURIComponent(review.slug)}`, {
        method: 'PATCH',
        body: JSON.stringify({ handle: card.querySelector('[data-handle]').value }),
      });
      review.handle = updated.handle;
      flash('Handle saved. Reload to see it in the preview.');
    } catch (error) { flash(error.message, true); }
  });

  card.querySelector('[data-avatar]').addEventListener('change', async (e) => {
    const file = e.currentTarget.files[0];
    if (!file) return;
    try {
      const up = await uploadFile(review.slug, file);
      await api(`/api/reviews/${encodeURIComponent(review.slug)}`, {
        method: 'PATCH', body: JSON.stringify({ avatarKey: up.key }),
      });
      flash('Profile picture saved. Reload to see it.');
    } catch (error) { flash(error.message, true); }
  });

  card.querySelector('[data-del]').addEventListener('click', async () => {
    if (!confirm(`Delete "${review.title}" and every file in it? This cannot be undone.`)) return;
    await api(`/api/reviews/${encodeURIComponent(review.slug)}`, { method: 'DELETE' });
    location.hash = '';
  });

  return card;
}

/* ---------------- uploading ---------------- */

function measure(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const done = (w, h) => { URL.revokeObjectURL(url); resolve({ w, h }); };
    if (file.type.startsWith('video/')) {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => done(v.videoWidth || null, v.videoHeight || null);
      v.onerror = () => done(null, null);
      v.src = url;
    } else {
      const img = new Image();
      img.onload = () => done(img.naturalWidth || null, img.naturalHeight || null);
      img.onerror = () => done(null, null);
      img.src = url;
    }
  });
}

async function uploadFile(slug, file) {
  const form = new FormData();
  form.append('file', file, file.name);
  const { w, h } = await measure(file);
  const up = await api(`/api/upload?slug=${encodeURIComponent(slug)}`, { method: 'POST', body: form });
  return { ...up, w, h };
}

function uploadCard(review, onDone) {
  const card = el(`<div class="card">
    <h3 style="margin-bottom:10px">Add a post</h3>
    <label class="drop" data-drop>
      <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" multiple>
      <b>Drop files here</b> or click to choose.<br>
      Each video becomes its own reel. Images dropped together become one carousel, ordered by filename.
    </label>
    <div class="bar" hidden><i></i></div>
    <p class="err" data-err hidden></p>
    <p class="ok" data-ok hidden></p>
  </div>`);

  const drop = card.querySelector('[data-drop]');
  const input = card.querySelector('input[type=file]');
  const bar = card.querySelector('.bar');
  const fill = card.querySelector('.bar i');
  const err = card.querySelector('[data-err]');
  const okMsg = card.querySelector('[data-ok]');

  const handle = async (fileList) => {
    const files = [...fileList];
    if (!files.length) return;
    err.hidden = true; okMsg.hidden = true;
    bar.hidden = false; fill.style.width = '0%';

    const videos = files.filter((f) => f.type.startsWith('video/'));
    const images = files.filter((f) => f.type.startsWith('image/'))
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));

    const total = files.length;
    let done = 0;
    const step = () => { done += 1; fill.style.width = `${Math.round((done / total) * 100)}%`; };

    try {
      for (const video of videos) {
        const media = await uploadFile(review.slug, video);
        step();
        await api(`/api/reviews/${encodeURIComponent(review.slug)}/posts`, {
          method: 'POST', body: JSON.stringify({ type: 'reel', media: [media] }),
        });
      }
      if (images.length) {
        const media = [];
        for (const image of images) { media.push(await uploadFile(review.slug, image)); step(); }
        await api(`/api/reviews/${encodeURIComponent(review.slug)}/posts`, {
          method: 'POST',
          body: JSON.stringify({ type: images.length > 1 ? 'carousel' : 'post', media }),
        });
      }
      okMsg.hidden = false;
      okMsg.textContent = `Added ${videos.length ? `${videos.length} reel${videos.length > 1 ? 's' : ''}` : ''}${videos.length && images.length ? ' and ' : ''}${images.length ? `1 ${images.length > 1 ? 'carousel' : 'post'}` : ''}.`;
      await onDone();
    } catch (error) {
      err.hidden = false;
      err.textContent = error.message;
    } finally {
      bar.hidden = true;
      input.value = '';
    }
  };

  input.addEventListener('change', (e) => handle(e.currentTarget.files));
  for (const type of ['dragenter', 'dragover']) {
    drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.add('over'); });
  }
  for (const type of ['dragleave', 'drop']) {
    drop.addEventListener(type, () => drop.classList.remove('over'));
  }
  drop.addEventListener('drop', (e) => { e.preventDefault(); handle(e.dataTransfer.files); });

  return card;
}

/* ---------------- post list and preview ---------------- */

function postsCard(review, onDone) {
  if (!review.posts.length) return el('<p class="empty">No posts yet. Add the first one above.</p>');

  const wrap = el('<div></div>');
  const move = async (index, delta) => {
    const order = review.posts.map((p) => p.id);
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    await api(`/api/reviews/${encodeURIComponent(review.slug)}`, {
      method: 'PATCH', body: JSON.stringify({ order }),
    });
    await onDone();
  };

  review.posts.forEach((post, i) => {
    const first = post.media[0];
    const isVideo = (first.mime || '').startsWith('video/');
    const url = `/m/${first.key.slice('media/'.length)}`;
    const warnings = cropWarnings(post);

    const card = el(`<div class="card"><div class="admin-post">
      ${isVideo
        ? `<video class="thumb" src="${escapeHtml(url)}#t=0.1" muted playsinline preload="metadata"></video>`
        : `<img class="thumb" src="${escapeHtml(url)}" alt="">`}
      <div>
        <h3>${i + 1}. ${post.type === 'reel' ? 'Reel' : post.type === 'carousel' ? `Carousel, ${post.media.length} slides` : 'Single post'}</h3>
        <p class="meta">${first.w && first.h ? `${first.w}&times;${first.h}` : 'size unknown'}
          &middot; ${escapeHtml(first.name || first.mime)}</p>
      </div>
      <span class="spacer"></span>
      <button class="btn" data-link>Copy link</button>
      <button class="btn" data-up aria-label="Move up">${icon('chevL', 14, { sw: 2.4 })}</button>
      <button class="btn" data-down aria-label="Move down">${icon('chevR', 14, { sw: 2.4 })}</button>
      <button class="btn danger" data-remove>Remove</button>
    </div></div>`);

    card.appendChild(slidesPanel(review, post, onDone));

    for (const w of warnings) card.appendChild(el(`<p class="warn">${escapeHtml(w)}</p>`));

    card.querySelector('[data-link]').addEventListener('click', async (e) => {
      await copy(postUrl(review.slug, post.id), e.currentTarget, 'Copy link');
    });
    card.querySelector('[data-up]').disabled = i === 0;
    card.querySelector('[data-down]').disabled = i === review.posts.length - 1;
    card.querySelector('[data-up]').addEventListener('click', () => move(i, -1));
    card.querySelector('[data-down]').addEventListener('click', () => move(i, 1));
    card.querySelector('[data-remove]').addEventListener('click', async () => {
      if (!confirm('Remove this post from the review?')) return;
      await api(`/api/reviews/${encodeURIComponent(review.slug)}`, {
        method: 'PATCH', body: JSON.stringify({ removePostId: post.id }),
      });
      await onDone();
    });

    wrap.appendChild(card);
  });

  return wrap;
}

/* Slide-level editing. Every operation sends the post's complete new media
   list, so reorder, remove, add and replace are all one request. */
function slidesPanel(review, post, onDone) {
  const isReel = (post.media[0].mime || '').startsWith('video/');
  const url = (m) => `/m/${m.key.slice('media/'.length)}`;

  const panel = el(`<div class="slides">
    <p class="slides-label">${isReel ? 'Video' : `Slides (${post.media.length})`}</p>
    <div class="slide-strip"></div>
    <p class="err" data-err hidden></p>
  </div>`);

  const strip = panel.querySelector('.slide-strip');
  const err = panel.querySelector('[data-err]');

  const commit = async (media) => {
    err.hidden = true;
    panel.classList.add('busy');
    try {
      await api(`/api/reviews/${encodeURIComponent(review.slug)}`, {
        method: 'PATCH',
        body: JSON.stringify({ postId: post.id, media }),
      });
      await onDone();
    } catch (error) {
      err.hidden = false;
      err.textContent = error.message;
      panel.classList.remove('busy');
    }
  };

  const plain = () => post.media.map((m) => ({ key: m.key, mime: m.mime, name: m.name, w: m.w, h: m.h }));

  post.media.forEach((m, i) => {
    const isVideo = (m.mime || '').startsWith('video/');
    const slide = el(`<figure class="slide">
      ${isVideo
        ? `<video src="${escapeHtml(url(m))}#t=0.1" muted playsinline preload="metadata"></video>`
        : `<img src="${escapeHtml(url(m))}" alt="Slide ${i + 1}">`}
      <span class="slide-n">${i + 1}</span>
      <div class="slide-bar">
        <button data-left aria-label="Move slide left">${icon('chevL', 12, { sw: 2.6 })}</button>
        <label class="swap" title="Replace this slide">
          ${icon('swap', 12, { sw: 2.2 })}
          <input type="file" accept="${isVideo ? 'video/mp4,video/webm,video/quicktime' : 'image/jpeg,image/png,image/webp'}" hidden>
        </label>
        <button data-del aria-label="Remove slide">&times;</button>
        <button data-right aria-label="Move slide right">${icon('chevR', 12, { sw: 2.6 })}</button>
      </div>
    </figure>`);

    const left = slide.querySelector('[data-left]');
    const right = slide.querySelector('[data-right]');
    left.disabled = i === 0;
    right.disabled = i === post.media.length - 1;

    const move = (delta) => {
      const media = plain();
      [media[i], media[i + delta]] = [media[i + delta], media[i]];
      commit(media);
    };
    left.addEventListener('click', () => move(-1));
    right.addEventListener('click', () => move(1));

    // Swap one slide for another without disturbing its position, which
    // matters because the post's link is already out with a client.
    slide.querySelector('.swap input').addEventListener('change', async (e) => {
      const file = e.currentTarget.files[0];
      e.currentTarget.value = '';
      if (!file) return;
      err.hidden = true;
      panel.classList.add('busy');
      try {
        const replacement = await uploadFile(review.slug, file);
        await commit(plain().map((m, j) => (j === i ? replacement : m)));
      } catch (error) {
        err.hidden = false;
        err.textContent = error.message;
        panel.classList.remove('busy');
      }
    });

    slide.querySelector('[data-del]').addEventListener('click', () => {
      if (post.media.length === 1) {
        err.hidden = false;
        err.textContent = 'A post needs at least one slide. Use Remove to delete the whole post.';
        return;
      }
      commit(plain().filter((_, j) => j !== i));
    });

    strip.appendChild(slide);
  });

  const accept = isReel
    ? 'video/mp4,video/webm,video/quicktime'
    : 'image/jpeg,image/png,image/webp';

  const add = el(`<label class="slide-add">
    <span>${isReel ? 'Replace' : '+ Add'}</span>
    <input type="file" accept="${accept}" ${isReel ? '' : 'multiple'} hidden>
  </label>`);

  add.querySelector('input').addEventListener('change', async (e) => {
    const files = [...e.currentTarget.files]
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    if (!files.length) return;
    err.hidden = true;
    panel.classList.add('busy');
    try {
      const uploaded = [];
      for (const file of files) uploaded.push(await uploadFile(review.slug, file));
      await commit(isReel ? uploaded.slice(0, 1) : [...plain(), ...uploaded]);
    } catch (error) {
      err.hidden = false;
      err.textContent = error.message;
      panel.classList.remove('busy');
    }
  });

  strip.appendChild(add);
  return panel;
}

function previewSection(review) {
  const section = el(`<section style="margin-top:34px">
    <div class="controls">
      <div class="seg" role="group" aria-label="View">
        <button data-feed aria-pressed="true">Feed</button>
        <button data-grid aria-pressed="false">Grid</button>
      </div>
      <button class="btn" data-ui aria-pressed="false">Hide Instagram UI</button>
      <button class="btn" data-safe aria-pressed="false">Safe zones</button>
      <span style="font-size:13px;color:var(--muted)">Exactly what the client sees, plus crop notes.</span>
    </div>
    <div data-out class="feed"></div>
  </section>`);

  const out = section.querySelector('[data-out]');
  const ctx = {
    handle: review.handle,
    avatar: review.avatarKey ? `/m/${review.avatarKey.slice('media/'.length)}` : null,
    fileBase: review.slug,
  };
  const posts = review.posts.map((p) => ({
    ...p,
    media: p.media.map((m) => ({ ...m, url: `/m/${m.key.slice('media/'.length)}` })),
  }));

  let mode = 'feed';
  const paint = () => {
    out.innerHTML = '';
    if (!posts.length) { out.innerHTML = '<p class="empty">Nothing to preview yet.</p>'; return; }
    if (mode === 'grid') { out.className = ''; out.appendChild(renderGrid(posts, ctx)); return; }
    out.className = 'feed';
    posts.forEach((post, i) => out.appendChild(renderPost(post, ctx, i + 1)));
  };

  section.querySelector('[data-feed]').addEventListener('click', () => {
    mode = 'feed';
    section.querySelector('[data-feed]').setAttribute('aria-pressed', 'true');
    section.querySelector('[data-grid]').setAttribute('aria-pressed', 'false');
    paint();
  });
  section.querySelector('[data-grid]').addEventListener('click', () => {
    mode = 'grid';
    section.querySelector('[data-feed]').setAttribute('aria-pressed', 'false');
    section.querySelector('[data-grid]').setAttribute('aria-pressed', 'true');
    paint();
  });
  section.querySelector('[data-ui]').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.textContent = on ? 'Show Instagram UI' : 'Hide Instagram UI';
    document.body.classList.toggle('hideui', on);
  });
  section.querySelector('[data-safe]').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    document.body.classList.toggle('showsafe', on);
  });

  paint();
  return section;
}

boot().catch((error) => {
  gate.hidden = false;
  const err = document.getElementById('gate-err');
  err.hidden = false;
  err.textContent = error.message;
});
