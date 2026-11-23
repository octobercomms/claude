/**
 * nvelope: Asset Drawer / Popup script (JupiterX + Raven popup compatible)
 * - Stores clicked asset in sessionStorage
 * - Populates the popup that actually opened (Elementor OR JupiterX)
 * - Shows asset-unlocked for free assets WITHOUT unlocking the whole session
 */
(function () {
  'use strict';

  // Prevent double-loading if the script is enqueued twice
  if (window.__nvelopeAssetDrawerLoaded) return;
  window.__nvelopeAssetDrawerLoaded = true;

  var STORAGE_ACTIVE_ASSET = 'nvelope_active_asset_json';
  var STORAGE_UNLOCKED_SESSION = 'nvelope_unlocked_session';
  var STORAGE_SCROLL_Y = 'nvelope_scroll_y';

  function log() { try { console.log.apply(console, arguments); } catch (e) {} }
  function warn() { try { console.warn.apply(console, arguments); } catch (e) {} }

  function isSessionUnlocked() {
    try { return sessionStorage.getItem(STORAGE_UNLOCKED_SESSION) === '1'; } catch (e) {}
    return false;
  }

  // Only unlock the *session* when you return with ?u=1 (your email gate flow)
  function handleUnlockParam() {
    try {
      var params = new URLSearchParams(window.location.search);
      if (params.get('u') === '1') {
        sessionStorage.setItem(STORAGE_UNLOCKED_SESSION, '1');
      }
    } catch (e) {}
  }

  function wireScrollSaveRestore() {
    try {
      window.addEventListener('beforeunload', function () {
        try { sessionStorage.setItem(STORAGE_SCROLL_Y, String(window.scrollY || 0)); } catch (e) {}
      });
      var y = sessionStorage.getItem(STORAGE_SCROLL_Y);
      if (y) {
        var n = parseInt(y, 10);
        if (!isNaN(n)) window.scrollTo(0, n);
      }
    } catch (e) {}
  }

  function storeActiveAsset(asset) {
    try { sessionStorage.setItem(STORAGE_ACTIVE_ASSET, JSON.stringify(asset)); } catch (e) {}
  }

  function getActiveAsset() {
    try {
      var raw = sessionStorage.getItem(STORAGE_ACTIVE_ASSET);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  function closestCard(el) {
    if (!el || !el.closest) return null;
    return (
      el.closest('.jet-listing-grid__item') ||
      el.closest('.jet-listing-grid__item-wrap') ||
      el.closest('.jet-listing') ||
      null
    );
  }

  function textFrom(root, selector) {
    if (!root) return '';
    var el = root.querySelector(selector);
    if (!el) return '';
    return (el.textContent || '').trim();
  }

  function htmlFrom(root, selector) {
    if (!root) return '';
    var el = root.querySelector(selector);
    if (!el) return '';
    return (el.innerHTML || '').trim();
  }

  function normaliseType(typeText) {
    var t = (typeText || '').toLowerCase().trim();
    if (t.indexOf('video') > -1) return 'video';
    return 'pdf';
  }

  function gateFromWrapper(wrapper) {
    if (wrapper && wrapper.classList && wrapper.classList.contains('nvelope-asset-free')) {
      return 'free';
    }
    return 'gated';
  }

  // More forgiving fallbacks so we don’t end up with empty title/body if a class is missing
  function readAssetFromCard(card, wrapper) {
    var uid =
      textFrom(card, '.js-asset-uid') ||
      textFrom(card, '.nvelope-asset-uid') ||
      '';

    var title =
      textFrom(card, '.js-asset-title') ||
      textFrom(card, '.nvelope-asset-title') ||
      textFrom(card, 'h1, h2, h3, h4, .elementor-heading-title') ||
      '';

    var standfirst =
      textFrom(card, '.js-asset-standfirst') ||
      textFrom(card, '.nvelope-asset-standfirst') ||
      textFrom(card, 'p') ||
      '';

    var body =
      htmlFrom(card, '.js-asset-body') ||
      htmlFrom(card, '.nvelope-asset-body') ||
      htmlFrom(card, '.elementor-widget-text-editor') ||
      textFrom(card, '.elementor-widget-text-editor') ||
      '';

    var typeText =
      textFrom(card, '.js-asset-type') ||
      textFrom(card, '.nvelope-asset-type') ||
      '';

    var type = normaliseType(typeText);

    var file =
      textFrom(card, '.js-asset-file') ||
      textFrom(card, '.nvelope-asset-file') ||
      (function () {
        var a = card && card.querySelector ? card.querySelector('a[href$=".pdf"]') : null;
        return a ? (a.getAttribute('href') || '').trim() : '';
      })() ||
      '';

    var embedUrl =
      textFrom(card, '.js-asset-embed-url') ||
      textFrom(card, '.nvelope-asset-embed-url') ||
      (card && card.getAttribute ? (card.getAttribute('data-embed-url') || '').trim() : '') ||
      '';

    return {
      uid: uid,
      title: title,
      standfirst: standfirst,
      body: body,
      type: type,
      file: file,
      embed_url: embedUrl,
      gated: gateFromWrapper(wrapper)
    };
  }

  // Raven popup link looks like: #elementor-action:action=raven_popup_848:open&settings=...
  function getPopupIdFromClick(wrapper) {
    if (!wrapper) return '';
    var a = wrapper.querySelector && wrapper.querySelector('a[href*="raven_popup_"]');
    var href = (a && a.getAttribute('href')) || wrapper.getAttribute('href') || '';
    href = decodeURIComponent(href || '');

    var m = href.match(/raven_popup_(\d+)\s*:\s*open/i);
    if (m && m[1]) return m[1];

    m = href.match(/raven_popup_(\d+)/i);
    if (m && m[1]) return m[1];

    return '';
  }

  // DOM has #jupiterx-popups-848 (not #elementor-popup-modal-848)
  function getPopupRootById(popupId) {
    if (!popupId) return null;

    var el =
      document.getElementById('elementor-popup-modal-' + popupId) ||
      document.getElementById('jupiterx-popups-' + popupId);

    if (el) return el;

    var q = document.querySelector('[id$="' + popupId + '"]');
    return q || null;
  }

  function setText(root, selector, value) {
    if (!root) return;
    var el = root.querySelector(selector);
    if (!el) return;
    el.textContent = value || '';
  }

  function setHTML(root, selector, value) {
    if (!root) return;
    var el = root.querySelector(selector);
    if (!el) return;
    el.innerHTML = value || '';
  }

  // UPDATED: supports YouTube, Vimeo, Loom, and passes through embed URLs
  function toEmbedUrl(url) {
    url = (url || '').trim();
    if (!url) return '';

    // If it's already an embed URL we know, accept it as-is
    if (
      url.indexOf('youtube.com/embed/') > -1 ||
      url.indexOf('player.vimeo.com/video/') > -1 ||
      url.indexOf('loom.com/embed/') > -1
    ) {
      return url;
    }

    // YouTube
    var yt =
      url.match(/youtu\.be\/([^?&]+)/) ||
      url.match(/[?&]v=([^?&]+)/) ||
      url.match(/youtube\.com\/watch\?[^#]*v=([^?&]+)/);

    if (yt && yt[1]) return 'https://www.youtube.com/embed/' + yt[1];

    // Vimeo
    var vimeo =
      url.match(/vimeo\.com\/(\d+)/) ||
      url.match(/player\.vimeo\.com\/video\/(\d+)/);

    if (vimeo && vimeo[1]) return 'https://player.vimeo.com/video/' + vimeo[1];

    // Loom
    // Share URL format: https://www.loom.com/share/<id>
    // Embed URL format: https://www.loom.com/embed/<id>
    var loomShare = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/);
    if (loomShare && loomShare[1]) return 'https://www.loom.com/embed/' + loomShare[1];

    var loomEmbed = url.match(/loom\.com\/embed\/([a-zA-Z0-9]+)/);
    if (loomEmbed && loomEmbed[1]) return 'https://www.loom.com/embed/' + loomEmbed[1];

    return '';
  }

  function setPopupMedia(popupRoot, asset) {
    if (!popupRoot || !asset) return;

    var media = popupRoot.querySelector('.nvelope-popup-media');
    var cta = popupRoot.querySelector('.nvelope-popup-cta, a.nvelope-popup-cta, a.elementor-button');

    // Always reset first
    if (media) {
      media.innerHTML = '';
      media.style.display = 'none';
    }

    if (cta) {
      cta.style.display = 'none';
      cta.removeAttribute('href');
      cta.removeAttribute('target');
      cta.removeAttribute('rel');
    }

    // VIDEO
    if (asset.type === 'video') {
      // Prefer embed_url, but also support putting a share URL in "file"
      var raw = (asset.embed_url || '').trim() || (asset.file || '').trim();
      var src = toEmbedUrl(raw);
      if (media && src) {
        media.style.display = 'block';
        media.innerHTML =
          '<div class="nvelope-popup-video-wrap">' +
            '<iframe src="' + src + '" ' +
            'allow="autoplay; fullscreen; picture-in-picture" ' +
            'allowfullscreen></iframe>' +
          '</div>';
        return;
      }

      // Fallback: show CTA as link if we couldn't embed
      if (cta && raw) {
        cta.style.display = '';
        cta.textContent = 'Watch video';
        cta.setAttribute('href', raw);
        cta.setAttribute('target', '_blank');
        cta.setAttribute('rel', 'noopener');
      }
      return;
    }

    // PDF
    if (asset.type === 'pdf' && cta && asset.file) {
      cta.style.display = '';
      cta.textContent = 'Download PDF';
      cta.setAttribute('href', asset.file);
      cta.setAttribute('target', '_blank');
      cta.setAttribute('rel', 'noopener');
    }
  }

  function setPopupGateState(popupRoot, asset) {
    var lockedWrap = popupRoot.querySelector('.asset-locked');
    var unlockedWrap = popupRoot.querySelector('.asset-unlocked');
    if (!lockedWrap || !unlockedWrap) return;

    var shouldShowUnlocked = (asset.gated === 'free') || isSessionUnlocked();

    lockedWrap.style.display = shouldShowUnlocked ? 'none' : 'block';
    unlockedWrap.style.display = shouldShowUnlocked ? 'block' : 'none';
  }

  function populatePopup(popupRoot) {
    var asset = getActiveAsset();
    if (!asset) {
      warn('nvelope: no stored asset to populate popup');
      return;
    }

    setText(popupRoot, '.nvelope-popup-title', asset.title || '');
    setText(popupRoot, '.nvelope-popup-standfirst', asset.standfirst || '');
    setHTML(popupRoot, '.nvelope-popup-body', asset.body || '');

    setPopupGateState(popupRoot, asset);

    try {
      setPopupMedia(popupRoot, asset);
    } catch (e) {
      warn('nvelope: setPopupMedia failed');
      if (window && window.console) console.warn(e);
    }

    log('nvelope: popup populated', asset);
  }

  function waitForPopupAndPopulate(popupId) {
    var start = Date.now();
    var timeoutMs = 6000;

    function tick() {
      var popupRoot = getPopupRootById(popupId);
      if (popupRoot) {
        populatePopup(popupRoot);
        return;
      }

      if (Date.now() - start > timeoutMs) {
        warn('nvelope: popup not found in time for id', popupId);
        return;
      }

      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  function wireAssetButtons() {
    document.addEventListener('click', function (evt) {
      var wrapper =
        evt.target.closest('.nvelope-asset-open') ||
        evt.target.closest('a.raven-button') ||
        evt.target.closest('a.elementor-button') ||
        evt.target.closest('.raven-button') ||
        evt.target.closest('.elementor-button');

      if (!wrapper) return;

      wrapper = wrapper.closest('.nvelope-asset-open') || wrapper;
      if (!wrapper.classList || !wrapper.classList.contains('nvelope-asset-open')) return;

      var card = closestCard(wrapper);
      if (!card) return;

      var asset = readAssetFromCard(card, wrapper);
      if (!asset || !asset.uid) {
        warn('nvelope: could not capture asset (missing uid)');
        return;
      }

      storeActiveAsset(asset);

      var popupId = getPopupIdFromClick(wrapper);
      if (!popupId) {
        warn('nvelope: could not detect popup id from href');
        return;
      }

      waitForPopupAndPopulate(popupId);
    }, true);
  }

  // Init
  handleUnlockParam();
  wireScrollSaveRestore();
  wireAssetButtons();
})();

// LISTEN TO UNLOCKING
window.addEventListener('DOMContentLoaded', () => {
  if (document.documentElement.classList.contains('nvelope-unlocked')) {
    // run whatever you currently run on unlock
  }
});

// single source of truth for unlocking UI
function applyUnlockedUI() {
  document.body.classList.add('nvelope-unlocked');

  document.querySelectorAll('.asset-locked').forEach(el => {
    el.style.display = 'none';
  });

  document.querySelectorAll('.asset-unlocked').forEach(el => {
    el.style.display = '';
  });
}

document.addEventListener('DOMContentLoaded', function () {
  var params = new URLSearchParams(window.location.search);

  if (params.get('u') === '1') {
    document.documentElement.classList.add('nvelope-unlocked');
  }
});