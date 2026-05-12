/* October Outreach — Campaign Wizard */

(function ($) {
    'use strict';

    var wizard = {
        campaignId: 0,
        currentStep: 1,
        data: {
            domains: [],
            jobTitles: [],
            contacts: [],
            sequence: [],
            contactType: '',
            savedContacts: 0,
        },

        init: function () {
            this.campaignId = parseInt( $('#oo-wizard').data('campaign-id') ) || 0;
            this.bindEvents();
        },

        bindEvents: function () {
            // Step 1
            $('#oo-step1-next').on('click', this.step1Next.bind(this));

            // Step 2
            $('#oo-refine-audience').on('click', this.refineAudience.bind(this));
            $('#oo-add-domain-btn').on('click', this.addDomain.bind(this));
            $('#oo-add-domain').on('keypress', function (e) {
                if (e.which === 13) { e.preventDefault(); wizard.addDomain(); }
            });
            $('#oo-step2-back').on('click', function () { wizard.goToStep(1); });
            $('#oo-step2-next').on('click', this.step2Next.bind(this));

            // Step 3
            $('#oo-search-contacts').on('click', this.searchContacts.bind(this));
            $('#oo-step3-back').on('click', function () { wizard.goToStep(2); });
            $('#oo-select-all').on('click', function () { $('.oo-contact-check').prop('checked', true); });
            $('#oo-deselect-all').on('click', function () { $('.oo-contact-check').prop('checked', false); });
            $('#oo-save-contacts').on('click', this.saveContacts.bind(this));
            $('#oo-step3-next').on('click', function () { wizard.goToStep(4); });

            // Step 4
            $('#oo-generate-emails').on('click', this.generateEmails.bind(this));
            $('#oo-step4-back').on('click', function () { wizard.goToStep(3); });
            $('#oo-save-sequence').on('click', this.saveSequence.bind(this));

            // Step 5
            $('#oo-sync-airtable').on('click', this.syncAirtable.bind(this));
            $('#oo-launch-campaign').on('click', this.launchCampaign.bind(this));
        },

        goToStep: function (step) {
            this.currentStep = step;
            $('.oo-wizard-panel').removeClass('active');
            $('#oo-step-' + step).addClass('active');
            $('.oo-wizard-step').removeClass('active completed');
            for (var i = 1; i < step; i++) {
                $('[data-step="' + i + '"]').addClass('completed');
            }
            $('[data-step="' + step + '"]').addClass('active');
            $('html, body').animate({ scrollTop: $('#oo-wizard').offset().top - 40 }, 300);
        },

        setLoading: function (btn, loading) {
            var $btn = $(btn);
            $btn.prop('disabled', loading);
            $btn.find('.oo-btn-text').toggle(!loading);
            $btn.find('.oo-btn-loading').toggle(loading);
        },

        showNotice: function (selector, message, type) {
            var $el = $(selector);
            $el.removeClass('oo-notice-success oo-notice-error').addClass('oo-notice-' + (type || 'success'));
            $el.text(message).show();
        },

        // ── Step 1 ────────────────────────────────────────────

        step1Next: function () {
            var name = $('#w_name').val().trim();
            var brand = $('#w_brand').val();
            if (!name || !brand) {
                alert('Please enter a campaign name and select a brand.');
                return;
            }
            this.saveCampaignMeta(function () {
                wizard.goToStep(2);
            });
        },

        saveCampaignMeta: function (callback) {
            $.post(ooData.ajaxUrl, {
                action: 'oo_wizard_save_meta',
                nonce: ooData.nonce,
                campaign_id: this.campaignId,
                name: $('#w_name').val(),
                brand: $('#w_brand').val(),
                type: $('#w_type').val(),
                from_name: $('#w_from_name').val(),
                from_email: $('#w_from_email').val(),
                reply_to: $('#w_reply_to').val(),
                coupon_url: $('#w_coupon_url').val(),
                coupon_field: $('#w_coupon_field').val(),
            }, function (res) {
                if (res.success) {
                    wizard.campaignId = res.data.campaign_id;
                    $('#oo-wizard').data('campaign-id', wizard.campaignId);
                    if (callback) callback();
                } else {
                    alert('Error saving campaign: ' + (res.data || 'Unknown error'));
                }
            });
        },

        // ── Step 2 ────────────────────────────────────────────

        refineAudience: function () {
            var audience = $('#w_audience').val().trim();
            if (!audience) {
                alert('Please describe your target audience first.');
                return;
            }

            this.data.contactType = $('#w_contact_type').val();
            this.setLoading('#oo-refine-audience', true);

            $.post(ooData.ajaxUrl, {
                action: 'oo_wizard_refine_audience',
                nonce: ooData.nonce,
                campaign_id: this.campaignId,
                audience: audience,
                claude_prompt: $('#w_claude_prompt').val(),
                campaign_name: $('#w_name').val(),
                brand: $('#w_brand').val(),
                campaign_type: $('#w_type').val(),
            }, function (res) {
                wizard.setLoading('#oo-refine-audience', false);
                if (res.success) {
                    wizard.renderAudienceResult(res.data);
                    $('#oo-audience-result').show();
                } else {
                    alert('Claude error: ' + (res.data || 'Unknown error'));
                }
            }).fail(function () {
                wizard.setLoading('#oo-refine-audience', false);
                alert('Request failed. Please try again.');
            });
        },

        renderAudienceResult: function (data) {
            $('#oo-refined-description').text(data.refined_description || '');
            $('#oo-rationale').text(data.rationale || '');

            this.data.domains = data.domains || [];
            this.data.jobTitles = data.job_titles || [];

            this.renderTags('#oo-domains-list', this.data.domains, 'domain');
            this.renderTags('#oo-titles-list', this.data.jobTitles, 'title');
        },

        renderTags: function (container, items, type) {
            var $c = $(container).empty();
            items.forEach(function (item, i) {
                var $tag = $('<span class="oo-tag">').text(item);
                var $remove = $('<button class="oo-tag-remove" type="button">×</button>').on('click', function () {
                    if (type === 'domain') wizard.data.domains.splice(i, 1);
                    else wizard.data.jobTitles.splice(i, 1);
                    wizard.renderTags(container, type === 'domain' ? wizard.data.domains : wizard.data.jobTitles, type);
                });
                $tag.append($remove);
                $c.append($tag);
            });
        },

        addDomain: function () {
            var val = $('#oo-add-domain').val().trim().toLowerCase().replace(/^https?:\/\//, '');
            if (!val) return;
            if (this.data.domains.indexOf(val) === -1) {
                this.data.domains.push(val);
                this.renderTags('#oo-domains-list', this.data.domains, 'domain');
            }
            $('#oo-add-domain').val('');
        },

        step2Next: function () {
            if (this.data.domains.length === 0) {
                alert('Please add at least one domain to search.');
                return;
            }
            // Save audience back to campaign
            $.post(ooData.ajaxUrl, {
                action: 'oo_wizard_save_audience',
                nonce: ooData.nonce,
                campaign_id: this.campaignId,
                audience_description: $('#w_audience').val(),
                claude_prompt: $('#w_claude_prompt').val(),
            });
            this.goToStep(3);
        },

        // ── Step 3 ────────────────────────────────────────────

        searchContacts: function () {
            if (this.data.domains.length === 0) {
                alert('No domains to search. Go back and define your audience first.');
                return;
            }

            this.setLoading('#oo-search-contacts', true);

            $.post(ooData.ajaxUrl, {
                action: 'oo_wizard_search_contacts',
                nonce: ooData.nonce,
                domains: this.data.domains,
                contact_type: this.data.contactType,
            }, function (res) {
                wizard.setLoading('#oo-search-contacts', false);
                if (res.success) {
                    wizard.data.contacts = res.data.contacts || [];
                    wizard.renderContactsTable(res.data);
                    $('#oo-contacts-results').show();
                } else {
                    alert('Hunter.io error: ' + (res.data || 'Unknown error'));
                }
            }).fail(function () {
                wizard.setLoading('#oo-search-contacts', false);
                alert('Search failed. Please try again.');
            });
        },

        renderContactsTable: function (data) {
            $('#oo-contacts-count').text(data.contacts.length);

            var html = '<div class="oo-table-wrap"><table class="oo-table"><thead><tr>';
            html += '<th style="width:30px"><input type="checkbox" id="oo-check-all"></th>';
            html += '<th>Name</th><th>Email</th><th>Company</th><th>Position</th><th>Confidence</th></tr></thead><tbody>';

            data.contacts.forEach(function (c, i) {
                var name = (c.first_name + ' ' + c.last_name).trim() || '—';
                var conf = c.confidence || 0;
                var confClass = conf >= 80 ? 'green' : conf >= 50 ? 'orange' : 'grey';
                html += '<tr>';
                html += '<td><input type="checkbox" class="oo-contact-check" data-index="' + i + '" checked></td>';
                html += '<td>' + wizard.esc(name) + '</td>';
                html += '<td>' + wizard.esc(c.email) + '</td>';
                html += '<td>' + wizard.esc(c.company || '—') + '</td>';
                html += '<td>' + wizard.esc(c.position || '—') + '</td>';
                html += '<td><span class="oo-badge oo-badge-' + confClass + '">' + conf + '%</span></td>';
                html += '</tr>';
            });

            html += '</tbody></table></div>';

            if (data.errors && Object.keys(data.errors).length) {
                html += '<p class="oo-muted">Domains with no results: ' + Object.keys(data.errors).join(', ') + '</p>';
            }

            $('#oo-contacts-table-wrap').html(html);

            $('#oo-check-all').on('change', function () {
                $('.oo-contact-check').prop('checked', $(this).is(':checked'));
            });
        },

        saveContacts: function () {
            var selected = [];
            $('.oo-contact-check:checked').each(function () {
                var i = parseInt($(this).data('index'));
                if (wizard.data.contacts[i]) selected.push(wizard.data.contacts[i]);
            });

            if (selected.length === 0) {
                alert('No contacts selected.');
                return;
            }

            this.setLoading('#oo-save-contacts', true);

            $.post(ooData.ajaxUrl, {
                action: 'oo_wizard_save_contacts',
                nonce: ooData.nonce,
                contacts: JSON.stringify(selected),
                contact_type: this.data.contactType,
                campaign_id: this.campaignId,
            }, function (res) {
                wizard.setLoading('#oo-save-contacts', false);
                if (res.success) {
                    wizard.data.savedContacts = res.data.inserted || 0;
                    wizard.showNotice('#oo-save-result',
                        res.data.inserted + ' contacts added, ' + res.data.skipped + ' skipped (duplicates)',
                        'success'
                    );
                } else {
                    wizard.showNotice('#oo-save-result', res.data || 'Error saving contacts', 'error');
                }
            });
        },

        // ── Step 4 ────────────────────────────────────────────

        generateEmails: function () {
            this.setLoading('#oo-generate-emails', true);

            $.post(ooData.ajaxUrl, {
                action: 'oo_wizard_generate_emails',
                nonce: ooData.nonce,
                campaign_id: this.campaignId,
                audience: $('#w_audience').val(),
                claude_prompt: $('#w_claude_prompt').val(),
            }, function (res) {
                wizard.setLoading('#oo-generate-emails', false);
                if (res.success) {
                    wizard.data.sequence = res.data.sequence || [];
                    wizard.renderEmailSequence(wizard.data.sequence);
                    $('#oo-emails-result').show();
                } else {
                    alert('Claude error: ' + (res.data || 'Unknown error'));
                }
            }).fail(function () {
                wizard.setLoading('#oo-generate-emails', false);
                alert('Request failed. Please try again.');
            });
        },

        renderEmailSequence: function (sequence) {
            var html = '';
            var labels = {1: 'Email 1 — Initial Outreach (Day 0)', 2: 'Email 2 — Follow-up (Day 4)', 3: 'Email 3 — Final Nudge (Day 9)'};

            sequence.forEach(function (email) {
                var step = email.step;
                html += '<div class="oo-card oo-email-card" data-step="' + step + '">';
                html += '<h2 class="oo-card-title">' + (labels[step] || 'Email ' + step) + '</h2>';
                html += '<div class="oo-field"><label class="oo-label">Subject</label>';
                html += '<input type="text" class="oo-input oo-email-subject" value="' + wizard.esc(email.subject) + '"></div>';
                html += '<div class="oo-field"><label class="oo-label">Body</label>';
                html += '<textarea class="oo-textarea oo-email-body" rows="8">' + wizard.esc(email.body) + '</textarea></div>';
                html += '<div class="oo-field"><label class="oo-label">Send delay</label>';
                html += '<div style="display:flex;align-items:center;gap:8px"><input type="number" class="oo-input oo-email-delay" style="width:80px" value="' + email.delay_days + '"><span class="oo-muted">days after previous email</span></div></div>';
                html += '</div>';
            });

            $('#oo-email-sequence').html(html);
        },

        saveSequence: function () {
            var sequence = [];
            $('.oo-email-card').each(function () {
                sequence.push({
                    step: $(this).data('step'),
                    subject: $(this).find('.oo-email-subject').val(),
                    body: $(this).find('.oo-email-body').val(),
                    delay_days: parseInt($(this).find('.oo-email-delay').val()) || 0,
                });
            });

            if (!sequence.length) {
                alert('No emails to save.');
                return;
            }

            this.setLoading('#oo-save-sequence', true);

            $.post(ooData.ajaxUrl, {
                action: 'oo_wizard_save_sequence',
                nonce: ooData.nonce,
                campaign_id: this.campaignId,
                sequence: JSON.stringify(sequence),
            }, function (res) {
                wizard.setLoading('#oo-save-sequence', false);
                if (res.success) {
                    wizard.showNotice('#oo-sequence-result', 'Email sequence saved.', 'success');
                    wizard.renderLaunchSummary();
                    wizard.goToStep(5);
                } else {
                    wizard.showNotice('#oo-sequence-result', res.data || 'Error saving sequence', 'error');
                }
            });
        },

        // ── Step 5 ────────────────────────────────────────────

        renderLaunchSummary: function () {
            var html = '<table class="oo-status-table">';
            html += '<tr><td>Campaign</td><td><strong>' + wizard.esc($('#w_name').val()) + '</strong></td></tr>';
            html += '<tr><td>Brand</td><td>' + wizard.esc($('#w_brand option:selected').text()) + '</td></tr>';
            html += '<tr><td>From</td><td>' + wizard.esc($('#w_from_email').val()) + '</td></tr>';
            html += '<tr><td>Contacts added</td><td><span class="oo-badge oo-badge-blue">' + (wizard.data.savedContacts || 0) + '</span></td></tr>';
            html += '<tr><td>Emails in sequence</td><td><span class="oo-badge oo-badge-blue">' + wizard.data.sequence.length + '</span></td></tr>';
            html += '</table>';
            $('#oo-launch-details').html(html);
        },

        syncAirtable: function () {
            this.setLoading('#oo-sync-airtable', true);
            $.post(ooData.ajaxUrl, {
                action: 'oo_wizard_sync_airtable',
                nonce: ooData.nonce,
            }, function (res) {
                wizard.setLoading('#oo-sync-airtable', false);
                if (res.success) {
                    wizard.showNotice('#oo-airtable-result', res.data.pushed + ' contacts synced to Airtable.', 'success');
                } else {
                    wizard.showNotice('#oo-airtable-result', res.data || 'Airtable sync error', 'error');
                }
            });
        },

        launchCampaign: function () {
            if (!confirm('Set this campaign to Active and start sending?')) return;
            this.setLoading('#oo-launch-campaign', true);
            $.post(ooData.ajaxUrl, {
                action: 'oo_wizard_launch',
                nonce: ooData.nonce,
                campaign_id: this.campaignId,
            }, function (res) {
                wizard.setLoading('#oo-launch-campaign', false);
                if (res.success) {
                    wizard.showNotice('#oo-launch-result', 'Campaign launched! Emails will begin sending.', 'success');
                    setTimeout(function () {
                        window.location = ooData.campaignsUrl;
                    }, 2000);
                } else {
                    wizard.showNotice('#oo-launch-result', res.data || 'Launch error', 'error');
                }
            });
        },

        esc: function (str) {
            return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },
    };

    $(document).ready(function () {
        if ($('#oo-wizard').length) {
            wizard.init();
        }
    });

}(jQuery));
