/* global ooData */
(function () {
    'use strict';

    var cfg     = window.ooData || {};
    var ajaxUrl = cfg.ajaxUrl || '/wp-admin/admin-ajax.php';
    var nonce   = cfg.nonce   || '';

    function post(action, data, cb) {
        var body = 'action=' + encodeURIComponent(action) + '&nonce=' + encodeURIComponent(nonce);
        Object.keys(data).forEach(function (k) { body += '&' + k + '=' + encodeURIComponent(data[k]); });
        fetch(ajaxUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body })
            .then(function (r) { return r.json(); }).then(cb)
            .catch(function (e) { cb({ success: false, data: (e && e.message) || 'Request failed.' }); });
    }
    function notice(msg, type) {
        var el = document.getElementById('oo-prof-notice');
        if (!el) return;
        el.className = 'oo-notice oo-notice-' + (type || 'success');
        el.textContent = msg; el.style.display = 'block';
        if (type !== 'warning') setTimeout(function () { el.style.display = 'none'; }, 5000);
    }
    function loading(btn, on) {
        if (!btn) return;
        btn.disabled = on;
        var t = btn.querySelector('.oo-btn-text'); var l = btn.querySelector('.oo-btn-loading');
        if (t) t.style.display = on ? 'none' : '';
        if (l) l.style.display = on ? '' : 'none';
    }

    // Show/hide the "back on" date when availability isn't Active.
    var avail = document.getElementById('oo-avail');
    var rw    = document.getElementById('oo-return-wrap');
    if (avail && rw) {
        avail.addEventListener('change', function () { rw.style.display = avail.value === 'active' ? 'none' : ''; });
    }

    // Live photo preview.
    var photoInput = document.querySelector('#oo-journalist-meta input[name="photo_url"]');
    if (photoInput) {
        photoInput.addEventListener('change', function () {
            var img = document.getElementById('oo-prof-photo');
            if (img && photoInput.value) img.src = photoInput.value;
        });
    }

    // Suggest beats (journalist).
    var beatsBtn = document.getElementById('oo-suggest-beats');
    if (beatsBtn) {
        var form = document.getElementById('oo-journalist-meta');
        beatsBtn.addEventListener('click', function () {
            loading(beatsBtn, true);
            post('oo_suggest_beats', { contact_id: form.dataset.id }, function (res) {
                loading(beatsBtn, false);
                if (!res.success) { notice(res.data || 'Could not suggest.', 'warning'); return; }
                var input = document.getElementById('oo-beats');
                var existing = input.value.split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
                (res.data.beats || []).forEach(function (b) { if (existing.indexOf(b) === -1) existing.push(b); });
                input.value = existing.join(', ');
                notice('Beats suggested — review and Save.', 'success');
            });
        });
    }

    // Generate outlet summary.
    var sumBtn = document.getElementById('oo-gen-summary');
    if (sumBtn) {
        var oform = document.getElementById('oo-outlet-meta');
        sumBtn.addEventListener('click', function () {
            loading(sumBtn, true);
            post('oo_outlet_summary', { outlet_id: oform.dataset.id }, function (res) {
                loading(sumBtn, false);
                if (!res.success) { notice(res.data || 'Could not generate.', 'warning'); return; }
                var ta = document.getElementById('oo-outlet-summary');
                if (ta) ta.value = res.data.summary || '';
                notice('Summary drafted — review and Save.', 'success');
            });
        });
    }
})();
