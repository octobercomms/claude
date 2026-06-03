/**
 * ADF Festival — self-serve ad booking. Package pricing + promo, creative
 * uploads, and the Stripe PaymentIntent flow against /ad-book-intent.
 */
(function () {
    'use strict';

    var cfg = window.ADF_ADBOOK || {};
    var form = document.getElementById('adf-adbook-form');
    if (!form || !cfg.packages) { return; }

    var state = { pct: 0, promo: '' };
    var stripe = null, card = null;

    function money(n) { return cfg.symbol + Number(n || 0).toFixed(2); }
    function pkg() {
        var name = document.getElementById('adf-adbook-package').value;
        return cfg.packages.filter(function (p) { return p.name === name; })[0] || null;
    }

    // Populate packages.
    var sel = document.getElementById('adf-adbook-package');
    sel.innerHTML = cfg.packages.map(function (p) {
        return '<option value="' + p.name + '">' + p.name + ' — ' + p.quantity + ' ' + p.type + ' · ' + money(p.price) + '</option>';
    }).join('');

    function summary() {
        var p = pkg(); if (!p) { return; }
        var sub = Number(p.price);
        var disc = sub * state.pct / 100;
        var total = Math.max(0, sub - disc);
        document.getElementById('adf-adbook-summary').innerHTML =
            '<div class="adf-co-line"><span>' + p.name + '</span><span>' + money(sub) + '</span></div>' +
            (state.pct ? '<div class="adf-co-line"><span>Discount ' + state.pct + '%</span><span>−' + money(disc) + '</span></div>' : '') +
            '<div class="adf-co-line adf-co-total"><span>Total</span><span>' + money(total) + '</span></div>';
        document.getElementById('adf-adbook-pay').textContent = 'Pay ' + money(total);
    }

    sel.addEventListener('change', function () { state.pct = 0; state.promo = ''; document.getElementById('adf-adbook-promo-msg').textContent = ''; summary(); });

    document.getElementById('adf-adbook-promo-apply').addEventListener('click', function () {
        var code = document.getElementById('adf-adbook-promo').value.trim();
        var msg = document.getElementById('adf-adbook-promo-msg');
        if (!code) { return; }
        fetch(cfg.restUrl + '/ad-promo?code=' + encodeURIComponent(code)).then(function (r) { return r.json(); }).then(function (d) {
            if (d.valid) { state.pct = d.pct; state.promo = code; msg.textContent = d.pct + '% applied.'; }
            else { state.pct = 0; state.promo = ''; msg.textContent = 'Invalid code.'; }
            summary();
        });
    });

    if (cfg.stripeKey && window.Stripe) {
        stripe = window.Stripe(cfg.stripeKey);
        card = stripe.elements().create('card');
        card.mount('#adf-adbook-card');
    }

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        var btn = document.getElementById('adf-adbook-pay');
        var out = document.getElementById('adf-adbook-result');
        btn.disabled = true; out.textContent = 'Processing…';

        var fd = new FormData(form); // includes file inputs
        fd.set('promo_code', state.promo);

        fetch(cfg.restUrl + '/ad-book-intent', {
            method: 'POST', headers: { 'X-WP-Nonce': cfg.nonce }, body: fd
        }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
          .then(function (res) {
            if (!res.ok) { out.textContent = res.body.error || 'Error'; btn.disabled = false; return; }
            return stripe.confirmCardPayment(res.body.client_secret, {
                payment_method: { card: card, billing_details: { email: form.email.value } }
            }).then(function (result) {
                if (result.error) {
                    document.getElementById('adf-adbook-card-errors').textContent = result.error.message;
                    out.textContent = ''; btn.disabled = false; return;
                }
                form.querySelectorAll('input,select,button,fieldset').forEach(function (el) { el.style.display = 'none'; });
                out.textContent = '';
                document.getElementById('adf-adbook-summary').style.display = 'none';
                document.getElementById('adf-adbook-success').hidden = false;
            });
        });
    });

    summary();
})();
