(function($) {
	'use strict';

	$(document).on('click', '.atwp-copy-btn', function() {
		var btn = $(this);
		var targetId = btn.data('copy-target');
		var text = $('#' + targetId).text().trim();

		if (navigator.clipboard) {
			navigator.clipboard.writeText(text).then(function() {
				showCopied(btn);
			});
		} else {
			var textarea = document.createElement('textarea');
			textarea.value = text;
			textarea.style.position = 'fixed';
			textarea.style.opacity = '0';
			document.body.appendChild(textarea);
			textarea.select();
			document.execCommand('copy');
			document.body.removeChild(textarea);
			showCopied(btn);
		}
	});

	function showCopied(btn) {
		var original = btn.text();
		btn.text(atwpAdmin.strings.copied).addClass('copied');
		setTimeout(function() {
			btn.text(original).removeClass('copied');
		}, 2000);
	}

	$('#atwp-generate-key').on('click', function() {
		var name = $('#atwp-new-key-name').val().trim();
		var permissions = $('#atwp-new-key-permissions').val();

		if (!name) {
			alert('Please enter a name for the API key.');
			$('#atwp-new-key-name').focus();
			return;
		}

		var btn = $(this);
		btn.prop('disabled', true).text('Generating...');

		$.post(atwpAdmin.ajaxUrl, {
			action: 'atwp_generate_key',
			nonce: atwpAdmin.nonce,
			key_name: name,
			key_permissions: permissions
		}, function(response) {
			btn.prop('disabled', false).text('Generate API Key');

			if (response.success) {
				$('#atwp-new-key-value').text(response.data.key);
				$('#atwp-new-key-display').slideDown();
				$('#atwp-new-key-name').val('');

				var row = '<tr data-key-id="' + response.data.id + '">' +
					'<td>' + escHtml(response.data.name) + '</td>' +
					'<td><code>' + escHtml(response.data.id) + '</code></td>' +
					'<td><span class="atwp-permission-badge atwp-permission-' + escHtml(permissions) + '">' +
						permissions.charAt(0).toUpperCase() + permissions.slice(1) + '</span></td>' +
					'<td>Just now</td>' +
					'<td>&mdash;</td>' +
					'<td><button type="button" class="button button-small atwp-delete-key" data-key-id="' +
						escHtml(response.data.id) + '">Delete</button></td>' +
					'</tr>';

				$('.atwp-no-keys').remove();
				$('#atwp-keys-table tbody').append(row);
			} else {
				alert(response.data || 'Failed to generate key.');
			}
		}).fail(function() {
			btn.prop('disabled', false).text('Generate API Key');
			alert('Request failed. Please try again.');
		});
	});

	$(document).on('click', '.atwp-delete-key', function() {
		if (!confirm(atwpAdmin.strings.confirmDelete)) {
			return;
		}

		var btn = $(this);
		var keyId = btn.data('key-id');

		btn.prop('disabled', true);

		$.post(atwpAdmin.ajaxUrl, {
			action: 'atwp_delete_key',
			nonce: atwpAdmin.nonce,
			key_id: keyId
		}, function(response) {
			if (response.success) {
				$('tr[data-key-id="' + keyId + '"]').fadeOut(300, function() {
					$(this).remove();
					if ($('#atwp-keys-table tbody tr').length === 0) {
						$('#atwp-keys-table tbody').append(
							'<tr class="atwp-no-keys"><td colspan="6">No API keys created yet.</td></tr>'
						);
					}
				});
			} else {
				btn.prop('disabled', false);
				alert(response.data || 'Failed to delete key.');
			}
		}).fail(function() {
			btn.prop('disabled', false);
			alert('Request failed.');
		});
	});

	function escHtml(str) {
		var div = document.createElement('div');
		div.appendChild(document.createTextNode(str));
		return div.innerHTML;
	}

})(jQuery);
