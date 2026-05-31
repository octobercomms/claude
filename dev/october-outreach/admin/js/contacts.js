/* global ooContactsData, ooData */
(function () {
    'use strict';

    var cfg = window.ooContactsData || {};
    var ajaxUrl = cfg.ajaxUrl || '/wp-admin/admin-ajax.php';
    var nonce   = cfg.nonce   || '';
    var workspaceTags = cfg.workspaceTags || [];

    // ── AJAX helper ───────────────────────────────────────────────────────
    function post(action, data, cb) {
        var body = 'action=' + encodeURIComponent(action) + '&nonce=' + encodeURIComponent(nonce);
        Object.keys(data).forEach(function (k) {
            var v = data[k];
            if (Array.isArray(v) || (v !== null && typeof v === 'object')) {
                body += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(JSON.stringify(v));
            } else {
                body += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(v);
            }
        });
        fetch(ajaxUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body
        }).then(function (r) { return r.json(); }).then(cb).catch(function (e) {
            cb({ success: false, data: e.message || 'Request failed.' });
        });
    }

    function showNotice(msg, type) {
        var el = document.getElementById('oo-contacts-notices');
        if (!el) return;
        el.innerHTML = '<div class="oo-notice oo-notice-' + (type || 'success') + '">' + msg + '</div>';
        setTimeout(function () { el.innerHTML = ''; }, 5000);
    }

    // ── Tag chip factory ─────────────────────────────────────────────────
    function TagChips(listEl, inputEl, addBtnEl, suggestEl, onChange) {
        var tags = [];

        function render() {
            listEl.innerHTML = '';
            tags.forEach(function (t) {
                var chip = document.createElement('span');
                chip.className = 'oo-chip';
                chip.innerHTML = t + '<button type="button" class="oo-chip-remove" aria-label="Remove">×</button>';
                chip.querySelector('.oo-chip-remove').addEventListener('click', function () {
                    tags = tags.filter(function (x) { return x !== t; });
                    render();
                    if (onChange) onChange(tags);
                });
                listEl.appendChild(chip);
            });
            renderSuggestions();
        }

        function add(raw) {
            var t = raw.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
            if (!t || tags.indexOf(t) !== -1) return;
            tags.push(t);
            render();
            if (onChange) onChange(tags);
        }

        function renderSuggestions() {
            if (!suggestEl) return;
            suggestEl.innerHTML = '';
            workspaceTags.forEach(function (wt) {
                if (tags.indexOf(wt) !== -1) return;
                var chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'oo-tag-suggest-chip';
                chip.textContent = wt;
                chip.addEventListener('click', function () { add(wt); });
                suggestEl.appendChild(chip);
            });
        }

        if (addBtnEl) {
            addBtnEl.addEventListener('click', function () {
                add(inputEl.value); inputEl.value = ''; inputEl.focus();
            });
        }
        if (inputEl) {
            inputEl.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(inputEl.value); inputEl.value = ''; }
            });
        }

        return {
            setTags: function (arr) { tags = arr.slice(); render(); },
            getTags: function () { return tags.slice(); },
            render: render
        };
    }

    // ════════════════════════════════════════════════════════════════════
    // EDIT MODAL
    // ════════════════════════════════════════════════════════════════════
    var editModal    = document.getElementById('oo-edit-modal');
    var editForm     = document.getElementById('oo-edit-form');
    var editTitle    = document.getElementById('oo-edit-modal-title');
    var editStatusEl = document.getElementById('oo-edit-status-msg');
    var activityList = document.getElementById('oo-activity-list');

    var editTagChips = TagChips(
        document.getElementById('oo-edit-tag-chips'),
        document.getElementById('oo-edit-tag-input'),
        document.getElementById('oo-edit-tag-add-btn'),
        document.getElementById('oo-edit-tag-suggestions'),
        null
    );

    // Tab switching
    document.querySelectorAll('.oo-tab-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var tab = btn.dataset.tab;
            document.querySelectorAll('.oo-tab-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            document.getElementById('oo-edit-tab-details').style.display  = tab === 'details'  ? '' : 'none';
            document.getElementById('oo-edit-tab-activity').style.display = tab === 'activity' ? '' : 'none';
        });
    });

    function openEditModal(id) {
        editTitle.textContent = id ? 'Edit Contact' : 'Add Contact';
        editStatusEl.textContent = '';
        document.getElementById('oo-edit-contact-id').value = id || '';

        // Reset tabs
        document.querySelectorAll('.oo-tab-btn').forEach(function (b) { b.classList.remove('active'); });
        document.querySelector('.oo-tab-btn[data-tab="details"]').classList.add('active');
        document.getElementById('oo-edit-tab-details').style.display  = '';
        document.getElementById('oo-edit-tab-activity').style.display = 'none';

        if (!id) {
            editForm.reset();
            editTagChips.setTags([]);
            editModal.style.display = 'flex';
            return;
        }

        post('oo_get_contact', { contact_id: id }, function (res) {
            if (!res.success) { showNotice(res.data || 'Could not load contact.', 'error'); return; }
            var c = res.data.contact;
            var fields = ['first_name','last_name','email','company','type','title','website','location','linkedin_url','source','status','notes'];
            fields.forEach(function (f) {
                var el = document.getElementById('oo-edit-' + f);
                if (el) el.value = c[f] || '';
            });
            editTagChips.setTags(Array.isArray(c.tags) ? c.tags : []);
            renderActivity(res.data.audit, res.data.sends);
            editModal.style.display = 'flex';
        });
    }

    function renderActivity(audit, sends) {
        var html = '';
        var entries = [];
        (audit || []).forEach(function (a) {
            entries.push({
                time: a.applied_at,
                html: '<strong>' + esc(a.field) + '</strong> changed '
                    + (a.source === 'claude_tidy' ? 'by Claude' : 'manually')
                    + (a.rationale ? ' — <em>' + esc(a.rationale) + '</em>' : '')
                    + '<br><span class="oo-muted">' + esc(a.before_value || '(empty)') + ' → ' + esc(a.after_value || '(empty)') + '</span>'
            });
        });
        (sends || []).forEach(function (s) {
            entries.push({
                time: s.sent_at || '',
                html: 'Email sent: <strong>' + esc(s.campaign_name) + '</strong> · status: ' + esc(s.status)
            });
        });
        entries.sort(function (a, b) { return a.time < b.time ? 1 : -1; });
        if (!entries.length) {
            html = '<p class="oo-muted" style="padding:20px">No activity yet.</p>';
        } else {
            entries.forEach(function (e) {
                html += '<div class="oo-activity-entry"><span class="oo-muted" style="font-size:11px">' + esc(e.time) + '</span><div>' + e.html + '</div></div>';
            });
        }
        activityList.innerHTML = html;
    }

    function esc(str) {
        return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function closeEditModal() { editModal.style.display = 'none'; }

    document.getElementById('oo-edit-modal-close').addEventListener('click', closeEditModal);
    document.getElementById('oo-edit-cancel-btn').addEventListener('click', closeEditModal);
    editModal.addEventListener('click', function (e) { if (e.target === editModal) closeEditModal(); });

    // Save contact
    editForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var saveBtn = document.getElementById('oo-edit-save-btn');
        saveBtn.disabled = true;
        editStatusEl.textContent = 'Saving…';

        var data = {
            contact_id:   document.getElementById('oo-edit-contact-id').value,
            first_name:   editForm.first_name.value,
            last_name:    editForm.last_name.value,
            email:        editForm.email.value,
            company:      editForm.company.value,
            type:         editForm.type.value,
            title:        editForm.title.value,
            website:      editForm.website.value,
            location:     editForm.location.value,
            linkedin_url: editForm.linkedin_url.value,
            source:       editForm.source.value,
            status:       editForm.status.value,
            notes:        editForm.notes.value,
            tags:         editTagChips.getTags()
        };

        post('oo_save_contact_ajax', data, function (res) {
            saveBtn.disabled = false;
            if (res.success) {
                editStatusEl.textContent = 'Saved!';
                setTimeout(function () { closeEditModal(); location.reload(); }, 800);
            } else {
                editStatusEl.textContent = res.data || 'Save failed.';
                editStatusEl.style.color = '#c0392b';
            }
        });
    });

    // ── Row click → open modal ────────────────────────────────────────
    document.querySelectorAll('.oo-contact-row').forEach(function (row) {
        row.addEventListener('click', function (e) {
            if (e.target.closest('.oo-cb-cell') || e.target.closest('.oo-delete-cell')) return;
            openEditModal(row.dataset.id);
        });
        row.style.cursor = 'pointer';
    });

    // ── Add Contact button ────────────────────────────────────────────
    ['oo-add-contact-btn','oo-add-contact-btn-empty'].forEach(function (id) {
        var btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', function () { openEditModal(null); });
    });

    // ── Per-row delete ────────────────────────────────────────────────
    document.querySelectorAll('.oo-row-delete-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (!confirm('Delete this contact permanently?')) return;
            var id = btn.dataset.id;
            post('oo_delete_contact_ajax', { contact_id: id }, function (res) {
                if (res.success) {
                    var row = btn.closest('tr');
                    if (row) row.remove();
                    showNotice('Contact deleted.');
                } else {
                    showNotice(res.data || 'Delete failed.', 'error');
                }
            });
        });
    });

    // ════════════════════════════════════════════════════════════════════
    // BULK TOOLBAR
    // ════════════════════════════════════════════════════════════════════
    var bulkToolbar  = document.getElementById('oo-bulk-toolbar');
    var bulkCountEl  = document.getElementById('oo-bulk-count');
    var selectAll    = document.getElementById('oo-select-all');
    var checkboxes   = document.querySelectorAll('.oo-row-cb');

    function getCheckedIds() {
        return Array.from(document.querySelectorAll('.oo-row-cb:checked')).map(function (c) { return c.value; });
    }

    function updateBulkToolbar() {
        var ids = getCheckedIds();
        if (bulkToolbar) bulkToolbar.style.display = ids.length ? 'flex' : 'none';
        if (bulkCountEl) bulkCountEl.textContent = ids.length + ' selected';
        if (selectAll) selectAll.checked = checkboxes.length > 0 && ids.length === checkboxes.length;
    }

    if (selectAll) {
        selectAll.addEventListener('change', function () {
            checkboxes.forEach(function (cb) { cb.checked = selectAll.checked; });
            updateBulkToolbar();
        });
    }
    checkboxes.forEach(function (cb) {
        cb.addEventListener('change', updateBulkToolbar);
        cb.addEventListener('click', function (e) { e.stopPropagation(); });
    });

    // Bulk delete
    var bulkDeleteBtn = document.getElementById('oo-bulk-delete-btn');
    if (bulkDeleteBtn) {
        bulkDeleteBtn.addEventListener('click', function () {
            var ids = getCheckedIds();
            if (!ids.length) return;
            if (!confirm('Permanently delete ' + ids.length + ' contact' + (ids.length === 1 ? '' : 's') + '?')) return;
            bulkDeleteBtn.disabled = true;
            bulkDeleteBtn.textContent = 'Deleting…';
            post('oo_bulk_delete_contacts_ajax', { ids: ids }, function (res) {
                if (res.success) {
                    showNotice(res.data.deleted + ' contact' + (res.data.deleted === 1 ? '' : 's') + ' deleted.');
                    setTimeout(function () { location.reload(); }, 800);
                } else {
                    bulkDeleteBtn.disabled = false;
                    bulkDeleteBtn.textContent = 'Delete Selected';
                    showNotice(res.data || 'Delete failed.', 'error');
                }
            });
        });
    }

    // ════════════════════════════════════════════════════════════════════
    // BULK TAG MODAL
    // ════════════════════════════════════════════════════════════════════
    var bulkTagModal   = document.getElementById('oo-bulk-tag-modal');
    var bulkTagStatus  = document.getElementById('oo-bulk-tag-status');

    var bulkTagChips = TagChips(
        document.getElementById('oo-bulk-tag-chips'),
        document.getElementById('oo-bulk-tag-input'),
        document.getElementById('oo-bulk-tag-add-btn'),
        document.getElementById('oo-bulk-tag-suggestions'),
        null
    );

    var bulkTagBtn = document.getElementById('oo-bulk-tag-btn');
    if (bulkTagBtn) {
        bulkTagBtn.addEventListener('click', function () {
            bulkTagChips.setTags([]);
            bulkTagStatus.textContent = '';
            bulkTagModal.style.display = 'flex';
        });
    }
    document.getElementById('oo-bulk-tag-modal-close').addEventListener('click', function () { bulkTagModal.style.display = 'none'; });
    document.getElementById('oo-bulk-tag-cancel-btn').addEventListener('click', function () { bulkTagModal.style.display = 'none'; });
    bulkTagModal.addEventListener('click', function (e) { if (e.target === bulkTagModal) bulkTagModal.style.display = 'none'; });

    document.getElementById('oo-bulk-tag-apply-btn').addEventListener('click', function () {
        var ids  = getCheckedIds();
        var tags = bulkTagChips.getTags();
        if (!ids.length || !tags.length) { bulkTagStatus.textContent = 'Select contacts and add at least one tag.'; return; }
        bulkTagStatus.textContent = 'Applying…';
        post('oo_bulk_tag_contacts', { ids: ids, add: tags, remove: [] }, function (res) {
            if (res.success) {
                bulkTagStatus.textContent = 'Tags applied to ' + res.data.updated + ' contacts.';
                setTimeout(function () { bulkTagModal.style.display = 'none'; location.reload(); }, 800);
            } else {
                bulkTagStatus.textContent = res.data || 'Failed.';
            }
        });
    });

    // ════════════════════════════════════════════════════════════════════
    // IMPORT WIZARD MODAL
    // ════════════════════════════════════════════════════════════════════
    var importModal = document.getElementById('oo-import-modal');
    var csvRows     = [];
    var csvHeaders  = [];
    var fieldMapping = {}; // fieldName -> colIndex

    var CANONICAL = ['email','first_name','last_name','name','company','contact_type','title','location','linkedin_url','website','source','notes','tags'];

    var ALIASES = {
        'email':'email','emailaddress':'email','e_mail':'email',
        'first':'first_name','firstname':'first_name','forename':'first_name',
        'last':'last_name','lastname':'last_name','surname':'last_name',
        'name':'name','fullname':'name','contact':'name',
        'company':'company','companyname':'company','practice':'company',
        'organisation':'company','organization':'company','outlet':'company','publication':'company',
        'type':'contact_type','contacttype':'contact_type','beat':'contact_type','category':'contact_type',
        'role':'title','position':'title','jobtitle':'title','title':'title',
        'city':'location','location':'location','address':'location','country':'location',
        'linkedin':'linkedin_url','linkedinurl':'linkedin_url',
        'website':'website','site':'website','url':'website',
        'source':'source','notes':'notes','note':'notes',
        'tags':'tags','topics':'tags','segments':'tags','segment':'tags','lists':'tags'
    };

    function normaliseHeader(h) {
        return h.toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function autoDetect(header) {
        return ALIASES[normaliseHeader(header)] || '__ignore__';
    }

    // CSV parser
    function parseCSV(text) {
        var rows = [], row = [], cell = '', inQuote = false;
        for (var i = 0; i < text.length; i++) {
            var ch = text[i];
            if (inQuote) {
                if (ch === '"') {
                    if (text[i+1] === '"') { cell += '"'; i++; }
                    else { inQuote = false; }
                } else { cell += ch; }
            } else {
                if (ch === '"') { inQuote = true; }
                else if (ch === ',') { row.push(cell); cell = ''; }
                else if (ch === '\n') { row.push(cell); cell = ''; rows.push(row); row = []; }
                else if (ch === '\r') { /* skip */ }
                else { cell += ch; }
            }
        }
        if (cell || row.length) { row.push(cell); rows.push(row); }
        return rows.filter(function (r) { return r.some(function (c) { return c.trim(); }); });
    }

    function goToImportStep(n) {
        [1,2,3].forEach(function (i) {
            document.getElementById('oo-import-panel-' + i).style.display = i === n ? '' : 'none';
            var step = document.getElementById('oo-istep-' + i);
            if (step) { step.classList.toggle('active', i === n); step.classList.toggle('done', i < n); }
        });
    }

    // File input / dropzone
    var csvInput = document.getElementById('oo-csv-file-input');
    var dropzone = document.getElementById('oo-dropzone');
    var dropFn   = document.getElementById('oo-dropzone-filename');
    var nextBtn1 = document.getElementById('oo-import-next-1');

    function handleFile(file) {
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (e) {
            var all = parseCSV(e.target.result);
            if (all.length < 2) { dropFn.textContent = 'File appears empty.'; return; }
            csvHeaders = all[0];
            csvRows    = all.slice(1);
            dropFn.textContent = file.name + ' — ' + csvRows.length + ' data rows';
            nextBtn1.disabled  = false;
        };
        reader.readAsText(file);
    }

    csvInput.addEventListener('change', function () { handleFile(csvInput.files[0]); });
    dropzone.addEventListener('dragover', function (e) { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', function () { dropzone.classList.remove('drag-over'); });
    dropzone.addEventListener('drop', function (e) {
        e.preventDefault(); dropzone.classList.remove('drag-over');
        handleFile(e.dataTransfer.files[0]);
    });

    nextBtn1.addEventListener('click', function () { buildMappingTable(); goToImportStep(2); });
    document.getElementById('oo-import-back-2').addEventListener('click', function () { goToImportStep(1); });
    document.getElementById('oo-import-back-3').addEventListener('click', function () { goToImportStep(2); });

    var importTagChips = TagChips(
        document.getElementById('oo-import-tag-chips'),
        document.getElementById('oo-import-tag-input'),
        document.getElementById('oo-import-tag-add-btn'),
        document.getElementById('oo-import-tag-suggestions'),
        null
    );

    function buildMappingTable() {
        var tbody = document.getElementById('oo-mapping-tbody');
        tbody.innerHTML = '';
        var preview = csvRows.slice(0, 3);

        csvHeaders.forEach(function (header, colIdx) {
            var detected = autoDetect(header);
            var tr = document.createElement('tr');

            // Column header cell
            var tdH = document.createElement('td');
            tdH.textContent = header;
            tr.appendChild(tdH);

            // Mapping select
            var tdS = document.createElement('td');
            var sel = document.createElement('select');
            sel.className = 'oo-select oo-mapping-select';
            sel.dataset.col = colIdx;
            var optIgnore = document.createElement('option');
            optIgnore.value = '__ignore__'; optIgnore.textContent = '— ignore —';
            sel.appendChild(optIgnore);
            CANONICAL.forEach(function (f) {
                var opt = document.createElement('option');
                opt.value = f; opt.textContent = f;
                if (f === detected) opt.selected = true;
                sel.appendChild(opt);
            });
            if (detected === '__ignore__') sel.value = '__ignore__';
            tdS.appendChild(sel);
            tr.appendChild(tdS);

            // Preview
            var tdP = document.createElement('td');
            tdP.style.fontSize = '11px';
            tdP.style.color    = 'var(--oo-text-muted)';
            tdP.textContent = preview.map(function (row) { return row[colIdx] || ''; }).join(' · ');
            tr.appendChild(tdP);

            tbody.appendChild(tr);
        });
    }

    document.getElementById('oo-import-next-2').addEventListener('click', function () {
        var errEl = document.getElementById('oo-mapping-error');
        errEl.style.display = 'none';

        fieldMapping = {};
        document.querySelectorAll('.oo-mapping-select').forEach(function (sel) {
            if (sel.value !== '__ignore__') {
                fieldMapping[sel.value] = parseInt(sel.dataset.col, 10);
            }
        });

        if (fieldMapping.email === undefined) {
            errEl.textContent = 'You must map a column to "email" before continuing.';
            errEl.style.display = 'block';
            return;
        }

        // Count valid rows
        var valid = csvRows.filter(function (row) {
            var em = (row[fieldMapping.email] || '').trim();
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em);
        });

        var tags = importTagChips.getTags();
        var summaryEl = document.getElementById('oo-import-summary');
        summaryEl.innerHTML =
            '<p><strong>' + valid.length + '</strong> contacts with a valid email will be processed.</p>' +
            '<ul style="margin:8px 0 0 16px;font-size:13px">' +
            '<li>Existing emails → tags merged into the existing row</li>' +
            '<li>New emails → fresh rows created</li>' +
            (tags.length ? '<li>Tags applied to every row: <strong>' + tags.map(esc).join(', ') + '</strong></li>' : '') +
            '</ul>';

        document.getElementById('oo-import-do-btn').textContent = 'Import ' + valid.length + ' contacts';
        goToImportStep(3);
    });

    document.getElementById('oo-import-do-btn').addEventListener('click', function () {
        var doBtn  = document.getElementById('oo-import-do-btn');
        var progEl = document.getElementById('oo-import-progress');
        doBtn.disabled = true;
        progEl.textContent = 'Importing…';

        // Only send rows with a valid email
        var rows = csvRows.filter(function (row) {
            var em = (row[fieldMapping.email] !== undefined ? row[fieldMapping.email] : '') .trim();
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em);
        });

        post('oo_import_contacts_mapped', {
            rows:    rows,
            mapping: fieldMapping,
            tags:    importTagChips.getTags()
        }, function (res) {
            doBtn.disabled = false;
            if (res.success) {
                importModal.style.display = 'none';
                var d = res.data;
                showNotice(d.inserted + ' contacts imported, ' + d.merged + ' merged, ' + d.skipped + ' skipped.');
                setTimeout(function () { location.reload(); }, 1200);
            } else {
                progEl.textContent = res.data || 'Import failed.';
            }
        });
    });

    // Open / close import modal
    document.getElementById('oo-import-btn').addEventListener('click', function () {
        goToImportStep(1);
        nextBtn1.disabled = false; // allow re-open with same file
        importModal.style.display = 'flex';
    });
    document.getElementById('oo-import-modal-close').addEventListener('click', function () { importModal.style.display = 'none'; });
    importModal.addEventListener('click', function (e) { if (e.target === importModal) importModal.style.display = 'none'; });

    // ════════════════════════════════════════════════════════════════════
    // UTILITY BUTTONS (Airtable, delete dead, enrich locations)
    // ════════════════════════════════════════════════════════════════════
    var airtableBtn = document.getElementById('oo-airtable-push-btn');
    if (airtableBtn) {
        airtableBtn.addEventListener('click', function () {
            airtableBtn.disabled = true; airtableBtn.textContent = 'Syncing…';
            var result = document.getElementById('oo-airtable-push-result');
            post('oo_airtable_push_all', {}, function (res) {
                airtableBtn.disabled = false; airtableBtn.textContent = 'Sync Airtable';
                result.className = 'oo-notice ' + (res.success ? 'oo-notice-success' : 'oo-notice-error');
                result.textContent = res.success ? (res.data.pushed + ' contacts synced.') : (res.data || 'Sync failed.');
                result.style.display = 'block';
            });
        });
    }

    var deadBtn = document.getElementById('oo-delete-dead-btn');
    if (deadBtn) {
        deadBtn.addEventListener('click', function () {
            if (!confirm('Delete all invalid and dead email contacts?')) return;
            deadBtn.disabled = true; deadBtn.textContent = 'Deleting…';
            var result = document.getElementById('oo-dead-result');
            post('oo_bulk_delete_dead', {}, function (res) {
                if (res.success) {
                    result.className = 'oo-notice oo-notice-success';
                    result.textContent = res.data.deleted + ' deleted.';
                    result.style.display = 'block';
                    setTimeout(function () { location.reload(); }, 1200);
                } else {
                    deadBtn.disabled = false; deadBtn.textContent = 'Delete Dead / Invalid';
                    result.className = 'oo-notice oo-notice-error';
                    result.textContent = res.data || 'Failed.';
                    result.style.display = 'block';
                }
            });
        });
    }

    var enrichBtn = document.getElementById('oo-enrich-locations-btn');
    if (enrichBtn) {
        var enrichResult = document.getElementById('oo-enrich-result');
        var enrichLabel  = document.getElementById('oo-enrich-btn-text');
        enrichBtn.addEventListener('click', function runBatch() {
            enrichBtn.disabled = true;
            post('oo_enrich_locations', {}, function (res) {
                if (!res.success) {
                    enrichBtn.disabled = false;
                    enrichResult.className = 'oo-notice oo-notice-error';
                    enrichResult.textContent = res.data || 'Enrichment failed.';
                    enrichResult.style.display = 'block';
                    return;
                }
                var d = res.data;
                enrichResult.className = 'oo-notice oo-notice-success';
                enrichResult.textContent = d.updated + ' locations updated, ' + d.failed + ' failed. ' +
                    (d.remaining > 0 ? d.remaining + ' still missing — click again.' : 'All done!');
                enrichResult.style.display = 'block';
                if (d.remaining > 0) {
                    enrichLabel.textContent = 'Enrich Locations (' + d.remaining + ' remaining)';
                    enrichBtn.disabled = false;
                } else {
                    enrichBtn.parentNode.style.display = 'none';
                    setTimeout(function () { location.reload(); }, 1800);
                }
            });
        });
    }

    // ── Delete All contacts ─────────────────────────────────────────
    var deleteAllBtn   = document.getElementById('oo-delete-all-btn');
    var deleteAllModal = document.getElementById('oo-delete-all-modal');
    if (deleteAllBtn && deleteAllModal) {
        var deleteAllInput   = document.getElementById('oo-delete-all-confirm-input');
        var deleteAllConfirm = document.getElementById('oo-delete-all-confirm-btn');
        var deleteAllStatus  = document.getElementById('oo-delete-all-status');

        deleteAllBtn.addEventListener('click', function () {
            deleteAllInput.value = '';
            deleteAllConfirm.disabled = true;
            deleteAllStatus.textContent = '';
            deleteAllModal.style.display = 'flex';
            setTimeout(function () { deleteAllInput.focus(); }, 100);
        });

        deleteAllInput.addEventListener('input', function () {
            deleteAllConfirm.disabled = deleteAllInput.value.trim() !== 'DELETE';
        });

        document.getElementById('oo-delete-all-modal-close').addEventListener('click', function () { deleteAllModal.style.display = 'none'; });
        document.getElementById('oo-delete-all-cancel-btn').addEventListener('click', function () { deleteAllModal.style.display = 'none'; });
        deleteAllModal.addEventListener('click', function (e) { if (e.target === deleteAllModal) deleteAllModal.style.display = 'none'; });

        deleteAllConfirm.addEventListener('click', function () {
            deleteAllConfirm.disabled = true;
            deleteAllStatus.textContent = 'Deleting…';
            post('oo_delete_all_contacts', {}, function (res) {
                if (res.success) {
                    deleteAllStatus.textContent = res.data.deleted + ' contacts deleted.';
                    setTimeout(function () { location.reload(); }, 1000);
                } else {
                    deleteAllConfirm.disabled = false;
                    deleteAllStatus.textContent = res.data || 'Delete failed.';
                }
            });
        });
    }


})();
