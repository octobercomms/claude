/**
 * October Events — fast door-sale checkout.
 *
 * A walk-up scans the QR and lands here. They pick a ticket and quantity; the
 * Stripe Payment Element (card + Apple Pay / Google Pay / Link) appears inline
 * right under the tickets, and one Pay button charges it. Deferred PaymentIntent:
 * the element mounts with the running total and the intent is created on Pay. The
 * order + emailed ticket are issued by the payment webhook (and /ticket-confirm).
 * Without a publishable key it falls back to a hosted Stripe Checkout redirect.
 * `?poster=1` renders a printable poster instead (handled up top).
 */
(function () {
    'use strict';

    var cfg = window.OE_DOOR || {};
    var root = document.getElementById('oe-door');
    if (!root) { return; }

    // Poster mode: render a big QR to the buy URL and stop.
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

    if (qs('oe_paid') || qs('redirect_status') === 'succeeded') { showResult('paid'); return; }
    if (qs('oe_cancelled')) { showResult('cancel'); }
    else if (qs('redirect_status')) { showResult('cancel'); }

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

    var appliedDiscount = 0;   // from the promo preview
    var appliedCode = '';      // the code that discount belongs to (sent at Pay)
    var stripe = null, elements = null, mounted = false, paying = false;

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
    function totalCents() { return Math.max(0, Math.round((subtotal() - appliedDiscount) * 100)); }

    function refresh() {
        var items = cart();
        var cents = totalCents();
        totalEl.textContent = money(cents / 100);
        payBtn.textContent = cents > 0 ? 'Pay ' + money(cents / 100) : 'Get ticket';
        payBtn.disabled = paying || !(items.length && emailOk() && cfg.ready);
        syncPayment(cents, items.length);
    }

    // Mount / update the inline Payment Element to match the running total. Only
    // for the inline flow and only once there's a chargeable amount.
    function syncPayment(cents, hasItems) {
        if (!inline || !payPhaseEl) { return; }
        if (cents >= 50) {
            payPhaseEl.hidden = false;
            try {
                if (!stripe) { stripe = window.Stripe(cfg.publishable); }
                if (!elements) {
                    var appearance = { theme: 'stripe' };
                    try {
                        var accent = getComputedStyle(payBtn).backgroundColor;
                        if (accent) { appearance.variables = { colorPrimary: accent, borderRadius: '10px' }; }
                    } catch (e) {}
                    elements = stripe.elements({ mode: 'payment', amount: cents, currency: (cfg.currency || 'usd').toLowerCase(), appearance: appearance });
                    elements.create('payment', { layout: 'tabs' }).mount('#oe-door-payment-element');
                    mounted = true;
                } else {
                    elements.update({ amount: cents });
                }
            } catch (e) { /* leave hidden; Pay still works via a fresh intent */ }
        } else {
            // Nothing to charge by card (empty cart, or a fully-discounted $0 cart).
            payPhaseEl.hidden = true;
        }
    }

    function setPromoMsg(text, kind) {
        if (!promoMsgEl) { return; }
        promoMsgEl.textContent = text || '';
        promoMsgEl.className = 'door-promo-msg' + (kind ? ' is-' + kind : '');
    }
    function clearPromo() {
        if (appliedDiscount > 0 || appliedCode) {
            appliedDiscount = 0; appliedCode = '';
            setPromoMsg('Cart changed — tap Apply to reprice.', '');
        }
    }

    root.querySelectorAll('.door-type').forEach(function (row) {
        var qtyEl = row.querySelector('.door-qty');
        var max = parseInt(row.dataset.max, 10) || 99;
        function step(delta) {
            var q = parseInt(qtyEl.textContent, 10) || 0;
            q = Math.min(max, Math.max(0, q + delta));
            qtyEl.textContent = q;
            row.classList.toggle('is-picked', q > 0);
            clearPromo(); refresh();
        }
        row.querySelector('.door-plus').addEventListener('click', function () { step(1); });
        row.querySelector('.door-minus').addEventListener('click', function () { step(-1); });
    });
    emailEl.addEventListener('input', refresh);

    /* ---- Promo ---- */
    // Validate a code against the cart; resolves to the discount (0 if none/invalid).
    function applyPromo() {
        var code = promoEl ? (promoEl.value || '').trim() : '';
        var items = cart();
        if (!code) { setPromoMsg('Enter a code first.', 'bad'); return Promise.resolve(false); }
        if (!items.length) { setPromoMsg('Choose a ticket first.', 'bad'); return Promise.resolve(false); }
        if (promoApplyBtn) { promoApplyBtn.disabled = true; }
        setPromoMsg('Checking…', '');
        return fetch(cfg.restUrl + '/ticket-promo', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event_id: cfg.eventId, cart: items, promo_code: code, email: (emailEl.value || '').trim() })
        }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
          .then(function (res) {
            if (promoApplyBtn) { promoApplyBtn.disabled = false; }
            if (res.ok && res.body && typeof res.body.discount !== 'undefined') {
                appliedDiscount = parseFloat(res.body.discount) || 0;
                appliedCode = code;
                setPromoMsg(appliedDiscount > 0
                    ? code.toUpperCase() + ' applied — you save ' + money(appliedDiscount) + '.'
                    : 'Code accepted. No discount on this cart.', 'ok');
                refresh();
                return true;
            }
            appliedDiscount = 0; appliedCode = '';
            setPromoMsg((res.body && res.body.error) ? res.body.error : 'That code isn\'t valid.', 'bad');
            refresh();
            return false;
        }).catch(function () {
            if (promoApplyBtn) { promoApplyBtn.disabled = false; }
            setPromoMsg('Network problem. Try again.', 'bad');
            return false;
        });
    }
    if (promoApplyBtn) { promoApplyBtn.addEventListener('click', function () { applyPromo(); }); }
    if (promoEl) { promoEl.addEventListener('input', function () { clearPromo(); refresh(); }); }

    /* ---- Pay ---- */
    payBtn.addEventListener('click', function () {
        if (paying) { return; }
        var items = cart();
        if (!items.length || !emailOk()) { return; }

        // A typed-but-unapplied code: apply it first so the amount is right.
        var typed = promoEl ? (promoEl.value || '').trim().toUpperCase() : '';
        if (typed && typed !== appliedCode.toUpperCase()) {
            applyPromo().then(function () { pay(); });
            return;
        }
        pay();
    });

    function busy(on, label) {
        paying = on;
        payBtn.disabled = on;
        payBtn.classList.toggle('is-busy', on);
        if (label) { payBtn.textContent = label; }
    }

    function pay() {
        msgEl.textContent = '';
        if (payErrEl) { payErrEl.textContent = ''; }

        var body = {
            event_id: cfg.eventId,
            cart: cart(),
            email: (emailEl.value || '').trim(),
            promo_code: appliedCode,
            door: cfg.venue || '',
            return_url: cfg.returnUrl || window.location.href
        };

        // Hosted fallback (no inline payments): redirect to Stripe Checkout.
        if (!inline) {
            busy(true, 'Starting…');
            fetch(cfg.restUrl + '/door-session', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            }).then(readJson).then(function (res) {
                if (res.ok && res.body && res.body.url) { window.location = res.body.url; return; }
                if (res.ok && res.body && res.body.free) { showResult('paid'); return; }
                fail(pickError(res.body));
            }).catch(function () { fail('Network problem. Check the connection and try again.'); });
            return;
        }

        var cents = totalCents();
        busy(true, 'Paying…');

        // Fully-discounted / free cart: no card step.
        if (cents < 50) {
            fetch(cfg.restUrl + '/door-intent', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            }).then(readJson).then(function (res) {
                if (res.ok && res.body && res.body.free) { showResult('paid'); return; }
                fail(pickError(res.body));
            }).catch(function () { fail('Network problem. Check the connection and try again.'); });
            return;
        }

        // Deferred flow: validate the element, create the intent, then confirm.
        elements.submit().then(function (sub) {
            if (sub && sub.error) { return payFail(sub.error.message); }
            return fetch(cfg.restUrl + '/door-intent', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            }).then(readJson).then(function (res) {
                if (res.ok && res.body && res.body.free) { showResult('paid'); return; }
                if (!res.ok || !res.body || !res.body.client_secret) { return payFail(pickError(res.body)); }
                var intentId = res.body.intent_id || '';
                return stripe.confirmPayment({
                    elements: elements,
                    clientSecret: res.body.client_secret,
                    confirmParams: { return_url: cfg.returnUrl || window.location.href },
                    redirect: 'if_required'
                }).then(function (result) {
                    if (result.error) { return payFail(result.error.message); }
                    if (intentId) {
                        fetch(cfg.restUrl + '/ticket-confirm', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intent_id: intentId })
                        }).catch(function () {});
                    }
                    showResult('paid');
                });
            });
        }).catch(function () { payFail('Payment failed. Please try again.'); });
    }

    function payFail(text) {
        if (payErrEl) { payErrEl.textContent = text || 'Payment failed. Please try again.'; }
        busy(false);
        refresh();
    }

    function readJson(r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); }
    function pickError(body) { return (body && body.message) ? body.message : mapError(body && body.error); }
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
    function fail(text) { msgEl.textContent = text; busy(false); refresh(); }

    refresh();
})();
