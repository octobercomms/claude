/* October Outreach — Campaign Wizard */

(function ($) {
    'use strict';

    var wizard = {
        campaignId: 0,
        currentStep: 1,
        data: {
            sequence: [],
            savedContacts: 0,
        },

        init: function () {
            this.campaignId = parseInt( $('#oo-wizard').data('campaign-id') ) || 0;
            this.applyModules();
            this.bindEvents();
            this.loadExistingData();
            this.initPreviewModal();
        },

        applyModules: function () {
            var m = (typeof ooData !== 'undefined' && ooData.modules) ? ooData.modules : {};
            var singleModule = (!!m.enableOutreach) !== (!!m.enablePress); // XOR
            if ( ! singleModule ) return;

            var forcedType = m.enableOutreach ? 'outreach' : 'press_release';
            var $sel = $('#w_type');

            // Replace any select with a hidden input
            if ( $sel.length && $sel[0].tagName === 'SELECT' ) {
                $sel.closest('.oo-field').hide();
                $sel.replaceWith( '<input type="hidden" id="w_type" value="' + forcedType + '">' );
            }
        },

        // Pre-load sequences and contact count for existing campaigns,
        // and make the step nav directly clickable.
        loadExistingData: function () {
            var init = window.ooWizardInit || {};

            if ( init.sequences && init.sequences.length ) {
                this.data.sequence = init.sequences;
                this.renderEmailSequence( init.sequences );
                $('#oo-emails-result').show();
            }

            this.data.savedContacts = parseInt( init.contactCount ) || 0;

            // Allow clicking any step tab when editing an existing campaign
            if ( this.campaignId ) {
                $('#oo-wizard').addClass('navigable');
                $('.oo-wizard-nav .oo-wizard-step').on('click', function () {
                    var step = parseInt( $(this).data('step') );
                    if ( step ) wizard.goToStep( step );
                });
            }
        },

        updateTypeCards: function () {
            var type = $('#w_type').val();
            $('#oo-press-card').toggle( type === 'press_release' );
            $('#oo-coupon-card').toggle( type !== 'press_release' );
        },

        bindEvents: function () {
            // Step 1
            $('#w_type').on('change', this.updateTypeCards.bind(this));
            this.updateTypeCards();
            $('#oo-step1-next').on('click', this.step1Next.bind(this));

            // Step 2 — contacts
            $('#oo-step2-back').on('click', function () { wizard.goToStep(1); });
            $('#oo-filter-contacts-btn').on('click', this.filterExistingContacts.bind(this));
            $('#oo-existing-select-all').on('click', function () { $('.oo-existing-check').prop('checked', true); });
            $('#oo-existing-deselect-all').on('click', function () { $('.oo-existing-check').prop('checked', false); });
            $('#oo-link-contacts').on('click', this.linkExistingContacts.bind(this));
            $('#oo-step2-next').on('click', function () { wizard.goToStep(3); });

            // Step 3 — emails
            $('#oo-step3-back').on('click', function () { wizard.goToStep(2); });
            $('#oo-generate-emails').on('click', this.generateEmails.bind(this));
            $('#oo-save-sequence').on('click', this.saveSequence.bind(this));

            // Email preview / test send (delegated — cards are rendered dynamically)
            $(document).on('click', '.oo-preview-btn', this.previewEmail.bind(this));
            $(document).on('click', '.oo-test-btn',    this.sendTestEmail.bind(this));

            // Step 4 — launch
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
            if (!name) {
                alert('Please enter a campaign name.');
                return;
            }
            this.saveCampaignMeta(function () {
                wizard.goToStep(2);
            });
        },

        saveCampaignMeta: function (callback) {
            $.post(ooData.ajaxUrl, {
                action:              'oo_wizard_save_meta',
                nonce:               ooData.nonce,
                campaign_id:         this.campaignId,
                name:                $('#w_name').val(),
                brand:               $('#w_brand').val(),
                type:                $('#w_type').val(),
                from_name:           $('#w_from_name').val(),
                from_email:          $('#w_from_email').val(),
                reply_to:            $('#w_reply_to').val(),
                coupon_url:          $('#w_coupon_url').val(),
                coupon_field:        $('#w_coupon_field').val(),
                press_release_url:   $('#w_press_release_url').val(),
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

        filterExistingContacts: function () {
            var $btn = $('#oo-filter-contacts-btn');
            $btn.prop('disabled', true).text('Filtering…');

            $.post(ooData.ajaxUrl, {
                action:      'oo_wizard_filter_contacts',
                nonce:       ooData.nonce,
                campaign_id: this.campaignId,
                type:        $('#oo-filter-type').val(),
                location:    $('#oo-filter-location').val(),
                verified:    $('#oo-filter-verified').val(),
            }, function (res) {
                $btn.prop('disabled', false).text('Filter');
                if (!res.success) { alert(res.data || 'Error filtering contacts'); return; }

                var contacts = res.data.contacts || [];
                $('#oo-existing-count').text(contacts.length);

                var vBadge = {valid:'green', risky:'orange', invalid:'red', dead:'grey', unverified:'grey'};
                var vLabel = {valid:'Valid', risky:'Risky', invalid:'Invalid', dead:'Dead', unverified:'—'};

                var html = '<div class="oo-table-wrap"><table class="oo-table"><thead><tr>';
                html += '<th style="width:30px"></th><th>Name</th><th>Email</th><th>Company</th><th>Type</th><th>Location</th><th>Verified</th></tr></thead><tbody>';
                contacts.forEach(function (c) {
                    var name = (c.first_name + ' ' + c.last_name).trim() || '—';
                    var vs   = c.verified_status || 'unverified';
                    html += '<tr>';
                    html += '<td><input type="checkbox" class="oo-existing-check" data-id="' + c.id + '" checked></td>';
                    html += '<td>' + wizard.esc(name) + '</td>';
                    html += '<td>' + wizard.esc(c.email) + '</td>';
                    html += '<td>' + wizard.esc(c.company || '—') + '</td>';
                    html += '<td>' + wizard.esc(c.type || '—') + '</td>';
                    html += '<td>' + wizard.esc(c.location || '—') + '</td>';
                    html += '<td><span class="oo-badge oo-badge-' + (vBadge[vs] || 'grey') + '">' + wizard.esc(vLabel[vs] || vs) + '</span></td>';
                    html += '</tr>';
                });
                html += '</tbody></table></div>';

                $('#oo-existing-table-wrap').html(html);
                $('#oo-existing-results').show();
            }).fail(function () {
                $btn.prop('disabled', false).text('Filter');
                alert('Request failed.');
            });
        },

        linkExistingContacts: function () {
            var ids = [];
            $('.oo-existing-check:checked').each(function () { ids.push($(this).data('id')); });
            if (!ids.length) { alert('No contacts selected.'); return; }
            if (!this.campaignId) { alert('Save the campaign first (complete Step 1).'); return; }

            this.setLoading('#oo-link-contacts', true);

            $.post(ooData.ajaxUrl, {
                action:      'oo_wizard_link_contacts',
                nonce:       ooData.nonce,
                campaign_id: this.campaignId,
                contact_ids: JSON.stringify(ids),
            }, function (res) {
                wizard.setLoading('#oo-link-contacts', false);
                if (res.success) {
                    wizard.data.savedContacts = (wizard.data.savedContacts || 0) + (res.data.linked || 0);
                    wizard.showNotice('#oo-link-result', res.data.linked + ' contacts added to campaign.', 'success');
                } else {
                    wizard.showNotice('#oo-link-result', res.data || 'Error', 'error');
                }
            });
        },

        // ── Step 3 ────────────────────────────────────────────

        generateEmails: function () {
            this.setLoading('#oo-generate-emails', true);

            $.post(ooData.ajaxUrl, {
                action:       'oo_wizard_generate_emails',
                nonce:        ooData.nonce,
                campaign_id:  this.campaignId,
                audience:     $('#w_audience').val(),
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
            var labels = {1:'Email 1 — Initial Outreach (Day 0)', 2:'Email 2 — Follow-up (Day 4)', 3:'Email 3 — Final Nudge (Day 9)'};
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
                html += '<div style="display:flex;gap:8px;margin-top:8px">';
                html += '<button type="button" class="oo-btn oo-btn-secondary oo-btn-sm oo-preview-btn">Preview</button>';
                html += '<button type="button" class="oo-btn oo-btn-secondary oo-btn-sm oo-test-btn">Send Test</button>';
                html += '</div>';
                html += '</div>';
            });
            $('#oo-email-sequence').html(html);
        },

        saveSequence: function () {
            var sequence = [];
            $('.oo-email-card').each(function () {
                sequence.push({
                    step:       $(this).data('step'),
                    subject:    $(this).find('.oo-email-subject').val(),
                    body:       $(this).find('.oo-email-body').val(),
                    delay_days: parseInt($(this).find('.oo-email-delay').val()) || 0,
                });
            });

            if (!sequence.length) { alert('No emails to save.'); return; }

            this.setLoading('#oo-save-sequence', true);

            $.post(ooData.ajaxUrl, {
                action:      'oo_wizard_save_sequence',
                nonce:       ooData.nonce,
                campaign_id: this.campaignId,
                sequence:    JSON.stringify(sequence),
            }, function (res) {
                wizard.setLoading('#oo-save-sequence', false);
                if (res.success) {
                    wizard.showNotice('#oo-sequence-result', 'Email sequence saved.', 'success');
                    wizard.renderLaunchSummary();
                    wizard.goToStep(4);
                } else {
                    wizard.showNotice('#oo-sequence-result', res.data || 'Error saving sequence', 'error');
                }
            });
        },

        // ── Email preview ──────────────────────────────────────

        initPreviewModal: function () {
            if ($('#oo-preview-modal').length) return;
            $('body').append(
                '<div id="oo-preview-modal" style="display:none;position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);overflow-y:auto">' +
                    '<div style="max-width:660px;margin:48px auto 48px;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.3)">' +
                        '<div style="padding:14px 20px;background:#f8f9fa;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:flex-start;gap:12px">' +
                            '<div>' +
                                '<div style="font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;margin-bottom:3px">Subject preview</div>' +
                                '<div id="oo-preview-subject" style="font-size:14px;font-weight:600;color:#1a202c"></div>' +
                            '</div>' +
                            '<button type="button" id="oo-preview-close" style="background:none;border:none;cursor:pointer;font-size:22px;color:#94a3b8;line-height:1;flex-shrink:0;padding:0">×</button>' +
                        '</div>' +
                        '<iframe id="oo-preview-iframe" style="width:100%;height:580px;border:none;display:block" sandbox="allow-same-origin"></iframe>' +
                    '</div>' +
                '</div>'
            );
            $('#oo-preview-close').on('click', function () { $('#oo-preview-modal').hide(); });
            $('#oo-preview-modal').on('click', function (e) {
                if ($(e.target).is('#oo-preview-modal')) $(this).hide();
            });
        },

        openPreviewModal: function (subject, body) {
            $('#oo-preview-subject').text(subject);
            var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
                '<style>*{box-sizing:border-box}body{margin:0;padding:0;background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#1a202c}' +
                '.wrap{max-width:580px;margin:28px auto;background:#fff;border-radius:6px;padding:36px 40px;box-shadow:0 1px 3px rgba(0,0,0,.1)}' +
                'p{margin:0 0 16px}h1,h2,h3{margin:0 0 12px;line-height:1.3}a{color:#4F46E5}hr{border:none;border-top:1px solid #e2e8f0;margin:24px 0}' +
                'img{max-width:100%;height:auto;display:block}figure{margin:0 0 16px}figcaption{font-size:12px;color:#64748b;margin-top:4px}</style>' +
                '</head><body><div class="wrap">' + body + '</div></body></html>';
            document.getElementById('oo-preview-iframe').srcdoc = html;
            $('#oo-preview-modal').show();
        },

        previewEmail: function (e) {
            var $card   = $(e.target).closest('.oo-email-card');
            var subject = $card.find('.oo-email-subject').val();
            var body    = $card.find('.oo-email-body').val();
            var sample  = { '{{first_name}}': 'Jane', '{{last_name}}': 'Smith', '{{company}}': 'Example Studio' };
            Object.keys(sample).forEach(function (k) {
                subject = subject.split(k).join(sample[k]);
                body    = body.split(k).join(sample[k]);
            });
            this.openPreviewModal(subject, body);
        },

        // ── Test send ──────────────────────────────────────────

        sendTestEmail: function (e) {
            var $btn  = $(e.target);
            var $card = $btn.closest('.oo-email-card');

            if (!this.campaignId) {
                alert('Save the campaign first (Step 1) so we have a From address.');
                return;
            }

            var toEmail = prompt('Send test email to:');
            if (!toEmail || !toEmail.trim()) return;

            $btn.prop('disabled', true).text('Sending…');

            $.post(ooData.ajaxUrl, {
                action:      'oo_send_test_email',
                nonce:       ooData.nonce,
                campaign_id: this.campaignId,
                to_email:    toEmail.trim(),
                subject:     $card.find('.oo-email-subject').val(),
                body:        $card.find('.oo-email-body').val(),
            }, function (res) {
                $btn.prop('disabled', false).text('Send Test');
                if (res.success) {
                    alert('Test sent to ' + toEmail.trim() + '.');
                } else {
                    alert('Error: ' + (res.data || 'Send failed.'));
                }
            }).fail(function () {
                $btn.prop('disabled', false).text('Send Test');
                alert('Request failed.');
            });
        },

        // ── Step 4 ────────────────────────────────────────────

        renderLaunchSummary: function () {
            var html = '<table class="oo-status-table">';
            html += '<tr><td>Campaign</td><td><strong>' + wizard.esc($('#w_name').val()) + '</strong></td></tr>';
            html += '<tr><td>Brand</td><td>' + wizard.esc($('#w_brand').val()) + '</td></tr>';
            html += '<tr><td>From</td><td>' + wizard.esc($('#w_from_email').val()) + '</td></tr>';
            html += '<tr><td>Contacts added</td><td><span class="oo-badge oo-badge-blue">' + (wizard.data.savedContacts || 0) + '</span></td></tr>';
            html += '<tr><td>Emails in sequence</td><td><span class="oo-badge oo-badge-blue">' + wizard.data.sequence.length + '</span></td></tr>';
            html += '</table>';
            $('#oo-launch-details').html(html);
        },

        launchCampaign: function () {
            if (!confirm('Set this campaign to Active and start sending?')) return;
            this.setLoading('#oo-launch-campaign', true);
            $.post(ooData.ajaxUrl, {
                action:      'oo_wizard_launch',
                nonce:       ooData.nonce,
                campaign_id: this.campaignId,
            }, function (res) {
                wizard.setLoading('#oo-launch-campaign', false);
                if (res.success) {
                    wizard.showNotice('#oo-launch-result', 'Campaign launched! Emails will begin sending.', 'success');
                    setTimeout(function () { window.location = ooData.campaignsUrl; }, 2000);
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
