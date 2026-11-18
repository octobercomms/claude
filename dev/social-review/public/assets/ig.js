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
  mute: 'M11 5 6 9H3v6h3l5 4V5ZM17 9.5l5 5m0-5-5 5',
  play: 'M8 5v14l11-7Z',
  download: 'M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  swap: 'M4 8h13m0 0-3.5-3.5M17 8l-3.5 3.5M20 16H7m0 0 3.5-3.5M7 16l3.5 3.5',
  close: 'M5 5l14 14M19 5 5 19',
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
const STORY_RATIO = 9 / 16;

/* A post's type follows its media, except that a story can only be chosen.
   A 9:16 image could be a story or a feed post Instagram will crop, and
   nothing in the file says which, so the person decides and the choice
   survives later edits to the media. */
export function deriveType(media, current) {
  if (!media.length) return 'post';
  if (current === 'story' && media.length === 1) return 'story';
  if ((media[0].mime || '').startsWith('video/')) return 'reel';
  return media.length > 1 ? 'carousel' : 'post';
}

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

  if (post.type === 'story') {
    const m = media[0];
    const r = ratioOf(m);
    if (r && !near(r, STORY_RATIO, 0.03)) {
      out.push(`This is ${m.w}x${m.h} (${r.toFixed(2)}:1). Stories are 9:16, so it will be cropped or sit on bars.`);
    }
    return out;
  }

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

  /* Drag with the pointer, the way a finger works on the real thing.
     Touch is left alone: the browser's own scrolling already does this,
     and taking it over makes it worse. */
  let dragging = false;
  let startX = 0;
  let startScroll = 0;
  let travelled = 0;

  slides.addEventListener('dragstart', (e) => e.preventDefault());

  slides.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    dragging = true;
    travelled = 0;
    startX = e.clientX;
    startScroll = slides.scrollLeft;
    slides.setPointerCapture(e.pointerId);
    slides.classList.add('dragging');
  });

  slides.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    travelled = Math.max(travelled, Math.abs(dx));
    slides.scrollLeft = startScroll - dx;
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    slides.classList.remove('dragging');
    const width = slides.clientWidth || 1;
    const raw = slides.scrollLeft / width;
    const dx = e.clientX - startX;
    // A short flick still turns the page, as it does on a phone.
    const target = Math.abs(dx) > 40
      ? (dx < 0 ? Math.ceil(raw) : Math.floor(raw))
      : Math.round(raw);
    go(target);
  };
  slides.addEventListener('pointerup', endDrag);
  slides.addEventListener('pointercancel', endDrag);

  // A drag that ends on an image must not also register as a click.
  slides.addEventListener('click', (e) => {
    if (travelled > 6) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  paint();
}

/* ---------------- reel ---------------- */

/* ------------------------------------------------------------------
   Sound

   Browsers refuse to start an unmuted video until the person has
   interacted with the page, so the first reel on a fresh load starts
   muted whatever the preference says. The moment they click anything,
   sound comes on by itself and stays on for the rest of the visit.
------------------------------------------------------------------ */

const SOUND_KEY = 'ocsr_sound';

let soundOn = (() => {
  try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
})();

let interacted = false;

function allVideos() {
  return document.querySelectorAll('.ig-reel video');
}

export function soundWanted() {
  return soundOn;
}

function applySound({ restart = false } = {}) {
  for (const v of allVideos()) {
    const wasMuted = v.muted;
    v.muted = !(soundOn && interacted);
    // Whatever played while the browser held sound back was never really
    // watched, so start it again rather than drop the person mid-sentence.
    if (restart && wasMuted && !v.muted && !v.paused) v.currentTime = 0;
    v.dispatchEvent(new Event('ocsr:sound'));
  }
}

export function setSoundOn(on) {
  soundOn = on;
  try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch { /* private window */ }
  // A deliberate toggle part-way through should not jump back to the start.
  applySound();
}

function markInteracted() {
  if (interacted) return;
  interacted = true;
  applySound({ restart: true });
}

if (typeof document !== 'undefined') {
  for (const type of ['pointerdown', 'keydown']) {
    document.addEventListener(type, markInteracted, { capture: true, once: true });
  }
}

async function startPlayback(video) {
  video.muted = !(soundOn && interacted);
  try {
    await video.play();
  } catch {
    // Blocked for want of a gesture. Fall back to muted so something plays.
    video.muted = true;
    try { await video.play(); } catch { /* give up quietly */ }
  }
}

// Created on first use so this module stays importable outside a browser.
let videoWatcher;
function watchVideo(video) {
  videoWatcher ||= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const v = entry.target;
      if (entry.isIntersecting) {
        if (v.dataset.autoplay !== 'off') startPlayback(v);
      } else v.pause();
    }
  }, { threshold: 0.45 });
  videoWatcher.observe(video);
}

function fmt(t) {
  if (!Number.isFinite(t)) return '0:00';
  const m = Math.floor(t / 60);
  const sec = Math.floor(t % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

const videoControls = () => `
  <button class="reel-sound" aria-label="Sound" aria-pressed="false"></button>
  <button class="reel-prompt" type="button" hidden>
    ${icon('sound', 13, { sw: 2.2 })} Tap for sound</button>
  <span class="reel-tap" hidden>${icon('play', 34, { fill: true })}</span>
  <div class="reel-scrub">
    <input class="reel-range" type="range" min="0" max="1000" value="0" step="1"
           aria-label="Seek through the video">
    <span class="reel-time">0:00</span>
  </div>`;

/* Sound, scrubbing and play/pause, shared by reels and video stories. */
function wireVideo(phone, ctx = {}) {
  const video = phone.querySelector('video');
  if (!video) return;

  const soundBtn = phone.querySelector('.reel-sound');
  const prompt = phone.querySelector('.reel-prompt');
  const tap = phone.querySelector('.reel-tap');
  const range = phone.querySelector('.reel-range');
  const time = phone.querySelector('.reel-time');

  video.muted = true; // the observer decides the real value when it plays
  if (ctx.autoplay === false) video.dataset.autoplay = 'off';

  const paintSound = () => {
    const on = !video.muted;
    soundBtn.setAttribute('aria-pressed', String(on));
    soundBtn.innerHTML = icon(on ? 'sound' : 'mute', 16, { sw: 2 });
    soundBtn.setAttribute('aria-label', on ? 'Turn sound off' : 'Turn sound on');
  };
  const paintPrompt = () => {
    prompt.hidden = !(soundWanted() && video.muted && !video.paused);
  };
  const paintAll = () => { paintSound(); paintPrompt(); };

  video.addEventListener('volumechange', paintAll);
  video.addEventListener('ocsr:sound', paintAll);
  video.addEventListener('play', paintPrompt);
  video.addEventListener('pause', paintPrompt);

  prompt.addEventListener('click', (e) => {
    e.stopPropagation();
    if (video.muted) { video.muted = false; video.currentTime = 0; }
    startPlayback(video);
    paintAll();
  });
  soundBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setSoundOn(video.muted);
  });
  paintAll();

  let scrubbing = false;
  const paintTime = () => {
    if (!scrubbing && Number.isFinite(video.duration) && video.duration > 0) {
      range.value = String(Math.round((video.currentTime / video.duration) * 1000));
    }
    time.textContent = Number.isFinite(video.duration)
      ? `${fmt(video.currentTime)} / ${fmt(video.duration)}`
      : fmt(video.currentTime);
    phone.style.setProperty('--seek', `${Number(range.value) / 10}%`);
  };
  video.addEventListener('timeupdate', paintTime);
  video.addEventListener('loadedmetadata', paintTime);
  video.addEventListener('durationchange', paintTime);

  const seek = () => {
    if (!Number.isFinite(video.duration)) return;
    video.currentTime = (Number(range.value) / 1000) * video.duration;
    paintTime();
  };
  range.addEventListener('pointerdown', () => { scrubbing = true; });
  range.addEventListener('input', () => { scrubbing = true; seek(); });
  range.addEventListener('change', () => { seek(); scrubbing = false; });
  for (const type of ['pointerup', 'pointercancel', 'blur']) {
    range.addEventListener(type, () => { scrubbing = false; });
  }
  range.addEventListener('click', (e) => e.stopPropagation());

  const toggle = () => {
    if (video.paused) startPlayback(video); else video.pause();
  };
  video.addEventListener('click', toggle);
  tap.addEventListener('click', toggle);
  video.addEventListener('play', () => { tap.hidden = true; });
  video.addEventListener('pause', () => { tap.hidden = false; });
  if (ctx.autoplay === false) tap.hidden = false;

  phone.addEventListener('keydown', (e) => {
    if (e.target === range) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); video.currentTime += 5; }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); video.currentTime -= 5; }
    else if (e.key === ' ') { e.preventDefault(); toggle(); }
    else return;
    paintTime();
  });

  watchVideo(video);
  paintTime();
}

function renderReel(post, ctx) {
  const m = post.media[0];
  const phone = el(`<div class="phone dark">
    <div class="phone-screen">
      ${statusBar()}
      <div class="ig-reel">
        <video src="${escapeHtml(m.url)}" loop playsinline preload="metadata"></video>
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
        ${videoControls()}
        <div class="safe">
          <i class="t"><em>Instagram UI</em></i><i class="b"><em>Caption &amp; audio</em></i><i class="r"></i>
        </div>
      </div>
    </div>
  </div>`);

  wireVideo(phone, ctx);
  return phone;
}

/* ---------------- story ---------------- */

function renderStory(post, ctx) {
  const m = post.media[0];
  const isVideo = (m.mime || '').startsWith('video/');

  const phone = el(`<div class="phone dark">
    <div class="phone-screen">
      <div class="ig-story">
        ${isVideo
          ? `<video src="${escapeHtml(m.url)}" loop playsinline preload="metadata"></video>`
          : `<img src="${escapeHtml(m.url)}" alt="Story" draggable="false">`}
        <div class="story-top">
          <div class="story-bars"><i></i></div>
          <div class="story-who">
            ${avatar(ctx.avatar)}
            <b>${escapeHtml(ctx.handle || 'yourbrand')}</b>
            <span class="ago">2h</span>
            <span class="story-x">${icon('close', 17, { sw: 2.2 })}</span>
          </div>
        </div>
        <div class="story-foot">
          <span class="story-reply">Send message</span>
          ${icon('heart', 23)}${icon('send', 23)}
        </div>
        ${isVideo ? videoControls() : ''}
        <div class="safe story-safe">
          <i class="t"><em>Profile &amp; progress</em></i>
          <i class="b"><em>Reply bar</em></i>
        </div>
      </div>
    </div>
  </div>`);

  if (isVideo) wireVideo(phone, ctx);
  return phone;
}

/* ------------------------------------------------------------------
   PNG export

   Rendered by hand rather than with a library: the page carries no
   external dependency, so nothing here breaks when a CDN does.

   The phone is cloned, every computed style is written onto the clone,
   media is turned into data URIs, and the result is drawn through an
   SVG foreignObject onto a canvas. The canvas is never filled, so
   everything outside the phone's rounded corners stays transparent.
------------------------------------------------------------------ */

async function toDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not read one of the images');
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not encode one of the images'));
    reader.readAsDataURL(blob);
  });
}

function inlineStyles(source, clone) {
  const computed = getComputedStyle(source);
  let css = '';
  for (const prop of computed) css += `${prop}:${computed.getPropertyValue(prop)};`;
  clone.setAttribute('style', css);

  // Icons carry their own fill and stroke attributes. Writing computed
  // styles inside an <svg> breaks more than it fixes.
  if (source.tagName.toLowerCase() === 'svg') return;

  const from = source.children;
  const to = clone.children;
  for (let i = 0; i < from.length && i < to.length; i++) inlineStyles(from[i], to[i]);
}

export async function capturePhone(phone, filename = 'post.png', scale = 2) {
  // offsetWidth ignores any scaling applied to fit several across a row,
  // so a shrunken preview still exports at full size.
  const width = phone.offsetWidth;
  const height = phone.offsetHeight;
  if (!width || !height) throw new Error('Nothing to capture');

  const clone = phone.cloneNode(true);
  inlineStyles(phone, clone);

  // A clone has no scroll position, so keep only the slide on screen now.
  const liveSlides = phone.querySelector('.ig-slides');
  if (liveSlides) {
    const shown = Math.round(liveSlides.scrollLeft / (liveSlides.clientWidth || 1));
    [...clone.querySelectorAll('.ig-slides > figure')]
      .forEach((figure, i) => { if (i !== shown) figure.remove(); });
  }

  // Controls that only mean something on a live page.
  for (const selector of ['.reel-scrub', '.reel-sound', '.reel-tap', '.ig-arrow', '.safe']) {
    for (const node of clone.querySelectorAll(selector)) node.remove();
  }

  for (const img of clone.querySelectorAll('img')) {
    img.setAttribute('src', await toDataUrl(img.src));
  }

  // A video cannot be serialised, so the frame on screen becomes an image.
  const liveVideo = phone.querySelector('video');
  const clonedVideo = clone.querySelector('video');
  if (liveVideo && clonedVideo) {
    const frame = document.createElement('canvas');
    frame.width = liveVideo.videoWidth || 1080;
    frame.height = liveVideo.videoHeight || 1920;
    try {
      frame.getContext('2d').drawImage(liveVideo, 0, 0, frame.width, frame.height);
    } catch { /* nothing decoded yet; the still comes out black */ }
    const still = document.createElement('img');
    still.setAttribute('src', frame.toDataURL('image/png'));
    still.setAttribute('style', clonedVideo.getAttribute('style') || '');
    clonedVideo.replaceWith(still);
  }

  // The shadow falls outside the box and would only be clipped, and the
  // clone must not inherit the preview's scaling.
  clone.style.boxShadow = 'none';
  clone.style.margin = '0';
  clone.style.transform = 'none';

  const xml = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<foreignObject x="0" y="0" width="${width}" height="${height}">`
    + `<div xmlns="http://www.w3.org/1999/xhtml">${xml}</div>`
    + '</foreignObject></svg>';

  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext('2d');
  context.scale(scale, scale);
  context.drawImage(image, 0, 0); // never filled, so the corners stay clear

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The browser could not produce a PNG');

  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 4000);
}

/* ------------------------------------------------------------------
   Fitting several phones across a row

   A phone is built at its real 390px so every size inside it stays
   honest. To show more than one across, it is scaled rather than
   rebuilt, and its wrapper is given the scaled height so the page
   still flows. Layout size is unaffected by a transform, which is why
   the export below measures offsetWidth rather than the bounding box.
------------------------------------------------------------------ */

const PHONE_WIDTH = 390;

export function fitPhones(root = document) {
  for (const fit of root.querySelectorAll('.fit')) {
    const phone = fit.firstElementChild;
    if (!phone) continue;
    const available = fit.clientWidth;
    if (!available) continue;
    const scale = Math.min(1, available / (phone.offsetWidth || PHONE_WIDTH));
    phone.style.transform = scale < 1 ? `scale(${scale})` : '';
    fit.style.height = `${Math.round(phone.offsetHeight * scale)}px`;
  }
}

let fitQueued = false;
export function watchFit(root) {
  const run = () => {
    fitQueued = false;
    fitPhones(root);
  };
  const queue = () => {
    if (fitQueued) return;
    fitQueued = true;
    requestAnimationFrame(run);
  };
  queue();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(queue).observe(root);
  return queue;
}

/* ---------------- public API ---------------- */

const LABEL = { reel: 'Reel', story: 'Story', carousel: 'Carousel', post: 'Single post' };

export function renderPost(post, ctx = {}, position = 1) {
  const slot = document.createElement('div');
  slot.className = 'slot';
  slot.dataset.postId = post.id;

  const count = post.type === 'carousel' ? ` &middot; ${post.media.length} slides` : '';
  const label = el(`<p class="slot-label"><span class="tag">${position}</span>
    ${LABEL[post.type] || 'Post'}${count}<span class="spacer"></span>
    <button class="png" type="button">${icon('download', 13, { sw: 2.1 })} PNG</button></p>`);
  slot.appendChild(label);

  const phone = post.type === 'reel' ? renderReel(post, ctx)
    : post.type === 'story' ? renderStory(post, ctx)
    : renderFeedPost(post, ctx);
  const fit = document.createElement('div');
  fit.className = 'fit';
  fit.appendChild(phone);
  slot.appendChild(fit);

  const button = label.querySelector('.png');
  button.addEventListener('click', async () => {
    const original = button.innerHTML;
    button.disabled = true;
    button.textContent = 'Rendering';
    const base = (ctx.fileBase || 'post').replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
    try {
      await capturePhone(phone, `${base}-${position}-${post.type}.png`);
      button.innerHTML = original;
    } catch (error) {
      button.textContent = 'Failed';
      console.error(error);
      setTimeout(() => { button.innerHTML = original; }, 2500);
    } finally {
      button.disabled = false;
    }
  });

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
  // Stories are not in the grid at all, so they are left out.
  for (const post of [...posts].filter((p) => p.type !== 'story').reverse()) {
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
