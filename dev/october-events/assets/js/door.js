/**
 * October Events — fast door-sale checkout.
 *
 * A walk-up scans the "Sell" QR on the tablet and lands here. They pick a ticket
 * and quantity, enter an email, optionally add a promo, then pay on-page with the
 * Stripe Payment Element (card + Apple Pay / Google Pay / Link). The order and the
 * emailed ticket are issued by the payment webhook (and /ticket-confirm), the same
 * as every other sale. When no publishable key is configured, the page falls back
 * to a hosted Stripe Checkout redirect.
 */
(function () {
    'use strict';

    var cfg = window.OE_DOOR || {};
    var root = document.getElementById('oe-door');
    if (!root) { return; }

    // Poster mode: render a big QR to the buy URL and stop (nothing to sell here).
    if (cfg.poster) {
        var qrBox = document.getElementById('oe-door-qr');
        if (qrBox && window.QRCode && cfg.buyUrl) {
            new window.QRCode(qrBox, { text: cfg.buyUrl, width: 360, height: 360, correctLevel: window.QRCode.CorrectLevel.M });
        } else if (qrBox) {
            qrBox.textContent = cfg.buyUrl || '';
        }
        return;
    }

    var sym = cfg.symbol || '$';
    // Inline payment is available only with a publishable key + Stripe.js loaded.
    var inline = !!(cfg.publishable && window.Stripe);

    function money(n) { return sym + (Math.round(n * 100) / 100).toFixed(2); }
    function qs(name) {
        var m = new RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search);
        return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
    }

    /* ---- Result overlay ---- */
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
                '<h2>Payment not completed</h2>' +
                '<p>Nothing was charged.</p>' +
                '<button type="button" class="door-again" id="oe-door-again">Try again</button>';
        }
        o.hidden = false;
        var again = document.getElementById('oe-door-again');
        if (again) {
            again.addEventListener('click', function () {
                window.location = cfg.returnUrl || window.location.pathname;
            });
        }
    }

    // Returning from a hosted redirect or a 3DS challenge.
    if (qs('oe_paid') || qs('redirect_status') === 'succeeded') { showResult('paid'); return; }
    if (qs('oe_cancelled')) { showResult('cancel'); }
    else if (qs('redirect_status')) { showResult('cancel'); } // failed / requires_payment_method

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
    var payPhaseEl = document.getElementById('oe-door-pay-phase');
    var payErrEl   = document.getElementById('oe-door-pay-err');
    var backBtn    = document.getElementById('oe-door-back');

    var appliedDiscount = 0;   // promo preview only; the PaymentIntent is authoritative
    var phase = 'select';      // 'select' → pick tickets; 'pay' → Payment Element shown
    var stripe = null, elements = null, intentId = '', payAmount = 0;

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
        if (phase === 'pay') {
            totalEl.textContent = money(payAmount / 100);
            payBtn.textContent = 'Pay ' + money(payAmount / 100);
            payBtn.disabled = false;
            return;
        }
        totalEl.textContent = money(Math.max(0, subtotal() - appliedDiscount));
        payBtn.textContent = 'Continue to payment';
        payBtn.disabled = !(items.length && emailOk() && cfg.ready);
    }

    function setPromoMsg(text, kind) {
        if (!promoMsgEl) { return; }
        promoMsgEl.textContent = text || '';
        promoMsgEl.className = 'door-promo-msg' + (kind ? ' is-' + kind : '');
    }
    function clearPromo() {
        if (appliedDiscount > 0) {
            appliedDiscount = 0;
            setPromoMsg('Cart changed — tap Apply to reprice.', '');
        }
    }

    // Return to the selection step (e.g. after Change order or a cart edit),
    // tearing down any mounted Payment Element so the amount can't go stale.
    function toSelect() {
        phase = 'select';
        if (elements) { try { elements.getElement('payment').unmount(); } catch (e) {} }
        elements = null; intentId = ''; payAmount = 0;
        if (payPhaseEl) { payPhaseEl.hidden = true; }
        if (payErrEl) { payErrEl.textContent = ''; }
        payBtn.classList.remove('is-busy');
        refresh();
    }

    root.querySelectorAll('.door-type').forEach(function (row) {
        var qtyEl = row.querySelector('.door-qty');
        var max = parseInt(row.dataset.max, 10) || 99;
        function step(delta) {
            var q = parseInt(qtyEl.textContent, 10) || 0;
            q = Math.min(max, Math.max(0, q + delta));
            qtyEl.textContent = q;
            row.classList.toggle('is-picked', q > 0);
            if (phase === 'pay') { toSelect(); } else { clearPromo(); refresh(); }
        }
        row.querySelector('.door-plus').addEventListener('click', function () { step(1); });
        row.querySelector('.door-minus').addEventListener('click', function () { step(-1); });
    });
    emailEl.addEventListener('input', function () { if (phase === 'pay') { toSelect(); } else { refresh(); } });

    /* ---- Promo: validate + preview the discount ---- */
    if (promoApplyBtn) {
        promoApplyBtn.addEventListener('click', function () {
            var code = promoEl ? (promoEl.value || '').trim() : '';
            var items = cart();
            if (!code) { setPromoMsg('Enter a code first.', 'bad'); return; }
            if (!items.length) { setPromoMsg('Choose a ticket first.', 'bad'); return; }
            if (phase === 'pay') { toSelect(); }
            promoApplyBtn.disabled = true;
            setPromoMsg('Checking…', '');
            fetch(cfg.restUrl + '/ticket-promo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ event_id: cfg.eventId, cart: items, promo_code: code, email: (emailEl.value || '').trim() })
            }).then(function (r) {
                return r.json().then(function (b) { return { ok: r.ok, body: b }; });
            }).then(function (res) {
                promoApplyBtn.disabled = false;
                if (res.ok && res.body && typeof res.body.discount !== 'undefined') {
                    appliedDiscount = parseFloat(res.body.discount) || 0;
                    setPromoMsg(appliedDiscount > 0
                        ? code.toUpperCase() + ' applied — you save ' + money(appliedDiscount) + '.'
                        : 'Code accepted. No discount on this cart.', 'ok');
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
    if (promoEl) { promoEl.addEventListener('input', function () { if (phase === 'pay') { toSelect(); } clearPromo(); refresh(); }); }

    if (backBtn) { backBtn.addEventListener('click', toSelect); }

    /* ---- Payment ---- */
    payBtn.addEventListener('click', function () {
        if (phase === 'pay') { confirmPayment(); return; }
        startPayment();
    });

    function busy(on, label) {
        payBtn.disabled = on;
        payBtn.classList.toggle('is-busy', on);
        if (label) { payBtn.textContent = label; }
    }

    function startPayment() {
        var items = cart();
        if (!items.length || !emailOk()) { return; }
        msgEl.textContent = '';
        busy(true, 'Starting…');

        var body = {
            event_id: cfg.eventId,
            cart: items,
            email: (emailEl.value || '').trim(),
            promo_code: promoEl ? (promoEl.value || '').trim() : '',
            door: cfg.venue || '',
            return_url: cfg.returnUrl || window.location.href
        };

        // No inline payments available → hosted Stripe Checkout redirect.
        if (!inline) {
            fetch(cfg.restUrl + '/door-session', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            }).then(readJson).then(function (res) {
                if (res.ok && res.body && res.body.url) { window.location = res.body.url; return; }
                if (res.ok && res.body && res.body.free) { showResult('paid'); return; }
                fail(pickError(res.body));
            }).catch(function () { fail('Network problem. Check the connection and try again.'); });
            return;
        }

        // Inline: create the PaymentIntent, then mount the Payment Element.
        fetch(cfg.restUrl + '/door-intent', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        }).then(readJson).then(function (res) {
            if (res.ok && res.body && res.body.free) { showResult('paid'); return; }
            if (!res.ok || !res.body || !res.body.client_secret) { fail(pickError(res.body)); return; }
            intentId  = res.body.intent_id || '';
            payAmount = parseInt(res.body.amount, 10) || 0;
            mountPaymentElement(res.body.client_secret);
        }).catch(function () { fail('Network problem. Check the connection and try again.'); });
    }

    function mountPaymentElement(clientSecret) {
        try {
            if (!stripe) { stripe = window.Stripe(cfg.publishable); }
            var appearance = { theme: 'stripe' };
            try {
                var accent = getComputedStyle(payBtn).backgroundColor;
                if (accent) { appearance.variables = { colorPrimary: accent, borderRadius: '10px' }; }
            } catch (e) {}
            elements = stripe.elements({ clientSecret: clientSecret, appearance: appearance });
            var pe = elements.create('payment', { layout: 'tabs' });
            pe.mount('#oe-door-payment-element');
        } catch (e) {
            fail('Could not start the payment. Please try again.');
            return;
        }
        phase = 'pay';
        if (payPhaseEl) { payPhaseEl.hidden = false; }
        if (payErrEl) { payErrEl.textContent = ''; }
        busy(false);
        refresh();
        if (payPhaseEl && payPhaseEl.scrollIntoView) { payPhaseEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }

    function confirmPayment() {
        if (!stripe || !elements) { return; }
        if (payErrEl) { payErrEl.textContent = ''; }
        busy(true, 'Paying…');
        stripe.confirmPayment({
            elements: elements,
            confirmParams: { return_url: cfg.returnUrl || window.location.href },
            redirect: 'if_required'
        }).then(function (result) {
            if (result.error) {
                if (payErrEl) { payErrEl.textContent = result.error.message || 'Payment failed. Please try again.'; }
                busy(false);
                refresh();
                return;
            }
            // Succeeded without a redirect. The webhook issues + emails the ticket;
            // nudge /ticket-confirm too so it happens immediately.
            if (intentId) {
                fetch(cfg.restUrl + '/ticket-confirm', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intent_id: intentId })
                }).catch(function () {});
            }
            showResult('paid');
        }).catch(function () {
            if (payErrEl) { payErrEl.textContent = 'Payment failed. Please try again.'; }
            busy(false);
            refresh();
        });
    }

    function readJson(r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); }
    function pickError(body) {
        if (body && body.message) { return body.message; }
        return mapError(body && body.error);
    }
    function mapError(code) {
        var m = {
            email_required: 'Please enter an email for the ticket.',
            oe_empty_cart: 'Please choose at least one ticket.',
            oe_bad_type: 'That ticket is not available.',
            oe_unavailable: 'Those tickets are no longer on sale.',
            payments_unavailable: 'Card payments are not set up on this site yet.',
            not_enabled: 'Ticketing is off for this site.',
            payment_init_failed: 'Could not start the payment. Please try again.',
            session_failed: 'Could not start the payment. Please try again.'
        };
        return m[code] || 'Something went wrong. Please try again.';
    }
    function fail(text) {
        msgEl.textContent = text;
        busy(false);
        refresh();
    }

    refresh();
})();
