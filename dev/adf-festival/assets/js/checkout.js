/**
 * ADF Festival — event checkout (Stripe only).
 *
 * Renders ticket types, quantity, promo + summary, and drives the Stripe
 * PaymentIntent flow against the adf/v1 ticket endpoints.
 */
(function () {
    'use strict';

    var cfg = window.ADF_CHECKOUT || {};
    var root = document.getElementById('adf-checkout');
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
        var box = document.getElementById('adf-co-types');
        box.innerHTML = cfg.types.map(function (t) {
            var avail = t.state !== 'available';
            var note = t.state === 'sold_out' ? 'Sold out'
                : t.state === 'coming_soon' ? 'Coming soon'
                : t.state === 'sale_ended' ? 'Sales closed'
                : t.state === 'unavailable' ? 'Unavailable' : '';
            var price = (t.sale_price != null && t.sale_price < t.price)
                ? '<s>' + money(t.price) + '</s> ' + money(t.effective)
                : money(t.effective);
            var admits = t.admits > 1 ? ' <span class="adf-co-admits">Admits ' + t.admits + '</span>' : '';
            return '<label class="adf-co-type' + (avail ? ' is-disabled' : '') + '">' +
                '<input type="radio" name="adf-co-type" value="' + esc(t.key) + '"' + (avail ? ' disabled' : '') + '>' +
                '<span class="adf-co-type-main"><strong>' + esc(t.label) + '</strong>' + admits +
                (t.desc ? '<br><span class="adf-co-desc">' + esc(t.desc) + '</span>' : '') + '</span>' +
                '<span class="adf-co-type-price">' + price + (note ? '<br><em>' + note + '</em>' : '') + '</span></label>';
        }).join('');

        box.querySelectorAll('input[name="adf-co-type"]').forEach(function (r) {
            r.addEventListener('change', function () { state.typeKey = r.value; resetPromo(); updateSummary(); });
        });
        var first = cfg.types.filter(function (t) { return t.state === 'available'; })[0];
        if (first) {
            state.typeKey = first.key;
            var input = box.querySelector('input[value="' + first.key + '"]');
            if (input) { input.checked = true; }
        }
    }

    function resetPromo() {
        state.discount = 0; state.promo = '';
        document.getElementById('adf-co-promo').value = '';
        document.getElementById('adf-co-promo-msg').textContent = '';
    }

    function updateSummary() {
        var t = selectedType();
        var sum = document.getElementById('adf-co-summary');
        if (!t) { sum.innerHTML = ''; return; }
        var subtotal = t.effective * state.qty;
        var total = Math.max(0, subtotal - state.discount);
        sum.innerHTML =
            '<div class="adf-co-line"><span>' + esc(t.label) + ' × ' + state.qty + '</span><span>' + money(subtotal) + '</span></div>' +
            (state.discount ? '<div class="adf-co-line"><span>Discount</span><span>−' + money(state.discount) + '</span></div>' : '') +
            '<div class="adf-co-line adf-co-total"><span>Total</span><span>' + money(total) + '</span></div>';
        document.getElementById('adf-co-pay').textContent = total > 0 ? 'Pay ' + money(total) : 'Get tickets';
        ensureStripe(total > 0);
    }

    function ensureStripe(show) {
        var pay = document.getElementById('adf-co-payment');
        pay.style.display = show ? '' : 'none';
        if (show && !stripe && cfg.stripeKey && window.Stripe) {
            stripe = window.Stripe(cfg.stripeKey);
            card = stripe.elements().create('card');
            card.mount('#adf-co-card');
        }
    }

    /* ---- Promo ---- */
    document.getElementById('adf-co-promo-apply').addEventListener('click', function () {
        var code = document.getElementById('adf-co-promo').value.trim();
        var msg = document.getElementById('adf-co-promo-msg');
        if (!code || !state.typeKey) { return; }
        msg.textContent = '…';
        api('/ticket-promo', { event_id: cfg.eventId, type_key: state.typeKey, qty: state.qty, promo_code: code })
            .then(function (res) {
                if (!res.ok) { state.discount = 0; state.promo = ''; msg.textContent = res.body.error || 'Invalid code'; }
                else { state.discount = res.body.discount; state.promo = code; msg.textContent = 'Code applied.'; }
                updateSummary();
            });
    });

    document.getElementById('adf-co-qty').addEventListener('change', function (e) {
        state.qty = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1));
        e.target.value = state.qty; resetPromo(); updateSummary();
    });

    /* ---- Submit ---- */
    document.getElementById('adf-co-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var form = e.target;
        var out = document.getElementById('adf-co-result');
        var pay = document.getElementById('adf-co-pay');
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
                    document.getElementById('adf-co-card-errors').textContent = result.error.message;
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
        document.getElementById('adf-co-form').style.display = 'none';
        document.getElementById('adf-co-summary').style.display = 'none';
        var ok = document.getElementById('adf-co-success');
        ok.hidden = false;
        document.getElementById('adf-co-tickets').innerHTML = (tickets || []).map(function (t) {
            return '<li><a href="' + esc(t.url) + '" target="_blank" rel="noopener">Ticket ' + t.number + ' — view / print</a></li>';
        }).join('');
    }

    renderTypes();
    updateSummary();
})();
