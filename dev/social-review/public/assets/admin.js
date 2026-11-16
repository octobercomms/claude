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

async function boot() {
  const { signedIn, configured } = await api('/api/session');
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

const shareUrl = (slug) => `${location.origin}/r/${encodeURIComponent(slug)}`;

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
    <div class="row" style="margin-top:14px">
      <label style="font-size:13px;color:var(--oc-muted)">Instagram handle shown in the mockup</label>
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

  card.querySelector('[data-copy]').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(shareUrl(review.slug));
      e.currentTarget.textContent = 'Copied';
      setTimeout(() => { e.currentTarget.textContent = 'Copy link'; }, 1800);
    } catch {
      flash('Copy failed. Select the link and copy it by hand.', true);
    }
  });

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
      <button class="btn" data-up aria-label="Move up">${icon('chevL', 14, { sw: 2.4 })}</button>
      <button class="btn" data-down aria-label="Move down">${icon('chevR', 14, { sw: 2.4 })}</button>
      <button class="btn danger" data-remove>Remove</button>
    </div></div>`);

    for (const w of warnings) card.appendChild(el(`<p class="warn">${escapeHtml(w)}</p>`));

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

function previewSection(review) {
  const section = el(`<section style="margin-top:34px">
    <div class="controls">
      <div class="seg" role="group" aria-label="View">
        <button data-feed aria-pressed="true">Feed</button>
        <button data-grid aria-pressed="false">Grid</button>
      </div>
      <button class="btn" data-ui aria-pressed="false">Hide Instagram UI</button>
      <button class="btn" data-safe aria-pressed="false">Safe zones</button>
      <span style="font-size:13px;color:var(--oc-muted)">Exactly what the client sees, plus crop notes.</span>
    </div>
    <div data-out class="feed"></div>
  </section>`);

  const out = section.querySelector('[data-out]');
  const ctx = {
    handle: review.handle,
    avatar: review.avatarKey ? `/m/${review.avatarKey.slice('media/'.length)}` : null,
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
