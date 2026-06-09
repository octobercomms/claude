/* global ooData */
(function () {
    'use strict';

    var cfg     = window.ooData || {};
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
            cb({ success: false, data: (e && e.message) || 'Request failed.' });
        });
    }

    function notice(msg, type) {
        var el = document.getElementById('oo-media-notice');
        if (!el) return;
        el.className = 'oo-notice oo-notice-' + (type || 'success');
        el.textContent = msg;
        el.style.display = 'block';
        if (type !== 'warning') setTimeout(function () { el.style.display = 'none'; }, 6000);
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    var scanBtn = document.getElementById('oo-dedup-scan');
    var results = document.getElementById('oo-dedup-results');
    if (!scanBtn || !results) return;

    function setLoading(on) {
        scanBtn.disabled = on;
        var t = scanBtn.querySelector('.oo-btn-text');
        var l = scanBtn.querySelector('.oo-btn-loading');
        if (t) t.style.display = on ? 'none' : '';
        if (l) l.style.display = on ? '' : 'none';
    }

    function badge(method, confidence) {
        if (method === 'exact') return '<span class="oo-badge oo-badge-green">Exact match · safe</span>';
        if (method === 'ai')    return '<span class="oo-badge oo-badge-blue">AI confirmed · ' + Math.round(confidence * 100) + '%</span>';
        return '<span class="oo-badge oo-badge-grey">Possible · review carefully</span>';
    }

    function render(data) {
        var clusters = data.clusters || [];
        if (!clusters.length) {
            results.style.display = 'block';
            results.innerHTML = '<div class="oo-card"><div class="oo-empty-state"><h3>No duplicates found</h3><p>Your publications look clean.</p></div></div>';
            return;
        }

        var exact = clusters.filter(function (c) { return c.method === 'exact'; });
        var html = '';

        if (!data.claude) {
            html += '<div class="oo-notice oo-notice-warning" style="margin-bottom:14px">Claude isn\'t configured, so possible (fuzzy) matches below are heuristic only — review each carefully. Add a Claude key in Settings to auto-confirm and split these.</div>';
        }

        if (exact.length) {
            html += '<div style="margin-bottom:10px"><button class="oo-btn oo-btn-secondary oo-btn-sm" id="oo-merge-all-exact">Merge all ' + exact.length + ' exact matches</button> <span class="oo-muted" style="font-size:13px">High-confidence — same name in URL/case/“DO NOT USE” forms.</span></div>';
        }

        clusters.forEach(function (c, ci) {
            html += '<div class="oo-card oo-dedup-cluster" data-ci="' + ci + '" style="margin-bottom:12px">';
            html += '<div style="margin-bottom:10px">' + badge(c.method, c.confidence) + '</div>';
            html += '<table class="oo-table" style="margin-bottom:10px"><thead><tr><th style="width:90px">Keep</th><th>Publication</th></tr></thead><tbody>';
            c.members.forEach(function (m, mi) {
                // Default canonical = the suggested clean name if it matches, else first member.
                var isCanon = (m.name === c.suggested) || (c.suggested == null && mi === 0);
                html += '<tr>'
                    + '<td><input type="radio" name="canon-' + ci + '" value="' + m.id + '"' + (isCanon ? ' checked' : '') + '></td>'
                    + '<td data-id="' + m.id + '">' + esc(m.name) + '</td>'
                    + '</tr>';
            });
            html += '</tbody></table>';
            html += '<button class="oo-btn oo-btn-primary oo-btn-sm oo-do-merge" data-ci="' + ci + '">Merge into selected</button>';
            html += ' <span class="oo-muted" style="font-size:12px">The selected row is kept; the rest become aliases of it.</span>';
            html += '</div>';
        });

        results.style.display = 'block';
        results.innerHTML = html;
        wire(clusters);
    }

    function doMerge(cluster, ci, done) {
        var card = results.querySelector('.oo-dedup-cluster[data-ci="' + ci + '"]');
        if (!card) return;
        var checked = card.querySelector('input[name="canon-' + ci + '"]:checked');
        if (!checked) { notice('Pick which publication to keep.', 'warning'); return; }
        var canonId = parseInt(checked.value, 10);
        var memberIds = cluster.members.map(function (m) { return m.id; }).filter(function (id) { return id !== canonId; });
        post('oo_dedup_merge', { canonical_id: canonId, member_ids: memberIds }, function (res) {
            if (res.success) {
                card.style.opacity = '0.5';
                card.innerHTML = '<div class="oo-muted" style="padding:8px">✓ Merged ' + res.data.merged + ' duplicate(s).</div>';
                if (done) done();
            } else {
                notice(res.data || 'Merge failed.', 'warning');
            }
        });
    }

    function wire(clusters) {
        results.querySelectorAll('.oo-do-merge').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var ci = parseInt(btn.dataset.ci, 10);
                doMerge(clusters[ci], ci);
            });
        });
        var allBtn = document.getElementById('oo-merge-all-exact');
        if (allBtn) {
            allBtn.addEventListener('click', function () {
                allBtn.disabled = true;
                var remaining = 0;
                clusters.forEach(function (c, ci) {
                    if (c.method === 'exact') { remaining++; doMerge(c, ci, function () { remaining--; if (!remaining) notice('Exact matches merged.', 'success'); }); }
                });
            });
        }
    }

    scanBtn.addEventListener('click', function () {
        setLoading(true);
        results.style.display = 'none';
        post('oo_dedup_scan', {}, function (res) {
            setLoading(false);
            if (res.success) { render(res.data); }
            else { notice(res.data || 'Scan failed.', 'warning'); }
        });
    });
})();
