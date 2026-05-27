/* global document, window, jQuery, wp */
(function ($) {
	'use strict';

	var ROOT = document.getElementById('ocf-builder');
	if (!ROOT) return;

	var raw = ROOT.getAttribute('data-config');
	var config = JSON.parse(raw);
	var schema = config.schema;
	var types  = config.types;

	// Normalise containers that PHP json_encode might emit as `[]` instead of
	// `{}` when empty — JSON.stringify drops string keys from arrays, so an
	// unfixed array map silently swallows every mapping the user adds.
	function asPlainObject(v) {
		if (v == null || Array.isArray(v)) return {};
		if (typeof v === 'object') return v;
		return {};
	}

	schema.steps   = schema.steps   || [];
	schema.theme   = schema.theme   || {};
	schema.brevo   = schema.brevo   || { list_ids: [], attribute_map: {}, event_properties_map: {} };
	schema.brevo.attribute_map        = asPlainObject(schema.brevo.attribute_map);
	schema.brevo.event_properties_map = asPlainObject(schema.brevo.event_properties_map);
	schema.spam    = schema.spam    || { turnstile: true, honeypot: true, rate_limit: 5 };
	schema.endings = schema.endings || { default: {} };
	schema.settings = schema.settings || {};
	schema.notifications = schema.notifications || { cc: [] };
	if (!Array.isArray(schema.notifications.cc)) {
		schema.notifications.cc = [];
	}

	// Brevo attribute autocomplete — fetched once from the admin API, cached
	// for the lifetime of this page. When it arrives we re-render the brevo
	// tab so the new datalist options are live.
	var brevoAttrs = [];
	var brevoAttrsLoading = false;
	var brevoAttrsError = '';
	function loadBrevoAttributes(force) {
		if (brevoAttrsLoading) return;
		brevoAttrsLoading = true;
		fetch(config.restUrl + 'admin/brevo-attributes' + (force ? '?refresh=1' : ''), {
			headers: { 'X-WP-Nonce': (window.wpApiSettings && wpApiSettings.nonce) || config.nonce || '' },
			credentials: 'same-origin'
		}).then(function (r) {
			return r.json().then(function (j) {
				if (!r.ok) { throw new Error((j && j.message) || ('HTTP ' + r.status)); }
				return j;
			});
		}).then(function (j) {
			brevoAttrs = (j && j.attributes) || [];
			brevoAttrsError = '';
		}).catch(function (e) {
			brevoAttrsError = (e && e.message) || 'Could not load Brevo attributes';
		}).finally(function () {
			brevoAttrsLoading = false;
			if (state.view === 'brevo') render();
		});
	}

	var state = {
		view: 'steps',                // 'steps' | 'theme' | 'brevo' | 'spam' | 'endings'
		selectedStep: null,           // step index
		selectedQuestion: null,       // question index inside selected step
	};
	if (schema.steps.length) {
		state.selectedStep = 0;
	}

	function el(tag, attrs, kids) {
		var n = document.createElement(tag);
		if (attrs) {
			Object.keys(attrs).forEach(function (k) {
				if (k === 'class') n.className = attrs[k];
				else if (k === 'html') n.innerHTML = attrs[k];
				else if (k === 'style' && typeof attrs[k] === 'object') Object.assign(n.style, attrs[k]);
				else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
				else if (attrs[k] == null || attrs[k] === false) {}
				else n.setAttribute(k, attrs[k]);
			});
		}
		(kids || []).forEach(function (k) {
			if (k == null || k === false) return;
			if (typeof k === 'string') n.appendChild(document.createTextNode(k));
			else n.appendChild(k);
		});
		return n;
	}

	function uid(prefix) { return (prefix || 'id_') + Math.random().toString(36).slice(2, 10); }

	function syncHiddenInput() {
		var input = document.getElementById('ocf_schema_json');
		if (input) input.value = JSON.stringify(schema);
	}

	function render() {
		syncHiddenInput();
		ROOT.innerHTML = '';
		ROOT.appendChild(toolbar());
		var body = el('div', { class: 'ocf-b-body' });
		body.appendChild(sidebar());
		body.appendChild(mainArea());
		body.appendChild(inspector());
		ROOT.appendChild(body);
	}

	function toolbar() {
		function tab(id, label) {
			return el('button', { type: 'button',
				class: 'ocf-b-tab' + (state.view === id ? ' is-active' : ''),
				onClick: function () { state.view = id; render(); }
			}, [label]);
		}
		return el('div', { class: 'ocf-b-toolbar' }, [
			tab('steps',         'Steps'),
			tab('theme',         'Theme'),
			tab('brevo',         'Brevo'),
			tab('notifications', 'Notifications'),
			tab('spam',          'Spam'),
			tab('endings',       'Ending'),
			tab('json',          'JSON'),
			el('div', { class: 'ocf-b-spacer' }),
			el('span', { class: 'ocf-b-hint' }, ['Save the post to persist changes.'])
		]);
	}

	function sidebar() {
		if (state.view !== 'steps') return el('div', { class: 'ocf-b-side ocf-b-side-empty' });

		var host = el('div', { class: 'ocf-b-side' });
		host.appendChild(el('h3', null, ['Steps']));
		var list = el('ol', { class: 'ocf-b-step-list' });
		schema.steps.forEach(function (s, i) {
			var li = el('li', { class: 'ocf-b-step-item' + (state.selectedStep === i ? ' is-active' : ''),
				onClick: function () { state.selectedStep = i; state.selectedQuestion = null; render(); }
			}, [
				el('span', { class: 'ocf-b-step-num' }, [String(i + 1)]),
				el('span', { class: 'ocf-b-step-title' }, [s.title || '(untitled step)']),
				el('span', { class: 'ocf-b-step-actions' }, [
					i > 0 ? el('button', { type: 'button', title: 'Move up', onClick: function (e) { e.stopPropagation(); move(schema.steps, i, i - 1); if (state.selectedStep === i) state.selectedStep -= 1; render(); } }, ['↑']) : null,
					i < schema.steps.length - 1 ? el('button', { type: 'button', title: 'Move down', onClick: function (e) { e.stopPropagation(); move(schema.steps, i, i + 1); if (state.selectedStep === i) state.selectedStep += 1; render(); } }, ['↓']) : null,
					el('button', { type: 'button', title: 'Delete', class: 'ocf-b-del', onClick: function (e) {
						e.stopPropagation();
						if (!confirm('Delete this step and its questions?')) return;
						schema.steps.splice(i, 1);
						state.selectedStep = schema.steps.length ? Math.max(0, i - 1) : null;
						state.selectedQuestion = null;
						render();
					} }, ['×'])
				])
			]);
			list.appendChild(li);
		});
		host.appendChild(list);

		host.appendChild(el('button', { type: 'button', class: 'button button-primary',
			onClick: function () {
				schema.steps.push({ id: uid('s_'), title: 'New step', questions: [] });
				state.selectedStep = schema.steps.length - 1;
				state.selectedQuestion = null;
				render();
			}
		}, ['+ Add step']));

		return host;
	}

	function mainArea() {
		var host = el('div', { class: 'ocf-b-main' });
		switch (state.view) {
			case 'steps':         renderStepEditor(host); break;
			case 'theme':         renderTheme(host); break;
			case 'brevo':         renderBrevo(host); break;
			case 'notifications': renderNotifications(host); break;
			case 'spam':          renderSpam(host); break;
			case 'endings':       renderEndings(host); break;
			case 'json':          renderJson(host); break;
		}
		return host;
	}

	function inspector() {
		if (state.view !== 'steps') return el('div', { class: 'ocf-b-insp ocf-b-insp-empty' });
		var host = el('div', { class: 'ocf-b-insp' });
		if (state.selectedStep == null) return host;
		var step = schema.steps[state.selectedStep];
		if (state.selectedQuestion == null) {
			renderStepInspector(host, step);
		} else {
			renderQuestionInspector(host, step, step.questions[state.selectedQuestion]);
		}
		return host;
	}

	function renderStepEditor(host) {
		if (state.selectedStep == null) {
			host.appendChild(el('div', { class: 'ocf-b-empty' }, ['Add a step to get started.']));
			return;
		}
		var step = schema.steps[state.selectedStep];

		host.appendChild(el('label', { class: 'ocf-b-field' }, [
			el('span', null, ['Step title']),
			el('input', { type: 'text', class: 'widefat', value: step.title || '', onInput: function (e) { step.title = e.target.value; syncHiddenInput(); refreshSidebar(); } })
		]));

		host.appendChild(el('h3', null, ['Questions']));
		var qList = el('div', { class: 'ocf-b-questions' });
		step.questions.forEach(function (q, i) {
			var typeLabel = (types[q.type] && types[q.type].label) || q.type;
			var card = el('div', { class: 'ocf-b-q-card' + (state.selectedQuestion === i ? ' is-active' : ''),
				onClick: function () { state.selectedQuestion = i; render(); }
			}, [
				el('div', { class: 'ocf-b-q-card-row' }, [
					el('span', { class: 'ocf-b-q-type' }, [typeLabel]),
					el('span', { class: 'ocf-b-q-id' }, [q.id])
				]),
				el('div', { class: 'ocf-b-q-card-label' }, [stripHtml(q.label || '(no label)')]),
				el('div', { class: 'ocf-b-q-card-actions' }, [
					i > 0 ? el('button', { type: 'button', onClick: function (e) { e.stopPropagation(); move(step.questions, i, i - 1); if (state.selectedQuestion === i) state.selectedQuestion -= 1; render(); } }, ['↑']) : null,
					i < step.questions.length - 1 ? el('button', { type: 'button', onClick: function (e) { e.stopPropagation(); move(step.questions, i, i + 1); if (state.selectedQuestion === i) state.selectedQuestion += 1; render(); } }, ['↓']) : null,
					el('button', { type: 'button', class: 'ocf-b-del', onClick: function (e) {
						e.stopPropagation();
						if (!confirm('Delete this question?')) return;
						step.questions.splice(i, 1);
						state.selectedQuestion = null;
						render();
					} }, ['×'])
				])
			]);
			qList.appendChild(card);
		});
		host.appendChild(qList);

		// Add-question palette.
		var palette = el('div', { class: 'ocf-b-palette' });
		palette.appendChild(el('div', { class: 'ocf-b-palette-title' }, ['Add a question:']));
		Object.keys(types).forEach(function (t) {
			palette.appendChild(el('button', { type: 'button', class: 'button',
				onClick: function () {
					// Leave the label blank — only show one if the user fills it in.
					var q = { id: uid('q_'), type: t, label: '', required: false };
					if (t === 'choice' || t === 'multi_choice' || t === 'image_cards' || t === 'image_cards_multi' || t === 'dropdown') {
						q.options = [
							{ label: 'Option A', value: 'a', image: '' },
							{ label: 'Option B', value: 'b', image: '' }
						];
					}
					if (t === 'grid') {
						q.grid = { rows: ['Row 1'], columns: ['Column 1', 'Column 2'] };
					}
					step.questions.push(q);
					state.selectedQuestion = step.questions.length - 1;
					render();
				}
			}, [types[t].label]));
		});
		host.appendChild(palette);
	}

	function refreshSidebar() {
		// Cheap: rebuild only the sidebar by re-rendering full UI.
		render();
	}

	function renderStepInspector(host, step) {
		host.appendChild(el('h3', null, ['Step settings']));
		host.appendChild(el('label', { class: 'ocf-b-field' }, [
			el('span', null, ['Step ID']),
			el('input', { type: 'text', class: 'widefat', value: step.id, onInput: function (e) { step.id = sanitizeId(e.target.value); syncHiddenInput(); } })
		]));
		host.appendChild(el('label', { class: 'ocf-b-field ocf-b-field-inline' }, [
			el('input', { type: 'checkbox', checked: step.show_title ? 'checked' : null, onChange: function (e) { step.show_title = e.target.checked; syncHiddenInput(); } }),
			el('span', null, ['Show step title as heading on the form'])
		]));
		host.appendChild(el('p', { class: 'ocf-b-hint' }, ['By default the step title is an internal label for the builder only.']));
		host.appendChild(el('label', { class: 'ocf-b-field ocf-b-field-inline' }, [
			el('input', { type: 'checkbox', checked: step.skippable ? 'checked' : null, onChange: function (e) { step.skippable = e.target.checked; syncHiddenInput(); } }),
			el('span', null, ['Show "Skip" button on this step'])
		]));
		host.appendChild(logicEditor('Show step if…', step.show_if || [], function (rules) { step.show_if = rules; syncHiddenInput(); }));
	}

	function renderQuestionInspector(host, step, q) {
		if (!q) return;

		host.appendChild(el('h3', null, ['Question settings']));

		host.appendChild(el('label', { class: 'ocf-b-field' }, [
			el('span', null, ['Type']),
			(function () {
				var sel = el('select', { class: 'widefat', onChange: function (e) { q.type = e.target.value; syncHiddenInput(); render(); } });
				Object.keys(types).forEach(function (t) {
					var o = el('option', { value: t }, [types[t].label]);
					if (q.type === t) o.setAttribute('selected', 'selected');
					sel.appendChild(o);
				});
				return sel;
			})()
		]));

		host.appendChild(el('label', { class: 'ocf-b-field' }, [
			el('span', null, ['Question ID']),
			el('input', { type: 'text', class: 'widefat', value: q.id, onInput: function (e) { q.id = sanitizeId(e.target.value); syncHiddenInput(); } })
		]));

		host.appendChild(el('label', { class: 'ocf-b-field' }, [
			el('span', null, ['Label (HTML allowed)']),
			el('input', { type: 'text', class: 'widefat', value: q.label || '', onInput: function (e) { q.label = e.target.value; syncHiddenInput(); render(); } })
		]));

		host.appendChild(el('label', { class: 'ocf-b-field' }, [
			el('span', null, ['Help text']),
			el('textarea', { class: 'widefat', rows: 2, onInput: function (e) { q.help = e.target.value; syncHiddenInput(); } }, [q.help || ''])
		]));

		if (['short_text', 'email', 'phone', 'url', 'number', 'long_text', 'dropdown'].indexOf(q.type) > -1) {
			host.appendChild(el('label', { class: 'ocf-b-field' }, [
				el('span', null, ['Placeholder']),
				el('input', { type: 'text', class: 'widefat', value: q.placeholder || '', onInput: function (e) { q.placeholder = e.target.value; syncHiddenInput(); } })
			]));
		}

		// Required + skippable
		host.appendChild(el('label', { class: 'ocf-b-field ocf-b-field-inline' }, [
			el('input', { type: 'checkbox', checked: q.required ? 'checked' : null, onChange: function (e) { q.required = e.target.checked; syncHiddenInput(); } }),
			el('span', null, ['Required'])
		]));

		// Options
		if (['choice', 'multi_choice', 'image_cards', 'image_cards_multi', 'dropdown'].indexOf(q.type) > -1) {
			q.options = q.options || [];
			host.appendChild(el('h4', null, ['Options']));
			var opts = el('div', { class: 'ocf-b-opts' });
			q.options.forEach(function (opt, i) {
				var row = el('div', { class: 'ocf-b-opt' }, [
					el('input', { type: 'text', placeholder: 'Label', value: opt.label || '', onInput: function (e) { opt.label = e.target.value; if (!opt.value) opt.value = slug(opt.label); syncHiddenInput(); } }),
					el('input', { type: 'text', placeholder: 'Value', value: opt.value || '', onInput: function (e) { opt.value = e.target.value; syncHiddenInput(); } }),
					(q.type === 'image_cards' || q.type === 'image_cards_multi')
						? el('div', { class: 'ocf-b-opt-image' }, [
							opt.image ? el('img', { src: opt.image, alt: '' }) : null,
							el('button', { type: 'button', class: 'button', onClick: function () { openMedia(function (url) { opt.image = url; render(); }); } }, [opt.image ? 'Change' : 'Pick image'])
						])
						: null,
					el('button', { type: 'button', class: 'ocf-b-del', onClick: function () { q.options.splice(i, 1); render(); } }, ['×'])
				]);
				opts.appendChild(row);
			});
			host.appendChild(opts);
			host.appendChild(el('button', { type: 'button', class: 'button', onClick: function () { q.options.push({ label: 'Option', value: '', image: '' }); render(); } }, ['+ Add option']));
		}

		// File-upload settings.
		if (q.type === 'file_upload') {
			host.appendChild(el('label', { class: 'ocf-b-field' }, [
				el('span', null, ['Accepted types (e.g. pdf,jpg,png or image/*)']),
				el('input', { type: 'text', class: 'widefat', value: q.accept || '', onInput: function (e) { q.accept = e.target.value; syncHiddenInput(); } })
			]));
			host.appendChild(el('label', { class: 'ocf-b-field' }, [
				el('span', null, ['Max size (MB)']),
				el('input', { type: 'number', min: 1, max: 100, value: q.max_size_mb || 20, onInput: function (e) { q.max_size_mb = parseInt(e.target.value, 10) || 20; syncHiddenInput(); } })
			]));
			host.appendChild(el('label', { class: 'ocf-b-field ocf-b-field-inline' }, [
				el('input', { type: 'checkbox', checked: q.multiple ? 'checked' : null, onChange: function (e) { q.multiple = e.target.checked; syncHiddenInput(); } }),
				el('span', null, ['Allow multiple files'])
			]));
		}

		// Grid settings.
		if (q.type === 'grid') {
			q.grid = q.grid || { rows: [], columns: [] };
			host.appendChild(el('label', { class: 'ocf-b-field' }, [
				el('span', null, ['Rows (one per line)']),
				el('textarea', { rows: 4, class: 'widefat', onInput: function (e) { q.grid.rows = e.target.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); syncHiddenInput(); } }, [(q.grid.rows || []).join('\n')])
			]));
			host.appendChild(el('label', { class: 'ocf-b-field' }, [
				el('span', null, ['Columns (one per line)']),
				el('textarea', { rows: 4, class: 'widefat', onInput: function (e) { q.grid.columns = e.target.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); syncHiddenInput(); } }, [(q.grid.columns || []).join('\n')])
			]));
		}

		host.appendChild(logicEditor('Show this question if…', q.show_if || [], function (rules) { q.show_if = rules; syncHiddenInput(); }));
	}

	function logicEditor(title, rules, onChange) {
		var host = el('div', { class: 'ocf-b-logic' });
		host.appendChild(el('h4', null, [title]));
		var hint = el('p', { class: 'ocf-b-hint' }, ['Leave empty to always show.']);
		host.appendChild(hint);
		var list = el('div', { class: 'ocf-b-logic-list' });

		function refresh() {
			list.innerHTML = '';
			rules.forEach(function (r, i) {
				var row = el('div', { class: 'ocf-b-logic-row' }, [
					i > 0 ? (function () {
						var s = el('select', { onChange: function (e) { r.join = e.target.value; onChange(rules); } }, [
							el('option', { value: 'and' }, ['AND']),
							el('option', { value: 'or' }, ['OR'])
						]);
						if (r.join === 'or') s.value = 'or';
						return s;
					})() : null,
					(function () {
						var s = el('select', { onChange: function (e) { r.question = e.target.value; onChange(rules); } });
						s.appendChild(el('option', { value: '' }, ['— question —']));
						schema.steps.forEach(function (st) {
							st.questions.forEach(function (qq) {
								var o = el('option', { value: qq.id }, [stripHtml(qq.label || qq.id)]);
								if (r.question === qq.id) o.setAttribute('selected', 'selected');
								s.appendChild(o);
							});
						});
						return s;
					})(),
					(function () {
						var s = el('select', { onChange: function (e) { r.op = e.target.value; onChange(rules); } });
						['is','is_not','contains','not_contains','is_set','is_empty','gt','lt'].forEach(function (op) {
							var o = el('option', { value: op }, [op]);
							if (r.op === op) o.setAttribute('selected', 'selected');
							s.appendChild(o);
						});
						return s;
					})(),
					el('input', { type: 'text', placeholder: 'value', value: r.value || '', onInput: function (e) { r.value = e.target.value; onChange(rules); } }),
					el('button', { type: 'button', class: 'ocf-b-del', onClick: function () { rules.splice(i, 1); refresh(); onChange(rules); } }, ['×'])
				]);
				list.appendChild(row);
			});
		}
		refresh();
		host.appendChild(list);
		host.appendChild(el('button', { type: 'button', class: 'button', onClick: function () {
			rules.push({ question: '', op: 'is', value: '', join: 'and' });
			refresh();
			onChange(rules);
		} }, ['+ Add rule']));
		return host;
	}

	function renderTheme(host) {
		host.appendChild(el('h3', null, ['Theme']));
		var t = schema.theme;
		function color(label, key) {
			return el('label', { class: 'ocf-b-field' }, [
				el('span', null, [label]),
				el('input', { type: 'color', value: t[key] || '#000000', onInput: function (e) { t[key] = e.target.value; syncHiddenInput(); } })
			]);
		}
		host.appendChild(color('Primary (buttons, selected state)', 'primary'));
		host.appendChild(color('Accent (progress bar)', 'accent'));
		host.appendChild(color('Card background', 'background'));
		host.appendChild(el('label', { class: 'ocf-b-field' }, [
			el('span', null, ['Font family (Google Fonts auto-loaded)']),
			el('input', { type: 'text', class: 'widefat', value: t.font || 'Inter', placeholder: 'e.g. Inter, Roboto, Playfair Display', onInput: function (e) { t.font = e.target.value; syncHiddenInput(); } })
		]));
		host.appendChild(el('label', { class: 'ocf-b-field' }, [
			el('span', null, ['Corner radius (e.g. 8px)']),
			el('input', { type: 'text', class: 'widefat', value: t.radius || '8px', onInput: function (e) { t.radius = e.target.value; syncHiddenInput(); } })
		]));
		host.appendChild(el('label', { class: 'ocf-b-field' }, [
			el('span', null, ['Logo URL']),
			el('input', { type: 'url', class: 'widefat', value: t.logo || '', onInput: function (e) { t.logo = e.target.value; syncHiddenInput(); } })
		]));
		host.appendChild(el('button', { type: 'button', class: 'button', onClick: function () { openMedia(function (url) { t.logo = url; render(); }); } }, ['Pick from library']));

		host.appendChild(el('h3', null, ['Labels']));
		var s = schema.settings;
		['submit_label','next_label','back_label','skip_label'].forEach(function (k) {
			host.appendChild(el('label', { class: 'ocf-b-field' }, [
				el('span', null, [k]),
				el('input', { type: 'text', class: 'widefat', value: s[k] || '', onInput: function (e) { s[k] = e.target.value; syncHiddenInput(); } })
			]));
		});
		host.appendChild(el('label', { class: 'ocf-b-field ocf-b-field-inline' }, [
			el('input', { type: 'checkbox', checked: s.show_progress !== false ? 'checked' : null, onChange: function (e) { s.show_progress = e.target.checked; syncHiddenInput(); } }),
			el('span', null, ['Show progress bar'])
		]));
	}

	function renderBrevo(host) {
		var b = schema.brevo;
		b.attribute_map        = asPlainObject(b.attribute_map);
		b.event_properties_map = asPlainObject(b.event_properties_map);

		// Kick off (or refresh) the Brevo attribute fetch on first render.
		if (!brevoAttrs.length && !brevoAttrsLoading && !brevoAttrsError) {
			loadBrevoAttributes(false);
		}

		host.appendChild(el('h3', null, ['Brevo integration']));
		host.appendChild(el('label', { class: 'ocf-b-field ocf-b-field-inline' }, [
			el('input', { type: 'checkbox', checked: b.enabled !== false ? 'checked' : null, onChange: function (e) { b.enabled = e.target.checked; syncHiddenInput(); } }),
			el('span', null, ['Send to Brevo'])
		]));
		host.appendChild(el('label', { class: 'ocf-b-field' }, [
			el('span', null, ['List IDs (comma-separated)']),
			el('input', { type: 'text', class: 'widefat', value: (b.list_ids || []).join(','), onInput: function (e) { b.list_ids = e.target.value.split(',').map(function (s) { return parseInt(s.trim(), 10); }).filter(function (n) { return !isNaN(n); }); syncHiddenInput(); } })
		]));

		// Single datalist shared across both map editors on this tab.
		var datalistId = 'ocf-brevo-attrs';
		host.appendChild((function () {
			var dl = el('datalist', { id: datalistId });
			brevoAttrs.forEach(function (a) { dl.appendChild(el('option', { value: a.name })); });
			return dl;
		})());

		host.appendChild(el('h4', null, ['Attribute mapping (contact)']));
		host.appendChild(el('p', { class: 'ocf-b-hint' }, [
			brevoAttrsLoading ? 'Loading Brevo attributes…'
				: brevoAttrsError ? ('Could not load Brevo attributes: ' + brevoAttrsError + '. Check your API key in Settings.')
				: brevoAttrs.length ? ('Map each question to a Brevo contact attribute. ' + brevoAttrs.length + ' available — type or pick from the dropdown.')
				: 'Map each question to a Brevo contact attribute name (e.g. FIRSTNAME, BUDGET).'
		]));
		host.appendChild(el('p', { class: 'ocf-b-hint', style: { background: '#fffbeb', border: '1px solid #fde68a', padding: '8px 10px', borderRadius: '4px' } }, [
			(function () {
				var hasEmail = schema.steps.some(function (st) { return (st.questions || []).some(function (q) { return q.type === 'email'; }); });
				if (hasEmail) {
					return 'Your Email question is automatically used as the Brevo contact identifier — you do not need to map it here. Map other questions (name, phone, project type, etc.) to their Brevo attributes below.';
				}
				return 'Tip: any question of type Email is auto-detected and used as the Brevo contact identifier. Add one to your form so submissions land as real Brevo contacts.';
			})()
		]));
		if (brevoAttrs.length || brevoAttrsError) {
			host.appendChild(el('p', null, [
				el('button', { type: 'button', class: 'button button-small', onClick: function () { brevoAttrs = []; brevoAttrsError = ''; loadBrevoAttributes(true); } }, ['Refresh attribute list'])
			]));
		}
		mapEditor(host, b.attribute_map, function () { syncHiddenInput(); }, datalistId);

		host.appendChild(el('h4', null, ['Track event']));
		host.appendChild(el('label', { class: 'ocf-b-field ocf-b-field-inline' }, [
			el('input', { type: 'checkbox', checked: b.send_event ? 'checked' : null, onChange: function (e) { b.send_event = e.target.checked; syncHiddenInput(); } }),
			el('span', null, ['Send a track event'])
		]));
		host.appendChild(el('label', { class: 'ocf-b-field' }, [
			el('span', null, ['Event name']),
			el('input', { type: 'text', class: 'widefat', value: b.event_name || 'lead_form_completed', onInput: function (e) { b.event_name = e.target.value; syncHiddenInput(); } })
		]));
		host.appendChild(el('h4', null, ['Event property mapping']));
		mapEditor(host, b.event_properties_map, function () { syncHiddenInput(); });
	}

	function mapEditor(host, map, onChange, datalistId) {
		var list = el('div', { class: 'ocf-b-map' });
		function rebuild() {
			list.innerHTML = '';
			Object.keys(map).forEach(function (qid) {
				var input = el('input', {
					type: 'text',
					placeholder: 'BREVO_ATTRIBUTE',
					value: map[qid] || '',
					list: datalistId || null,
					onInput: function (e) { map[qid] = e.target.value; onChange(); }
				});
				var row = el('div', { class: 'ocf-b-map-row' }, [
					(function () {
						var s = el('select', { onChange: function (e) {
							var nv = e.target.value;
							var attr = map[qid];
							delete map[qid];
							map[nv] = attr;
							qid = nv; // keep this row's closure in sync
							onChange();
							rebuild();
						} });
						s.appendChild(el('option', { value: '' }, ['— question —']));
						schema.steps.forEach(function (st) {
							st.questions.forEach(function (q) {
								var o = el('option', { value: q.id }, [stripHtml(q.label || q.id)]);
								if (qid === q.id) o.setAttribute('selected', 'selected');
								s.appendChild(o);
							});
						});
						return s;
					})(),
					input,
					el('button', { type: 'button', class: 'ocf-b-del', onClick: function () { delete map[qid]; rebuild(); onChange(); } }, ['×'])
				]);
				list.appendChild(row);
			});
		}
		rebuild();
		host.appendChild(list);
		host.appendChild(el('button', { type: 'button', class: 'button', onClick: function () {
			// Pick first question without an entry.
			var qid = '';
			schema.steps.some(function (st) { return st.questions.some(function (q) { if (!(q.id in map)) { qid = q.id; return true; } }); });
			if (!qid) { alert('No more questions to map.'); return; }
			map[qid] = '';
			rebuild();
			onChange();
		} }, ['+ Add mapping']));
	}

	function renderSpam(host) {
		var s = schema.spam;
		host.appendChild(el('h3', null, ['Spam protection']));
		host.appendChild(el('label', { class: 'ocf-b-field ocf-b-field-inline' }, [
			el('input', { type: 'checkbox', checked: s.honeypot ? 'checked' : null, onChange: function (e) { s.honeypot = e.target.checked; syncHiddenInput(); } }),
			el('span', null, ['Enable honeypot'])
		]));
		host.appendChild(el('label', { class: 'ocf-b-field ocf-b-field-inline' }, [
			el('input', { type: 'checkbox', checked: s.turnstile ? 'checked' : null, onChange: function (e) { s.turnstile = e.target.checked; syncHiddenInput(); } }),
			el('span', null, ['Require Cloudflare Turnstile on submit'])
		]));
		host.appendChild(el('label', { class: 'ocf-b-field' }, [
			el('span', null, ['Submissions per IP per 10 min']),
			el('input', { type: 'number', min: 1, max: 100, value: s.rate_limit || 5, onInput: function (e) { s.rate_limit = parseInt(e.target.value, 10) || 5; syncHiddenInput(); } })
		]));
		host.appendChild(el('p', { class: 'description' }, ['Turnstile keys are set in Settings → October Forms.']));
	}

	function renderNotifications(host) {
		var n = schema.notifications;
		host.appendChild(el('h3', null, ['Notifications']));
		host.appendChild(el('p', { class: 'ocf-b-hint' }, ['Each completed submission emails a notification to the address set in Settings → October Forms. Use the field below to CC additional people on the email for this form only.']));

		host.appendChild(el('label', { class: 'ocf-b-field' }, [
			el('span', null, ['CC recipients (comma-separated email addresses)']),
			el('input', { type: 'text', class: 'widefat',
				placeholder: 'partner@example.com, accounts@example.com',
				value: (n.cc || []).join(', '),
				onInput: function (e) {
					n.cc = e.target.value.split(/[\s,;]+/).map(function (s) { return s.trim(); }).filter(Boolean);
					syncHiddenInput();
				}
			})
		]));
	}

	function renderEndings(host) {
		var e = schema.endings.default = schema.endings.default || {};
		host.appendChild(el('h3', null, ['On submit']));

		host.appendChild(el('label', { class: 'ocf-b-field' }, [
			el('span', null, ['Redirect to URL after submit (optional)']),
			el('input', { type: 'url', class: 'widefat', placeholder: 'https://nvelope.co/thank-you', value: e.redirect_url || '', onInput: function (ev) { e.redirect_url = ev.target.value; syncHiddenInput(); } })
		]));
		host.appendChild(el('p', { class: 'ocf-b-hint' }, ['If set, the visitor is redirected here once the form is submitted. The ending screen below is ignored.']));

		host.appendChild(el('h4', null, ['Ending screen (used when no redirect is set)']));
		host.appendChild(el('label', { class: 'ocf-b-field' }, [
			el('span', null, ['Heading']),
			el('input', { type: 'text', class: 'widefat', value: e.heading || '', onInput: function (ev) { e.heading = ev.target.value; syncHiddenInput(); } })
		]));
		host.appendChild(el('label', { class: 'ocf-b-field' }, [
			el('span', null, ['Body']),
			el('textarea', { rows: 4, class: 'widefat', onInput: function (ev) { e.body = ev.target.value; syncHiddenInput(); } }, [e.body || ''])
		]));
		host.appendChild(el('label', { class: 'ocf-b-field' }, [
			el('span', null, ['CTA label']),
			el('input', { type: 'text', class: 'widefat', value: e.cta_label || '', onInput: function (ev) { e.cta_label = ev.target.value; syncHiddenInput(); } })
		]));
		host.appendChild(el('label', { class: 'ocf-b-field' }, [
			el('span', null, ['CTA URL']),
			el('input', { type: 'url', class: 'widefat', value: e.cta_url || '', onInput: function (ev) { e.cta_url = ev.target.value; syncHiddenInput(); } })
		]));
	}

	function renderJson(host) {
		host.appendChild(el('h3', null, ['Schema JSON']));
		host.appendChild(el('p', { class: 'description' }, ['Paste a schema below to import. Editing is at your own risk — save the post to apply.']));
		var ta = el('textarea', { class: 'widefat code', rows: 24 }, [JSON.stringify(schema, null, 2)]);
		host.appendChild(ta);
		host.appendChild(el('button', { type: 'button', class: 'button button-primary',
			style: { marginTop: '10px' },
			onClick: function () {
				try {
					var parsed = JSON.parse(ta.value);
					Object.keys(schema).forEach(function (k) { delete schema[k]; });
					Object.assign(schema, parsed);
					alert('Schema replaced. Save the post to persist.');
					render();
				} catch (e) { alert('Invalid JSON: ' + e.message); }
			}
		}, ['Replace schema with above JSON']));
	}

	// -- helpers --
	function move(arr, from, to) {
		if (to < 0 || to >= arr.length) return;
		arr.splice(to, 0, arr.splice(from, 1)[0]);
	}
	function sanitizeId(s) {
		return (s || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 64) || ('id_' + Math.random().toString(36).slice(2, 8));
	}
	function slug(s) {
		return (s || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
	}
	function stripHtml(s) {
		var d = document.createElement('div'); d.innerHTML = s || ''; return d.textContent || d.innerText || '';
	}
	function openMedia(cb) {
		if (!window.wp || !wp.media) { alert('Media library unavailable.'); return; }
		var frame = wp.media({ title: 'Choose image', multiple: false, library: { type: 'image' } });
		frame.on('select', function () {
			var att = frame.state().get('selection').first().toJSON();
			cb(att.url);
		});
		frame.open();
	}

	// Patch the post form on submit so the JSON is current.
	$(function () {
		$('form#post').on('submit', function () { syncHiddenInput(); });
	});

	render();
})(window.jQuery);
