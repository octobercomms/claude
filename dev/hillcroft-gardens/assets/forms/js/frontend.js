/* global window, document */
(function () {
	'use strict';

	function $(sel, root) { return (root || document).querySelector(sel); }
	function el(tag, attrs, children) {
		var node = document.createElement(tag);
		if (attrs) {
			Object.keys(attrs).forEach(function (k) {
				if (k === 'class') node.className = attrs[k];
				else if (k === 'style' && typeof attrs[k] === 'object') Object.assign(node.style, attrs[k]);
				else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
				else if (k === 'html') node.innerHTML = attrs[k];
				else if (attrs[k] === true) node.setAttribute(k, k);
				else if (attrs[k] === false || attrs[k] == null) {}
				else node.setAttribute(k, attrs[k]);
			});
		}
		(children || []).forEach(function (c) {
			if (c == null || c === false) return;
			if (typeof c === 'string') node.appendChild(document.createTextNode(c));
			else node.appendChild(c);
		});
		return node;
	}

	function evalLogic(rules, answers) {
		if (!rules || !rules.length) return true;
		var result = null;
		for (var i = 0; i < rules.length; i++) {
			var r = rules[i];
			var v = answers[r.question];
			var match = false;
			switch (r.op) {
				case 'is':            match = Array.isArray(v) ? v.indexOf(r.value) > -1 : String(v) === String(r.value); break;
				case 'is_not':        match = Array.isArray(v) ? v.indexOf(r.value) < 0   : String(v) !== String(r.value); break;
				case 'contains':      match = Array.isArray(v) ? v.indexOf(r.value) > -1 : (v != null && String(v).toLowerCase().indexOf(String(r.value).toLowerCase()) > -1); break;
				case 'not_contains':  match = Array.isArray(v) ? v.indexOf(r.value) < 0  : (v == null || String(v).toLowerCase().indexOf(String(r.value).toLowerCase()) < 0); break;
				case 'is_set':        match = !(v == null || v === '' || (Array.isArray(v) && v.length === 0)); break;
				case 'is_empty':      match = (v == null || v === '' || (Array.isArray(v) && v.length === 0)); break;
				case 'gt':            match = !isNaN(parseFloat(v)) && parseFloat(v) > parseFloat(r.value); break;
				case 'lt':            match = !isNaN(parseFloat(v)) && parseFloat(v) < parseFloat(r.value); break;
			}
			result = (result == null) ? match : (r.join === 'or' ? (result || match) : (result && match));
		}
		return !!result;
	}

	function emailLike(s) { return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

	function api(cfg, path, opts) {
		var headers = { 'X-WP-Nonce': cfg.nonce };
		if (!(opts && opts.body instanceof FormData)) {
			headers['Content-Type'] = 'application/json';
		}
		return fetch(cfg.restUrl + path, {
			method: (opts && opts.method) || 'POST',
			headers: headers,
			credentials: 'same-origin',
			body: (opts && opts.body) ? (opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body)) : null
		}).then(function (r) {
			return r.json().then(function (j) {
				if (!r.ok) { throw new Error((j && j.message) || ('HTTP ' + r.status)); }
				return j;
			});
		});
	}

	function getOrCreateSession() {
		try {
			var s = window.localStorage.getItem('hgd_form_sess');
			if (s && /^[A-Za-z0-9_-]{8,64}$/.test(s)) return s;
		} catch (e) { /* private browsing */ }
		var rnd = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
		var hash = rnd.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
		try { window.localStorage.setItem('hgd_form_sess', hash); } catch (e) {}
		// Also set as cookie so server-side fallbacks can read it.
		try {
			document.cookie = 'hgd_form_sess=' + hash + '; path=/; max-age=31536000; samesite=lax';
		} catch (e) {}
		return hash;
	}

	function Form(root) {
		var cfg     = JSON.parse(root.getAttribute('data-hgd-form-config'));
		var schema  = cfg.schema;
		var session = getOrCreateSession();
		var answers = {};
		var uploads = {};      // questionId -> [ { id, url, name, size } ]
		var token   = null;
		var stepIdx = 0;
		var maxStepReached = 0;
		var saveTimer = null;
		var turnstileToken = '';
		var turnstileWidget = null;

		// Engagement-time tracking: count seconds while the form tab is active.
		var startedAt = Date.now();
		var activeMs  = 0;
		var lastTick  = Date.now();
		var isVisible = !document.hidden;
		document.addEventListener('visibilitychange', function () {
			if (document.hidden) {
				if (isVisible) { activeMs += Date.now() - lastTick; }
				isVisible = false;
			} else {
				lastTick  = Date.now();
				isVisible = true;
			}
		});
		setInterval(function () {
			if (isVisible) {
				activeMs += Date.now() - lastTick;
				lastTick  = Date.now();
			}
		}, 5000);
		function secondsActive() {
			var ms = activeMs + (isVisible ? (Date.now() - lastTick) : 0);
			return Math.round(ms / 1000);
		}

		root.innerHTML = '';
		var card = el('div', { class: 'hgd-form-card' });
		var progress = el('div', { class: 'hgd-form-progress' }, [el('div', { class: 'hgd-form-progress-bar' })]);
		var stepHost = el('div', { class: 'hgd-form-step-host' });
		var foot = el('div', { class: 'hgd-form-foot' });
		if (schema.theme && schema.theme.logo) {
			card.appendChild(el('div', { class: 'hgd-form-logo' }, [el('img', { src: schema.theme.logo, alt: '' })]));
		}
		if (schema.settings && schema.settings.show_progress !== false) {
			card.appendChild(progress);
		}
		card.appendChild(stepHost);
		card.appendChild(foot);
		root.appendChild(card);

		// Record the page view (deduped server-side per session).
		api(cfg, 'view', { body: { form_id: cfg.formId, session: session } }).catch(function () {});

		// Start a submission (gets a token + id).
		api(cfg, 'start', { body: { form_id: cfg.formId, session: session } })
			.then(function (res) { token = res.token; render(); })
			.catch(function () { stepHost.appendChild(el('div', { class: 'hgd-form-error' }, ['Could not start form. Refresh to try again.'])); });

		// Final beacon on unload: capture engagement time + step depth for abandoners.
		function flushBeacon() {
			if (!token) return;
			var payload = JSON.stringify({
				token: token,
				answers: answers,
				step_reached: maxStepReached,
				seconds_active: secondsActive()
			});
			try {
				if (navigator.sendBeacon) {
					var blob = new Blob([payload], { type: 'application/json' });
					navigator.sendBeacon(cfg.restUrl + 'save', blob);
				} else {
					fetch(cfg.restUrl + 'save', {
						method: 'POST', keepalive: true,
						headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
						credentials: 'same-origin',
						body: payload
					});
				}
			} catch (e) {}
		}
		window.addEventListener('pagehide', flushBeacon);
		window.addEventListener('beforeunload', flushBeacon);

		function visibleSteps() {
			return schema.steps.filter(function (s) { return evalLogic(s.show_if, answers); });
		}

		function currentStep() {
			var list = visibleSteps();
			if (stepIdx >= list.length) stepIdx = list.length - 1;
			if (stepIdx < 0) stepIdx = 0;
			return list[stepIdx];
		}

		function queueSave() {
			if (saveTimer) clearTimeout(saveTimer);
			saveTimer = setTimeout(function () {
				if (!token) return;
				api(cfg, 'save', { body: {
					token: token,
					answers: answers,
					step_reached: maxStepReached,
					seconds_active: secondsActive()
				} }).catch(function () {});
			}, 600);
		}

		// Used by click-driven inputs (choice / image cards / dropdown / grid / file remove).
		// These need an immediate redraw so the visual selection state updates.
		function setAnswer(qid, value) {
			answers[qid] = value;
			queueSave();
			renderStep();
		}

		function logicReferences(qid) {
			for (var i = 0; i < schema.steps.length; i++) {
				var s = schema.steps[i];
				if ((s.show_if || []).some(function (r) { return r.question === qid; })) return true;
				for (var j = 0; j < s.questions.length; j++) {
					if ((s.questions[j].show_if || []).some(function (r) { return r.question === qid; })) return true;
				}
			}
			return false;
		}

		function renderProgress() {
			var list = visibleSteps();
			var pct = list.length ? Math.min(100, Math.round(((stepIdx) / list.length) * 100)) : 0;
			var bar = progress.querySelector('.hgd-form-progress-bar');
			if (bar) bar.style.width = pct + '%';
		}

		function render() {
			renderStep();
		}

		function renderStep() {
			var step = currentStep();
			if (!step) return;
			if (stepIdx > maxStepReached) {
				maxStepReached = stepIdx;
				queueSave();
			}
			stepHost.innerHTML = '';
			foot.innerHTML = '';
			renderProgress();

			// Step title is an internal label for the builder by default.
			// Opt in to showing it on the front-end via the "Show as heading" toggle.
			if (step.title && step.show_title) {
				stepHost.appendChild(el('h2', { class: 'hgd-form-step-title' }, [step.title]));
			}

			step.questions.forEach(function (q) {
				if (!evalLogic(q.show_if, answers)) return;
				stepHost.appendChild(renderQuestion(q));
			});

			// Honeypot.
			if (schema.spam && schema.spam.honeypot) {
				var hp = el('div', { class: 'hgd-form-hp', 'aria-hidden': 'true', style: { position: 'absolute', left: '-9999px', height: '0', overflow: 'hidden' } }, [
					el('label', null, ['Leave this empty', el('input', { type: 'text', name: 'hgd_form_hp', tabindex: '-1', autocomplete: 'off' })]),
					el('label', null, ['Email', el('input', { type: 'email', name: 'hgd_form_hp_email', tabindex: '-1', autocomplete: 'off' })])
				]);
				stepHost.appendChild(hp);
			}

			var visible = visibleSteps();
			var isLast = stepIdx === visible.length - 1;
			var labels = schema.settings || {};

			if (stepIdx > 0) {
				foot.appendChild(el('button', { type: 'button', class: 'hgd-form-btn hgd-form-btn-ghost', onClick: prev }, [labels.back_label || 'Back']));
			}
			if (step.skippable) {
				foot.appendChild(el('button', { type: 'button', class: 'hgd-form-btn hgd-form-btn-ghost', onClick: skip }, [labels.skip_label || 'Skip']));
			}
			if (isLast && schema.spam && schema.spam.turnstile && cfg.turnstileKey) {
				var ts = el('div', { class: 'hgd-form-turnstile', id: 'hgd-form-ts-' + cfg.formId });
				foot.appendChild(ts);
				mountTurnstile(ts);
			}
			var nextBtn = el('button', { type: 'button', class: 'hgd-form-btn hgd-form-btn-primary', onClick: isLast ? submit : next },
				[isLast ? (labels.submit_label || 'Submit') : (labels.next_label || 'Continue')]);
			foot.appendChild(nextBtn);
		}

		function mountTurnstile(host) {
			if (!window.turnstile || turnstileWidget) return;
			turnstileWidget = window.turnstile.render(host, {
				sitekey: cfg.turnstileKey,
				callback: function (t) { turnstileToken = t; }
			});
		}

		function validateStep(step) {
			var errors = [];
			step.questions.forEach(function (q) {
				if (!evalLogic(q.show_if, answers)) return;
				if (!q.required) return;
				var v = answers[q.id];
				var empty = v == null || v === '' || (Array.isArray(v) && v.length === 0);
				if (empty) {
					errors.push({ id: q.id, msg: 'This field is required.' });
				} else if (q.type === 'email' && !emailLike(v)) {
					errors.push({ id: q.id, msg: 'Enter a valid email.' });
				} else if (q.type === 'url' && !/^https?:\/\//i.test(v)) {
					errors.push({ id: q.id, msg: 'Enter a valid URL (starts with http).' });
				}
			});
			return errors;
		}

		function showErrors(errors) {
			Array.from(stepHost.querySelectorAll('.hgd-form-q-error')).forEach(function (n) { n.remove(); });
			Array.from(stepHost.querySelectorAll('.hgd-form-q.has-error')).forEach(function (n) { n.classList.remove('has-error'); });
			errors.forEach(function (e) {
				var host = stepHost.querySelector('[data-q="' + e.id + '"]');
				if (host) {
					host.classList.add('has-error');
					host.appendChild(el('div', { class: 'hgd-form-q-error' }, [e.msg]));
				}
			});
		}

		function next() {
			var step = currentStep();
			var errs = validateStep(step);
			if (errs.length) { showErrors(errs); return; }
			stepIdx += 1;
			window.scrollTo({ top: root.offsetTop - 20, behavior: 'smooth' });
			renderStep();
		}

		function prev() {
			stepIdx -= 1;
			renderStep();
		}

		function skip() {
			// Move to the next step without validating the current one.
			stepIdx += 1;
			renderStep();
		}

		function submit(btnEvent) {
			var step = currentStep();
			var errs = validateStep(step);
			if (errs.length) { showErrors(errs); return; }
			var btn = btnEvent && btnEvent.target;
			if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

			// Flatten uploads into answers as id arrays.
			Object.keys(uploads).forEach(function (qid) {
				answers[qid] = uploads[qid].map(function (u) { return { id: u.id, url: u.url, name: u.name }; });
			});

			api(cfg, 'submit', { body: {
				token: token,
				answers: answers,
				step_reached: maxStepReached,
				seconds_active: secondsActive(),
				turnstile_token: turnstileToken,
				hgd_form_hp: (root.querySelector('input[name="hgd_form_hp"]') || {}).value || '',
				hgd_form_hp_email: (root.querySelector('input[name="hgd_form_hp_email"]') || {}).value || ''
			} }).then(function (res) {
				var ending = res.ending || {};
				if (ending.redirect_url) {
					window.location.href = ending.redirect_url;
					return;
				}
				renderEnding(ending);
			}).catch(function (err) {
				if (btn) { btn.disabled = false; btn.textContent = (schema.settings && schema.settings.submit_label) || 'Submit'; }
				stepHost.appendChild(el('div', { class: 'hgd-form-error' }, [err.message || 'Submission failed.']));
			});
		}

		function renderEnding(ending) {
			stepHost.innerHTML = '';
			foot.innerHTML = '';
			var bar = progress.querySelector('.hgd-form-progress-bar');
			if (bar) bar.style.width = '100%';
			stepHost.appendChild(el('div', { class: 'hgd-form-ending' }, [
				el('h2', null, [ending.heading || 'Thanks!']),
				ending.body ? el('p', null, [ending.body]) : null,
				(ending.cta_label && ending.cta_url) ? el('a', { class: 'hgd-form-btn hgd-form-btn-primary', href: ending.cta_url }, [ending.cta_label]) : null
			]));
		}

		// ---- Question renderers ----

		function renderQuestion(q) {
			var wrap = el('div', { class: 'hgd-form-q hgd-form-q-' + q.type, 'data-q': q.id });
			if (q.label && q.type !== 'heading') {
				wrap.appendChild(el('label', { class: 'hgd-form-q-label', html: q.label + (q.required ? ' <span class="hgd-form-req">*</span>' : '') }));
			}
			if (q.help) wrap.appendChild(el('div', { class: 'hgd-form-q-help', html: q.help }));

			var body = el('div', { class: 'hgd-form-q-body' });
			switch (q.type) {
				case 'heading':     body.appendChild(el('h2', { class: 'hgd-form-heading' }, [q.label || ''])); break;
				case 'paragraph':   body.appendChild(el('div', { class: 'hgd-form-paragraph', html: q.help || q.label || '' })); break;
				case 'short_text':  body.appendChild(textInput(q, 'text')); break;
				case 'email':       body.appendChild(textInput(q, 'email')); break;
				case 'phone':       body.appendChild(textInput(q, 'tel')); break;
				case 'url':         body.appendChild(textInput(q, 'url')); break;
				case 'number':      body.appendChild(textInput(q, 'number')); break;
				case 'long_text':   body.appendChild(textArea(q)); break;
				case 'choice':      body.appendChild(choiceList(q, false)); break;
				case 'multi_choice':body.appendChild(choiceList(q, true)); break;
				case 'image_cards':       body.appendChild(imageCards(q, false)); break;
				case 'image_cards_multi': body.appendChild(imageCards(q, true)); break;
				case 'dropdown':    body.appendChild(dropdown(q)); break;
				case 'grid':        body.appendChild(grid(q)); break;
				case 'date':        body.appendChild(textInput(q, 'date')); break;
				case 'address':     body.appendChild(addressGroup(q)); break;
				case 'file_upload': body.appendChild(fileGroup(q)); break;
				default:            body.appendChild(el('div', null, ['Unsupported field type.']));
			}
			wrap.appendChild(body);
			return wrap;
		}

		function textInput(q, type) {
			var input = el('input', {
				type: type, class: 'hgd-form-input', value: answers[q.id] || '', placeholder: q.placeholder || '',
				onInput: function (e) { setAnswerDebounced(q.id, e.target.value); }
			});
			return input;
		}

		var debounceTimers = {};
		function setAnswerDebounced(qid, value) {
			answers[qid] = value;
			queueSave();
			if (!logicReferences(qid)) return;
			if (debounceTimers[qid]) clearTimeout(debounceTimers[qid]);
			debounceTimers[qid] = setTimeout(function () {
				renderStep();
			}, 600);
		}

		function textArea(q) {
			return el('textarea', {
				class: 'hgd-form-input hgd-form-textarea', placeholder: q.placeholder || '',
				rows: 5,
				onInput: function (e) { setAnswerDebounced(q.id, e.target.value); }
			}, [answers[q.id] || '']);
		}

		function choiceList(q, multi) {
			var host = el('div', { class: 'hgd-form-choices' });
			(q.options || []).forEach(function (opt) {
				var checked = multi ? (Array.isArray(answers[q.id]) && answers[q.id].indexOf(opt.value) > -1)
					: answers[q.id] === opt.value;
				var input = el('input', {
					type: multi ? 'checkbox' : 'radio',
					name: 'hgd_form_' + q.id,
					value: opt.value,
					checked: checked ? 'checked' : null,
					onChange: function () {
						if (multi) {
							var arr = Array.isArray(answers[q.id]) ? answers[q.id].slice() : [];
							var i = arr.indexOf(opt.value);
							if (i > -1) arr.splice(i, 1); else arr.push(opt.value);
							setAnswer(q.id, arr);
						} else {
							setAnswer(q.id, opt.value);
						}
					}
				});
				host.appendChild(el('label', { class: 'hgd-form-choice' + (checked ? ' is-checked' : '') }, [input, el('span', null, [opt.label])]));
			});
			return host;
		}

		function imageCards(q, multi) {
			var host = el('div', { class: 'hgd-form-image-cards' });
			(q.options || []).forEach(function (opt) {
				var checked = multi ? (Array.isArray(answers[q.id]) && answers[q.id].indexOf(opt.value) > -1)
					: answers[q.id] === opt.value;
				var input = el('input', {
					type: multi ? 'checkbox' : 'radio',
					name: 'hgd_form_' + q.id,
					value: opt.value,
					checked: checked ? 'checked' : null
				});
				var card = el('label', { class: 'hgd-form-image-card' + (checked ? ' is-selected' : ''),
					onClick: function (e) {
						e.preventDefault();
						if (multi) {
							var arr = Array.isArray(answers[q.id]) ? answers[q.id].slice() : [];
							var i = arr.indexOf(opt.value);
							if (i > -1) arr.splice(i, 1); else arr.push(opt.value);
							setAnswer(q.id, arr);
						} else {
							setAnswer(q.id, opt.value);
						}
					}
				}, [
					opt.image ? el('div', { class: 'hgd-form-image-card-img' }, [el('img', { src: opt.image, alt: opt.label || '' })]) : null,
					el('div', { class: 'hgd-form-image-card-meta' }, [input, el('span', null, [opt.label || ''])])
				]);
				host.appendChild(card);
			});
			return host;
		}

		function dropdown(q) {
			var current = answers[q.id] || '';
			var sel = el('select', { class: 'hgd-form-input hgd-form-select', onChange: function (e) { setAnswer(q.id, e.target.value); } });
			sel.appendChild(el('option', { value: '' }, [q.placeholder || 'Select…']));
			(q.options || []).forEach(function (opt) {
				var o = el('option', { value: opt.value }, [opt.label || opt.value]);
				if (current === opt.value) o.setAttribute('selected', 'selected');
				sel.appendChild(o);
			});
			return sel;
		}

		function grid(q) {
			var cols = (q.grid && q.grid.columns) || [];
			var rows = (q.grid && q.grid.rows) || [];
			var table = el('table', { class: 'hgd-form-grid' });
			var thead = el('thead');
			var trh = el('tr', null, [el('th')]);
			cols.forEach(function (c) { trh.appendChild(el('th', null, [c])); });
			thead.appendChild(trh);
			table.appendChild(thead);
			var tbody = el('tbody');
			rows.forEach(function (row) {
				var tr = el('tr', null, [el('td', null, [row])]);
				cols.forEach(function (col) {
					var current = (answers[q.id] || {})[row];
					var input = el('input', { type: 'radio', name: 'hgd_form_' + q.id + '_' + row, value: col,
						checked: current === col ? 'checked' : null,
						onChange: function () {
							var v = Object.assign({}, answers[q.id] || {});
							v[row] = col;
							setAnswer(q.id, v);
						} });
					tr.appendChild(el('td', null, [input]));
				});
				tbody.appendChild(tr);
			});
			table.appendChild(tbody);
			return table;
		}

		function addressGroup(q) {
			var v = answers[q.id] || {};
			function field(name, ph, cls) {
				return el('input', { type: 'text', class: 'hgd-form-input ' + (cls || ''), placeholder: ph, value: v[name] || '',
					onInput: function (e) { v[name] = e.target.value; setAnswer(q.id, v); } });
			}
			return el('div', { class: 'hgd-form-address' }, [
				field('line1', 'Address line 1'),
				field('line2', 'Address line 2'),
				el('div', { class: 'hgd-form-address-row' }, [
					field('city',    'City'),
					field('state',   'State / Province'),
					field('zip',     'ZIP / Postcode')
				]),
				field('country', 'Country')
			]);
		}

		function fileGroup(q) {
			var host = el('div', { class: 'hgd-form-file' });
			uploads[q.id] = uploads[q.id] || [];

			var input = el('input', { type: 'file', class: 'hgd-form-file-input',
				multiple: q.multiple ? 'multiple' : null,
				accept: q.accept || null,
				onChange: function (e) {
					Array.from(e.target.files || []).forEach(function (f) { uploadOne(q, f, list); });
					e.target.value = '';
				}
			});
			var drop = el('div', { class: 'hgd-form-dropzone',
				onDragover: function (e) { e.preventDefault(); drop.classList.add('is-drag'); },
				onDragleave: function () { drop.classList.remove('is-drag'); },
				onDrop: function (e) {
					e.preventDefault();
					drop.classList.remove('is-drag');
					Array.from(e.dataTransfer.files || []).forEach(function (f) { uploadOne(q, f, list); });
				},
				onClick: function () { input.click(); }
			}, ['Drag & drop a file or ', el('span', { class: 'hgd-form-file-browse' }, ['browse'])]);
			var list = el('div', { class: 'hgd-form-file-list' });

			(uploads[q.id] || []).forEach(function (u) { list.appendChild(fileRow(q, u, list)); });

			host.appendChild(drop);
			host.appendChild(input);
			host.appendChild(list);
			return host;
		}

		function fileRow(q, info, list) {
			var row = el('div', { class: 'hgd-form-file-row' }, [
				el('span', { class: 'hgd-form-file-name' }, [info.name]),
				el('button', { type: 'button', class: 'hgd-form-file-remove', onClick: function () {
					uploads[q.id] = (uploads[q.id] || []).filter(function (u) { return u.id !== info.id; });
					row.remove();
				} }, ['Remove'])
			]);
			return row;
		}

		function uploadOne(q, file, list) {
			var row = el('div', { class: 'hgd-form-file-row is-uploading' }, [
				el('span', { class: 'hgd-form-file-name' }, [file.name]),
				el('span', { class: 'hgd-form-file-progress' }, ['Uploading…'])
			]);
			list.appendChild(row);
			var fd = new FormData();
			fd.append('token', token);
			fd.append('question_id', q.id);
			fd.append('file', file);
			api(cfg, 'upload', { body: fd })
				.then(function (res) {
					row.remove();
					var info = { id: res.id, url: res.url, name: res.name, size: res.size };
					uploads[q.id].push(info);
					list.appendChild(fileRow(q, info, list));
				})
				.catch(function (err) {
					row.classList.remove('is-uploading');
					row.classList.add('has-error');
					row.querySelector('.hgd-form-file-progress').textContent = err.message || 'Upload failed';
				});
		}
	}

	function boot() {
		Array.from(document.querySelectorAll('.hgd-form-form-root')).forEach(function (root) {
			if (root.getAttribute('data-hgd-form-booted')) return;
			root.setAttribute('data-hgd-form-booted', '1');
			try { Form(root); } catch (e) { console.error('OCF init', e); }
		});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', boot);
	} else {
		boot();
	}
})();
