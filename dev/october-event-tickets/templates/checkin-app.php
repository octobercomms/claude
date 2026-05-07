<?php
/**
 * Check-in PWA — served at /oct-checkin/
 * Full-screen single-page app, dark theme.
 */
defined('ABSPATH') || exit;

$api_base   = esc_url(rest_url('oct-tickets/v1'));
$site_name  = get_bloginfo('name');
?>
<!DOCTYPE html>
<html lang="<?php echo esc_attr(get_locale()); ?>">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="theme-color" content="#0f0f0f">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title><?php echo esc_html($site_name . ' — ' . __('Check-in', 'october-event-tickets')); ?></title>
<style>
  :root {
    --bg:       #0f0f0f;
    --surface:  #1a1a1a;
    --border:   #2a2a2a;
    --accent:   #C8A96E;
    --text:     #f0f0f0;
    --muted:    #888;
    --green:    #22c55e;
    --amber:    #f59e0b;
    --red:      #ef4444;
    --radius:   12px;
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  html, body {
    height: 100%;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
  }

  /* ---- Layout ---- */
  #app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
  }

  .app-header {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 14px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    min-height: 56px;
  }

  .app-header h1 {
    font-size: 16px;
    font-weight: 700;
    color: var(--text);
  }

  .app-header .back-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--muted);
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 13px;
    cursor: pointer;
    display: none;
  }

  .scan-count-badge {
    background: var(--accent);
    color: #1a1a1a;
    font-size: 13px;
    font-weight: 700;
    padding: 4px 12px;
    border-radius: 20px;
    display: none;
  }

  /* ---- Screens ---- */
  .screen {
    display: none;
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 24px 20px;
  }
  .screen.active { display: flex; flex-direction: column; }

  /* ---- Cards / Lists ---- */
  .screen-title {
    font-size: 22px;
    font-weight: 800;
    color: var(--text);
    margin-bottom: 8px;
  }
  .screen-sub {
    font-size: 14px;
    color: var(--muted);
    margin-bottom: 24px;
  }

  .list-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    margin-bottom: 16px;
  }

  .list-item {
    display: flex;
    align-items: center;
    padding: 16px 20px;
    cursor: pointer;
    transition: background 0.15s;
    border-bottom: 1px solid var(--border);
    gap: 12px;
  }
  .list-item:last-child { border-bottom: none; }
  .list-item:hover, .list-item:active { background: #222; }

  .list-item__icon {
    width: 40px; height: 40px;
    border-radius: 10px;
    background: #252525;
    display: flex; align-items: center; justify-content: center;
    font-size: 18px;
    flex-shrink: 0;
    color: var(--accent);
  }

  .list-item__body { flex: 1; }
  .list-item__title { font-size: 15px; font-weight: 600; }
  .list-item__sub   { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .list-item__arrow { color: var(--muted); font-size: 18px; }

  /* ---- PIN screen ---- */
  #pin-display {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    text-align: center;
    padding: 20px;
    font-size: 32px;
    letter-spacing: 12px;
    color: var(--accent);
    margin-bottom: 20px;
    min-height: 72px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .pin-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-bottom: 20px;
  }

  .pin-btn {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 22px;
    font-weight: 600;
    padding: 18px 0;
    cursor: pointer;
    transition: background 0.1s;
    -webkit-tap-highlight-color: transparent;
  }
  .pin-btn:active { background: #333; }
  .pin-btn.clear  { color: var(--red); font-size: 16px; }
  .pin-btn.enter  { background: var(--accent); color: #1a1a1a; border-color: var(--accent); }
  .pin-error { color: var(--red); text-align: center; font-size: 14px; display: none; margin-top: 8px; }

  /* ---- Scanner screen ---- */
  #scanner-screen { padding: 0; position: relative; }

  #qr-reader {
    width: 100%;
    flex: 1;
    background: #000;
    position: relative;
    overflow: hidden;
  }

  #qr-reader video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  /* Scanner overlay */
  .scanner-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 10;
  }

  .scan-frame {
    width: 240px;
    height: 240px;
    position: relative;
  }

  .scan-frame::before, .scan-frame::after,
  .scan-frame__corner-tr, .scan-frame__corner-bl, .scan-frame__corner-br {
    content: '';
    position: absolute;
    width: 40px;
    height: 40px;
    border-color: var(--accent);
    border-style: solid;
  }
  .scan-frame::before    { top: 0;    left: 0;  border-width: 4px 0 0 4px; border-radius: 6px 0 0 0; }
  .scan-frame__corner-tr { top: 0;    right: 0; border-width: 4px 4px 0 0; border-radius: 0 6px 0 0; }
  .scan-frame__corner-bl { bottom: 0; left: 0;  border-width: 0 0 4px 4px; border-radius: 0 0 0 6px; }
  .scan-frame__corner-br { bottom: 0; right: 0; border-width: 0 4px 4px 0; border-radius: 0 0 6px 0; }
  .scan-frame::after     { display: none; }

  .scan-line {
    position: absolute;
    left: 4px; right: 4px;
    height: 2px;
    background: var(--accent);
    opacity: 0.8;
    animation: scan-anim 2s ease-in-out infinite;
  }

  @keyframes scan-anim {
    0%   { top: 4px; }
    50%  { top: calc(100% - 4px); }
    100% { top: 4px; }
  }

  .scanner-label {
    margin-top: 20px;
    color: #fff;
    font-size: 14px;
    text-shadow: 0 1px 4px rgba(0,0,0,.8);
    letter-spacing: 0.5px;
  }

  /* Scanner bottom bar */
  .scanner-bar {
    background: var(--surface);
    border-top: 1px solid var(--border);
    padding: 12px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-shrink: 0;
    z-index: 20;
  }

  .scanner-bar button {
    background: #252525;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 10px 16px;
    border-radius: 8px;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
  }

  /* Result overlay */
  .scan-result-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 30;
    padding: 24px;
    transition: opacity 0.2s;
  }
  .scan-result-overlay.valid   { background: rgba(34,197,94,0.92); }
  .scan-result-overlay.amber   { background: rgba(245,158,11,0.92); }
  .scan-result-overlay.invalid { background: rgba(239,68,68,0.92); }

  .scan-result-icon {
    font-size: 72px;
    margin-bottom: 16px;
    line-height: 1;
  }
  .scan-result-title {
    font-size: 28px;
    font-weight: 900;
    color: #fff;
    text-align: center;
    margin-bottom: 8px;
  }
  .scan-result-info {
    font-size: 16px;
    color: rgba(255,255,255,0.9);
    text-align: center;
    line-height: 1.5;
  }

  /* Stats overlay */
  .stats-panel {
    position: absolute;
    inset: 0;
    background: var(--bg);
    z-index: 40;
    overflow-y: auto;
    padding: 20px;
    display: none;
  }
  .stats-panel.active { display: block; }
  .stats-panel h2 { font-size: 20px; font-weight: 800; margin-bottom: 16px; }
  .stats-total { font-size: 48px; font-weight: 900; color: var(--accent); text-align: center; margin: 20px 0 8px; }
  .stats-total-label { text-align: center; color: var(--muted); font-size: 14px; margin-bottom: 24px; }
  .stats-venue-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 14px 0; border-bottom: 1px solid var(--border);
    font-size: 15px;
  }
  .stats-venue-count { font-weight: 700; color: var(--accent); font-size: 18px; }
  .stats-refresh { margin-top: 20px; width: 100%; padding: 14px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); font-size: 15px; cursor: pointer; }
  .stats-close { margin-top: 12px; width: 100%; padding: 14px; background: none; border: none; color: var(--muted); font-size: 14px; cursor: pointer; }

  /* ---- Generic ---- */
  .btn-primary {
    width: 100%;
    background: var(--accent);
    color: #1a1a1a;
    border: none;
    border-radius: var(--radius);
    padding: 16px;
    font-size: 17px;
    font-weight: 700;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .btn-primary:active { opacity: 0.9; }

  .spinner {
    display: inline-block;
    width: 16px; height: 16px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    vertical-align: middle;
    margin-right: 6px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .loading-screen {
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    flex: 1; color: var(--muted); gap: 16px;
  }
  .loading-spinner {
    width: 40px; height: 40px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
</style>
</head>
<body>

<div id="app">

  <div class="app-header">
    <button class="back-btn" id="back-btn">&#8592; <?php esc_html_e('Back', 'october-event-tickets'); ?></button>
    <h1 id="app-title"><?php echo esc_html($site_name); ?> <?php esc_html_e('Check-in', 'october-event-tickets'); ?></h1>
    <div class="scan-count-badge" id="scan-badge">0</div>
  </div>

  <!-- Screen 1: Event Selection -->
  <div class="screen active" id="screen-events">
    <div class="screen-title"><?php esc_html_e('Select Event', 'october-event-tickets'); ?></div>
    <div class="screen-sub"><?php esc_html_e('Choose the event you are checking attendees into.', 'october-event-tickets'); ?></div>
    <div id="event-list">
      <div class="loading-screen">
        <div class="loading-spinner"></div>
        <span><?php esc_html_e('Loading events…', 'october-event-tickets'); ?></span>
      </div>
    </div>
  </div>

  <!-- Screen 2: PIN Entry -->
  <div class="screen" id="screen-pin">
    <div class="screen-title"><?php esc_html_e('Enter PIN', 'october-event-tickets'); ?></div>
    <div class="screen-sub" id="pin-event-name"></div>

    <div id="pin-display">&#9679;&#9679;&#9679;&#9679;</div>

    <div class="pin-grid">
      <?php for ($d = 1; $d <= 9; $d++) : ?>
        <button class="pin-btn" data-digit="<?php echo $d; ?>"><?php echo $d; ?></button>
      <?php endfor; ?>
      <button class="pin-btn clear" id="pin-clear"><?php esc_html_e('Clear', 'october-event-tickets'); ?></button>
      <button class="pin-btn" data-digit="0">0</button>
      <button class="pin-btn enter" id="pin-enter"><?php esc_html_e('Enter', 'october-event-tickets'); ?></button>
    </div>

    <div class="pin-error" id="pin-error"><?php esc_html_e('Incorrect PIN. Please try again.', 'october-event-tickets'); ?></div>
  </div>

  <!-- Screen 3: Venue Selection -->
  <div class="screen" id="screen-venues">
    <div class="screen-title"><?php esc_html_e('Select Venue', 'october-event-tickets'); ?></div>
    <div class="screen-sub"><?php esc_html_e('Choose your check-in point.', 'october-event-tickets'); ?></div>
    <div id="venue-list" class="list-card"></div>
  </div>

  <!-- Screen 4: Scanner -->
  <div class="screen" id="scanner-screen">
    <div id="qr-reader">
      <!-- html5-qrcode attaches here -->
      <div class="scanner-overlay">
        <div class="scan-frame">
          <div class="scan-frame__corner-tr"></div>
          <div class="scan-frame__corner-bl"></div>
          <div class="scan-frame__corner-br"></div>
          <div class="scan-line"></div>
        </div>
        <div class="scanner-label" id="scanner-label"><?php esc_html_e('Point at a ticket QR code', 'october-event-tickets'); ?></div>
      </div>
      <div class="scan-result-overlay" id="scan-result" style="display:none">
        <div class="scan-result-icon" id="result-icon"></div>
        <div class="scan-result-title" id="result-title"></div>
        <div class="scan-result-info" id="result-info"></div>
      </div>
    </div>

    <!-- Stats panel (layered on top) -->
    <div class="stats-panel" id="stats-panel">
      <h2><?php esc_html_e('Check-in Stats', 'october-event-tickets'); ?></h2>
      <div class="stats-total" id="stats-total">0</div>
      <div class="stats-total-label"><?php esc_html_e('Unique Tickets Scanned', 'october-event-tickets'); ?></div>
      <div id="stats-venues"></div>
      <button class="stats-refresh" id="stats-refresh"><?php esc_html_e('Refresh Stats', 'october-event-tickets'); ?></button>
      <button class="stats-close" id="stats-close"><?php esc_html_e('Close', 'october-event-tickets'); ?></button>
    </div>

    <div class="scanner-bar">
      <button id="btn-change-venue"><?php esc_html_e('Change Venue', 'october-event-tickets'); ?></button>
      <button id="btn-show-stats"><?php esc_html_e('Stats', 'october-event-tickets'); ?></button>
    </div>
  </div>

</div><!-- #app -->

<!-- html5-qrcode from CDN -->
<script src="https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js"></script>

<script>
(function () {
  'use strict';

  // ---- Config ----
  const API = <?php echo wp_json_encode(esc_url_raw(rest_url('oct-tickets/v1'))); ?>;

  // ---- State ----
  let state = {
    events:    [],
    event:     null,   // {id, title, date}
    pin:       '',
    venues:    [],
    venue:     null,   // string
    scanner:   null,   // Html5Qrcode instance
    scanning:  false,
    sessionScans: 0,
    resultTimer: null,
  };

  // ---- DOM refs ----
  const screens   = {
    events:  document.getElementById('screen-events'),
    pin:     document.getElementById('screen-pin'),
    venues:  document.getElementById('screen-venues'),
    scanner: document.getElementById('scanner-screen'),
  };

  const appTitle    = document.getElementById('app-title');
  const backBtn     = document.getElementById('back-btn');
  const scanBadge   = document.getElementById('scan-badge');
  const eventList   = document.getElementById('event-list');
  const venueList   = document.getElementById('venue-list');
  const pinDisplay  = document.getElementById('pin-display');
  const pinError    = document.getElementById('pin-error');
  const pinEventName = document.getElementById('pin-event-name');
  const scanResult  = document.getElementById('scan-result');
  const resultIcon  = document.getElementById('result-icon');
  const resultTitle = document.getElementById('result-title');
  const resultInfo  = document.getElementById('result-info');
  const statsPanel  = document.getElementById('stats-panel');

  // ---- Screen switching ----
  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    if (screens[name]) {
      screens[name].classList.add('active');
    }

    backBtn.style.display     = name === 'events' ? 'none' : '';
    scanBadge.style.display   = name === 'scanner' ? '' : 'none';
    statsPanel.classList.remove('active');

    switch (name) {
      case 'events':
        appTitle.textContent = <?php echo wp_json_encode(get_bloginfo('name') . ' ' . __('Check-in', 'october-event-tickets')); ?>;
        break;
      case 'pin':
        appTitle.textContent = <?php echo wp_json_encode(__('Enter PIN', 'october-event-tickets')); ?>;
        break;
      case 'venues':
        appTitle.textContent = <?php echo wp_json_encode(__('Select Venue', 'october-event-tickets')); ?>;
        break;
      case 'scanner':
        appTitle.textContent = state.venue || <?php echo wp_json_encode(__('Scanning', 'october-event-tickets')); ?>;
        break;
    }
  }

  backBtn.addEventListener('click', function () {
    const current = Object.entries(screens).find(([, el]) => el.classList.contains('active'));
    const order   = ['events', 'pin', 'venues', 'scanner'];
    if (!current) return;
    const idx = order.indexOf(current[0]);
    if (idx > 0) {
      if (current[0] === 'scanner') stopScanner();
      showScreen(order[idx - 1]);
    }
  });

  // ---- Events screen ----
  async function loadEvents() {
    try {
      const res  = await fetch(API + '/events');
      state.events = await res.json();
    } catch (e) {
      state.events = [];
    }

    if (!state.events.length) {
      eventList.innerHTML = '<p style="color:var(--muted);text-align:center;padding:40px 0"><?php esc_html_e('No published events found.', 'october-event-tickets'); ?></p>';
      return;
    }

    const card = document.createElement('div');
    card.className = 'list-card';
    state.events.forEach(ev => {
      const item = document.createElement('div');
      item.className = 'list-item';
      item.innerHTML = `
        <div class="list-item__icon">&#127914;</div>
        <div class="list-item__body">
          <div class="list-item__title">${escHtml(ev.title)}</div>
          ${ev.date ? `<div class="list-item__sub">${escHtml(ev.date)}</div>` : ''}
        </div>
        <div class="list-item__arrow">&#8250;</div>
      `;
      item.addEventListener('click', () => selectEvent(ev));
      card.appendChild(item);
    });
    eventList.innerHTML = '';
    eventList.appendChild(card);
  }

  function selectEvent(ev) {
    state.event  = ev;
    state.pin    = '';
    updatePinDisplay();
    pinEventName.textContent = ev.title;
    pinError.style.display   = 'none';
    showScreen('pin');
  }

  // ---- PIN screen ----
  function updatePinDisplay() {
    const dots = state.pin.length ? '●'.repeat(state.pin.length) : '○○○○';
    pinDisplay.textContent = dots;
  }

  document.querySelectorAll('.pin-btn[data-digit]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.pin.length >= 6) return;
      state.pin += btn.dataset.digit;
      updatePinDisplay();
      pinError.style.display = 'none';
    });
  });

  document.getElementById('pin-clear').addEventListener('click', () => {
    state.pin = '';
    updatePinDisplay();
    pinError.style.display = 'none';
  });

  document.getElementById('pin-enter').addEventListener('click', async () => {
    if (!state.pin || state.pin.length < 4) return;
    const btn = document.getElementById('pin-enter');
    btn.textContent = '…';
    btn.disabled = true;

    try {
      const res    = await fetch(API + '/venues?' + new URLSearchParams({
        event_id:  state.event.id,
        event_pin: state.pin,
      }));
      const venues = await res.json();

      if (!res.ok || (Array.isArray(venues) && venues.error)) {
        throw new Error('invalid_pin');
      }

      state.venues = Array.isArray(venues) ? venues : [];
      buildVenueList();
      showScreen('venues');
    } catch (e) {
      pinError.style.display = '';
      state.pin = '';
      updatePinDisplay();
    } finally {
      btn.textContent = '<?php esc_html_e('Enter', 'october-event-tickets'); ?>';
      btn.disabled = false;
    }
  });

  // ---- Venues screen ----
  function buildVenueList() {
    venueList.innerHTML = '';
    if (!state.venues.length) {
      venueList.innerHTML = '<p style="color:var(--muted);padding:20px;text-align:center"><?php esc_html_e('No venues configured for this event.', 'october-event-tickets'); ?></p>';
      return;
    }
    state.venues.forEach(vname => {
      const item = document.createElement('div');
      item.className = 'list-item';
      item.innerHTML = `
        <div class="list-item__icon">&#128205;</div>
        <div class="list-item__body">
          <div class="list-item__title">${escHtml(vname)}</div>
        </div>
        <div class="list-item__arrow">&#8250;</div>
      `;
      item.addEventListener('click', () => selectVenue(vname));
      venueList.appendChild(item);
    });
  }

  function selectVenue(vname) {
    state.venue        = vname;
    state.sessionScans = 0;
    updateScanBadge();
    showScreen('scanner');
    startScanner();
  }

  // ---- Scanner ----
  function startScanner() {
    if (state.scanner) {
      state.scanner.clear();
      state.scanner = null;
    }

    // Clear the reader div of any previous content except our overlay
    const readerDiv = document.getElementById('qr-reader');
    // Remove any child divs added by html5-qrcode except our overlays
    Array.from(readerDiv.children).forEach(child => {
      if (!child.classList.contains('scanner-overlay') && !child.classList.contains('scan-result-overlay')) {
        child.remove();
      }
    });

    state.scanner = new Html5Qrcode('qr-reader');
    state.scanning = false;

    const config = {
      fps: 10,
      qrbox: { width: 240, height: 240 },
      aspectRatio: window.innerHeight / window.innerWidth,
    };

    state.scanner.start(
      { facingMode: 'environment' },
      config,
      onQrSuccess,
      () => {} // silent failure callback
    ).catch(err => {
      console.warn('Camera error:', err);
      document.getElementById('scanner-label').textContent = '<?php esc_html_e('Camera access denied — enable in browser settings.', 'october-event-tickets'); ?>';
    });
  }

  function stopScanner() {
    if (state.scanner) {
      state.scanner.stop().catch(() => {});
      state.scanner = null;
    }
  }

  async function onQrSuccess(decodedText) {
    if (state.scanning) return;
    state.scanning = true;

    const token = decodedText.trim();

    try {
      const res  = await fetch(API + '/checkin', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          token:      token,
          venue_name: state.venue,
          event_id:   state.event.id,
          event_pin:  state.pin,
        }),
      });
      const data = await res.json();

      showScanResult(data.status, data.ticket);
    } catch (e) {
      showScanResult('error', null);
    }
  }

  function showScanResult(status, ticket) {
    clearTimeout(state.resultTimer);

    const overlay = scanResult;
    overlay.className = 'scan-result-overlay';

    let icon  = '';
    let title = '';
    let info  = '';

    if (status === 'valid') {
      overlay.classList.add('valid');
      icon  = '✓';
      title = '<?php esc_html_e('Valid Ticket', 'october-event-tickets'); ?>';
      state.sessionScans++;
      updateScanBadge();
    } else if (status === 'already_scanned') {
      overlay.classList.add('amber');
      icon  = '⚠';
      title = '<?php esc_html_e('Already Scanned', 'october-event-tickets'); ?>';
    } else if (status === 'wrong_event') {
      overlay.classList.add('invalid');
      icon  = '✕';
      title = '<?php esc_html_e('Wrong Event', 'october-event-tickets'); ?>';
    } else {
      overlay.classList.add('invalid');
      icon  = '✕';
      title = '<?php esc_html_e('Invalid Ticket', 'october-event-tickets'); ?>';
    }

    if (ticket) {
      const parts = [];
      if (ticket.attendee_name) parts.push(ticket.attendee_name);
      if (ticket.ticket_type_label) parts.push(ticket.ticket_type_label);
      if (ticket.ticket_number && ticket.total_in_order) {
        parts.push(`<?php esc_html_e('Ticket', 'october-event-tickets'); ?> ${ticket.ticket_number} <?php esc_html_e('of', 'october-event-tickets'); ?> ${ticket.total_in_order}`);
      }
      info = parts.join(' · ');
    }

    resultIcon.textContent  = icon;
    resultTitle.textContent = title;
    resultInfo.textContent  = info;
    overlay.style.display   = 'flex';

    state.resultTimer = setTimeout(() => {
      overlay.style.display = 'none';
      state.scanning = false;
    }, 3000);
  }

  function updateScanBadge() {
    scanBadge.textContent = state.sessionScans;
  }

  // Change venue button
  document.getElementById('btn-change-venue').addEventListener('click', () => {
    stopScanner();
    showScreen('venues');
  });

  // Stats
  document.getElementById('btn-show-stats').addEventListener('click', () => {
    statsPanel.classList.add('active');
    loadStats();
  });

  document.getElementById('stats-close').addEventListener('click', () => {
    statsPanel.classList.remove('active');
  });

  document.getElementById('stats-refresh').addEventListener('click', loadStats);

  async function loadStats() {
    document.getElementById('stats-total').textContent = '…';
    document.getElementById('stats-venues').innerHTML  = '';

    try {
      const res  = await fetch(API + '/stats?' + new URLSearchParams({
        event_id:  state.event.id,
        event_pin: state.pin,
      }));
      const data = await res.json();

      document.getElementById('stats-total').textContent = data.unique_scans || 0;

      const venueContainer = document.getElementById('stats-venues');
      if (data.venue_stats && data.venue_stats.length) {
        data.venue_stats.forEach(vs => {
          const row = document.createElement('div');
          row.className = 'stats-venue-row';
          row.innerHTML = `
            <span>${escHtml(vs.venue_name)}</span>
            <span class="stats-venue-count">${parseInt(vs.count, 10)}</span>
          `;
          venueContainer.appendChild(row);
        });
      } else {
        venueContainer.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px 0"><?php esc_html_e('No check-ins yet.', 'october-event-tickets'); ?></p>';
      }
    } catch (e) {
      document.getElementById('stats-total').textContent = '—';
    }
  }

  // ---- Utility ----
  function escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---- Init ----
  loadEvents();

})();
</script>
</body>
</html>
