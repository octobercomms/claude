jQuery(function ($) {
	$(document).on('click', '.aipdf-download-btn', function (e) {
		e.preventDefault();
		var $btn = $(this);
		var postId = $btn.data('post-id');

		if (!postId) {
			alert('No post ID found.');
			return;
		}

		var originalText = $btn.text();
		$btn.text('Generating PDF…').prop('disabled', true);

		// Use a form POST so the browser handles the file download stream
		var $form = $('<form>', {
			method: 'POST',
			action: aipdf.ajax_url,
			target: '_blank',
		});
		$form.append($('<input>', { type: 'hidden', name: 'action', value: 'aipdf_generate' }));
		$form.append($('<input>', { type: 'hidden', name: 'nonce',  value: aipdf.nonce }));
		$form.append($('<input>', { type: 'hidden', name: 'post_id', value: postId }));
		$('body').append($form);
		$form.submit();
		$form.remove();

		// Re-enable button after a moment
		setTimeout(function () {
			$btn.text(originalText).prop('disabled', false);
		}, 3000);
	});
});
