/* global ooData */
(function () {
    'use strict';

    var cfg     = window.ooData || {};
    var ajaxUrl = cfg.ajaxUrl || '/wp-admin/admin-ajax.php';
    var nonce   = cfg.nonce   || '';

    function post(action, data, cb) {
        var body = 'action=' + encodeURIComponent(action) + '&nonce=' + encodeURIComponent(nonce);
        Object.keys(data).forEach(function (k) {
            body += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(data[k]);
        });
        fetch(ajaxUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body
        }).then(function (r) { return r.json(); }).then(cb).catch(function (e) {
            cb({ success: false, data: (e && e.message) || 'Request failed.' });
        });
    }

    function byId(id) { return document.getElementById(id); }

    // ── Paste-a-URL → auto-fill ────────────────────────────────────────────
    var btn = byId('oo-autofill-btn');
    if (btn) {
        var urlInput = byId('oo-autofill-url');
        var msg      = byId('oo-autofill-msg');

        function setLoading(on) {
            btn.disabled = on;
            var t = btn.querySelector('.oo-btn-text');
            var l = btn.querySelector('.oo-btn-loading');
            if (t) t.style.display = on ? 'none' : '';
            if (l) l.style.display = on ? '' : 'none';
        }
        function note(text, ok) {
            if (!msg) return;
            msg.style.display = 'block';
            msg.style.color = ok ? '#166534' : '#92400e';
            msg.textContent = text;
        }
        // Only fill a field if it's currently empty (don't clobber manual edits).
        function fill(id, val) {
            var el = byId(id);
            if (el && val && !el.value) el.value = val;
        }

        btn.addEventListener('click', function () {
            var url = (urlInput && urlInput.value || '').trim();
            if (!url) { note('Paste a story URL first.', false); return; }
            setLoading(true);
            note('', true); if (msg) msg.style.display = 'none';
            post('oo_log_extract_url', { url: url }, function (res) {
                setLoading(false);
                if (!res.success) { note(res.data || 'Could not read that page.', false); return; }
                var d = res.data || {};
                fill('oo-f-publication', d.publication);
                fill('oo-f-press_contact', d.author);
                fill('oo-f-story_title', d.title);
                fill('oo-f-issue_date', d.published_date);
                var su = byId('oo-f-story_url');
                if (su && !su.value) su.value = url;
                note('Filled from the page — check and adjust, then save.', true);
            });
        });
    }

    // ── Alias-aware typeahead (datalist) ───────────────────────────────────
    function wireSuggest(inputId, listId, type) {
        var input = byId(inputId);
        var list  = byId(listId);
        if (!input || !list) return;
        var timer = null;
        input.addEventListener('input', function () {
            var q = input.value.trim();
            if (q.length < 2) return;
            clearTimeout(timer);
            timer = setTimeout(function () {
                post('oo_log_suggest', { q: q, type: type }, function (res) {
                    if (!res.success) return;
                    var items = (res.data && res.data.items) || [];
                    list.innerHTML = '';
                    items.forEach(function (name) {
                        var opt = document.createElement('option');
                        opt.value = name;
                        list.appendChild(opt);
                    });
                });
            }, 220);
        });
    }
    wireSuggest('oo-f-publication', 'oo-publication-list', 'outlet');
    wireSuggest('oo-f-press_contact', 'oo-contact-list', 'contact');
})();
