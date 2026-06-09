/* global ooData */
(function () {
    'use strict';

    var cfg     = window.ooData || {};
    var ajaxUrl = cfg.ajaxUrl || '/wp-admin/admin-ajax.php';
    var nonce   = cfg.nonce   || '';

    var btn = document.getElementById('pr-draft-btn');
    if (!btn) return;

    function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
    function notice(msg, type) {
        var el = document.getElementById('oo-pr-notice');
        if (!el) return;
        el.className = 'oo-notice oo-notice-' + (type || 'success');
        el.textContent = msg;
        el.style.display = 'block';
        if (type !== 'warning') setTimeout(function () { el.style.display = 'none'; }, 5000);
    }
    function loading(on) {
        btn.disabled = on;
        var t = btn.querySelector('.oo-btn-text');
        var l = btn.querySelector('.oo-btn-loading');
        if (t) t.style.display = on ? 'none' : '';
        if (l) l.style.display = on ? '' : 'none';
    }

    btn.addEventListener('click', function () {
        var title = val('pr-title');
        if (!title.trim()) { notice('Add a headline first.', 'warning'); return; }
        var body = document.getElementById('pr-body');
        if (body && body.value.trim() && !confirm('Replace the current body with a fresh Claude draft?')) return;

        loading(true);
        var data = { title: title, client: val('pr-client'), angle: val('pr-angle'), key_facts: val('pr-key-facts') };
        var b = 'action=oo_pr_draft&nonce=' + encodeURIComponent(nonce);
        Object.keys(data).forEach(function (k) { b += '&' + k + '=' + encodeURIComponent(data[k]); });

        fetch(ajaxUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: b
        }).then(function (r) { return r.json(); }).then(function (res) {
            loading(false);
            if (res.success) {
                if (body) body.value = res.data.body_html || '';
                notice('Draft written — review and edit below.', 'success');
            } else {
                notice(res.data || 'Could not draft.', 'warning');
            }
        }).catch(function (e) {
            loading(false);
            notice((e && e.message) || 'Request failed.', 'warning');
        });
    });
})();
