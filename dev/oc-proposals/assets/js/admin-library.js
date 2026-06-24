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

	// Read an uploaded text file into the material box.
	file.addEventListener('change', function () {
		var f = file.files && file.files[0];
		if (!f) { return; }
		var reader = new FileReader();
		reader.onload = function () { material.value = String(reader.result || ''); };
		reader.readAsText(f);
	});

	function setField(name, value) {
		var el = document.getElementById('f_' + name);
		if (el) { el.value = value || ''; }
	}

	go.addEventListener('click', function () {
		if (!material.value.trim()) { material.focus(); return; }
		spin.classList.add('is-active');
		go.disabled = true;

		var fd = new FormData();
		fd.append('action', 'ocp_draft_cs');
		fd.append('nonce', nonce);
		fd.append('material', material.value);

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
