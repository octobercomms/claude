jQuery(function ($) {
	$(document).on('click', '.aipdf-upload-btn', function (e) {
		e.preventDefault();
		var $wrap = $(this).closest('.aipdf-media-upload');
		var $input = $wrap.find('input[type=hidden]');
		var $btn = $(this);

		var frame = wp.media({
			title: 'Select SVG',
			button: { text: 'Use this file' },
			multiple: false,
			library: { type: 'image/svg+xml' },
		});

		frame.on('select', function () {
			var att = frame.state().get('selection').first().toJSON();
			$input.val(att.id);
			$btn.text('Change SVG');
			$wrap.find('.aipdf-filename').remove();
			$wrap.find('.aipdf-remove-btn').remove();
			$btn.after(
				' <span class="aipdf-filename">' + att.filename + '</span>' +
				' <a href="#" class="aipdf-remove-btn" style="color:red;margin-left:8px;">Remove</a>'
			);
		});

		frame.open();
	});

	$(document).on('click', '.aipdf-remove-btn', function (e) {
		e.preventDefault();
		var $wrap = $(this).closest('.aipdf-media-upload');
		$wrap.find('input[type=hidden]').val('');
		$wrap.find('.aipdf-filename').remove();
		$(this).remove();
		$wrap.find('.aipdf-upload-btn').text('Upload SVG');
	});
});
