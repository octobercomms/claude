/* Shared Instagram renderer. Used by the client view and the admin preview. */

const SVG = {
  heart: 'M16.792 3.904A4.989 4.989 0 0 1 21.5 9.122c0 3.072-2.652 4.959-5.197 7.222-2.512 2.243-3.865 3.469-4.303 3.752-.477-.309-2.143-1.823-4.303-3.752C5.141 14.072 2.5 12.167 2.5 9.122a4.989 4.989 0 0 1 4.708-5.218 4.21 4.21 0 0 1 3.675 1.941c.84 1.175.98 1.763 1.12 1.763s.278-.588 1.11-1.766a4.17 4.17 0 0 1 3.679-1.938m0-2a6.04 6.04 0 0 0-4.797 2.127 6.052 6.052 0 0 0-4.787-2.127A6.985 6.985 0 0 0 .5 9.122c0 3.61 2.55 5.827 5.015 7.97.283.246.569.494.853.747l1.027.918a44.998 44.998 0 0 0 3.518 3.018 2 2 0 0 0 2.174 0 45.263 45.263 0 0 0 3.626-3.115l.922-.824c.293-.26.59-.519.885-.774 2.334-2.025 4.98-4.32 4.98-7.94a6.985 6.985 0 0 0-6.708-7.218Z',
  comment: 'M20.656 17.008a9.993 9.993 0 1 0-3.59 3.615L22 22Z',
  send: 'M22.5 3.3a.9.9 0 0 0-1-.2L2.4 11.2a.9.9 0 0 0 0 1.7l6.2 2.4 2.4 6.2a.9.9 0 0 0 1.7 0l8.1-19.1a.9.9 0 0 0-.3-1.1Z',
  bookmark: 'M20 21 12 13.44 4 21V3h16Z',
  dots: 'M12 8.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm0 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm0 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  camera: 'M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm0 7a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5ZM19 4h-2.2l-.9-1.5A2 2 0 0 0 14.2 1.5H9.8a2 2 0 0 0-1.7 1L7.2 4H5a3 3 0 0 0-3 3v11a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3Z',
  music: 'M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3Zm10-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3Z',
  reel: 'M3 3h18v18H3Zm0 6h18M9 3 6 9m9-6-3 6m-2.5 3.5 5 2.5-5 2.5Z',
  chevL: 'M15 5 8 12l7 7', chevR: 'M9 5l7 7-7 7',
  sound: 'M11 5 6 9H3v6h3l5 4V5Zm5.5 2.5a5 5 0 0 1 0 9m2.5-12a8.5 8.5 0 0 1 0 15',
};

const FILLED = new Set(['dots', 'heart-solid']);

export function icon(name, size = 24, opts = {}) {
  const d = SVG[name];
  if (!d) return '';
  const fill = opts.fill ?? FILLED.has(name);
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false"
    fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}"
    stroke-width="${opts.sw ?? 1.7}" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}

const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Instagram crops a feed post to between 4:5 portrait and 1.91:1 landscape. */
const FEED_MIN = 0.8;     // 4:5
const FEED_MAX = 1.91;    // 1.91:1
const REEL_RATIO = 9 / 16;

const ratioOf = (m) => (m.w && m.h ? m.w / m.h : null);
const clampFeed = (r) => Math.min(FEED_MAX, Math.max(FEED_MIN, r));
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

function statusBar() {
  return `<div class="ig-status"><span>9:41</span>
    <span class="glyphs"><svg width="25" height="12" viewBox="0 0 25 12" aria-hidden="true">
      <rect x="0.5" y="0.5" width="21" height="11" rx="3" fill="none" stroke="currentColor" opacity=".5"/>
      <rect x="2" y="2" width="18" height="8" rx="1.6" fill="currentColor"/>
      <path d="M23 4v4a2 2 0 0 0 0-4Z" fill="currentColor" opacity=".5"/></svg></span></div>`;
}

function avatar(src) {
  return src
    ? `<img class="ig-avatar" src="${escapeHtml(src)}" alt="">`
    : '<span class="ig-avatar"></span>';
}

/* ---------------- warnings the client and the team both need ---------------- */

export function cropWarnings(post) {
  const out = [];
  const media = post.media || [];
  if (!media.length) return out;

  if (post.type === 'reel') {
    const m = media[0];
    const r = ratioOf(m);
    if (r && !near(r, REEL_RATIO, 0.03)) {
      out.push(`This video is ${m.w}x${m.h} (${r.toFixed(2)}:1). Reels are 9:16, so Instagram will crop or letterbox it.`);
    }
    if (m.mime && m.mime !== 'video/mp4' && m.mime !== 'video/webm') {
      out.push('This is not an MP4. It may not play for the client, and Instagram prefers H.264 MP4.');
    }
    return out;
  }

  const first = ratioOf(media[0]);
  if (first) {
    if (first < FEED_MIN - 0.01) {
      out.push(`Slide 1 is ${media[0].w}x${media[0].h}, taller than 4:5. The feed will crop the top and bottom.`);
    } else if (first > FEED_MAX + 0.01) {
      out.push(`Slide 1 is wider than 1.91:1. The feed will crop the sides.`);
    }
    // The container takes slide 1's shape. Compare each slide's OWN ratio
    // against it: clamping first would make a 9:16 slide look like a 4:5 one
    // and the warning would never fire.
    const shape = clampFeed(first);
    const odd = media
      .map((m, i) => ({ i, r: ratioOf(m) }))
      .filter((s) => s.i > 0 && s.r && !near(s.r, shape, 0.03))
      .map((s) => s.i + 1);
    if (odd.length) {
      out.push(`Every slide takes slide 1's shape. Slide${odd.length > 1 ? 's' : ''} ${odd.join(', ')} will be cropped to match.`);
    }
  }
  return out;
}

/* ---------------- carousel / single feed post ---------------- */

function renderFeedPost(post, ctx) {
  const media = post.media;
  const shape = clampFeed(ratioOf(media[0]) || 1);
  const multi = media.length > 1;

  const phone = el(`<div class="phone">
    <div class="phone-screen">
      ${statusBar()}
      <div class="ig-head">
        ${avatar(ctx.avatar)}
        <div class="ig-handle">${escapeHtml(ctx.handle || 'yourbrand')}</div>
        <span class="dots">${icon('dots', 20)}</span>
      </div>
      <div class="ig-media" style="aspect-ratio:${shape}">
        <div class="ig-slides" tabindex="0" role="group" aria-label="Carousel slides">
          ${media.map((m, i) => `<figure><img src="${escapeHtml(m.url)}" alt="Slide ${i + 1}" loading="lazy" draggable="false"></figure>`).join('')}
        </div>
        ${multi ? `<span class="ig-count">1/${media.length}</span>
          <button class="ig-arrow prev" hidden aria-label="Previous slide">${icon('chevL', 15, { sw: 2.4 })}</button>
          <button class="ig-arrow next" aria-label="Next slide">${icon('chevR', 15, { sw: 2.4 })}</button>` : ''}
      </div>
      <div class="ig-actions">
        <span class="left">${icon('heart', 24)}${icon('comment', 24)}${icon('send', 24)}</span>
        ${multi ? `<div class="ig-dots">${media.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}
        <span class="save">${icon('bookmark', 24)}</span>
      </div>
      <div class="ig-likes">248 likes <span>&middot; view all 12 comments</span></div>
    </div>
  </div>`);

  if (multi) wireCarousel(phone, media.length);
  return phone;
}

function wireCarousel(phone, count) {
  const slides = phone.querySelector('.ig-slides');
  const dots = [...phone.querySelectorAll('.ig-dots i')];
  const counter = phone.querySelector('.ig-count');
  const prev = phone.querySelector('.ig-arrow.prev');
  const next = phone.querySelector('.ig-arrow.next');
  let index = 0;

  const paint = () => {
    dots.forEach((d, i) => d.classList.toggle('on', i === index));
    counter.textContent = `${index + 1}/${count}`;
    prev.hidden = index === 0;
    next.hidden = index === count - 1;
  };

  const go = (i) => {
    index = Math.max(0, Math.min(count - 1, i));
    slides.scrollTo({ left: index * slides.clientWidth, behavior: 'smooth' });
    paint();
  };

  let raf;
  slides.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const i = Math.round(slides.scrollLeft / slides.clientWidth);
      if (i !== index && i >= 0 && i < count) { index = i; paint(); }
    });
  }, { passive: true });

  prev.addEventListener('click', () => go(index - 1));
  next.addEventListener('click', () => go(index + 1));
  slides.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
  });
  paint();
}

/* ---------------- reel ---------------- */

// Created on first use so this module stays importable outside a browser.
let videoWatcher;
function watchVideo(video) {
  videoWatcher ||= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const v = entry.target;
      if (entry.isIntersecting) v.play().catch(() => {});
      else v.pause();
    }
  }, { threshold: 0.45 });
  videoWatcher.observe(video);
}

function renderReel(post, ctx) {
  const m = post.media[0];
  const phone = el(`<div class="phone dark">
    <div class="phone-screen">
      ${statusBar()}
      <div class="ig-reel">
        <video src="${escapeHtml(m.url)}" muted loop playsinline preload="metadata"
               ${m.poster ? `poster="${escapeHtml(m.poster)}"` : ''}></video>
        <div class="reel-top"><span>Reels</span>${icon('camera', 22)}</div>
        <div class="reel-rail">
          <figure>${icon('heart', 26)}<span>1,204</span></figure>
          <figure>${icon('comment', 26)}<span>38</span></figure>
          <figure>${icon('send', 26)}<span>91</span></figure>
          <figure>${icon('dots', 22)}</figure>
          <span class="reel-disc"></span>
        </div>
        <div class="reel-foot">
          <div class="who">${avatar(ctx.avatar)}<b>${escapeHtml(ctx.handle || 'yourbrand')}</b>
            <span class="follow">Follow</span></div>
          <div class="audio">${icon('music', 13, { sw: 2 })}<span>Original audio</span></div>
        </div>
        <button class="reel-unmute" aria-label="Turn sound on">${icon('sound', 16, { sw: 2 })}</button>
        <div class="safe">
          <i class="t"><em>Instagram UI</em></i><i class="b"><em>Caption &amp; audio</em></i><i class="r"></i>
        </div>
      </div>
    </div>
  </div>`);

  const video = phone.querySelector('video');
  const unmute = phone.querySelector('.reel-unmute');

  unmute.addEventListener('click', () => {
    video.muted = false;
    video.volume = 1;
    video.play().catch(() => {});
    unmute.hidden = true;
  });
  video.addEventListener('click', () => {
    if (video.paused) video.play().catch(() => {}); else video.pause();
  });
  video.addEventListener('volumechange', () => { unmute.hidden = !video.muted; });
  watchVideo(video);

  return phone;
}

/* ---------------- public API ---------------- */

const LABEL = { reel: 'Reel', carousel: 'Carousel', post: 'Single post' };

export function renderPost(post, ctx = {}, position = 1) {
  const slot = document.createElement('div');
  slot.className = 'slot';
  slot.dataset.postId = post.id;

  const count = post.type === 'carousel' ? ` &middot; ${post.media.length} slides` : '';
  slot.appendChild(el(`<p class="slot-label"><span class="tag">${position}</span>
    ${LABEL[post.type] || 'Post'}${count}</p>`));

  slot.appendChild(post.type === 'reel' ? renderReel(post, ctx) : renderFeedPost(post, ctx));

  if (ctx.showWarnings !== false) {
    for (const w of cropWarnings(post)) {
      slot.appendChild(el(`<p class="warn">${escapeHtml(w)}</p>`));
    }
  }
  return slot;
}

export function renderGrid(posts, ctx = {}) {
  const wrap = el(`<div class="grid-wrap">
    <div class="phone"><div class="phone-screen">${statusBar()}
      <div class="ig-head">${avatar(ctx.avatar)}
        <div><div class="ig-handle">${escapeHtml(ctx.handle || 'yourbrand')}</div>
        <div class="ig-sub">Profile grid, newest first</div></div></div>
      <div class="grid"></div>
    </div></div></div>`);

  const grid = wrap.querySelector('.grid');
  // Instagram shows newest first and crops every tile to a square.
  for (const post of [...posts].reverse()) {
    const m = post.media[0];
    const isVideo = (m.mime || '').startsWith('video/');
    grid.appendChild(el(`<div class="cell">
      ${isVideo
        ? `<video src="${escapeHtml(m.url)}#t=0.1" muted playsinline preload="metadata"></video>`
        : `<img src="${escapeHtml(m.url)}" alt="" loading="lazy">`}
      ${isVideo ? `<span class="pill">${icon('reel', 15, { sw: 1.9 })}</span>` : ''}
      ${post.type === 'carousel' ? `<span class="pill">${icon('bookmark', 14, { fill: true })}</span>` : ''}
    </div>`));
  }
  return wrap;
}
