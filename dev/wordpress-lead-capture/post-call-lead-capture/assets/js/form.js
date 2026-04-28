/* global pclcAjax, jQuery */
(function ($) {
	'use strict';

	$(document).ready(function () {
		var $form    = $('#pclc-lead-capture-form');
		var $msgs    = $form.find('.pclc-messages');
		var $btn     = $('#pclc-submit-btn');

		$form.on('submit', function (e) {
			e.preventDefault();

			$msgs.html('');
			$btn.prop('disabled', true).text('Sending…');

			var data = {
				action : 'pclc_submit_form',
				nonce  : pclcAjax.nonce,
				first_name   : $.trim($('#pclc_first_name').val()),
				last_name    : $.trim($('#pclc_last_name').val()),
				email        : $.trim($('#pclc_email').val()),
				project_type : $('#pclc_project_type').val()
			};

			$.post(pclcAjax.ajaxUrl, data)
				.done(function (response) {
					if (response.success) {
						$form.hide();
						$msgs.html('<div class="pclc-success">' + response.data.message + '</div>');
					} else {
						var messages = response.data && response.data.messages ? response.data.messages : ['An error occurred. Please try again.'];
						var html = '';
						$.each(messages, function (i, msg) {
							html += '<div class="pclc-error">' + msg + '</div>';
						});
						$msgs.html(html);
						$btn.prop('disabled', false).text('Send Resources');
					}
				})
				.fail(function () {
					$msgs.html('<div class="pclc-error">A network error occurred. Please try again.</div>');
					$btn.prop('disabled', false).text('Send Resources');
				});
		});
	});
}(jQuery));
