/* October Proposals — wizard Content step discovery chat.
   Paste a transcript/email, talk it through with Claude, then draft the
   Situation + Objectives sections (which stay editable before saving). */
(function () {
	var box = document.getElementById('ocp-chat');
	if (!box) { return; }

	var id = box.getAttribute('data-id');
	var ajax = box.getAttribute('data-ajax');
	var nonce = box.getAttribute('data-nonce');

	var thread = document.getElementById('ocp-chat-thread');
	var text = document.getElementById('ocp-chat-text');
	var send = document.getElementById('ocp-chat-send');
	var gen = document.getElementById('ocp-chat-generate');
	var spin = document.getElementById('ocp-chat-spin');
	var source = document.getElementById('ocp-source');

	function busy(on) {
		spin.classList.toggle('is-active', on);
		send.disabled = on; gen.disabled = on;
	}

	function bubble(role, html) {
		var d = document.createElement('div');
		d.className = 'ocp-msg ocp-msg--' + role;
		d.innerHTML = html;
		thread.appendChild(d);
		thread.scrollTop = thread.scrollHeight;
		return d;
	}

	function esc(s) {
		var p = document.createElement('p');
		p.textContent = s;
		return p.outerHTML;
	}

	function post(action, extra) {
		var fd = new FormData();
		fd.append('action', action);
		fd.append('nonce', nonce);
		fd.append('id', id);
		fd.append('material', source ? source.value : '');
		Object.keys(extra || {}).forEach(function (k) { fd.append(k, extra[k]); });
		return fetch(ajax, { method: 'POST', body: fd, credentials: 'same-origin' })
			.then(function (r) { return r.json(); });
	}

	// Extract an uploaded transcript/email file into the source box.
	var sFile = document.getElementById('ocp-source-file');
	var sBtn = document.getElementById('ocp-source-extract');
	var sSpin = document.getElementById('ocp-source-spin');
	if (sBtn) {
		sBtn.addEventListener('click', function () {
			var f = sFile && sFile.files && sFile.files[0];
			if (!f) { sFile.focus(); return; }
			sSpin.classList.add('is-active'); sBtn.disabled = true;
			var fd = new FormData();
			fd.append('action', 'ocp_extract_file');
			fd.append('nonce', nonce);
			fd.append('file', f);
			fetch(ajax, { method: 'POST', body: fd, credentials: 'same-origin' })
				.then(function (r) { return r.json(); })
				.then(function (res) {
					sSpin.classList.remove('is-active'); sBtn.disabled = false;
					if (res && res.success) {
						source.value = (source.value ? source.value + '\n\n' : '') + res.data.text;
					} else {
						alert((res && res.data && res.data.message) || 'Could not read that file.');
					}
				})
				.catch(function () { sSpin.classList.remove('is-active'); sBtn.disabled = false; alert('Network error.'); });
		});
	}

	send.addEventListener('click', function () {
		var msg = (text.value || '').trim();
		if (!msg) { return; }
		bubble('me', esc(msg));
		text.value = '';
		busy(true);
		post('ocp_content_chat', { message: msg })
			.then(function (res) {
				busy(false);
				if (res && res.success) { bubble('claude', esc(res.data.reply)); }
				else { bubble('claude', esc((res && res.data && res.data.message) || 'Something went wrong.')); }
			})
			.catch(function () { busy(false); bubble('claude', esc('Network error.')); });
	});

	gen.addEventListener('click', function () {
		busy(true);
		post('ocp_content_generate', {})
			.then(function (res) {
				busy(false);
				if (res && res.success) {
					document.getElementById('ocp-situation').value = stripTags(res.data.situation);
					document.getElementById('ocp-objectives').value = stripTags(res.data.objectives);
					bubble('claude', esc('Drafted the Situation and Objectives below — edit them, then Save & continue.'));
				} else {
					bubble('claude', esc((res && res.data && res.data.message) || 'Could not draft the sections.'));
				}
			})
			.catch(function () { busy(false); bubble('claude', esc('Network error.')); });
	});

	function stripTags(s) {
		var d = document.createElement('div');
		d.innerHTML = s || '';
		return (d.textContent || '').trim();
	}
})();
