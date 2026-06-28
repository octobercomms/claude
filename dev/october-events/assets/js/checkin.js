/**
 * October Events — door check-in PWA.
 *
 * Flow: pick event → enter PIN → choose venue → scan QR (camera, via the bundled
 * html5-qrcode library) or enter the token manually. PIN-gated against the REST
 * API; no WordPress login required for door staff.
 *
 * Works offline. On PIN entry the app downloads a manifest of valid tokens and
 * caches it (IndexedDB). If the venue Wi-Fi drops, scans are validated against
 * that cache and queued to persistent storage, then synced automatically when
 * connectivity returns — including the next time the app is opened, so a queue
 * survives the app being closed. A service worker caches the shell so it opens
 * with no signal.
 */
(function () {
    'use strict';

    var cfg = window.OE_CHECKIN || {};
    var root = document.getElementById('oe-checkin');
    if (!root) { return; }

    var state = { eventId: 0, pin: '', venue: '', count: 0 };
    var scanner = null, scanning = false, lastToken = '', lastAt = 0;
    // Cached manifest for the current event: token -> {attendee,type} + a set of
    // tokens already checked in (kept current as we scan, online or off).
    var manifest = null;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function go(step) {
        root.querySelectorAll('.oe-ci-step').forEach(function (s) {
            s.classList.toggle('is-active', s.dataset.step === step);
        });
        // "← All events" in the header on every step except the first.
        var home = document.getElementById('oe-ci-home');
        if (home) { home.hidden = (step === 'event'); }
        if (step !== 'scan') { stopScanner(); }
    }
    function get(path, params) {
        var qs = Object.keys(params || {}).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
        return fetch(cfg.restUrl + path + (qs ? '?' + qs : '')).then(function (r) { return r.json(); });
    }
    function post(path, body) {
        return fetch(cfg.restUrl + path, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); });
    }

    /* ---------------------------------------------------------------- *
     * IndexedDB — persistent manifest cache + offline scan queue.
     * Survives the app being closed, so a queue is never lost.
     * ---------------------------------------------------------------- */
    var DB = null;
    function db() {
        if (DB) { return DB; }
        DB = new Promise(function (resolve, reject) {
            if (!window.indexedDB) { reject(new Error('no-idb')); return; }
            var req = indexedDB.open('oe-checkin', 1);
            req.onupgradeneeded = function () {
                var d = req.result;
                if (!d.objectStoreNames.contains('manifest')) { d.createObjectStore('manifest', { keyPath: 'eventId' }); }
                if (!d.objectStoreNames.contains('queue')) { d.createObjectStore('queue', { keyPath: 'id', autoIncrement: true }); }
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
        return DB;
    }
    function tx(store, mode, fn) {
        return db().then(function (d) {
            return new Promise(function (resolve, reject) {
                var t = d.transaction(store, mode);
                var s = t.objectStore(store);
                var out = fn(s);
                t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
                t.onerror = function () { reject(t.error); };
            });
        });
    }
    function idbPut(store, val) { return tx(store, 'readwrite', function (s) { return s.put(val); }); }
    function idbGet(store, key) { return tx(store, 'readonly', function (s) { return s.get(key); }); }
    function idbAdd(store, val) { return tx(store, 'readwrite', function (s) { return s.add(val); }); }
    function idbDelete(store, keys) {
        return tx(store, 'readwrite', function (s) { (keys || []).forEach(function (k) { s.delete(k); }); });
    }
    function queueAll() {
        return db().then(function (d) {
            return new Promise(function (resolve) {
                var out = [];
                var cur = d.transaction('queue', 'readonly').objectStore('queue').openCursor();
                cur.onsuccess = function (e) {
                    var c = e.target.result;
                    if (c) { out.push(c.value); c.continue(); } else { resolve(out); }
                };
                cur.onerror = function () { resolve(out); };
            });
        });
    }

    /* ---- Manifest (valid tokens) cache ---- */
    // SHA-256 hex of a string (matches the server's token_hash). Needs a secure
    // context — which the scanner already requires for camera access.
    function sha256hex(str) {
        if (!(window.crypto && crypto.subtle)) { return Promise.reject(new Error('no-subtle')); }
        return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(function (buf) {
            var out = '', b = new Uint8Array(buf);
            for (var i = 0; i < b.length; i++) { out += ('0' + b[i].toString(16)).slice(-2); }
            return out;
        });
    }
    function manifestFromData(data) {
        // The manifest carries token *hashes*, not raw tokens.
        var tokens = {};
        (data.tickets || []).forEach(function (t) { tokens[t.token_hash] = { attendee: t.attendee, type: t.type }; });
        var checked = {};
        (data.checked_in || []).forEach(function (h) { checked[h] = true; });
        return { tokens: tokens, checked: checked, generated: data.generated || '' };
    }
    function loadManifest() {
        // Fetch fresh if online; always fall back to the cached copy.
        return get('/checkin-manifest', { event_id: state.eventId, pin: state.pin })
            .then(function (data) {
                if (data && !data.error && data.tickets) {
                    manifest = manifestFromData(data);
                    idbPut('manifest', { eventId: state.eventId, data: data }).catch(function () {});
                    return manifest;
                }
                throw new Error('no-manifest');
            })
            .catch(function () {
                return idbGet('manifest', state.eventId).then(function (row) {
                    if (row && row.data) { manifest = manifestFromData(row.data); }
                    return manifest;
                });
            });
    }

    /* ---- Network status pill + offline banner ---- */
    function setNet() {
        var el = document.getElementById('oe-ci-net');
        var banner = document.getElementById('oe-ci-offline');
        var online = navigator.onLine;
        if (banner) { banner.hidden = online; }
        if (!el) { return; }
        queueAll().then(function (items) {
            var n = items.length;
            if (online && !n) { el.hidden = true; return; }
            el.hidden = false;
            if (!online && n) { el.className = 'oe-ci-net off'; el.textContent = '🟡 Offline · ' + n + ' queued'; }
            else if (!online) { el.className = 'oe-ci-net off'; el.textContent = '🟡 Offline'; }
            else { el.className = 'oe-ci-net sync'; el.textContent = '🔄 Syncing ' + n + '…'; }
            if (banner && n) {
                banner.querySelector('.oe-ci-offline-q').textContent = online
                    ? ' Syncing ' + n + ' now…'
                    : ' ' + n + ' will sync when you\'re back online.';
            }
        });
    }

    /* ---- Offline scan queue + sync ---- */
    var syncing = false;
    function enqueue(token) {
        var rec = {
            event_id: state.eventId, pin: state.pin, token: token,
            venue: state.venue, scanned_at: new Date().toISOString()
        };
        return idbAdd('queue', rec).then(setNet);
    }
    function syncQueue() {
        if (syncing || !navigator.onLine) { return Promise.resolve(); }
        syncing = true;
        return queueAll().then(function (items) {
            if (!items.length) { syncing = false; setNet(); return; }
            setNet();
            // Group by event+pin so each batch is one PIN-gated request. (A queue
            // reopened later still carries its own event/pin, so it flushes even
            // before the user re-enters anything.)
            var groups = {};
            items.forEach(function (it) {
                var k = it.event_id + '|' + it.pin;
                if (!groups[k]) { groups[k] = { event_id: it.event_id, pin: it.pin, scans: [], ids: [] }; }
                groups[k].scans.push({ token: it.token, venue: it.venue, scanned_at: it.scanned_at });
                groups[k].ids.push(it.id);
            });
            var chain = Promise.resolve();
            Object.keys(groups).forEach(function (k) {
                var g = groups[k];
                chain = chain.then(function () {
                    return post('/checkin-sync', { event_id: g.event_id, pin: g.pin, scans: g.scans })
                        .then(function (res) { if (res.ok) { return idbDelete('queue', g.ids); } })
                        .catch(function () { /* leave queued; retry later */ });
                });
            });
            return chain.then(function () { syncing = false; setNet(); });
        }).catch(function () { syncing = false; });
    }

    root.querySelectorAll('[data-back]').forEach(function (b) {
        b.addEventListener('click', function () { go(b.dataset.back); });
    });

    function listItem(cls, data, icon, title) {
        return '<button class="list-item ' + cls + '" ' + data + '>' +
            '<span class="list-item__icon">' + icon + '</span>' +
            '<span class="list-item__body"><span class="list-item__title">' + esc(title) + '</span></span>' +
            '<span class="list-item__arrow">›</span></button>';
    }

    /* ---- Events ---- */
    get('/checkin-events', {}).then(function (events) {
        var box = document.getElementById('oe-ci-events');
        if (!events || !events.length) { box.innerHTML = '<div class="list-item">No events with tickets yet.</div>'; return; }
        box.innerHTML = events.map(function (e) {
            return listItem('oe-ci-event', 'data-id="' + e.id + '"', '🎟', e.title);
        }).join('');
        box.querySelectorAll('.oe-ci-event').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.eventId = parseInt(btn.dataset.id, 10);
                document.getElementById('oe-ci-pin-event').textContent = btn.querySelector('.list-item__title').textContent;
                resetPin();
                go('pin');
            });
        });
    }).catch(function () {
        var box = document.getElementById('oe-ci-events');
        if (box) { box.innerHTML = '<div class="list-item">Offline — connect once to load events.</div>'; }
    });

    /* ---- PIN keypad ---- */
    function renderPinDisplay() {
        var n = state.pin.length, slots = Math.max(4, n), out = '';
        for (var i = 0; i < slots; i++) { out += (i < n ? '●' : '○'); }
        document.getElementById('oe-ci-pin-display').textContent = out;
    }
    function resetPin() {
        state.pin = '';
        document.getElementById('oe-ci-pin').value = '';
        document.getElementById('oe-ci-pin-msg').textContent = '';
        renderPinDisplay();
    }
    root.querySelectorAll('.pin-btn[data-digit]').forEach(function (b) {
        b.addEventListener('click', function () {
            if (state.pin.length >= 6) { return; }
            state.pin += b.dataset.digit;
            document.getElementById('oe-ci-pin').value = state.pin;
            renderPinDisplay();
        });
    });
    document.getElementById('oe-ci-pin-clear').addEventListener('click', resetPin);

    document.getElementById('oe-ci-pin-go').addEventListener('click', function () {
        var msg = document.getElementById('oe-ci-pin-msg');
        if (state.pin.length < 4) { msg.textContent = 'Enter the 4–6 digit PIN.'; return; }
        msg.textContent = 'Checking…';
        get('/checkin-venues', { event_id: state.eventId, pin: state.pin }).then(function (res) {
            if (res.error) { msg.textContent = 'Incorrect PIN. Try again.'; return; }
            msg.textContent = '';
            // Preload the offline manifest now, while we know we're online.
            loadManifest();
            renderVenues(res);
            go('venue');
        }).catch(function () { msg.textContent = 'Network error. Check your connection and try again.'; });
    });

    function renderVenues(venues) {
        var box = document.getElementById('oe-ci-venues');
        var list = (venues && venues.length) ? venues : ['Main door'];
        box.innerHTML = list.map(function (v) {
            return listItem('oe-ci-venue', 'data-v="' + esc(v) + '"', '📍', v);
        }).join('');
        box.querySelectorAll('.oe-ci-venue').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.venue = btn.dataset.v;
                document.getElementById('oe-ci-venue-name').textContent = state.venue;
                go('scan'); startScanner(); refreshStats(); setNet();
            });
        });
    }

    /* ---- Scanner ---- */
    function startScanner() {
        if (scanning || !window.Html5Qrcode) { return; }
        scanner = new window.Html5Qrcode('oe-ci-reader');
        scanning = true;
        // No qrbox: scan the whole camera frame. A fixed centred qrbox misaligns
        // with the CSS object-fit:cover view, so a QR aimed at the on-screen
        // frame can fall outside the scan region and never decode.
        scanner.start({ facingMode: 'environment' }, { fps: 10 }, onDecode, function () {})
            .catch(function () { scanning = false; });
    }
    function stopScanner() {
        if (scanner && scanning) { scanner.stop().then(function () { scanning = false; }).catch(function () { scanning = false; }); }
    }
    function onDecode(text) {
        var now = Date.now();
        if (text === lastToken && now - lastAt < 3000) { return; } // debounce repeats
        lastToken = text; lastAt = now;
        submit(text);
    }

    document.getElementById('oe-ci-manual-go').addEventListener('click', function () {
        var t = document.getElementById('oe-ci-manual').value.trim();
        if (t) { submit(t); document.getElementById('oe-ci-manual').value = ''; }
    });

    /* Validate a token against the cached manifest, with no network. The manifest
       holds token hashes, so hash the scanned token and match on that. */
    function scanOffline(token) {
        if (!manifest) { overlay('offline', {}); return; }
        sha256hex(token).then(function (h) {
            var t = manifest.tokens[h];
            if (!t) { overlay('invalid', {}); return; }
            var already = !!manifest.checked[h];
            manifest.checked[h] = true; // remember locally so a repeat flags here too
            enqueue(token);             // queue the RAW token; the server re-validates on sync
            if (!already) { state.count++; document.getElementById('oe-ci-count').textContent = state.count; }
            overlay(already ? 'already' : 'valid', { attendee: t.attendee, type: t.type, offline: true });
        }).catch(function () { overlay('invalid', {}); });
    }

    function submit(token) {
        if (!navigator.onLine) { scanOffline(token); return; }
        post('/checkin-scan', { token: token, event_id: state.eventId, pin: state.pin, venue: state.venue })
            .then(function (res) {
                var s = res.body || {};
                overlay(s.status, s);
                if (s.status === 'valid') {
                    state.count++; document.getElementById('oe-ci-count').textContent = state.count;
                    // Keep the local (hash-keyed) checked set current in case we drop offline.
                    if (manifest) { sha256hex(token).then(function (h) { manifest.checked[h] = true; }).catch(function () {}); }
                }
                refreshStats();
            })
            .catch(function () { scanOffline(token); }); // lost signal mid-scan — fall back
    }

    function overlay(status, info) {
        var o = document.getElementById('oe-ci-overlay');
        var inner = o.querySelector('.oe-ci-overlay-inner');
        var off = info && info.offline ? ' · offline' : '';
        var map = {
            valid: ['ok', '✓ Welcome', (info.attendee || info.type || '') + off],
            already: ['warn', '⚠ Already scanned', (info.attendee || '') + ' · ' + (info.count || 0) + ' scans'],
            wrong_event: ['bad', '✗ Wrong event', 'This ticket is for another event'],
            invalid: ['bad', '✗ Invalid', 'Ticket not recognised'],
            offline: ['bad', '⚠ Offline — not ready', 'Connect once and re-enter the PIN to scan offline']
        };
        var m = map[status] || map.invalid;
        o.className = 'oe-ci-overlay oe-ci-' + m[0];
        inner.innerHTML = '<div class="oe-ci-big">' + esc(m[1]) + '</div><div>' + esc(m[2]) + '</div>';
        o.hidden = false;
        setTimeout(function () { o.hidden = true; }, 2200);
    }

    function refreshStats() {
        if (!navigator.onLine) { setNet(); return; }
        get('/checkin-stats', { event_id: state.eventId, pin: state.pin }).then(function (res) {
            if (res.error) { return; }
            var box = document.getElementById('oe-ci-stats');
            box.innerHTML = '<strong>' + (res.unique || 0) + '</strong> unique in · ' +
                (res.venues || []).map(function (v) { return esc(v.venue) + ': ' + v.count; }).join(' · ');
        }).catch(function () {});
    }

    if (!window.Html5Qrcode) {
        var reader = document.getElementById('oe-ci-reader');
        if (reader) { reader.innerHTML = '<p style="padding:16px">Camera scanning unavailable — use manual entry below.</p>'; }
    }

    /* ---- Connectivity wiring: flush the queue whenever we come back online ---- */
    window.addEventListener('online', function () { setNet(); syncQueue().then(refreshStats); });
    window.addEventListener('offline', setNet);
    // Flush any leftover queue from a previous (possibly closed) session, and keep
    // a slow retry going so nothing lingers.
    syncQueue();
    setNet();
    setInterval(function () { if (navigator.onLine) { syncQueue(); } }, 20000);
})();
