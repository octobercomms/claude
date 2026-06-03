jQuery(function ($) {
	$(document).on('click', '.aipdf-download-btn', function (e) {
		e.preventDefault();
		var $btn = $(this);
		var postId = $btn.data('post-id');

		if (!postId) {
			alert('No post ID found on this button.');
			return;
		}

		var originalText = $btn.text();
		$btn.text('Generating PDF…').prop('disabled', true);

		// Use fetch so we can detect JSON error responses vs binary PDF stream
		var formData = new FormData();
		formData.append('action', 'aipdf_generate');
		formData.append('nonce', aipdf.nonce);
		formData.append('post_id', postId);

		fetch(aipdf.ajax_url, { method: 'POST', body: formData })
			.then(function (response) {
				var contentType = response.headers.get('Content-Type') || '';

				if (contentType.indexOf('application/json') !== -1) {
					// Error response from wp_send_json_error()
					return response.json().then(function (json) {
						throw new Error(json.data || 'Unknown error');
					});
				}

				if (contentType.indexOf('application/pdf') !== -1 ||
				    contentType.indexOf('application/octet-stream') !== -1 ||
				    contentType.indexOf('application/force-download') !== -1) {
					return response.blob().then(function (blob) {
						// Get filename from Content-Disposition header if present
						var disposition = response.headers.get('Content-Disposition') || '';
						var match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
						var filename = match ? match[1].replace(/['"]/g, '') : 'itinerary.pdf';
						var url = URL.createObjectURL(blob);
						var a = document.createElement('a');
						a.href = url;
						a.download = filename;
						document.body.appendChild(a);
						a.click();
						document.body.removeChild(a);
						URL.revokeObjectURL(url);
					});
				}

				// Unexpected content type — try to show the text
				return response.text().then(function (text) {
					throw new Error('Unexpected response (' + contentType + '): ' + text.substring(0, 300));
				});
			})
			.catch(function (err) {
				alert('PDF generation error:\n\n' + err.message);
			})
			.finally(function () {
				$btn.text(originalText).prop('disabled', false);
			});
	});
});
