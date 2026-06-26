/**
 * October Events — event checkout (Stripe only).
 *
 * Renders ticket types, quantity, promo + summary, and drives the Stripe
 * PaymentIntent flow against the oe/v1 ticket endpoints.
 */
(function () {
    'use strict';

    var cfg = window.OE_CHECKOUT || {};
    var root = document.getElementById('oe-checkout');
    if (!root || !cfg.types) { return; }

    var state = { typeKey: null, qty: 1, discount: 0, promo: '' };
    var stripe = null, card = null;

    function money(n) { return cfg.symbol + Number(n || 0).toFixed(2); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function api(path, body) {
        return fetch(cfg.restUrl + path, {
            method: 'POST',
            headers: { 'X-WP-Nonce': cfg.nonce, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); });
    }
    function selectedType() {
        return cfg.types.filter(function (t) { return t.key === state.typeKey; })[0] || null;
    }

    /* ---- Render type chooser ---- */
    function renderTypes() {
        var box = document.getElementById('oe-co-types');
        box.innerHTML = cfg.types.map(function (t) {
            // Sold-out types stay selectable so the buyer can join the waitlist;
            // other unavailable states (coming soon / closed) are disabled.
            var soldout = t.state === 'sold_out';
            var disabled = (t.state !== 'available' && !soldout);
            var note = soldout ? 'Sold out · join the waitlist'
                : t.state === 'coming_soon' ? 'Coming soon'
                : t.state === 'sale_ended' ? 'Sales closed'
                : t.state === 'unavailable' ? 'Unavailable' : '';
            var price = (t.sale_price != null && t.sale_price < t.price)
                ? '<s>' + money(t.price) + '</s> ' + money(t.effective)
                : money(t.effective);
            var admits = t.admits > 1 ? ' <span class="oe-co-admits">Admits ' + t.admits + '</span>' : '';
            return '<label class="oe-co-type' + (disabled ? ' is-disabled' : '') + (soldout ? ' is-soldout' : '') + '">' +
                '<input type="radio" name="oe-co-type" value="' + esc(t.key) + '"' + (disabled ? ' disabled' : '') + '>' +
                '<span class="oe-co-type-main"><strong>' + esc(t.label) + '</strong>' + admits +
                (t.desc ? '<br><span class="oe-co-desc">' + esc(t.desc) + '</span>' : '') + '</span>' +
                '<span class="oe-co-type-price">' + price + (note ? '<br><em>' + note + '</em>' : '') + '</span></label>';
        }).join('');

        box.querySelectorAll('input[name="oe-co-type"]').forEach(function (r) {
            r.addEventListener('change', function () { state.typeKey = r.value; resetPromo(); updateSummary(); });
        });
        var first = cfg.types.filter(function (t) { return t.state === 'available'; })[0]
            || cfg.types.filter(function (t) { return t.state === 'sold_out'; })[0];
        if (first) {
            state.typeKey = first.key;
            var input = box.querySelector('input[value="' + first.key + '"]');
            if (input) { input.checked = true; }
        }
    }

    function resetPromo() {
        state.discount = 0; state.promo = '';
        document.getElementById('oe-co-promo').value = '';
        var m = document.getElementById('oe-co-promo-msg');
        m.textContent = ''; m.className = '';
    }

    function setQty(n) {
        state.qty = Math.max(1, Math.min(10, n || 1));
        document.getElementById('oe-co-qty').value = state.qty;
        resetPromo(); updateSummary();
    }

    function updateSummary() {
        var t = selectedType();
        var sum = document.getElementById('oe-co-summary');
        var wl = document.getElementById('oe-co-waitlist');
        var form = document.getElementById('oe-co-form');
        // Sold out → swap the buy flow for the waitlist join form.
        if (t && t.state === 'sold_out') {
            if (wl) { wl.hidden = false; }
            if (form) { form.style.display = 'none'; }
            sum.style.display = 'none';
            return;
        }
        if (wl) { wl.hidden = true; }
        if (form) { form.style.display = ''; }
        sum.style.display = '';
        if (!t) { sum.innerHTML = ''; return; }
        var subtotal = t.effective * state.qty;
        var total = Math.max(0, subtotal - state.discount);
        sum.innerHTML =
            '<div class="oe-co-line"><span>' + esc(t.label) + ' × ' + state.qty + '</span><span>' + money(subtotal) + '</span></div>' +
            (state.discount ? '<div class="oe-co-line"><span>Discount</span><span>−' + money(state.discount) + '</span></div>' : '') +
            '<div class="oe-co-line oe-co-total"><span>Total</span><span>' + money(total) + '</span></div>';
        document.getElementById('oe-co-pay').textContent = total > 0 ? 'Pay ' + money(total) : 'Get tickets';
        ensureStripe(total > 0);
    }

    function ensureStripe(show) {
        var pay = document.getElementById('oe-co-payment');
        pay.style.display = show ? '' : 'none';
        if (show && !stripe && cfg.stripeKey && window.Stripe) {
            stripe = window.Stripe(cfg.stripeKey);
            card = stripe.elements().create('card');
            card.mount('#oe-co-card');
        }
    }

    /* ---- Promo ---- */
    document.getElementById('oe-co-promo-apply').addEventListener('click', function () {
        var code = document.getElementById('oe-co-promo').value.trim();
        var msg = document.getElementById('oe-co-promo-msg');
        if (!code || !state.typeKey) { return; }
        msg.textContent = '…';
        api('/ticket-promo', { event_id: cfg.eventId, type_key: state.typeKey, qty: state.qty, promo_code: code })
            .then(function (res) {
                if (!res.ok) { state.discount = 0; state.promo = ''; msg.textContent = res.body.error || 'Invalid code'; msg.className = 'is-err'; }
                else { state.discount = res.body.discount; state.promo = code; msg.textContent = 'Code applied.'; msg.className = 'is-ok'; }
                updateSummary();
            });
    });

    /* ---- Waitlist (shown when the selected type is sold out) ---- */
    var wlJoin = document.getElementById('oe-co-wl-join');
    if (wlJoin) {
        wlJoin.addEventListener('click', function () {
            var email = document.getElementById('oe-co-wl-email').value.trim();
            var name = document.getElementById('oe-co-wl-name').value.trim();
            var msg = document.getElementById('oe-co-wl-msg');
            if (!email) { msg.textContent = 'Enter your email.'; return; }
            if (!state.typeKey) { return; }
            wlJoin.disabled = true; msg.textContent = 'Adding you…';
            api('/waitlist-join', { event_id: cfg.eventId, type_key: state.typeKey, email: email, name: name })
                .then(function (res) {
                    if (!res.ok) { msg.textContent = res.body.error || 'Could not join.'; wlJoin.disabled = false; return; }
                    document.getElementById('oe-co-waitlist').innerHTML =
                        '<h3>You’re on the list</h3><p>We’ll email you if a spot opens up.</p>';
                });
        });
    }

    document.getElementById('oe-co-qty').addEventListener('change', function (e) {
        setQty(parseInt(e.target.value, 10));
    });
    document.getElementById('oe-co-qty-minus').addEventListener('click', function () { setQty(state.qty - 1); });
    document.getElementById('oe-co-qty-plus').addEventListener('click', function () { setQty(state.qty + 1); });

    /* ---- Submit ---- */
    document.getElementById('oe-co-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var form = e.target;
        var out = document.getElementById('oe-co-result');
        var pay = document.getElementById('oe-co-pay');
        if (!state.typeKey) { out.textContent = 'Choose a ticket type.'; return; }
        pay.disabled = true; out.textContent = 'Processing…';

        var payload = {
            event_id: cfg.eventId, type_key: state.typeKey, qty: state.qty,
            promo_code: state.promo, name: form.name.value, email: form.email.value
        };

        api('/ticket-intent', payload).then(function (res) {
            if (!res.ok) { out.textContent = res.body.error || 'Error'; pay.disabled = false; return; }
            if (res.body.free) { return success(res.body.tickets); }

            return stripe.confirmCardPayment(res.body.client_secret, {
                payment_method: { card: card, billing_details: { name: form.name.value, email: form.email.value } }
            }).then(function (result) {
                if (result.error) {
                    document.getElementById('oe-co-card-errors').textContent = result.error.message;
                    out.textContent = ''; pay.disabled = false; return;
                }
                payload.intent_id = res.body.intent_id;
                return api('/ticket-confirm', payload).then(function (c) {
                    if (!c.ok) { out.textContent = c.body.error || 'Error'; pay.disabled = false; return; }
                    success(c.body.tickets);
                });
            });
        });
    });

    function success(tickets) {
        document.getElementById('oe-co-form').style.display = 'none';
        document.getElementById('oe-co-summary').style.display = 'none';
        var ok = document.getElementById('oe-co-success');
        ok.hidden = false;
        document.getElementById('oe-co-tickets').innerHTML = (tickets || []).map(function (t) {
            return '<li><a href="' + esc(t.url) + '" target="_blank" rel="noopener">Ticket ' + t.number + ' — view / print</a></li>';
        }).join('');
    }

    renderTypes();
    updateSummary();
})();
