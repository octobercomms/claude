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

    function notice(msg, type) {
        var el = document.getElementById('oo-thanks-notice');
        if (!el) return;
        el.className = 'oo-notice oo-notice-' + (type || 'success');
        el.textContent = msg;
        el.style.display = 'block';
        if (type !== 'warning') setTimeout(function () { el.style.display = 'none'; }, 5000);
    }

    function loading(btn, on) {
        if (!btn) return;
        btn.disabled = on;
        var t = btn.querySelector('.oo-btn-text');
        var l = btn.querySelector('.oo-btn-loading');
        if (t) t.style.display = on ? 'none' : '';
        if (l) l.style.display = on ? '' : 'none';
    }

    function draft(row, regen) {
        var id     = row.dataset.id;
        var btn    = row.querySelector(regen ? '.oo-thank-regen' : '.oo-thank-draft');
        var editor = row.querySelector('.oo-thank-editor');
        loading(btn, true);
        post('oo_thank_draft', { entry_id: id }, function (res) {
            loading(btn, false);
            if (!res.success) { notice(res.data || 'Could not draft.', 'warning'); return; }
            row.querySelector('.oo-thank-subject').value = res.data.subject || '';
            row.querySelector('.oo-thank-body').value = res.data.body || '';
            var tone = row.querySelector('.oo-thank-tone');
            if (tone) tone.textContent = res.data.tone ? 'tone: ' + res.data.tone : '';
            editor.style.display = 'block';
            editor.dataset.original = res.data.body || '';
        });
    }

    document.querySelectorAll('.oo-thank-row').forEach(function (row) {
        row.querySelector('.oo-thank-draft').addEventListener('click', function () { draft(row, false); });
        var regen = row.querySelector('.oo-thank-regen');
        if (regen) regen.addEventListener('click', function () { draft(row, true); });

        row.querySelector('.oo-thank-skip').addEventListener('click', function () {
            post('oo_thank_skip', { entry_id: row.dataset.id }, function (res) {
                if (res.success) { row.style.opacity = '0.45'; row.querySelector('.oo-thank-actions').innerHTML = '<span class="oo-muted">Skipped</span>'; row.querySelector('.oo-thank-editor').style.display = 'none'; }
                else notice(res.data || 'Failed.', 'warning');
            });
        });

        row.querySelector('.oo-thank-send').addEventListener('click', function () {
            var btn  = this;
            var subj = row.querySelector('.oo-thank-subject').value.trim();
            var body = row.querySelector('.oo-thank-body').value.trim();
            var editor = row.querySelector('.oo-thank-editor');
            var edited = (editor.dataset.original || '') !== body ? 1 : 0;
            var tone = (row.querySelector('.oo-thank-tone').textContent || '').replace('tone: ', '');
            if (!subj || !body) { notice('Subject and message are required.', 'warning'); return; }
            loading(btn, true);
            post('oo_thank_send', { entry_id: row.dataset.id, subject: subj, body: body, tone: tone, edited: edited }, function (res) {
                loading(btn, false);
                if (res.success) {
                    notice('Thank-you sent ✓', 'success');
                    row.style.opacity = '0.5';
                    row.querySelector('.oo-thank-editor').style.display = 'none';
                    row.querySelector('.oo-thank-actions').innerHTML = '<span class="oo-muted">✓ Sent</span>';
                } else {
                    notice(res.data || 'Send failed.', 'warning');
                }
            });
        });
    });
})();
