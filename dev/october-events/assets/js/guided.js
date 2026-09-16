/* Guided tours front end: unlock via ticket email, then reserve time slots.
   Plain vanilla; talks to oe/v1/guided/* with an oe_gt nonce. Times are rendered
   server-side in 12-hour format, so nothing here formats a clock.

   After unlock the page loads the visitor's own state (seat allowance + current
   bookings) and reflects it: their booked times are marked "yours", the seat
   count caps how many they can book, and each booking gets Change / Cancel. */
(function () {
    'use strict';
    var CFG = window.OE_GT || null;
    var unlocked = false;
    var buyerName = '';
    // Latest server view of this visitor: {allowance, used, remaining, mine:[…]}.
    var mine = { allowance: 0, used: 0, remaining: 0, mine: [] };

    function cfg() { return CFG && CFG.rest; }
    function t(s) { return (CFG && CFG.i18n && CFG.i18n[s]) || s; }

    // Fetch a live nonce rather than trusting the one printed into a page that may
    // be served from full-page cache. Memoised, and refreshable on a 403.
    var noncePromise = null;
    function freshNonce() {
        if (noncePromise) { return noncePromise; }
        noncePromise = fetch(CFG.rest + 'nonce', { credentials: 'same-origin', cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (d) { if (d && d.nonce) { CFG.nonce = d.nonce; } return CFG.nonce; })
            .catch(function () { return CFG.nonce; });
        return noncePromise;
    }

    function post(path, body, retried) {
        body = body || {};
        return freshNonce().then(function (nonce) {
            body.nonce = nonce;
            return fetch(CFG.rest + path, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-OE-GT-Nonce': nonce },
                body: JSON.stringify(body)
            }).then(function (r) { return r.json(); }).then(function (res) {
                // A rolled/invalid nonce reads as rest_forbidden — refresh once and retry.
                if (!retried && res && res.code === 'rest_forbidden') {
                    noncePromise = null;
                    return post(path, body, true);
                }
                return res;
            });
        });
    }

    /* ---- gate ---- */
    // Flag the whole page as unlocked so CSS anywhere (e.g. the slots inside a
    // listing, which aren't siblings of the gate) can react to the locked state.
    function markUnlocked() {
        unlocked = true;
        if (document.body) { document.body.classList.add('oe-gt-unlocked'); }
    }

    function showUnlockedGate(gate) {
        var locked = gate.querySelector('.oe-gt-gate__locked');
        var ok = gate.querySelector('[data-oe-gt-ok]');
        if (locked) { locked.hidden = true; }
        if (ok) { ok.hidden = false; }
        gate.classList.add('is-unlocked');
    }

    function initGate() {
        var gate = document.querySelector('[data-oe-gt-gate]');
        if (!gate) { return; }
        if (gate.classList.contains('is-unlocked')) { markUnlocked(); }
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
                    markUnlocked();
                    buyerName = res.name || '';
                    showUnlockedGate(gate);
                    loadState();
                } else if (err) {
                    err.textContent = (res && res.error) || t('Something went wrong. Please try again.');
                    err.hidden = false;
                }
            }).catch(function () {
                if (btn) { btn.disabled = false; }
                if (err) { err.textContent = t('Something went wrong. Please try again.'); err.hidden = false; }
            });
        });
    }

    /* ---- state (the visitor's own bookings + seat allowance) ---- */
    function loadState() {
        if (!cfg()) { return; }
        fetch(CFG.rest + 'state?tour=' + encodeURIComponent(CFG.tour), { credentials: 'same-origin', cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (res && res.ok) {
                    mine = res;
                    if (!unlocked) {
                        // A valid unlock cookie behind a cached "locked" page: reveal it.
                        markUnlocked();
                        var gate = document.querySelector('[data-oe-gt-gate]');
                        if (gate) { showUnlockedGate(gate); }
                    }
                    applyState();
                }
            }).catch(function () { /* leave the page as-is */ });
    }

    function myBookingsFor(location) {
        return (mine.mine || []).filter(function (b) { return String(b.location) === String(location); });
    }

    function partyLabel(b) {
        return b.party > 1 ? (b.party + ' ' + t('people')) : t('1 person');
    }

    // Repaint every slots panel from the latest state.
    function applyState() {
        document.querySelectorAll('[data-oe-gt-slots]').forEach(function (panel) {
            var location = panel.getAttribute('data-oe-gt-slots');
            var bookings = myBookingsFor(location);

            // 1. Clear any previous "yours" marks so a cancel/move repaints cleanly.
            panel.querySelectorAll('.oe-gt-pill.is-mine').forEach(function (p) {
                p.classList.remove('is-mine');
                p.removeAttribute('data-mine-status');
            });

            // 2. Mark each booked pill and list the bookings with Change / Cancel.
            var box = panel.querySelector('[data-oe-gt-mine]');
            if (box) { box.innerHTML = ''; }
            bookings.forEach(function (b) {
                var pill = panel.querySelector('[data-oe-gt-pill][data-slot="' + b.slot + '"]');
                var waiting = b.status === 'waitlist';
                if (pill) {
                    pill.classList.add('is-mine', 'is-done');
                    pill.setAttribute('data-full', '1');
                    pill.setAttribute('data-mine-status', b.status);
                    var count = pill.querySelector('.oe-gt-pill__count');
                    if (count) { count.textContent = waiting ? t('Waitlisted (yours)') : t('Reserved (yours)'); }
                }
                if (box) { box.appendChild(bookingRow(panel, location, b)); }
            });
            if (box) { box.hidden = bookings.length === 0; }

            // 3. Cap the reserve controls by the remaining seat allowance.
            refreshPartyOptions(panel);
            var msg = panel.querySelector('[data-oe-gt-msg]');
            if (unlocked && mine.remaining <= 0 && !panel._changing) {
                var reserveBtn = panel.querySelector('[data-oe-gt-reserve]');
                if (reserveBtn) { reserveBtn.disabled = true; reserveBtn.textContent = t('Select a time'); }
                if (msg) { msg.textContent = t('All your ticket seats are booked. Cancel one below to move it.'); }
                clearSelection(panel);
            } else if (unlocked && msg && !panel._changing) {
                msg.textContent = t('Pick a time, then reserve.');
            }
        });
    }

    function bookingRow(panel, location, b) {
        var row = document.createElement('div');
        row.className = 'oe-gt-mine__item';
        var label = document.createElement('span');
        label.className = 'oe-gt-mine__label';
        var status = b.status === 'waitlist' ? t('Waitlisted') : t('Booked');
        label.textContent = status + ': ' + (b.when || '') + ' · ' + partyLabel(b);
        row.appendChild(label);

        var change = document.createElement('button');
        change.type = 'button';
        change.className = 'oe-gt-mine__change';
        change.textContent = t('Change time');
        change.addEventListener('click', function () { startChange(panel, b); });
        row.appendChild(change);

        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'oe-gt-mine__cancel';
        cancel.textContent = t('Cancel');
        cancel.addEventListener('click', function () { doCancel(b); });
        row.appendChild(cancel);
        return row;
    }

    /* ---- party-size selector ---- */
    // Options run 1..(remaining + this booking's own seats when moving).
    function refreshPartyOptions(panel) {
        var wrap = panel.querySelector('[data-oe-gt-party-wrap]');
        var sel = panel.querySelector('[data-oe-gt-party]');
        if (!wrap || !sel) { return; }
        if (panel._changing) { wrap.hidden = true; return; } // party is fixed on a move
        var max = mine.remaining || 0;
        if (!unlocked || max <= 1) { wrap.hidden = true; return; }
        var prev = parseInt(sel.value, 10) || 1;
        sel.innerHTML = '';
        for (var i = 1; i <= max; i++) {
            var o = document.createElement('option');
            o.value = String(i);
            o.textContent = String(i);
            sel.appendChild(o);
        }
        sel.value = String(Math.min(prev, max));
        // Only shown once a slot is picked (handled in the click handler).
    }

    function selectedParty(panel) {
        var sel = panel.querySelector('[data-oe-gt-party]');
        var v = sel ? parseInt(sel.value, 10) : 1;
        return v > 0 ? v : 1;
    }

    /* ---- slots ---- */
    function clearSelection(panel) {
        panel.querySelectorAll('.is-selected').forEach(function (p) { p.classList.remove('is-selected'); });
        panel._selected = null;
        var wrap = panel.querySelector('[data-oe-gt-party-wrap]');
        if (wrap && !panel._changing) { wrap.hidden = true; }
    }

    function initSlots() {
        document.querySelectorAll('[data-oe-gt-slots]').forEach(function (panel) {
            var location = panel.getAttribute('data-oe-gt-slots');
            var reserveBtn = panel.querySelector('[data-oe-gt-reserve]');

            panel.addEventListener('click', function (e) {
                var pill = e.target.closest('[data-oe-gt-pill]');
                if (pill && !pill.classList.contains('is-mine') && !pill.hasAttribute('data-full') && !pill.classList.contains('is-done')) {
                    if (!unlocked) {
                        var m = panel.querySelector('[data-oe-gt-msg]');
                        if (m) { m.textContent = t('Enter your ticket email above to reserve.'); }
                        return;
                    }
                    if (mine.remaining <= 0 && !panel._changing) { return; }
                    panel.querySelectorAll('.is-selected').forEach(function (p) { p.classList.remove('is-selected'); });
                    pill.classList.add('is-selected');
                    panel._selected = pill;
                    var wrap = panel.querySelector('[data-oe-gt-party-wrap]');
                    if (wrap && !panel._changing && (mine.remaining || 0) > 1) { wrap.hidden = false; }
                    if (reserveBtn) {
                        reserveBtn.disabled = false;
                        var time = pill.querySelector('.oe-gt-pill__time').textContent;
                        reserveBtn.textContent = (panel._changing ? t('Move to ') : t('Reserve ')) + time;
                    }
                    return;
                }
                if (e.target.closest('[data-oe-gt-reserve]') && reserveBtn && !reserveBtn.disabled && panel._selected) {
                    submitSlot(panel, location, panel._selected, reserveBtn);
                }
            });
        });
    }

    function startChange(panel, booking) {
        panel._changing = booking.id;
        clearSelection(panel);
        var reserveBtn = panel.querySelector('[data-oe-gt-reserve]');
        if (reserveBtn) { reserveBtn.disabled = true; reserveBtn.textContent = t('Select a time'); }
        var wrap = panel.querySelector('[data-oe-gt-party-wrap]');
        if (wrap) { wrap.hidden = true; }
        var msg = panel.querySelector('[data-oe-gt-msg]');
        if (msg) { msg.textContent = t('Pick a new time, then Reserve to move your booking.'); }
        // Let them re-pick the slot they're moving.
        var current = panel.querySelector('[data-oe-gt-pill][data-slot="' + booking.slot + '"]');
        if (current) { current.classList.remove('is-mine', 'is-done'); current.removeAttribute('data-full'); }
    }

    function submitSlot(panel, location, pill, btn) {
        btn.disabled = true;
        var slot = pill.getAttribute('data-slot');
        if (panel._changing) {
            var id = panel._changing;
            post('change', { id: id, location: location, slot: slot, tour: CFG.tour }).then(function (res) {
                panel._changing = null;
                if (res && res.ok) {
                    if (res.state) { mine = res.state; }
                    clearSelection(panel);
                    applyState();
                    flash(panel, t('Booking moved. Check your email.'));
                } else {
                    handleError(panel, btn, res);
                }
            }).catch(function () { panel._changing = null; btn.disabled = false; btn.textContent = t('Try again'); });
            return;
        }
        var party = selectedParty(panel);
        post('reserve', { location: location, slot: slot, tour: CFG.tour, name: buyerName, party: party }).then(function (res) {
            if (res && res.ok) {
                if (res.state) { mine = res.state; }
                clearSelection(panel);
                applyState();
                flash(panel, res.status === 'waitlist' ? t('Added to the waitlist — check your email.') : t('Reserved — check your email.'));
            } else {
                handleError(panel, btn, res);
            }
        }).catch(function () { btn.disabled = false; btn.textContent = t('Try again'); });
    }

    function doCancel(booking) {
        if (!window.confirm(t('Cancel this booking?'))) { return; }
        post('cancel', { id: booking.id, tour: CFG.tour }).then(function (res) {
            if (res && res.state) { mine = res.state; }
            applyState();
        }).catch(function () { /* no-op */ });
    }

    function handleError(panel, btn, res) {
        if (res && res.state) { mine = res.state; applyState(); }
        btn.disabled = false;
        btn.textContent = t('Try again');
        var msg = panel.querySelector('[data-oe-gt-msg]');
        if (msg && res && res.error) { msg.textContent = res.error; }
    }

    function flash(panel, text) {
        var msg = panel.querySelector('[data-oe-gt-msg]');
        if (msg) { msg.textContent = text; }
        var btn = panel.querySelector('[data-oe-gt-reserve]');
        if (btn) { btn.disabled = true; btn.textContent = t('Select a time'); }
    }

    function ready(fn) {
        if (document.readyState !== 'loading') { fn(); }
        else { document.addEventListener('DOMContentLoaded', fn); }
    }
    ready(function () {
        initGate();
        initSlots();
        // Reflect an existing unlock (valid cookie) even on a cached page.
        loadState();
    });
})();
