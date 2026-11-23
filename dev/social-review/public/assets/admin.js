import { capturePhone, cropWarnings, escapeHtml, fitPhones, icon, renderGrid, renderPost, watchFit } from './ig.js';

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
  const [slug, section] = location.hash.replace(/^#\/?/, '').split('/');
  if (slug && section === 'archive') showArchive(slug);
  else if (slug) showReview(slug);
  else showList();
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

    const archived = review.posts.filter((p) => p.archived).length;
    if (archived) {
      view.appendChild(el(`<p class="archive-link"><a href="#/${encodeURIComponent(review.slug)}/archive">${archived} archived post${archived > 1 ? 's' : ''} &rarr;</a><span>Out of the client's set. Their own links still work.</span></p>`));
    }

    view.appendChild(postsCard(review, () => reload(), 'live'));
    view.appendChild(previewSection(review, 'live'));
  };

  const reload = async () => {
    ({ review } = await api(`/api/reviews/${encodeURIComponent(slug)}`));
    render();
  };

  render();
}

async function showArchive(slug) {
  back.hidden = false;
  view.innerHTML = '<p class="empty">Loading</p>';

  let review;
  try {
    ({ review } = await api(`/api/reviews/${encodeURIComponent(slug)}`));
  } catch (error) {
    view.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
    return;
  }
  crumb.textContent = `${review.title} · Archive`;

  const render = () => {
    const archived = review.posts.filter((p) => p.archived);
    view.innerHTML = '';
    view.appendChild(el(`<div class="card">
      <div class="row">
        <div>
          <h3>Archive</h3>
          <p class="meta">${archived.length} post${archived.length === 1 ? '' : 's'},
            out of the client's set. Each one's own link still works, so anyone
            already sent one still finds what they approved.</p>
        </div>
        <span class="spacer"></span>
        <a class="btn" href="#/${encodeURIComponent(review.slug)}">Back to review</a>
        ${archived.length ? `<a class="btn" href="/api/reviews/${encodeURIComponent(review.slug)}/zip?set=archived">
          ${icon('download', 13, { sw: 2.1 })} Download originals</a>
        <button class="btn danger" data-clear>Delete all ${archived.length}</button>` : ''}
      </div>
    </div>`));

    const clear = view.querySelector('[data-clear]');
    if (clear) {
      clear.addEventListener('click', async (e) => {
        if (!confirm(`Delete ${archived.length} archived post${archived.length > 1 ? 's' : ''} and every file in them? This cannot be undone, and their links will stop working.`)) return;
        e.currentTarget.disabled = true;
        e.currentTarget.textContent = 'Deleting';
        for (const post of archived) {
          await api(`/api/reviews/${encodeURIComponent(review.slug)}`, {
            method: 'PATCH', body: JSON.stringify({ removePostId: post.id }),
          });
        }
        await reload();
      });
    }

    view.appendChild(postsCard(review, () => reload(), 'archived'));
    if (archived.length) view.appendChild(previewSection(review, 'archived'));
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
      <a class="btn" data-zip href="/api/reviews/${encodeURIComponent(review.slug)}/zip?set=live">
        ${icon('download', 13, { sw: 2.1 })} Download originals</a>
      <span style="font-size:13px;color:var(--muted)">The files as uploaded, full resolution, one folder per post.</span>
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

/* Chrome will sit on a video it cannot decode without ever firing
   loadedmetadata or error. H.265 out of Premiere and some ProRes files do
   exactly that. Dimensions are only used for the crop warnings, so a file
   that will not give them up is uploaded without them rather than holding
   up everything behind it for ever. */
export const MEASURE_TIMEOUT = 12000;

function measure(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    let settled = false;

    const done = (w, h, timedOut = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve({ w, h, timedOut });
    };

    const timer = setTimeout(() => done(null, null, true), MEASURE_TIMEOUT);

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

export const mb = (bytes) => `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;

/* Cloudflare caps a request body at 100MB, so this is not a setting that can
   be raised from here. Checked in the browser as well as on the server, so a
   doomed upload is refused before it starts rather than after the wait. */
export const MAX_BYTES = 95 * 1024 * 1024;

const COMPRESS_HELP = 'Compress it with <a href="https://handbrake.fr" target="_blank" '
  + 'rel="noopener">HandBrake</a>, which is free and runs on your machine, so client '
  + 'footage never goes near a third party. The Fast 1080p30 preset, or raising RF to '
  + 'about 24, usually clears it with no visible difference.';

export function tooBig(files) {
  const over = [...files].filter((f) => f.size > MAX_BYTES);
  if (!over.length) return null;
  const names = over.map((f) => `${f.name} is ${mb(f.size)}`).join(', ');
  return `${names}. The limit is ${mb(MAX_BYTES)} per file, which is Cloudflare's cap `
    + `on a single upload rather than a setting here. ${COMPRESS_HELP}`;
}

/* fetch cannot report how much of a request body has gone out, so a large
   video uploaded through it shows nothing at all until it finishes. This
   uses XMLHttpRequest for the one thing it still does better. */
function send(slug, file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `/api/upload?slug=${encodeURIComponent(slug)}`);

    request.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
    });

    request.addEventListener('load', () => {
      let body = {};
      try { body = JSON.parse(request.responseText); } catch { /* not JSON */ }
      if (request.status >= 200 && request.status < 300) resolve(body);
      else reject(new Error(body.error || `Upload failed (${request.status})`));
    });
    request.addEventListener('error', () => reject(new Error('The upload did not reach the server. Check the connection and try again.')));
    request.addEventListener('abort', () => reject(new Error('Upload cancelled')));
    request.addEventListener('timeout', () => reject(new Error('The upload timed out')));

    const form = new FormData();
    form.append('file', file, file.name);
    request.send(form);
  });
}

async function uploadFile(slug, file, report = {}) {
  if (report.onPhase) report.onPhase('reading', file);
  const { w, h, timedOut } = await measure(file);
  if (timedOut && report.onUnreadable) report.onUnreadable(file);
  if (report.onPhase) report.onPhase('uploading', file);
  const up = await send(slug, file, report.onProgress);
  return { ...up, w, h };
}

/* onDone() rebuilds the whole view, so anything written onto the upload card
   just before it is thrown away. The outcome is parked here and picked up by
   the card that replaces it. */
let pendingNote = null;

function uploadCard(review, onDone) {
  const card = el(`<div class="card">
    <h3 style="margin-bottom:10px">Add a post</h3>
    <label class="drop" data-drop>
      <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" multiple>
      <b>Drop files here</b> or click to choose.<br>
      Each video becomes its own reel. Images dropped together become one carousel, ordered by filename.<br>
      <small>Up to ${mb(MAX_BYTES)} per file. MP4 for video.</small>
    </label>
    <div class="up" data-progress hidden>
      <div class="up-head">
        <span data-what>Reading the files</span>
        <b data-pct>0%</b>
      </div>
      <div class="bar"><i></i></div>
      <p class="up-detail" data-detail></p>
    </div>
    <p class="err" data-err hidden></p>
    <p class="ok" data-ok hidden></p>
  </div>`);

  const drop = card.querySelector('[data-drop]');
  const input = card.querySelector('input[type=file]');
  const panel = card.querySelector('[data-progress]');
  const what = card.querySelector('[data-what]');
  const pct = card.querySelector('[data-pct]');
  const detail = card.querySelector('[data-detail]');
  const fill = card.querySelector('.bar i');
  const err = card.querySelector('[data-err]');
  const okMsg = card.querySelector('[data-ok]');

  if (pendingNote) {
    if (pendingNote.ok) { okMsg.hidden = false; okMsg.textContent = pendingNote.ok; }
    if (pendingNote.err) { err.hidden = false; err.textContent = pendingNote.err; }
    pendingNote = null;
  }

  const handle = async (fileList) => {
    const files = [...fileList];
    if (!files.length) return;
    err.hidden = true;
    okMsg.hidden = true;

    const oversized = tooBig(files);
    if (oversized) {
      err.hidden = false;
      err.innerHTML = oversized;
      input.value = '';
      return;
    }

    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    const videos = files.filter((f) => f.type.startsWith('video/'));
    const images = files.filter((f) => f.type.startsWith('image/'))
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    const order = [...videos, ...images];

    // The reassurance stays in the detail line for the whole read phase. An
    // earlier "Preparing" state was set and replaced in the same synchronous
    // block, so it never reached the screen and took this line with it.
    const waiting = `${mb(totalBytes)}${files.length > 1 ? ' in total' : ''}. `
      + 'Large videos take a while; this page can stay open.';

    panel.hidden = false;
    fill.style.width = '0%';
    pct.textContent = '0%';
    what.textContent = `Reading ${order[0].name}`;
    detail.textContent = waiting;

    let sentBefore = 0;   // bytes of files already finished
    let index = 0;

    const paint = (loaded, size, name) => {
      const overall = totalBytes ? Math.min(1, (sentBefore + loaded) / totalBytes) : 0;
      const shown = Math.round(overall * 100);
      fill.style.width = `${shown}%`;
      pct.textContent = `${shown}%`;
      detail.textContent = `${name} · ${mb(loaded)} of ${mb(size)}`;
    };

    const report = {
      onPhase: (phase, file) => {
        if (phase === 'reading') {
          what.textContent = order.length > 1
            ? `Reading ${file.name} · ${index + 1} of ${order.length}`
            : `Reading ${file.name}`;
          detail.textContent = waiting;
        } else {
          what.textContent = order.length > 1
            ? `Uploading ${index + 1} of ${order.length}`
            : 'Uploading';
        }
      },
      onProgress: (loaded, size) => paint(loaded, size, order[index].name),
    };

    const next = (file) => { sentBefore += file.size; index += 1; };

    const failures = [];
    const unreadable = [];
    report.onUnreadable = (file) => unreadable.push(file.name);
    let reels = 0;
    let set = 0;

    // One bad file in a batch of five should not throw away the other four,
    // and each post appears as it is made rather than all at the end, so a
    // long run shows its work.
    for (const video of videos) {
      try {
        const media = await uploadFile(review.slug, video, report);
        what.textContent = 'Creating the reel';
        await api(`/api/reviews/${encodeURIComponent(review.slug)}/posts`, {
          method: 'POST', body: JSON.stringify({ type: 'reel', media: [media] }),
        });
        reels += 1;
        await onDone();
      } catch (error) {
        failures.push(`${video.name}: ${error.message}`);
      }
      next(video);
    }

    if (images.length) {
      const media = [];
      for (const image of images) {
        try {
          media.push(await uploadFile(review.slug, image, report));
        } catch (error) {
          failures.push(`${image.name}: ${error.message}`);
        }
        next(image);
      }
      if (media.length) {
        what.textContent = media.length > 1 ? 'Creating the carousel' : 'Creating the post';
        detail.textContent = '';
        try {
          await api(`/api/reviews/${encodeURIComponent(review.slug)}/posts`, {
            method: 'POST',
            body: JSON.stringify({ type: media.length > 1 ? 'carousel' : 'post', media }),
          });
          set = 1;
          await onDone();
        } catch (error) {
          failures.push(error.message);
        }
      }
    }

    fill.style.width = '100%';
    pct.textContent = '100%';
    panel.hidden = true;
    input.value = '';

    const added = [
      reels ? `${reels} reel${reels > 1 ? 's' : ''}` : '',
      set ? (images.length > 1 ? '1 carousel' : '1 post') : '',
    ].filter(Boolean).join(' and ');

    pendingNote = {
      ok: added
        ? `Added ${added}.`
          + (unreadable.length
            ? ` ${unreadable.join(', ')} would not report its size, so there are no crop notes for it. It uploaded fine.`
            : '')
        : '',
      err: failures.length
        ? `${failures.length} file${failures.length > 1 ? 's' : ''} did not go up. ${failures.join('. ')}`
        : '',
    };
    await onDone();
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

function postsCard(review, onDone, which = 'live') {
  const wrap = el('<div></div>');
  const shown = review.posts.filter((p) => (which === 'archived' ? p.archived : !p.archived));

  if (!shown.length) {
    return el(`<p class="empty">${which === 'archived'
      ? 'Nothing archived yet.'
      : review.posts.length ? 'Nothing left awaiting review.' : 'No posts yet. Add the first one above.'}</p>`);
  }

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

  shown.forEach((post, i) => {
    const first = post.media[0];
    const isVideo = (first.mime || '').startsWith('video/');
    const url = `/m/${first.key.slice('media/'.length)}`;
    const warnings = cropWarnings(post);

    const card = el(`<div class="card"><div class="admin-post">
      ${isVideo
        ? `<video class="thumb" src="${escapeHtml(url)}#t=0.1" muted playsinline preload="metadata"></video>`
        : `<img class="thumb" src="${escapeHtml(url)}" alt="">`}
      <div>
        <h3>${i + 1}. ${{ reel: 'Reel', story: 'Story', post: 'Single post' }[post.type]
          || `Carousel, ${post.media.length} slides`}</h3>
        <p class="meta">${first.w && first.h ? `${first.w}&times;${first.h}` : 'size unknown'}
          &middot; ${escapeHtml(first.name || first.mime)}</p>
      </div>
      <span class="spacer"></span>
      <a class="btn" data-files
         href="/api/reviews/${encodeURIComponent(review.slug)}/zip?post=${encodeURIComponent(post.id)}"
         title="Download the file${post.media.length > 1 ? 's' : ''} for this post, ready to publish">
        ${icon('download', 13, { sw: 2.1 })} ${post.media.length > 1 ? 'Files' : 'File'}</a>
      <button class="btn" data-png title="Download this post as a PNG of the mockup">
        ${icon('download', 13, { sw: 2.1 })} PNG</button>
      <button class="btn" data-link>Copy link</button>
      <button class="btn" data-up aria-label="Move up">${icon('chevL', 14, { sw: 2.4 })}</button>
      <button class="btn" data-down aria-label="Move down">${icon('chevR', 14, { sw: 2.4 })}</button>
      <button class="btn" data-archive>${post.archived ? 'Restore' : 'Archive'}</button>
      <button class="btn danger" data-remove>Remove</button>
    </div></div>`);

    card.appendChild(slidesPanel(review, post, onDone));

    for (const w of warnings) card.appendChild(el(`<p class="warn">${escapeHtml(w)}</p>`));

    card.querySelector('[data-link]').addEventListener('click', async (e) => {
      await copy(postUrl(review.slug, post.id), e.currentTarget, 'Copy link');
    });

    // Captures the preview further down the page, which is the same markup
    // the client sees, rather than rendering a second copy of it here.
    card.querySelector('[data-png]').addEventListener('click', async (e) => {
      const button = e.currentTarget;
      const phone = document.querySelector(`.slot[data-post-id="${post.id}"] .phone`);
      if (!phone) return;
      const original = button.innerHTML;
      button.disabled = true;
      button.textContent = 'Rendering';
      try {
        await capturePhone(phone, `${review.slug}-${i + 1}-${post.type}.png`);
        button.innerHTML = original;
      } catch (error) {
        button.textContent = 'Failed';
        console.error(error);
        setTimeout(() => { button.innerHTML = original; }, 2500);
      } finally {
        button.disabled = false;
      }
    });

    // A 9:16 file is either a story or a feed post Instagram will crop, and
    // only a person knows which, so the choice sits beside the post.
    const choices = isVideo ? ['reel', 'story']
      : post.media.length === 1 ? ['post', 'story'] : [];
    if (choices.length) {
      const names = { post: 'Post', story: 'Story', reel: 'Reel' };
      const seg = el(`<div class="seg format" role="group" aria-label="Format">
        ${choices.map((c) => `<button data-format="${c}" aria-pressed="${c === post.type}">${names[c]}</button>`).join('')}
      </div>`);
      for (const button of seg.querySelectorAll('[data-format]')) {
        button.addEventListener('click', async () => {
          if (button.dataset.format === post.type) return;
          await api(`/api/reviews/${encodeURIComponent(review.slug)}`, {
            method: 'PATCH',
            body: JSON.stringify({ postId: post.id, setType: button.dataset.format }),
          });
          await onDone();
        });
      }
      card.querySelector('.admin-post .spacer').before(seg);
    }
    const stored = review.posts.indexOf(post);
    card.querySelector('[data-up]').disabled = stored === 0 || Boolean(post.archived);
    card.querySelector('[data-down]').disabled = stored === review.posts.length - 1 || Boolean(post.archived);
    card.querySelector('[data-up]').addEventListener('click', () => move(stored, -1));
    card.querySelector('[data-down]').addEventListener('click', () => move(stored, 1));
    card.querySelector('[data-archive]').addEventListener('click', async () => {
      await api(`/api/reviews/${encodeURIComponent(review.slug)}`, {
        method: 'PATCH',
        body: JSON.stringify({ postId: post.id, archived: !post.archived }),
      });
      await onDone();
    });

    card.querySelector('[data-remove]').addEventListener('click', async () => {
      if (!confirm('Remove this post from the review?')) return;
      await api(`/api/reviews/${encodeURIComponent(review.slug)}`, {
        method: 'PATCH', body: JSON.stringify({ removePostId: post.id }),
      });
      await onDone();
    });

    card.classList.toggle('archived', Boolean(post.archived));
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
    <p class="slide-note" data-note></p>
    <p class="err" data-err hidden></p>
  </div>`);

  const strip = panel.querySelector('.slide-strip');
  const note = panel.querySelector('[data-note]');
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
      note.textContent = '';
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
      const oversized = tooBig([file]);
      if (oversized) { err.hidden = false; err.innerHTML = oversized; return; }
      err.hidden = true;
      panel.classList.add('busy');
      try {
        const replacement = await uploadFile(review.slug, file, {
          onPhase: (phase) => { note.textContent = `${phase === 'reading' ? 'Reading' : 'Uploading'} ${file.name}`; },
          onProgress: (loaded, size) => {
            note.textContent = `${Math.round((loaded / size) * 100)}% of ${mb(size)}`;
          },
        });
        note.textContent = 'Saving';
        await commit(plain().map((m, j) => (j === i ? replacement : m)));
      } catch (error) {
        err.hidden = false;
        err.textContent = error.message;
        note.textContent = '';
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
    const oversized = tooBig(files);
    if (oversized) { err.hidden = false; err.innerHTML = oversized; return; }
    err.hidden = true;
    panel.classList.add('busy');
    try {
      const uploaded = [];
      for (const [i, file] of files.entries()) {
        uploaded.push(await uploadFile(review.slug, file, {
          onPhase: (phase) => { note.textContent = `${phase === 'reading' ? 'Reading' : 'Uploading'} ${file.name}`; },
          onProgress: (loaded, size) => {
            note.textContent = `${files.length > 1 ? `${i + 1} of ${files.length} · ` : ''}${Math.round((loaded / size) * 100)}% of ${mb(size)}`;
          },
        }));
      }
      note.textContent = 'Saving';
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

function previewSection(review, which = 'live') {
  const section = el(`<section style="margin-top:34px">
    <div class="controls">
      <div class="seg" role="group" aria-label="View">
        <button data-feed aria-pressed="true">Feed</button>
        <button data-grid aria-pressed="false">Grid</button>
      </div>
      <button class="btn" data-ui aria-pressed="false">Hide Instagram UI</button>
      <button class="btn" data-safe aria-pressed="false">Safe zones</button>
      <label class="cols">Per row
        <select data-cols><option>1</option><option>2</option><option>3</option><option>4</option><option selected>5</option></select>
      </label>
      <span style="font-size:13px;color:var(--muted)">Exactly what the client sees, plus crop notes.</span>
    </div>
    <div data-out class="feed"></div>
  </section>`);

  const out = section.querySelector('[data-out]');
  const ctx = {
    handle: review.handle,
    avatar: review.avatarKey ? `/m/${review.avatarKey.slice('media/'.length)}` : null,
    fileBase: review.slug,
    autoplay: false,
  };
  // The preview shows whichever set the page is about, so the review page
  // claims nothing about posts that have left the client's set.
  const posts = review.posts
    .filter((p) => (which === 'archived' ? p.archived : !p.archived))
    .map((p) => ({
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
    fitPhones(out);
  };

  const colsSelect = section.querySelector('[data-cols]');
  const COLS_KEY = 'ocsr_admin_cols';
  try {
    const saved = localStorage.getItem(COLS_KEY);
    if (saved) colsSelect.value = saved;
  } catch { /* private window */ }
  const applyCols = () => {
    out.style.setProperty('--cols', colsSelect.value);
    try { localStorage.setItem(COLS_KEY, colsSelect.value); } catch { /* private window */ }
    fitPhones(out);
  };
  colsSelect.addEventListener('change', applyCols);
  applyCols();
  watchFit(out);

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
