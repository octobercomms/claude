/* Guided tours front end: unlock via ticket email, then reserve time slots.
   Plain vanilla; talks to oe/v1/guided/* with an oe_gt nonce. Times are rendered
   server-side in 12-hour format, so nothing here formats a clock. */
(function () {
    'use strict';
    var CFG = window.OE_GT || null;
    var unlocked = false;
    var buyerName = '';

    function cfg() { return CFG && CFG.rest && CFG.nonce; }

    function post(path, body) {
        body = body || {};
        body.nonce = CFG.nonce;
        return fetch(CFG.rest + path, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-OE-GT-Nonce': CFG.nonce },
            body: JSON.stringify(body)
        }).then(function (r) { return r.json(); });
    }

    /* ---- gate ---- */
    function initGate() {
        var gate = document.querySelector('[data-oe-gt-gate]');
        if (!gate) { return; }
        if (gate.classList.contains('is-unlocked')) { unlocked = true; }
        var form = gate.querySelector('[data-oe-gt-form]');
        var err = gate.querySelector('[data-oe-gt-error]');
        if (!form) { return; }
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            if (!cfg()) { return; }
            var input = form.querySelector('input[type="email"]');
            var email = (input && input.value || '').trim();
            if (!email) { if (input) { input.focus(); } return; }
            var btn = form.querySelector('button');
            if (btn) { btn.disabled = true; }
            if (err) { err.hidden = true; }
            post('unlock', { email: email, tour: CFG.tour }).then(function (res) {
                if (btn) { btn.disabled = false; }
                if (res && res.ok) {
                    unlocked = true;
                    buyerName = res.name || '';
                    var locked = gate.querySelector('.oe-gt-gate__locked');
                    var ok = gate.querySelector('[data-oe-gt-ok]');
                    if (locked) { locked.hidden = true; }
                    if (ok) { ok.hidden = false; }
                    gate.classList.add('is-unlocked');
                    document.querySelectorAll('[data-oe-gt-msg]').forEach(function (m) { m.textContent = 'Pick a time, then reserve.'; });
                } else if (err) {
                    err.textContent = (res && res.error) || 'Something went wrong. Please try again.';
                    err.hidden = false;
                }
            }).catch(function () {
                if (btn) { btn.disabled = false; }
                if (err) { err.textContent = 'Something went wrong. Please try again.'; err.hidden = false; }
            });
        });
    }

    /* ---- slots ---- */
    function initSlots() {
        document.querySelectorAll('[data-oe-gt-slots]').forEach(function (panel) {
            var location = panel.getAttribute('data-oe-gt-slots');
            var reserveBtn = panel.querySelector('[data-oe-gt-reserve]');
            var selected = null;

            panel.addEventListener('click', function (e) {
                var pill = e.target.closest('[data-oe-gt-pill]');
                if (pill && !pill.hasAttribute('data-full') && !pill.classList.contains('is-done')) {
                    if (!unlocked) {
                        var msg = panel.querySelector('[data-oe-gt-msg]');
                        if (msg) { msg.textContent = 'Enter your ticket email above to reserve.'; }
                        return;
                    }
                    panel.querySelectorAll('.is-selected').forEach(function (p) { p.classList.remove('is-selected'); });
                    pill.classList.add('is-selected');
                    selected = pill;
                    if (reserveBtn) {
                        reserveBtn.disabled = false;
                        reserveBtn.textContent = 'Reserve ' + pill.querySelector('.oe-gt-pill__time').textContent;
                    }
                    return;
                }
                if (e.target.closest('[data-oe-gt-reserve]') && reserveBtn && !reserveBtn.disabled && selected) {
                    doReserve(location, selected, reserveBtn);
                }
            });
        });
    }

    function doReserve(location, pill, btn) {
        btn.disabled = true;
        var slot = pill.getAttribute('data-slot');
        post('reserve', { location: location, slot: slot, tour: CFG.tour, name: buyerName }).then(function (res) {
            if (res && res.ok) {
                pill.classList.remove('is-selected', 'is-open', 'is-almost');
                pill.classList.add('is-done');
                var count = pill.querySelector('.oe-gt-pill__count');
                if (res.status === 'waitlist') {
                    if (count) { count.textContent = 'Waitlisted'; }
                    btn.textContent = '✓ Added to the waitlist';
                } else {
                    if (count) { count.textContent = 'Reserved'; }
                    btn.textContent = '✓ Reserved — check your email';
                }
                pill.setAttribute('data-full', '1');
            } else {
                btn.disabled = false;
                btn.textContent = 'Try again';
                var msg = pill.closest('[data-oe-gt-slots]').querySelector('[data-oe-gt-msg]');
                if (msg && res && res.error) { msg.textContent = res.error; }
            }
        }).catch(function () {
            btn.disabled = false; btn.textContent = 'Try again';
        });
    }

    function ready(fn) {
        if (document.readyState !== 'loading') { fn(); }
        else { document.addEventListener('DOMContentLoaded', fn); }
    }
    ready(function () { initGate(); initSlots(); });
})();
