/**
 * October Events — door check-in PWA.
 *
 * Flow: pick event → enter PIN → choose venue → scan QR (camera, via the bundled
 * html5-qrcode library) or enter the token manually. PIN-gated against the REST
 * API; no WordPress login required for door staff.
 */
(function () {
    'use strict';

    var cfg = window.OE_CHECKIN || {};
    var root = document.getElementById('oe-checkin');
    if (!root) { return; }

    var state = { eventId: 0, pin: '', venue: '', count: 0 };
    var scanner = null, scanning = false, lastToken = '', lastAt = 0;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function go(step) {
        root.querySelectorAll('.oe-ci-step').forEach(function (s) {
            s.classList.toggle('is-active', s.dataset.step === step);
        });
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

    root.querySelectorAll('[data-back]').forEach(function (b) {
        b.addEventListener('click', function () { go(b.dataset.back); });
    });

    /* ---- Events ---- */
    get('/checkin-events', {}).then(function (events) {
        var box = document.getElementById('oe-ci-events');
        box.innerHTML = (events || []).map(function (e) {
            return '<button class="oe-btn oe-ci-event" data-id="' + e.id + '">' + esc(e.title) + '</button>';
        }).join('') || '<p>No events with tickets.</p>';
        box.querySelectorAll('.oe-ci-event').forEach(function (btn) {
            btn.addEventListener('click', function () { state.eventId = parseInt(btn.dataset.id, 10); go('pin'); });
        });
    });

    /* ---- PIN ---- */
    document.getElementById('oe-ci-pin-go').addEventListener('click', function () {
        var pin = document.getElementById('oe-ci-pin').value.trim();
        var msg = document.getElementById('oe-ci-pin-msg');
        msg.textContent = 'Checking…';
        get('/checkin-venues', { event_id: state.eventId, pin: pin }).then(function (res) {
            if (res.error) { msg.textContent = 'Wrong PIN.'; return; }
            state.pin = pin; msg.textContent = '';
            renderVenues(res);
            go('venue');
        });
    });

    function renderVenues(venues) {
        var box = document.getElementById('oe-ci-venues');
        var list = (venues && venues.length) ? venues : ['Main door'];
        box.innerHTML = list.map(function (v) {
            return '<button class="oe-btn oe-ci-venue" data-v="' + esc(v) + '">' + esc(v) + '</button>';
        }).join('');
        box.querySelectorAll('.oe-ci-venue').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.venue = btn.dataset.v;
                document.getElementById('oe-ci-venue-name').textContent = state.venue;
                go('scan'); startScanner(); refreshStats();
            });
        });
    }

    /* ---- Scanner ---- */
    function startScanner() {
        if (scanning || !window.Html5Qrcode) { return; }
        scanner = new window.Html5Qrcode('oe-ci-reader');
        scanning = true;
        scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: 250 }, onDecode, function () {})
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

    function submit(token) {
        post('/checkin-scan', { token: token, event_id: state.eventId, pin: state.pin, venue: state.venue })
            .then(function (res) {
                var s = res.body || {};
                overlay(s.status, s);
                if (s.status === 'valid') { state.count++; document.getElementById('oe-ci-count').textContent = state.count; }
                refreshStats();
            });
    }

    function overlay(status, info) {
        var o = document.getElementById('oe-ci-overlay');
        var inner = o.querySelector('.oe-ci-overlay-inner');
        var map = {
            valid: ['ok', '✓ Welcome', (info.attendee || info.type || '')],
            already: ['warn', '⚠ Already scanned', (info.attendee || '') + ' · ' + (info.count || 0) + ' scans'],
            wrong_event: ['bad', '✗ Wrong event', 'This ticket is for another event'],
            invalid: ['bad', '✗ Invalid', 'Ticket not recognised']
        };
        var m = map[status] || map.invalid;
        o.className = 'oe-ci-overlay oe-ci-' + m[0];
        inner.innerHTML = '<div class="oe-ci-big">' + esc(m[1]) + '</div><div>' + esc(m[2]) + '</div>';
        o.hidden = false;
        setTimeout(function () { o.hidden = true; }, 2200);
    }

    function refreshStats() {
        get('/checkin-stats', { event_id: state.eventId, pin: state.pin }).then(function (res) {
            if (res.error) { return; }
            var box = document.getElementById('oe-ci-stats');
            box.innerHTML = '<strong>' + (res.unique || 0) + '</strong> unique in · ' +
                (res.venues || []).map(function (v) { return esc(v.venue) + ': ' + v.count; }).join(' · ');
        });
    }

    if (!window.Html5Qrcode) {
        var reader = document.getElementById('oe-ci-reader');
        if (reader) { reader.innerHTML = '<p style="padding:16px">Camera scanning unavailable — use manual entry below.</p>'; }
    }
})();
