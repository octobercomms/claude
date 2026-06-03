/**
 * ADF Festival — account dashboard (§2).
 *
 * Vanilla JS, no framework. Hydrates the shortcode shell against the adf/v1
 * REST API and drives the Stripe.js payment step for paid submissions.
 */
(function () {
    'use strict';

    var cfg = window.ADF_DASH || {};
    var root = document.getElementById('adf-dashboard');
    if (!root) { return; }

    /* ------------------------------------------------------------------ */
    /* REST helpers                                                        */
    /* ------------------------------------------------------------------ */

    function api(path, opts) {
        opts = opts || {};
        opts.headers = Object.assign({ 'X-WP-Nonce': cfg.nonce, 'Content-Type': 'application/json' }, opts.headers || {});
        return fetch(cfg.restUrl + path, opts).then(function (r) {
            return r.json().then(function (body) {
                return { ok: r.ok, status: r.status, body: body };
            });
        });
    }

    function el(html) {
        var d = document.createElement('div');
        d.innerHTML = html.trim();
        return d.firstChild;
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    /* ------------------------------------------------------------------ */
    /* Tabs                                                                */
    /* ------------------------------------------------------------------ */

    var loaded = {};
    root.querySelectorAll('.adf-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
            var name = tab.dataset.tab;
            root.querySelectorAll('.adf-tab').forEach(function (t) { t.classList.toggle('is-active', t === tab); });
            root.querySelectorAll('.adf-panel').forEach(function (p) {
                p.classList.toggle('is-active', p.dataset.panel === name);
            });
            if (!loaded[name]) { loaded[name] = true; load(name); }
        });
    });

    function load(name) {
        if (name === 'overview') { return renderOverview(); }
        if (name === 'listings') { return renderListings(); }
        if (name === 'tickets') { return renderTickets(); }
        if (name === 'invoices') { return renderInvoices(); }
        if (name === 'volunteer') { return renderVolunteer(); }
    }

    /* ------------------------------------------------------------------ */
    /* Panels                                                              */
    /* ------------------------------------------------------------------ */

    function renderOverview() {
        api('/dashboard').then(function (res) {
            if (!res.ok) { return; }
            var d = res.body;
            var cards = document.getElementById('adf-overview-cards');
            cards.innerHTML =
                card('Pending submissions', d.pending_count) +
                card('Tickets', (d.tickets || []).length) +
                card('Volunteer roles', (d.volunteer || []).length) +
                card('Invoices', (d.invoices || []).length);
        });
    }
    function card(label, value) {
        return '<div class="adf-card"><span class="adf-card-num">' + esc(value) + '</span><span class="adf-card-label">' + esc(label) + '</span></div>';
    }

    function renderListings() {
        var filter = document.getElementById('adf-listing-filter');
        var types = cfg.types || {};
        filter.innerHTML = '<button data-type="" class="is-active">All</button>' +
            Object.keys(types).map(function (t) { return '<button data-type="' + t + '">' + esc(types[t].label) + '</button>'; }).join('');
        filter.querySelectorAll('button').forEach(function (b) {
            b.addEventListener('click', function () {
                filter.querySelectorAll('button').forEach(function (x) { x.classList.toggle('is-active', x === b); });
                fetchListings(b.dataset.type);
            });
        });
        fetchListings('');
    }
    function fetchListings(type) {
        var box = document.getElementById('adf-listings');
        box.innerHTML = '<p class="adf-loading">…</p>';
        api('/listings' + (type ? '?type=' + encodeURIComponent(type) : '')).then(function (res) {
            var rows = (res.body || []).map(function (l) {
                var upgrade = (!l.paid && l.status === 'approved')
                    ? '<a class="adf-upgrade" data-id="' + l.id + '">Upgrade</a>' : '';
                return '<tr><td>' + esc(l.title) + '</td><td>' + esc(l.type) + '</td>' +
                    '<td><span class="adf-status adf-status-' + esc(l.status) + '">' + esc(l.status.replace(/_/g, ' ')) + '</span></td>' +
                    '<td>' + esc(l.tier) + '</td><td>' + upgrade + '</td></tr>';
            }).join('');
            box.innerHTML = rows
                ? '<table class="adf-table"><thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Tier</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
                : '<p>No listings yet.</p>';
        });
    }

    function renderTickets() {
        api('/dashboard').then(function (res) {
            var box = document.getElementById('adf-tickets');
            var rows = ((res.body || {}).tickets || []).map(function (t) {
                return '<tr><td>' + esc(t.number) + '</td><td>' + esc(t.event) + '</td>' +
                    '<td>' + (t.checked_in ? 'Checked in' : 'Valid') + '</td>' +
                    '<td><a href="' + esc(t.url) + '" target="_blank" rel="noopener">View / QR</a></td></tr>';
            }).join('');
            box.innerHTML = rows
                ? '<table class="adf-table"><thead><tr><th>Number</th><th>Event</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
                : '<p>No tickets yet.</p>';
        });
    }

    function renderInvoices() {
        api('/dashboard').then(function (res) {
            var box = document.getElementById('adf-invoices');
            var rows = ((res.body || {}).invoices || []).map(function (i) {
                var amt = (i.amount / 100).toFixed(2);
                return '<tr><td>' + esc(i.number) + '</td><td>' + esc(i.listing_name) + '</td>' +
                    '<td>' + esc(amt) + ' ' + esc((i.currency || '').toUpperCase()) + '</td>' +
                    '<td><span class="adf-status adf-status-' + esc(i.status) + '">' + esc(i.status) + '</span></td>' +
                    '<td><a href="?adf_invoice=' + esc(i.listing_id) + '" target="_blank" rel="noopener">PDF</a></td></tr>';
            }).join('');
            box.innerHTML = rows
                ? '<table class="adf-table"><thead><tr><th>#</th><th>Item</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
                : '<p>No invoices yet.</p>';
        });
    }

    function renderVolunteer() {
        api('/dashboard').then(function (res) {
            var box = document.getElementById('adf-volunteer-commitments');
            if (!box) { return; }
            var rows = ((res.body || {}).volunteer || []).map(function (v) {
                return '<li><strong>' + esc(v.opportunity) + '</strong>' + (v.shift ? ' — ' + esc(v.shift) : '') +
                    ' <span class="adf-status adf-status-' + esc(v.status) + '">' + esc(v.status) + '</span></li>';
            }).join('');
            box.innerHTML = rows ? '<ul class="adf-list">' + rows + '</ul>' : '<p>No current commitments.</p>';
        });
    }

    /* ------------------------------------------------------------------ */
    /* Submit New + Stripe                                                 */
    /* ------------------------------------------------------------------ */

    var typeSel = document.getElementById('adf-submit-type');
    var tierSel = document.getElementById('adf-submit-tier');
    var paymentBox = document.getElementById('adf-payment');
    var stripe = null, cardEl = null;

    if (typeSel) {
        Object.keys(cfg.types || {}).forEach(function (t) {
            typeSel.appendChild(el('<option value="' + t + '">' + esc(cfg.types[t].label) + '</option>'));
        });
        Object.keys(cfg.tiers || {}).forEach(function (t) {
            tierSel.appendChild(el('<option value="' + t + '">' + esc(cfg.tiers[t]) + '</option>'));
        });
        typeSel.addEventListener('change', refreshTierPrices);
        tierSel.addEventListener('change', togglePayment);
        refreshTierPrices();
    }

    function refreshTierPrices() {
        var t = typeSel.value, meta = (cfg.types || {})[t];
        if (!meta) { return; }
        Array.prototype.forEach.call(tierSel.options, function (opt) {
            var cents = meta.prices[opt.value] || 0;
            opt.textContent = cfg.tiers[opt.value] + (cents ? ' — $' + (cents / 100).toFixed(2) : '');
        });
        togglePayment();
    }

    function selectedPrice() {
        var meta = (cfg.types || {})[typeSel.value];
        return meta ? (meta.prices[tierSel.value] || 0) : 0;
    }

    function togglePayment() {
        var needsPay = selectedPrice() > 0;
        paymentBox.hidden = !needsPay;
        if (needsPay && !stripe && cfg.stripeKey && window.Stripe) {
            stripe = window.Stripe(cfg.stripeKey);
            cardEl = stripe.elements().create('card');
            cardEl.mount('#adf-card-element');
        }
    }

    var submitForm = document.getElementById('adf-submit-form');
    if (submitForm) {
        submitForm.addEventListener('submit', function (e) {
            e.preventDefault();
            var btn = document.getElementById('adf-submit-btn');
            var out = document.getElementById('adf-submit-result');
            btn.disabled = true; out.textContent = '…';

            var payload = {
                type: typeSel.value,
                tier: tierSel.value,
                title: submitForm.title.value,
                content: submitForm.content.value,
                meta: collectTypeFields()
            };

            api('/submit', { method: 'POST', body: JSON.stringify(payload) }).then(function (res) {
                if (!res.ok) { out.textContent = (res.body && res.body.error) || 'Error'; btn.disabled = false; return; }
                if (res.body.payment) {
                    return confirmPayment(res.body.payment, out, btn);
                }
                out.textContent = 'Submitted! Status: ' + res.body.status;
                btn.disabled = false;
                submitForm.reset();
            });
        });
    }

    function confirmPayment(payment, out, btn) {
        if (!stripe || !cardEl) { out.textContent = 'Payment unavailable.'; btn.disabled = false; return; }
        out.textContent = 'Confirming payment…';
        stripe.confirmCardPayment(payment.client_secret, { payment_method: { card: cardEl } })
            .then(function (result) {
                if (result.error) {
                    document.getElementById('adf-card-errors').textContent = result.error.message;
                    btn.disabled = false;
                    return;
                }
                // Tell the server to advance the listing now that the charge succeeded.
                return api('/confirm-payment', {
                    method: 'POST',
                    body: JSON.stringify({ intent_id: payment.intent_id })
                }).then(function () {
                    out.textContent = 'Payment received — submission complete.';
                    btn.disabled = false;
                    submitForm.reset();
                    paymentBox.hidden = true;
                });
            });
    }

    /* Minimal per-type extra fields (extend as needed). */
    function collectTypeFields() {
        var meta = {};
        document.querySelectorAll('#adf-type-fields [name]').forEach(function (input) {
            meta[input.name] = input.value;
        });
        return meta;
    }

    /* ------------------------------------------------------------------ */
    /* Volunteer + Account forms                                           */
    /* ------------------------------------------------------------------ */

    bindForm('adf-account-form', '/account', 'adf-account-result', 'Saved.');

    function bindForm(formId, path, resultId, okMsg) {
        var form = document.getElementById(formId);
        if (!form) { return; }
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var out = document.getElementById(resultId);
            out.textContent = '…';
            var data = {};
            Array.prototype.forEach.call(form.elements, function (input) {
                if (input.name) { data[input.name] = input.value; }
            });
            api(path, { method: 'POST', body: JSON.stringify(data) }).then(function (res) {
                out.textContent = res.ok ? okMsg : ((res.body && res.body.error) || 'Error');
            });
        });
    }

    /* Initial paint. */
    renderOverview();
})();

/* -------------------------------------------------------------------- */
/* Volunteer opportunity signup widget — standalone so it runs on the    */
/* /v/ opportunity page (via [adf_volunteer_signup]) where the dashboard */
/* shell is absent.                                                       */
/* -------------------------------------------------------------------- */
(function volunteerWidget() {
    'use strict';

    var vol = window.ADF_VOL;
    var mount = document.getElementById('adf-vol-signup');
    if (!vol || !mount) { return; }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function paint(shifts) {
        var rows = shifts.map(function (s) {
            var status = s.full
                ? '<span class="adf-vol-full">Full — sign-ups closed</span>'
                : '<span class="adf-vol-open">' + s.spots_left + ' spot' + (s.spots_left === 1 ? '' : 's') + ' left</span>';
            var radio = s.full ? '' :
                '<label class="adf-vol-pick"><input type="radio" name="shift" value="' + esc(s.id) + '"> Choose</label>';
            return '<tr><td>' + esc(s.label) + '</td><td>' + status + '</td><td>' + radio + '</td></tr>';
        }).join('');

        mount.innerHTML =
            '<table class="adf-table adf-vol-table"><thead><tr><th>Shift</th><th>Availability</th><th></th></tr></thead><tbody>' +
            rows + '</tbody></table>' +
            '<form id="adf-vol-form" class="adf-form">' +
            '<label>Name <input type="text" name="name" required></label>' +
            '<label>Email <input type="email" name="email" required></label>' +
            '<label>Mobile (for reminders) <input type="tel" name="phone"></label>' +
            '<label class="adf-checkbox"><input type="checkbox" name="sms_opt_in" value="1"> Text me shift reminders</label>' +
            '<button type="submit" class="adf-btn adf-btn-primary">Sign up</button>' +
            '<div class="adf-result" id="adf-vol-result"></div></form>';

        document.getElementById('adf-vol-form').addEventListener('submit', submit);
    }

    function submit(e) {
        e.preventDefault();
        var form = e.target;
        var out = document.getElementById('adf-vol-result');
        var shift = form.querySelector('input[name="shift"]:checked');
        if (!shift) { out.textContent = 'Please choose a shift.'; return; }
        out.textContent = '…';

        fetch(vol.restUrl + '/volunteer-signup', {
            method: 'POST',
            headers: { 'X-WP-Nonce': vol.nonce, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                opportunity_id: vol.opportunityId,
                shift_id: shift.value,
                name: form.name.value,
                email: form.email.value,
                phone: form.phone.value,
                sms_opt_in: form.sms_opt_in.checked ? 1 : 0
            })
        }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
          .then(function (res) {
            if (!res.ok) { out.textContent = (res.body && res.body.error) || 'Error'; return; }
            out.textContent = 'You are signed up — check your email for confirmation.';
            refresh();
        });
    }

    function refresh() {
        fetch(vol.restUrl + '/volunteer-shifts?opportunity_id=' + encodeURIComponent(vol.opportunityId))
            .then(function (r) { return r.json(); })
            .then(paint);
    }

    paint(vol.shifts || []);
})();
