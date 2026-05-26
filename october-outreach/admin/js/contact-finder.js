/* October Outreach — Contact Finder Wizard */

(function ($) {
    'use strict';

    var cf = {
        currentStep: 1,
        data: {
            domains: [],
            jobTitles: [],
            contacts: [],      // contacts from search step (all accumulated)
            verified: [],      // contacts after verify step (with verified_status set)
            remainingDomains: [],
            searchedDomains: [],
        },

        init: function () {
            this.bindEvents();
        },

        bindEvents: function () {
            // Step 1 — audience
            $('#cf-refine-audience').on('click', this.refineAudience.bind(this));
            $('#cf-add-domain-btn').on('click', this.addDomain.bind(this));
            $('#cf-add-domain').on('keypress', function (e) {
                if (e.which === 13) { e.preventDefault(); cf.addDomain(); }
            });
            $('#cf-more-domains-btn').on('click', this.moreDomains.bind(this));
            $('#cf-discover-domains-btn').on('click', this.discoverDomains.bind(this));
            $('#cf-step1-next').on('click', this.step1Next.bind(this));

            // Step 2 — search
            $('#cf-step2-back').on('click', function () { cf.goToStep(1); });
            $('#cf-search-contacts').on('click', this.searchContacts.bind(this));
            $('#cf-select-all').on('click', function () { $('.cf-contact-check').prop('checked', true); });
            $('#cf-deselect-all').on('click', function () { $('.cf-contact-check').prop('checked', false); });
            $('#cf-step2-next').on('click', this.step2Next.bind(this));

            // Step 3 — verify
            $('#cf-step3-back').on('click', function () { cf.goToStep(2); });
            $('#cf-verify-emails').on('click', this.verifyEmails.bind(this));
            $('#cf-skip-verify').on('click', this.skipVerify.bind(this));
            $('#cf-verify-select-valid').on('click', function () {
                $('.cf-verify-check').each(function () {
                    var status = $(this).data('status');
                    $(this).prop('checked', status === 'valid' || status === 'risky' || status === 'unverified');
                });
            });
            $('#cf-verify-select-all').on('click', function () { $('.cf-verify-check').prop('checked', true); });
            $('#cf-verify-deselect-dead').on('click', function () {
                $('.cf-verify-check').each(function () {
                    var status = $(this).data('status');
                    if (status === 'invalid' || status === 'dead') {
                        $(this).prop('checked', false);
                    }
                });
            });
            $('#cf-step3-next').on('click', this.step3Next.bind(this));

            // Step 4 — save
            $('#cf-step4-back').on('click', function () { cf.goToStep(3); });
            $('#cf-save-contacts').on('click', this.saveContacts.bind(this));
            $('#cf-start-over').on('click', this.startOver.bind(this));
        },

        goToStep: function (step) {
            this.currentStep = step;
            $('.oo-wizard-panel').removeClass('active');
            $('#oo-cf-step-' + step).addClass('active');
            $('.oo-wizard-step').removeClass('active completed');
            for (var i = 1; i < step; i++) {
                $('[data-step="' + i + '"]').addClass('completed');
            }
            $('[data-step="' + step + '"]').addClass('active');
            $('html, body').animate({ scrollTop: $('#oo-cf-wizard').offset().top - 40 }, 300);
        },

        setLoading: function (btn, loading) {
            var $btn = $(btn);
            $btn.prop('disabled', loading);
            $btn.find('.oo-btn-text').toggle(!loading);
            $btn.find('.oo-btn-loading').toggle(loading);
        },

        // ── Step 1 ────────────────────────────────────────────

        refineAudience: function () {
            var audience = $('#cf_audience').val().trim();
            if (!audience) {
                alert('Please describe your target audience first.');
                return;
            }
            this.setLoading('#cf-refine-audience', true);

            $.post(ooData.ajaxUrl, {
                action: 'oo_wizard_refine_audience',
                nonce: ooData.nonce,
                campaign_name:      'Contact Finder',
                brand:              '',
                campaign_type:      'outreach',
                audience:           audience,
                claude_prompt:      $('#cf_claude_prompt').val(),
                aud_location:       $('#cf_location').val(),
                aud_industry_type:  $('#cf_industry_type').val(),
                aud_specialisation: $('#cf_specialisation').val(),
                aud_business_size:  $('#cf_business_size').val(),
                aud_exclude_types:  $('#cf_exclude_types').val(),
                existing_domains:   $('#cf_exclude_searched').is(':checked')
                    ? this.data.domains.concat(this.data.searchedDomains)
                    : [],
            }, function (res) {
                cf.setLoading('#cf-refine-audience', false);
                if (res.success) {
                    cf.renderAudienceResult(res.data);
                    $('#cf-audience-result').show();
                } else {
                    alert('Claude error: ' + (res.data || 'Unknown error'));
                }
            }).fail(function () {
                cf.setLoading('#cf-refine-audience', false);
                alert('Request failed. Please try again.');
            });
        },

        renderAudienceResult: function (data) {
            $('#cf-refined-description').text(data.refined_description || '');
            $('#cf-rationale').text(data.rationale || '');
            this.data.domains   = data.domains    || [];
            this.data.jobTitles = data.job_titles || [];
            this.renderTags('#cf-domains-list', this.data.domains, 'domain');
            this.renderTags('#cf-titles-list', this.data.jobTitles, 'title');
        },

        renderTags: function (container, items, type) {
            var $c = $(container).empty();
            items.forEach(function (item, i) {
                var $tag    = $('<span class="oo-tag">').text(item);
                var $remove = $('<button class="oo-tag-remove" type="button">×</button>').on('click', function () {
                    if (type === 'domain') cf.data.domains.splice(i, 1);
                    else cf.data.jobTitles.splice(i, 1);
                    cf.renderTags(container, type === 'domain' ? cf.data.domains : cf.data.jobTitles, type);
                });
                $tag.append($remove);
                $c.append($tag);
            });
        },

        addDomain: function () {
            var val = $('#cf-add-domain').val().trim().toLowerCase().replace(/^https?:\/\//, '');
            if (!val) return;
            if (this.data.domains.indexOf(val) === -1) {
                this.data.domains.push(val);
                this.renderTags('#cf-domains-list', this.data.domains, 'domain');
            }
            $('#cf-add-domain').val('');
        },

        moreDomains: function () {
            this.setLoading('#cf-more-domains-btn', true);
            $('#cf-discover-note').hide();

            $.post(ooData.ajaxUrl, {
                action:             'oo_wizard_more_domains',
                nonce:              ooData.nonce,
                campaign_name:      'Contact Finder',
                brand:              '',
                audience:           $('#cf_audience').val(),
                aud_location:       $('#cf_location').val(),
                aud_industry_type:  $('#cf_industry_type').val(),
                aud_specialisation: $('#cf_specialisation').val(),
                aud_business_size:  $('#cf_business_size').val(),
                existing_domains:   cf.data.domains,
            }, function (res) {
                cf.setLoading('#cf-more-domains-btn', false);
                if (res.success) {
                    var added = 0;
                    (res.data.domains || []).forEach(function (d) {
                        if (cf.data.domains.indexOf(d) === -1) { cf.data.domains.push(d); added++; }
                    });
                    cf.renderTags('#cf-domains-list', cf.data.domains, 'domain');
                    var note = added + ' new domains added';
                    if (res.data.angle) note += ' (' + res.data.angle + ')';
                    $('#cf-discover-note').text(note).show();
                } else {
                    alert('Error: ' + (res.data || 'Unknown error'));
                }
            }).fail(function () {
                cf.setLoading('#cf-more-domains-btn', false);
                alert('Request failed. Please try again.');
            });
        },

        discoverDomains: function () {
            this.setLoading('#cf-discover-domains-btn', true);
            $('#cf-discover-note').hide();

            $.post(ooData.ajaxUrl, {
                action:             'oo_wizard_discover_domains',
                nonce:              ooData.nonce,
                aud_location:       $('#cf_location').val(),
                aud_industry_type:  $('#cf_industry_type').val(),
                aud_specialisation: $('#cf_specialisation').val(),
                existing_domains:   cf.data.domains,
            }, function (res) {
                cf.setLoading('#cf-discover-domains-btn', false);
                if (res.success) {
                    var added = 0;
                    (res.data.domains || []).forEach(function (d) {
                        if (cf.data.domains.indexOf(d) === -1) { cf.data.domains.push(d); added++; }
                    });
                    cf.renderTags('#cf-domains-list', cf.data.domains, 'domain');
                    var notes = res.data.notes || [];
                    var note  = added + ' new domains added';
                    if (notes.length) note += ' — ' + notes.join('; ');
                    $('#cf-discover-note').text(note).show();
                } else {
                    alert('Error: ' + (res.data || 'Unknown error'));
                }
            }).fail(function () {
                cf.setLoading('#cf-discover-domains-btn', false);
                alert('Request failed. Please try again.');
            });
        },

        step1Next: function () {
            if (this.data.domains.length === 0) {
                alert('Please add at least one domain to search.');
                return;
            }
            this.goToStep(2);
        },

        // ── Step 2 ────────────────────────────────────────────

        searchContacts: function () {
            var toSearch = this.data.remainingDomains.length > 0
                ? this.data.remainingDomains
                : this.data.domains;

            if (toSearch.length === 0) {
                alert('No domains to search. Go back and define your audience first.');
                return;
            }

            this.setLoading('#cf-search-contacts', true);
            $('#cf-search-progress').hide();

            $.post(ooData.ajaxUrl, {
                action:              'oo_wizard_search_contacts',
                nonce:               ooData.nonce,
                domains:             toSearch,
                job_titles:          this.data.jobTitles,
                contact_type:        $('#cf_contact_type').val(),
                contacts_per_domain: $('#cf_contacts_per_domain').val() || 25,
                include_personal:    $('#cf-include-personal').is(':checked') ? '1' : '0',
                include_generic:     $('#cf-include-generic').is(':checked')  ? '1' : '0',
            }, function (res) {
                cf.setLoading('#cf-search-contacts', false);
                if (res.success) {
                    var d = res.data;
                    if (d.searched) {
                        cf.data.searchedDomains = cf.data.searchedDomains.concat(d.searched);
                    }
                    cf.data.remainingDomains = d.remaining || [];
                    cf.data.contacts = cf.data.contacts.concat(d.contacts || []);
                    cf.renderContactsTable(cf.data.contacts, d.errors);

                    var searched  = cf.data.searchedDomains.length;
                    var remaining = cf.data.remainingDomains.length;
                    var total     = searched + remaining;
                    var msg = 'Searched ' + searched + ' of ' + total + ' domains. ';
                    if (remaining > 0) {
                        msg += remaining + ' remaining — click Search again for more.';
                        $('#cf-search-contacts').find('.oo-btn-text').text('Search Next ' + Math.min(8, remaining) + ' Domains →');
                    } else {
                        msg += 'All domains searched.';
                        $('#cf-search-contacts').find('.oo-btn-text').text('Search for Contacts →');
                    }
                    if (d.provider_notes && d.provider_notes.length && cf.data.contacts.length === 0) {
                        msg += ' Note: ' + d.provider_notes.join('; ');
                    }
                    $('#cf-search-progress').text(msg).show();
                    $('#cf-contacts-results').show();
                } else {
                    alert('Search error: ' + (res.data || 'Unknown error'));
                }
            }).fail(function () {
                cf.setLoading('#cf-search-contacts', false);
                alert('Search failed. Please try again.');
            });
        },

        renderContactsTable: function (contacts, errors) {
            $('#cf-contacts-count').text(contacts.length);

            var html = '<div class="oo-table-wrap"><table class="oo-table"><thead><tr>';
            html += '<th style="width:30px"><input type="checkbox" id="cf-check-all" checked></th>';
            html += '<th>Name</th><th>Email</th><th>Company</th><th>Title</th><th>Conf.</th><th>Source</th></tr></thead><tbody>';

            contacts.forEach(function (c, i) {
                var name     = (c.first_name + ' ' + c.last_name).trim() || '—';
                var conf     = c.confidence || 0;
                var confClass = conf >= 80 ? 'green' : conf >= 50 ? 'orange' : 'grey';
                var srcMap   = {icypeas:'Icypeas',hunter:'Hunter','web-scrape':'Scrape',pattern:'Pattern','icypeas-domain-scan':'Icypeas'};
                var srcLabel = srcMap[c.source] || (c.source || '?');
                html += '<tr>';
                html += '<td><input type="checkbox" class="cf-contact-check" data-index="' + i + '" checked></td>';
                html += '<td>' + cf.esc(name) + '</td>';
                html += '<td>' + cf.esc(c.email) + '</td>';
                html += '<td>' + cf.esc(c.company || '—') + '</td>';
                html += '<td>' + cf.esc(c.title || c.position || '—') + '</td>';
                html += '<td><span class="oo-badge oo-badge-' + confClass + '">' + conf + '%</span></td>';
                html += '<td><span class="oo-muted" style="font-size:11px">' + cf.esc(srcLabel) + '</span></td>';
                html += '</tr>';
            });

            html += '</tbody></table></div>';

            if (errors && Object.keys(errors).length) {
                html += '<p class="oo-muted" style="margin-top:8px">Domains with no results: ' + Object.keys(errors).join(', ') + '</p>';
            }

            $('#cf-contacts-table-wrap').html(html);

            $('#cf-check-all').on('change', function () {
                $('.cf-contact-check').prop('checked', $(this).is(':checked'));
            });
        },

        step2Next: function () {
            var selected = [];
            $('.cf-contact-check:checked').each(function () {
                var i = parseInt($(this).data('index'));
                if (cf.data.contacts[i]) selected.push(cf.data.contacts[i]);
            });
            if (selected.length === 0) {
                alert('Please select at least one contact to continue.');
                return;
            }
            cf.data.selected = selected;
            this.goToStep(3);
        },

        // ── Step 3 ────────────────────────────────────────────

        verifyEmails: function () {
            this.setLoading('#cf-verify-emails', true);

            var emails = (cf.data.selected || []).map(function (c) {
                return c.email;
            });

            $.post(ooData.ajaxUrl, {
                action: 'oo_verify_emails',
                nonce:  ooData.nonce,
                emails: emails,
            }, function (res) {
                cf.setLoading('#cf-verify-emails', false);
                if (res.success) {
                    cf.renderVerifyResults(res.data.results || []);
                    $('#cf-verify-results').show();
                } else {
                    alert('Verification error: ' + (res.data || 'Unknown error'));
                }
            }).fail(function () {
                cf.setLoading('#cf-verify-emails', false);
                alert('Request failed. Please try again.');
            });
        },

        skipVerify: function () {
            var contacts = (cf.data.selected || []);
            contacts.forEach(function (c) { c.verified_status = 'unverified'; });
            cf.data.verified = contacts;
            this.goToStep(4);
            this.updateSaveCount();
        },

        renderVerifyResults: function (results) {
            var byEmail = {};
            results.forEach(function (r) { byEmail[r.email] = r; });

            var valid = 0, risky = 0, invalid = 0;

            var html = '<div class="oo-table-wrap"><table class="oo-table"><thead><tr>';
            html += '<th style="width:30px"><input type="checkbox" id="cf-verify-all" checked></th>';
            html += '<th>Email</th><th>Name</th><th>Company</th><th>Verified Status</th></tr></thead><tbody>';

            var contacts = cf.data.selected || [];
            contacts.forEach(function (c, i) {
                var r      = byEmail[c.email] || { status: 'unverified' };
                var status = r.status || 'unverified';

                // Normalise Hunter status values to our internal set
                if (status === 'valid' || status === 'accept_all') status = 'valid';
                else if (status === 'risky' || status === 'unknown') status = 'risky';
                else if (status === 'invalid' || status === 'disposable' || status === 'webmail') status = 'invalid';
                else if (status === 'dead' || status === 'undeliverable') status = 'dead';
                else if (status === 'unverified') status = 'unverified';

                // Honour MX check result
                if (r.mx === false) status = 'dead';

                c.verified_status = status;

                var badgeClass = {valid:'green', risky:'orange', invalid:'red', dead:'grey', unverified:'grey'}[status] || 'grey';
                var label      = {valid:'Valid', risky:'Risky', invalid:'Invalid', dead:'No MX / Dead', unverified:'Not checked'}[status] || status;

                if (status === 'valid') valid++;
                else if (status === 'risky') risky++;
                else if (status === 'invalid' || status === 'dead') invalid++;

                var checked = (status !== 'invalid' && status !== 'dead') ? ' checked' : '';
                var name    = (c.first_name + ' ' + c.last_name).trim() || '—';

                html += '<tr>';
                html += '<td><input type="checkbox" class="cf-verify-check" data-index="' + i + '" data-status="' + status + '"' + checked + '></td>';
                html += '<td>' + cf.esc(c.email) + '</td>';
                html += '<td>' + cf.esc(name) + '</td>';
                html += '<td>' + cf.esc(c.company || '—') + '</td>';
                html += '<td><span class="oo-badge oo-badge-' + badgeClass + '">' + cf.esc(label) + '</span></td>';
                html += '</tr>';
            });

            html += '</tbody></table></div>';

            $('#cf-verify-summary').html(
                '<span class="oo-badge oo-badge-green">' + valid + ' valid</span> ' +
                '<span class="oo-badge oo-badge-orange">' + risky + ' risky</span> ' +
                '<span class="oo-badge oo-badge-grey">' + invalid + ' invalid / dead</span>'
            );
            $('#cf-verify-table-wrap').html(html);

            $('#cf-verify-all').on('change', function () {
                $('.cf-verify-check').prop('checked', $(this).is(':checked'));
            });

            cf.data.verified = contacts;
        },

        step3Next: function () {
            var contacts = cf.data.selected || [];
            var selected = [];
            $('.cf-verify-check:checked').each(function () {
                var i = parseInt($(this).data('index'));
                if (contacts[i]) selected.push(contacts[i]);
            });
            if (selected.length === 0) {
                alert('Please select at least one contact to save.');
                return;
            }
            cf.data.verified = selected;
            this.goToStep(4);
            this.updateSaveCount();
        },

        updateSaveCount: function () {
            $('#cf-selected-count').text((cf.data.verified || []).length);
        },

        // ── Step 4 ────────────────────────────────────────────

        saveContacts: function () {
            var contacts = cf.data.verified || [];
            if (!contacts.length) { alert('No contacts to save.'); return; }

            this.setLoading('#cf-save-contacts', true);

            $.post(ooData.ajaxUrl, {
                action:       'oo_wizard_save_contacts',
                nonce:        ooData.nonce,
                contacts:     JSON.stringify(contacts),
                contact_type: $('#cf_contact_type').val(),
                campaign_id:  0,
            }, function (res) {
                cf.setLoading('#cf-save-contacts', false);
                if (res.success) {
                    var msg = res.data.inserted + ' contacts added';
                    if (res.data.skipped) msg += ', ' + res.data.skipped + ' skipped (duplicates)';
                    $('#cf-save-result')
                        .removeClass('oo-notice-error').addClass('oo-notice-success oo-notice')
                        .text(msg).show();
                    $('#cf-save-done').show();
                    $('#cf-save-contacts').hide();
                    $('#cf-step4-back').hide();
                } else {
                    $('#cf-save-result')
                        .removeClass('oo-notice-success').addClass('oo-notice-error oo-notice')
                        .text(res.data || 'Error saving contacts').show();
                }
            }).fail(function () {
                cf.setLoading('#cf-save-contacts', false);
                alert('Request failed. Please try again.');
            });
        },

        startOver: function () {
            cf.data = { domains: [], jobTitles: [], contacts: [], verified: [], remainingDomains: [], searchedDomains: [] };
            $('#cf-audience-result').hide();
            $('#cf-contacts-results').hide();
            $('#cf-verify-results').hide();
            $('#cf-save-result').hide();
            $('#cf-save-done').hide();
            $('#cf-save-contacts').show();
            $('#cf-step4-back').show();
            $('#cf-domains-list, #cf-titles-list').empty();
            $('#cf_audience').val('').focus();
            cf.goToStep(1);
        },

        esc: function (str) {
            return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },
    };

    $(document).ready(function () {
        if ($('#oo-cf-wizard').length) {
            cf.init();
        }
    });

}(jQuery));
