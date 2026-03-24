/* global pclcAdmin, wp, jQuery */
(function ($) {
	'use strict';

	// ------------------------------------------------------------------
	// Media library logo picker
	// ------------------------------------------------------------------
	var mediaFrame;

	$('#pclc-logo-select').on('click', function (e) {
		e.preventDefault();

		if ( mediaFrame ) {
			mediaFrame.open();
			return;
		}

		mediaFrame = wp.media({
			title:    pclcAdmin.mediaTitle,
			button:   { text: pclcAdmin.mediaButton },
			multiple: false,
			library:  { type: 'image' }
		});

		mediaFrame.on('select', function () {
			var attachment = mediaFrame.state().get('selection').first().toJSON();
			$('#pclc_logo_attachment_id').val(attachment.id);
			$('#pclc-logo-preview').html('<img src="' + attachment.url + '" style="max-height:80px;display:block;" />');
			$('#pclc-logo-remove').show();
		});

		mediaFrame.open();
	});

	$('#pclc-logo-remove').on('click', function (e) {
		e.preventDefault();
		$('#pclc_logo_attachment_id').val('0');
		$('#pclc-logo-preview').html('');
		$(this).hide();
	});

	// ------------------------------------------------------------------
	// Test email buttons
	// ------------------------------------------------------------------
	$('.pclc-test-email-btn').on('click', function () {
		var $btn    = $(this);
		var $result = $btn.siblings('.pclc-test-result');
		var type    = $btn.data('type');

		$btn.prop('disabled', true).text(pclcAdmin.sending);
		$result.css('color', '').text('');

		$.post(pclcAdmin.ajaxUrl, {
			action:     'pclc_send_test_email',
			nonce:      pclcAdmin.nonce,
			email_type: type
		})
		.done(function (response) {
			if (response.success) {
				$result.css('color', '#008a00').text(response.data.message || pclcAdmin.sent);
			} else {
				$result.css('color', '#cc0000').text((response.data && response.data.message) || pclcAdmin.error);
			}
		})
		.fail(function () {
			$result.css('color', '#cc0000').text(pclcAdmin.error);
		})
		.always(function () {
			$btn.prop('disabled', false).text('Send Test');
		});
	});

}(jQuery));
