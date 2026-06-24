/* October Proposals — Library: draft a case study from pasted/uploaded
   material with Claude, then fill the form fields for editing. */
(function () {
	var box = document.querySelector('.ocp-cs-draft');
	if (!box) { return; }

	var ajax = box.getAttribute('data-ajax');
	var nonce = box.getAttribute('data-nonce');
	var material = document.getElementById('ocp-cs-material');
	var file = document.getElementById('ocp-cs-file');
	var go = document.getElementById('ocp-cs-go');
	var spin = document.getElementById('ocp-cs-spin');

	function setField(name, value) {
		var el = document.getElementById('f_' + name);
		if (el) { el.value = value || ''; }
	}

	go.addEventListener('click', function () {
		var hasFile = file.files && file.files[0];
		if (!material.value.trim() && !hasFile) { material.focus(); return; }
		spin.classList.add('is-active');
		go.disabled = true;

		var fd = new FormData();
		fd.append('action', 'ocp_draft_cs');
		fd.append('nonce', nonce);
		fd.append('material', material.value);
		if (hasFile) { fd.append('file', file.files[0]); }

		fetch(ajax, { method: 'POST', body: fd, credentials: 'same-origin' })
			.then(function (r) { return r.json(); })
			.then(function (res) {
				spin.classList.remove('is-active');
				go.disabled = false;
				if (!res || !res.success) {
					alert((res && res.data && res.data.message) || 'Could not draft.');
					return;
				}
				var d = res.data;
				['title', 'client', 'sector', 'services', 'summary', 'stats'].forEach(function (k) {
					if (d[k] !== undefined) { setField(k, d[k]); }
				});
				// Body is a TinyMCE editor.
				if (d.body !== undefined) {
					if (window.tinymce && window.tinymce.get('f_body')) {
						window.tinymce.get('f_body').setContent(d.body.replace(/\n/g, '<br/>'));
					} else {
						setField('body', d.body);
					}
				}
			})
			.catch(function () {
				spin.classList.remove('is-active');
				go.disabled = false;
				alert('Network error.');
			});
	});
})();
