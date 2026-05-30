/* global ooTagsData */
(function () {
    'use strict';

    var cfg     = window.ooTagsData || {};
    var ajaxUrl = cfg.ajaxUrl || '/wp-admin/admin-ajax.php';
    var nonce   = cfg.nonce   || '';

    function post(action, data, cb) {
        var body = 'action=' + encodeURIComponent(action) + '&nonce=' + encodeURIComponent(nonce);
        Object.keys(data).forEach(function (k) {
            var v = data[k];
            body += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(
                (Array.isArray(v) || (v !== null && typeof v === 'object')) ? JSON.stringify(v) : v
            );
        });
        fetch(ajaxUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body
        }).then(function (r) { return r.json(); }).then(cb).catch(function (e) {
            cb({ success: false, data: e.message || 'Request failed.' });
        });
    }

    function notice(msg, type) {
        var el = document.getElementById('oo-tags-notice');
        if (!el) return;
        el.className = 'oo-notice oo-notice-' + (type || 'success');
        el.textContent = msg;
        el.style.display = 'block';
        setTimeout(function () { el.style.display = 'none'; }, 5000);
    }

    // ── Rename ───────────────────────────────────────────────────────────
    document.querySelectorAll('.oo-tag-rename-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var row    = btn.closest('tr');
            var tag    = btn.dataset.tag;
            var nameEl = row.querySelector('.oo-tag-name');
            var actEl  = row.querySelector('.oo-row-actions');

            if (row.querySelector('.oo-rename-inline')) return; // already open

            var tpl    = document.getElementById('oo-rename-tpl').content.cloneNode(true);
            var inline = tpl.querySelector('.oo-rename-inline');
            var input  = tpl.querySelector('.oo-rename-input');
            var save   = tpl.querySelector('.oo-rename-save');
            var cancel = tpl.querySelector('.oo-rename-cancel');
            var status = tpl.querySelector('.oo-rename-status');

            input.value = tag;
            actEl.style.display = 'none';
            row.querySelector('td:last-child').appendChild(inline);
            input.focus(); input.select();

            cancel.addEventListener('click', function () {
                row.querySelector('.oo-rename-inline').remove();
                actEl.style.display = '';
            });

            save.addEventListener('click', function () {
                var newTag = input.value.trim();
                if (!newTag || newTag === tag) { cancel.click(); return; }
                save.disabled = cancel.disabled = true;
                status.textContent = 'Saving…';
                post('oo_rename_tag', { from: tag, to: newTag }, function (res) {
                    if (res.success) {
                        nameEl.textContent = res.data.to;
                        btn.dataset.tag = res.data.to;
                        row.querySelector('.oo-tag-delete-btn').dataset.tag = res.data.to;
                        row.dataset.tag = res.data.to;
                        row.querySelector('.oo-rename-inline').remove();
                        actEl.style.display = '';
                        notice('Renamed "' + tag + '" → "' + res.data.to + '" on ' + res.data.updated + ' contacts.');
                    } else {
                        status.textContent = res.data || 'Failed.';
                        save.disabled = cancel.disabled = false;
                    }
                });
            });

            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') save.click();
                if (e.key === 'Escape') cancel.click();
            });
        });
    });

    // ── Delete ───────────────────────────────────────────────────────────
    document.querySelectorAll('.oo-tag-delete-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var tag = btn.dataset.tag;
            var row = btn.closest('tr');
            var count = parseInt(row.querySelector('td:nth-child(2)').textContent.replace(/,/g,''), 10);
            if (!confirm('Remove tag "' + tag + '" from ' + count + ' contact' + (count === 1 ? '' : 's') + '? The contacts themselves are not deleted.')) return;
            btn.disabled = true;
            post('oo_delete_tag', { tag: tag }, function (res) {
                if (res.success) {
                    row.remove();
                    notice('Tag "' + tag + '" removed from ' + res.data.updated + ' contacts.');
                } else {
                    btn.disabled = false;
                    notice(res.data || 'Delete failed.', 'error');
                }
            });
        });
    });

    // ── Tidy with Claude ─────────────────────────────────────────────────
    var tidyBtn    = document.getElementById('oo-tidy-btn');
    var tidyPanel  = document.getElementById('oo-tidy-panel');
    var tidyLoad   = document.getElementById('oo-tidy-loading');
    var tidyRes    = document.getElementById('oo-tidy-results');
    var tidyErr    = document.getElementById('oo-tidy-error');
    var opsList    = document.getElementById('oo-tidy-ops-list');
    var opCount    = document.getElementById('oo-tidy-op-count');
    var applyBtn   = document.getElementById('oo-tidy-apply-btn');
    var applyStatus= document.getElementById('oo-tidy-apply-status');

    var pendingOps = [];

    if (tidyBtn) {
        tidyBtn.addEventListener('click', function () {
            if (tidyPanel.style.display !== 'none') {
                tidyPanel.style.display = 'none';
                return;
            }
            tidyPanel.style.display = '';
            tidyLoad.style.display  = '';
            tidyRes.style.display   = 'none';
            tidyErr.style.display   = 'none';
            tidyBtn.disabled        = true;
            tidyBtn.textContent     = 'Analysing…';

            post('oo_analyze_tags', {}, function (res) {
                tidyBtn.disabled    = false;
                tidyBtn.textContent = '✨ Tidy with Claude';
                tidyLoad.style.display = 'none';

                if (!res.success) {
                    tidyErr.textContent    = res.data || 'Analysis failed.';
                    tidyErr.style.display  = '';
                    return;
                }

                pendingOps = res.data.operations || [];
                if (!pendingOps.length) {
                    tidyErr.textContent   = 'Claude found no issues — your tags look clean!';
                    tidyErr.style.display = '';
                    tidyErr.style.color   = '#16a34a';
                    return;
                }

                renderOps(pendingOps);
                opCount.textContent = pendingOps.length;
                tidyRes.style.display = '';
            });
        });
    }

    function renderOps(ops) {
        opsList.innerHTML = '';
        ops.forEach(function (op, i) {
            var div = document.createElement('div');
            div.className = 'oo-tidy-op';
            div.style.cssText = 'padding:12px 20px;border-bottom:1px solid #f1f5f9;display:flex;align-items:flex-start;gap:12px';

            var cb = document.createElement('input');
            cb.type = 'checkbox'; cb.checked = true;
            cb.dataset.index = i;
            cb.style.marginTop = '2px';

            var badge = opBadge(op.type);
            var desc  = opDesc(op);

            var text = document.createElement('div');
            text.style.flex = '1';
            text.innerHTML  = badge + ' <strong>' + esc(desc) + '</strong>'
                + (op.why ? '<br><span style="font-size:12px;color:var(--oo-text-muted)">' + esc(op.why) + '</span>' : '');

            div.appendChild(cb);
            div.appendChild(text);
            opsList.appendChild(div);
        });
    }

    function opBadge(type) {
        var colours = { rename: '#3b82f6', merge: '#8b5cf6', delete: '#ef4444', add_parent: '#22c55e' };
        var c = colours[type] || '#64748b';
        return '<span style="background:' + c + ';color:#fff;border-radius:4px;padding:1px 7px;font-size:11px;font-weight:600;text-transform:uppercase">' + esc(type) + '</span>';
    }

    function opDesc(op) {
        if (op.type === 'rename') return '"' + op.from + '" → "' + op.to + '"';
        if (op.type === 'merge')  return 'merge "' + op.from + '" into "' + op.to + '"';
        if (op.type === 'delete') return 'delete "' + op.tag + '"';
        if (op.type === 'add_parent') return 'add parent "' + op.parent + '" to contacts tagged "' + op.child + '"';
        return JSON.stringify(op);
    }

    document.getElementById('oo-tidy-select-all').addEventListener('click', function () {
        opsList.querySelectorAll('input[type=checkbox]').forEach(function (cb) { cb.checked = true; });
    });
    document.getElementById('oo-tidy-select-none').addEventListener('click', function () {
        opsList.querySelectorAll('input[type=checkbox]').forEach(function (cb) { cb.checked = false; });
    });

    if (applyBtn) {
        applyBtn.addEventListener('click', function () {
            var selected = [];
            opsList.querySelectorAll('input[type=checkbox]:checked').forEach(function (cb) {
                selected.push(pendingOps[parseInt(cb.dataset.index, 10)]);
            });
            if (!selected.length) { applyStatus.textContent = 'Nothing selected.'; return; }
            applyBtn.disabled    = true;
            applyStatus.textContent = 'Applying ' + selected.length + ' changes…';

            post('oo_apply_tag_plan', { operations: selected }, function (res) {
                applyBtn.disabled = false;
                if (res.success) {
                    applyStatus.textContent = res.data.applied + ' operations applied.';
                    setTimeout(function () { location.reload(); }, 1200);
                } else {
                    applyStatus.textContent = res.data || 'Apply failed.';
                }
            });
        });
    }

    function esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

})();
