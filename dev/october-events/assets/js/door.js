/**
 * October Events — fast door-sale checkout.
 *
 * A walk-up scans the "Sell" QR on the tablet and lands here. They pick a ticket
 * and quantity, enter an email, optionally add a promo, and pay. Payment is a
 * hosted Stripe Checkout Session (Apple Pay / Google Pay native), so this page
 * just prices the cart and redirects. The ticket is emailed by the webhook.
 */
(function () {
    'use strict';

    var cfg = window.OE_DOOR || {};
    var root = document.getElementById('oe-door');
    if (!root) { return; }

    var sym = cfg.symbol || '$';

    function money(n) { return sym + (Math.round(n * 100) / 100).toFixed(2); }
    function qs(name) {
        var m = new RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search);
        return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
    }

    /* ---- Result overlay (returning from Stripe) ---- */
    function showResult(kind) {
        var o = document.getElementById('oe-door-result');
        if (!o) { return; }
        var inner = o.querySelector('.door-result-inner');
        if (kind === 'paid') {
            o.className = 'door-result is-ok';
            inner.innerHTML =
                '<div class="door-result-icon">✓</div>' +
                '<h2>You\'re in</h2>' +
                '<p>Your ticket is on its way by email. Show its QR code at any stop.</p>' +
                '<button type="button" class="door-again" id="oe-door-again">Sell another</button>';
        } else {
            o.className = 'door-result is-cancel';
            inner.innerHTML =
                '<div class="door-result-icon">↩</div>' +
                '<h2>Payment cancelled</h2>' +
                '<p>Nothing was charged.</p>' +
                '<button type="button" class="door-again" id="oe-door-again">Try again</button>';
        }
        o.hidden = false;
        var again = document.getElementById('oe-door-again');
        if (again) {
            again.addEventListener('click', function () {
                // Drop the result markers and reload a clean buy page.
                window.location = cfg.returnUrl || window.location.pathname;
            });
        }
    }

    if (qs('oe_paid')) { showResult('paid'); return; }
    if (qs('oe_cancelled')) { showResult('cancel'); }

    /* ---- Buy flow ---- */
    var buy = document.getElementById('oe-door-buy');
    if (!buy) { return; }

    var totalEl = document.getElementById('oe-door-total');
    var payBtn  = document.getElementById('oe-door-pay');
    var emailEl = document.getElementById('oe-door-email');
    var promoEl = document.getElementById('oe-door-promo');
    var msgEl   = document.getElementById('oe-door-msg');
    var promoApplyBtn = document.getElementById('oe-door-promo-apply');
    var promoMsgEl    = document.getElementById('oe-door-promo-msg');

    // Applied promo preview. The code is always re-priced server-side at Pay, so
    // this only drives the on-screen total + confirmation.
    var appliedDiscount = 0;

    function emailOk() { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((emailEl.value || '').trim()); }

    function cart() {
        var out = [];
        root.querySelectorAll('.door-type').forEach(function (row) {
            var q = parseInt(row.querySelector('.door-qty').textContent, 10) || 0;
            if (q > 0) { out.push({ type_key: row.dataset.key, qty: q }); }
        });
        return out;
    }
    function subtotal() {
        var t = 0;
        root.querySelectorAll('.door-type').forEach(function (row) {
            var q = parseInt(row.querySelector('.door-qty').textContent, 10) || 0;
            t += q * parseFloat(row.dataset.price || '0');
        });
        return t;
    }
    function refresh() {
        var items = cart();
        var total = Math.max(0, subtotal() - appliedDiscount);
        totalEl.textContent = money(total);
        payBtn.disabled = !(items.length && emailOk() && cfg.ready);
    }

    function setPromoMsg(text, kind) {
        if (!promoMsgEl) { return; }
        promoMsgEl.textContent = text || '';
        promoMsgEl.className = 'door-promo-msg' + (kind ? ' is-' + kind : '');
    }
    // A cart change invalidates any applied discount — clear it so the total is
    // honest until they re-apply. (Pay re-prices regardless.)
    function clearPromo() {
        if (appliedDiscount > 0) {
            appliedDiscount = 0;
            setPromoMsg('Cart changed — tap Apply to reprice.', '');
        }
    }

    root.querySelectorAll('.door-type').forEach(function (row) {
        var qtyEl = row.querySelector('.door-qty');
        var max = parseInt(row.dataset.max, 10) || 99;
        row.querySelector('.door-plus').addEventListener('click', function () {
            var q = parseInt(qtyEl.textContent, 10) || 0;
            if (q < max) { qtyEl.textContent = q + 1; }
            row.classList.toggle('is-picked', (parseInt(qtyEl.textContent, 10) || 0) > 0);
            clearPromo(); refresh();
        });
        row.querySelector('.door-minus').addEventListener('click', function () {
            var q = parseInt(qtyEl.textContent, 10) || 0;
            if (q > 0) { qtyEl.textContent = q - 1; }
            row.classList.toggle('is-picked', (parseInt(qtyEl.textContent, 10) || 0) > 0);
            clearPromo(); refresh();
        });
    });
    emailEl.addEventListener('input', refresh);

    /* ---- Promo: validate + preview the discount ---- */
    if (promoApplyBtn) {
        promoApplyBtn.addEventListener('click', function () {
            var code = promoEl ? (promoEl.value || '').trim() : '';
            var items = cart();
            if (!code) { setPromoMsg('Enter a code first.', 'bad'); return; }
            if (!items.length) { setPromoMsg('Choose a ticket first.', 'bad'); return; }
            promoApplyBtn.disabled = true;
            setPromoMsg('Checking…', '');
            fetch(cfg.restUrl + '/ticket-promo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event_id: cfg.eventId,
                    cart: items,
                    promo_code: code,
                    email: (emailEl.value || '').trim()
                })
            }).then(function (r) {
                return r.json().then(function (b) { return { ok: r.ok, body: b }; });
            }).then(function (res) {
                promoApplyBtn.disabled = false;
                if (res.ok && res.body && typeof res.body.discount !== 'undefined') {
                    appliedDiscount = parseFloat(res.body.discount) || 0;
                    if (appliedDiscount > 0) {
                        setPromoMsg(code.toUpperCase() + ' applied — you save ' + money(appliedDiscount) + '.', 'ok');
                    } else {
                        setPromoMsg('Code accepted. No discount on this cart.', 'ok');
                    }
                } else {
                    appliedDiscount = 0;
                    setPromoMsg((res.body && res.body.error) ? res.body.error : 'That code isn\'t valid.', 'bad');
                }
                refresh();
            }).catch(function () {
                promoApplyBtn.disabled = false;
                setPromoMsg('Network problem. Try again.', 'bad');
            });
        });
    }
    // Editing the code clears a stale applied discount.
    if (promoEl) { promoEl.addEventListener('input', function () { clearPromo(); refresh(); }); }

    payBtn.addEventListener('click', function () {
        var items = cart();
        if (!items.length || !emailOk()) { return; }
        msgEl.textContent = '';
        payBtn.disabled = true;
        payBtn.classList.add('is-busy');
        payBtn.textContent = 'Starting…';

        fetch(cfg.restUrl + '/door-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event_id: cfg.eventId,
                cart: items,
                email: (emailEl.value || '').trim(),
                promo_code: promoEl ? (promoEl.value || '').trim() : '',
                door: cfg.venue || '',
                return_url: cfg.returnUrl || window.location.href
            })
        }).then(function (r) {
            return r.json().then(function (b) { return { ok: r.ok, body: b }; });
        }).then(function (res) {
            if (res.ok && res.body && res.body.url) {
                window.location = res.body.url; // hand off to Stripe (wallets appear here)
                return;
            }
            if (res.ok && res.body && res.body.free) {
                showResult('paid'); // fully-discounted cart — ticket already emailed
                return;
            }
            fail(res.body && res.body.message ? res.body.message : mapError(res.body && res.body.error));
        }).catch(function () {
            fail('Network problem. Check the connection and try again.');
        });
    });

    function mapError(code) {
        var m = {
            email_required: 'Please enter an email for the ticket.',
            oe_empty_cart: 'Please choose at least one ticket.',
            oe_bad_type: 'That ticket is not available.',
            oe_unavailable: 'Those tickets are no longer on sale.',
            payments_unavailable: 'Card payments are not set up on this site yet.',
            not_enabled: 'Ticketing is off for this site.',
            session_failed: 'Could not start the payment. Please try again.'
        };
        return m[code] || 'Something went wrong. Please try again.';
    }
    function fail(text) {
        msgEl.textContent = text;
        payBtn.classList.remove('is-busy');
        payBtn.textContent = 'Pay';
        refresh();
    }

    refresh();
})();
