/**
 * WooCommerce Bulk Editor – Spreadsheet JS
 */
(function ($) {
	'use strict';

	// -------------------------------------------------------------------------
	// State
	// -------------------------------------------------------------------------
	const state = {
		changes: {},   // { "productId:field": { id, field, value, originalValue } }
		rows: [],      // last-loaded server rows, kept so grouping can re-render
		page: 1,
		totalPages: 1,
		loading: false,
	};

	// -------------------------------------------------------------------------
	// DOM refs
	// -------------------------------------------------------------------------
	const $tbody       = $('#wbe-tbody');
	const $saveBtn     = $('#wbe-save');
	const $discardBtn  = $('#wbe-discard');
	const $changeBadge = $('#wbe-change-count');
	const $status      = $('#wbe-status');
	const $pagination  = $('#wbe-pagination');
	const $pageInfo    = $('#wbe-page-info');
	const $prevBtn     = $('#wbe-prev');
	const $nextBtn     = $('#wbe-next');
	const $floatBar    = $('#wbe-float-actions');
	const $floatCount  = $('#wbe-float-count');
	const $floatSave   = $('#wbe-float-save');
	const $floatDiscard= $('#wbe-float-discard');

	// -------------------------------------------------------------------------
	// Helpers
	// -------------------------------------------------------------------------
	function showStatus(message, type = 'info') {
		$status
			.removeClass('is-success is-error is-info')
			.addClass('is-' + type)
			.text(message)
			.show();
	}

	function hideStatus() {
		$status.hide().text('');
	}

	function changeKey(id, field) {
		return id + ':' + field;
	}

	function updateToolbar() {
		const count = Object.keys(state.changes).length;
		if (count > 0) {
			const label = count + ' unsaved change' + (count !== 1 ? 's' : '');
			$changeBadge.text(label).show();
			$discardBtn.show();
			$saveBtn.prop('disabled', false);
			$floatCount.text(label);
			$floatBar.show();
		} else {
			$changeBadge.hide();
			$discardBtn.hide();
			$saveBtn.prop('disabled', true);
			$floatBar.hide();
		}
	}

	// Floating bar buttons proxy to the toolbar buttons (single source of truth).
	$floatSave.on('click', function () { $saveBtn.trigger('click'); });
	$floatDiscard.on('click', function () { $discardBtn.trigger('click'); });

	function formatPrice(val) {
		if (val === '' || val === null || val === undefined) return '';
		const n = parseFloat(val);
		return isNaN(n) ? val : n.toFixed(2);
	}

	// -------------------------------------------------------------------------
	// Image cell – click to pick from media library, drag-and-drop to upload
	// -------------------------------------------------------------------------
	function buildImageCell(id, imageId, thumbUrl, field, colKey, extraClass) {
		field    = field    || 'image';
		colKey   = colKey   || 'image';
		const $td = $('<td>')
			.addClass('wbe-col-image' + (extraClass ? ' ' + extraClass : ''))
			.attr('data-col', colKey);

		const $wrap = $('<div>')
			.addClass('wbe-img-wrap')
			.attr({
				'data-id':       id,
				'data-field':    field,
				'data-original': String(imageId || ''),
				title:           field === 'acvs_lifestyle'
					? 'Lifestyle (hover) image — click to choose, or drag & drop a file'
					: 'Click to choose image, or drag & drop a file',
			});

		if (thumbUrl) {
			$wrap.append($('<img>').addClass('wbe-img-thumb').attr('src', thumbUrl).attr('alt', ''));
		} else {
			$wrap.append($('<span>').addClass('wbe-img-placeholder').html('<span class="dashicons dashicons-camera-alt"></span>'));
		}

		// Uploading spinner (hidden by default)
		$wrap.append($('<span>').addClass('wbe-img-spinner').hide());

		$td.append($wrap);
		return $td;
	}

	// Open WP media library on click
	$tbody.on('click', '.wbe-img-wrap', function (e) {
		if ($(this).hasClass('is-uploading')) return;
		const $wrap = $(this);

		const frame = wp.media({
			title:    octwbe.i18n.selectImage,
			button:   { text: octwbe.i18n.useImage },
			multiple: false,
			library:  { type: 'image' },
		});

		frame.on('select', function () {
			const attachment = frame.state().get('selection').first().toJSON();
			deliverImage($wrap, attachment.id, attachment.sizes?.thumbnail?.url || attachment.url);
		});

		frame.open();
	});

	// A group-header image wrap fills every member variation in the group; a normal
	// wrap just sets its own cell. Both media-pick and drag-drop funnel through here.
	function deliverImage($wrap, attachmentId, thumbUrl) {
		if ($wrap.hasClass('is-group')) {
			fillGroupImage($wrap, attachmentId, thumbUrl);
		} else {
			applyImageToCell($wrap, attachmentId, thumbUrl);
		}
	}

	// Drag-and-drop image upload
	$tbody.on('dragover dragenter', '.wbe-img-wrap', function (e) {
		e.preventDefault();
		$(this).addClass('is-drag-over');
	});

	$tbody.on('dragleave drop', '.wbe-img-wrap', function (e) {
		e.preventDefault();
		$(this).removeClass('is-drag-over');

		if (e.type !== 'drop') return;

		const file = e.originalEvent.dataTransfer.files[0];
		if (!file || !file.type.startsWith('image/')) return;

		uploadImageFile($(this), file);
	});

	// Per-session upload cache, keyed by file name + size. The first drop of a
	// given image uploads it; every later drop of the same file — even ones fired
	// in parallel before the first finishes — waits on that single request and
	// reuses its attachment, so the media library never gets duplicates.
	const uploadCache = {};

	function uploadImageFile($wrap, file) {
		if ($wrap.hasClass('is-uploading')) return;

		const cacheKey = file.name + ':' + file.size;
		$wrap.addClass('is-uploading');
		$wrap.find('.wbe-img-spinner').show();

		// Already uploaded (or uploading) this exact file this session — reuse it.
		if (uploadCache[cacheKey]) {
			uploadCache[cacheKey].done(function (data) {
				deliverImage($wrap, data.attachment_id, data.thumb_url);
				showStatus('Reused "' + file.name + '" — no duplicate uploaded.', 'info');
			}).fail(function () {
				showStatus(octwbe.i18n.uploadError, 'error');
			}).always(function () {
				$wrap.removeClass('is-uploading');
				$wrap.find('.wbe-img-spinner').hide();
			});
			return;
		}

		const dfd = $.Deferred();
		uploadCache[cacheKey] = dfd;
		showStatus(octwbe.i18n.uploading, 'info');

		const formData = new FormData();
		formData.append('action', 'octwbe_upload_image');
		formData.append('nonce', octwbe.uploadNonce);
		formData.append('file', file, file.name);

		$.ajax({
			url:         octwbe.ajaxUrl,
			type:        'POST',
			data:        formData,
			processData: false,
			contentType: false,
		}).done(function (response) {
			if (response.success) {
				dfd.resolve(response.data);
				deliverImage($wrap, response.data.attachment_id, response.data.thumb_url);
				if (response.data.reused) {
					showStatus('Reused existing "' + (response.data.filename || file.name) + '" from the media library — no duplicate uploaded.', 'info');
				} else {
					hideStatus();
				}
			} else {
				delete uploadCache[cacheKey]; // allow a retry
				dfd.reject();
				showStatus(response.data || octwbe.i18n.uploadError, 'error');
			}
		}).fail(function () {
			delete uploadCache[cacheKey]; // allow a retry
			dfd.reject();
			showStatus(octwbe.i18n.uploadError, 'error');
		}).always(function () {
			$wrap.removeClass('is-uploading');
			$wrap.find('.wbe-img-spinner').hide();
		});
	}

	function applyImageToCell($wrap, attachmentId, thumbUrl) {
		const id    = $wrap.data('id');
		const field = $wrap.data('field') || 'image';
		const orig  = String($wrap.data('original') ?? '');
		const value = String(attachmentId);
		const key   = changeKey(id, field);

		// Update displayed image
		$wrap.find('.wbe-img-placeholder').remove();
		let $img = $wrap.find('.wbe-img-thumb');
		if (!$img.length) {
			$img = $('<img>').addClass('wbe-img-thumb').attr('alt', '');
			$wrap.prepend($img);
		}
		$img.attr('src', thumbUrl);

		// Track change
		if (value !== orig) {
			state.changes[key] = { id, field, value, originalValue: orig, originalThumb: $wrap.data('current-thumb') || '', thumb: thumbUrl };
			$wrap.addClass('is-dirty');
		} else {
			delete state.changes[key];
			$wrap.removeClass('is-dirty');
		}

		$wrap.attr('data-current-thumb', thumbUrl);
		updateToolbar();
	}

	// Set one image across every variation in a group (e.g. all cushion fillings
	// of the same fabric). Updates the group header's preview, then applies the
	// image to each member row's own image cell so it flows through normal change
	// tracking and the existing Save All Changes flow.
	function fillGroupImage($wrap, attachmentId, thumbUrl) {
		const pid  = String($wrap.data('parent-id'));
		const gval = String($wrap.data('group-value'));

		// Update the header's own preview
		$wrap.find('.wbe-img-placeholder').remove();
		let $img = $wrap.find('.wbe-img-thumb');
		if (!$img.length) {
			$img = $('<img>').addClass('wbe-img-thumb').attr('alt', '');
			$wrap.prepend($img);
		}
		$img.attr('src', thumbUrl);

		// Propagate to each member variation's main image cell
		let n = 0;
		$('#wbe-tbody tr.wbe-row-variation').each(function () {
			const $row = $(this);
			if (String($row.data('parent-id')) !== pid || String($row.data('group-value')) !== gval) return;
			const $memberWrap = $row.find('.wbe-img-wrap[data-field="image"]');
			if ($memberWrap.length) {
				applyImageToCell($memberWrap, attachmentId, thumbUrl);
				n++;
			}
		});

		showStatus('Applied image to ' + n + ' variation' + (n !== 1 ? 's' : '') + ' in this group. Review, then Save All Changes.', 'info');
	}

	// Backorder options (shared by the row cell and the bulk-edit bar).
	const BACKORDER_OPTIONS = [
		{ value: 'no',     label: 'Do not allow' },
		{ value: 'notify', label: 'Allow, but notify' },
		{ value: 'yes',    label: 'Allow' },
	];

	// -------------------------------------------------------------------------
	// Build table rows from server data
	// -------------------------------------------------------------------------
	function buildRow(row) {
		const isParent    = row.type === 'parent';
		const isVariation = row.type === 'variation';
		const rowClass    = isParent    ? 'wbe-row-parent'
		                  : isVariation ? 'wbe-row-variation'
		                  :               'wbe-row-simple';

		const $tr = $('<tr>').addClass(rowClass).attr('data-id', row.id);

		// Selection checkbox (parent toggles its children; simple/variation select themselves)
		if (isParent) {
			$tr.append('<td class="wbe-col-check"><input type="checkbox" class="wbe-parent-check" data-parent-id="' + esc(String(row.id)) + '" /></td>');
		} else {
			const parentAttr = isVariation && row.parent_id ? ' data-parent-id="' + esc(String(row.parent_id)) + '"' : '';
			$tr.append('<td class="wbe-col-check"><input type="checkbox" class="wbe-row-check" value="' + esc(String(row.id)) + '"' + parentAttr + ' /></td>');
		}

		// Main image cell (parent gets empty non-editable cell)
		if (isParent) {
			$tr.append('<td class="wbe-col-image" data-col="image"></td>');
		} else {
			$tr.append(buildImageCell(row.id, row.image_id, row.image_thumb));
		}

		// Lifestyle (hover) image cell — editable on every row type.
		$tr.append(buildImageCell(row.id, row.lifestyle_id, row.lifestyle_thumb, 'acvs_lifestyle', 'acvs_lifestyle', 'wbe-col-lifestyle'));

		// Name cell
		const nameContent = isParent
			? `<strong>${esc(row.name)}</strong> <span style="color:#999;font-size:11px;font-weight:400">(variable product — edit variations below)</span>`
			: esc(row.name);

		$tr.append(`<td class="wbe-col-name">${nameContent}</td>`);

		// "On Category Page" cell.
		const modeOptions = [
			{ value: 'default', label: 'Single card' },
			{ value: 'expand',  label: 'Variation cards' },
			{ value: 'single',  label: 'Feature one' },
		];
		if (isParent) {
			// Variable product: choose how it appears in the catalogue.
			$tr.append(buildSelectCell(row.id, 'acvs_mode', row.acvs_mode || 'default', modeOptions, 'wbe-col-catalog', 'acvs_catalog'));
		} else if (isVariation) {
			// Variation: tick to show it as its own card.
			$tr.append(buildCheckboxCell(row.id, row.acvs_show === 'yes'));
		} else {
			// Simple product: not applicable (it always shows as itself).
			$tr.append('<td class="wbe-col-catalog" data-col="acvs_catalog"></td>');
		}

		if (isParent) {
			// Whole-product cards (a variable product shown as one card) get their
			// own editable Card Title + Catalog Order. Render the same per-column
			// cells as every other row (empty for the inapplicable fields) so the
			// columns align and hide/show with the toggles — a single colspan
			// placeholder here misaligns once columns are hidden.
			['sku', 'regular_price', 'sale_price', 'stock_qty', 'stock_status', 'status', 'fabric_group', 'price_eur', 'sale_price_eur', 'price_usd', 'sale_price_usd'].forEach(function (col) {
				$tr.append('<td class="wbe-col-empty" data-col="' + col + '"></td>');
			});
			$tr.append(buildTextCell(row.id, 'acvs_card_title', row.acvs_card_title, 'wbe-col-cardtitle'));
			$tr.append(buildTextCell(row.id, 'acvs_catalog_order', row.acvs_catalog_order, 'wbe-col-order', 'number'));
			$tr.append(buildCheckboxCell(row.id, row.manage_stock === 'yes', 'manage_stock', 'wbe-col-status', 'manage_stock'));
			$tr.append(buildSelectCell(row.id, 'backorders', row.backorders || 'no', BACKORDER_OPTIONS, 'wbe-col-status'));
			$tr.append(`<td class="wbe-col-actions"><a href="${esc(row.edit_url)}" target="_blank" class="dashicons dashicons-edit" title="Edit product" style="text-decoration:none;color:#555"></a></td>`);
			return $tr;
		}

		// SKU – text input
		$tr.append(buildTextCell(row.id, 'sku', row.sku, 'wbe-col-sku'));

		// Regular price
		$tr.append(buildPriceCell(row.id, 'regular_price', row.regular_price, 'wbe-col-price'));

		// Sale price
		$tr.append(buildPriceCell(row.id, 'sale_price', row.sale_price, 'wbe-col-price'));

		// Stock qty
		$tr.append(buildTextCell(row.id, 'stock_qty', row.stock_qty, 'wbe-col-stock', 'number'));

		// Stock status
		const stockOptions = [
			{ value: 'instock',     label: 'In stock' },
			{ value: 'outofstock',  label: 'Out of stock' },
			{ value: 'onbackorder', label: 'On backorder' },
		];
		$tr.append(buildSelectCell(row.id, 'stock_status', row.stock_status, stockOptions, 'wbe-col-status'));

		// Publish status
		const statusOptions = [
			{ value: 'publish', label: 'Published' },
			{ value: 'draft',   label: 'Draft' },
			{ value: 'private', label: 'Private' },
			{ value: 'pending', label: 'Pending review' },
		];
		$tr.append(buildSelectCell(row.id, 'status', row.status, statusOptions, 'wbe-col-status'));

		// Fabric Group — per-variation drawer category. Variations get a dropdown
		// built from the parent product's Fabric Groups; simple products get nothing
		// (the drawer is a variable-product feature).
		if (isVariation && Array.isArray(row.fabric_group_options) && row.fabric_group_options.length) {
			const fgOptions = row.fabric_group_options.map(o => ({ value: o.value, label: o.label }));
			$tr.append(buildSelectCell(row.id, 'acvs_fabric_group', row.fabric_group || '', fgOptions, 'wbe-col-fabricgroup', 'fabric_group'));
		} else {
			$tr.append('<td class="wbe-col-fabricgroup" data-col="fabric_group"></td>');
		}

		// Aelia multi-currency prices (EUR / USD, regular + sale).
		$tr.append(buildPriceCell(row.id, 'price_eur', row.price_eur, 'wbe-col-price'));
		$tr.append(buildPriceCell(row.id, 'sale_price_eur', row.sale_price_eur, 'wbe-col-price'));
		$tr.append(buildPriceCell(row.id, 'price_usd', row.price_usd, 'wbe-col-price'));
		$tr.append(buildPriceCell(row.id, 'sale_price_usd', row.sale_price_usd, 'wbe-col-price'));

		// Variant Showcase: custom catalogue card title + catalogue sort order.
		$tr.append(buildTextCell(row.id, 'acvs_card_title', row.acvs_card_title, 'wbe-col-cardtitle'));
		$tr.append(buildTextCell(row.id, 'acvs_catalog_order', row.acvs_catalog_order, 'wbe-col-order', 'number'));

		// Stock management: manage own stock (checkbox) + backorders (made-to-order
		// = manage stock on, qty 0, backorders "notify" → resolves to On backorder
		// server-side).
		$tr.append(buildCheckboxCell(row.id, row.manage_stock === 'yes', 'manage_stock', 'wbe-col-status', 'manage_stock'));
		$tr.append(buildSelectCell(row.id, 'backorders', row.backorders || 'no', BACKORDER_OPTIONS, 'wbe-col-status'));

		// Actions
		$tr.append(`<td class="wbe-col-actions"><a href="${esc(row.edit_url)}" target="_blank" class="dashicons dashicons-edit" title="Edit in WooCommerce" style="text-decoration:none;color:#555"></a></td>`);

		return $tr;
	}

	function buildTextCell(id, field, value, colClass, inputType = 'text') {
		const displayVal = field.includes('price') ? formatPrice(value) : (value ?? '');
		const $td = $('<td>').addClass(colClass).attr('data-col', field);
		const $cell = $('<span>')
			.addClass('wbe-cell')
			.attr({
				contenteditable: 'true',
				'data-id': id,
				'data-field': field,
				'data-original': displayVal,
				'data-type': inputType,
				title: 'Click to edit',
			})
			.text(displayVal);
		$td.append($cell);
		return $td;
	}

	function buildPriceCell(id, field, value, colClass) {
		return buildTextCell(id, field, formatPrice(value), colClass, 'number');
	}

	function buildCheckboxCell(id, checked, field, colClass, colKey) {
		field    = field    || 'acvs_show';
		colClass = colClass || 'wbe-col-catalog';
		colKey   = colKey   || 'acvs_catalog';
		const $td = $('<td>').addClass(colClass).attr('data-col', colKey);
		const $label = $('<label>').addClass('wbe-check');
		const $cb = $('<input type="checkbox">')
			.addClass('wbe-cell-check')
			.attr({
				'data-id':       id,
				'data-field':    field,
				'data-original': checked ? 'yes' : 'no',
			});
		if (checked) $cb.prop('checked', true);
		$label.append($cb);
		$td.append($label);
		return $td;
	}

	function buildSelectCell(id, field, currentValue, options, colClass, colKey) {
		const $td = $('<td>').addClass(colClass).attr('data-col', colKey || field);
		const $select = $('<select>')
			.addClass('wbe-cell-select')
			.attr({
				'data-id': id,
				'data-field': field,
				'data-original': currentValue,
			});

		options.forEach(opt => {
			const $opt = $('<option>').val(opt.value).text(opt.label);
			if (opt.value === currentValue) $opt.prop('selected', true);
			$select.append($opt);
		});

		$td.append($select);
		return $td;
	}

	function esc(str) {
		return $('<div>').text(str || '').html();
	}

	// -------------------------------------------------------------------------
	// Column visibility toggle (persisted per user via localStorage).
	// The Variant Showcase columns start hidden so the grid stays uncluttered
	// for anyone not using the feature — the functionality is still there, one
	// click away in the Columns row.
	// -------------------------------------------------------------------------
	const COL_PREF_KEY      = 'octwbe_columns_v1';
	const COL_DEFAULT_HIDDEN = ['acvs_lifestyle', 'acvs_catalog', 'fabric_group', 'price_eur', 'sale_price_eur', 'price_usd', 'sale_price_usd', 'acvs_card_title', 'acvs_catalog_order', 'manage_stock', 'backorders'];

	function loadColPrefs() {
		try { return JSON.parse(localStorage.getItem(COL_PREF_KEY)) || {}; }
		catch (e) { return {}; }
	}

	function saveColPrefs(prefs) {
		try { localStorage.setItem(COL_PREF_KEY, JSON.stringify(prefs)); }
		catch (e) { /* storage unavailable — fall back to per-session state */ }
	}

	function applyColPrefs() {
		const prefs = loadColPrefs();
		$('.wbe-col-toggle-cb').each(function () {
			const col = $(this).data('col');
			const visible = Object.prototype.hasOwnProperty.call(prefs, col)
				? !!prefs[col]
				: COL_DEFAULT_HIDDEN.indexOf(col) === -1;
			$(this).prop('checked', visible);
			$('#wbe-table [data-col="' + col + '"]').toggle(visible);
		});
	}

	$(document).on('change', '.wbe-col-toggle-cb', function () {
		const col     = $(this).data('col');
		const visible = this.checked;
		$('#wbe-table [data-col="' + col + '"]').toggle(visible);

		const prefs = loadColPrefs();
		prefs[col] = visible;
		saveColPrefs(prefs);
	});

	// -------------------------------------------------------------------------
	// Group variations by attribute (e.g. Fabric) — re-renders the loaded rows
	// with collapsible group headers. Edits in progress are preserved because we
	// re-render from the server rows and re-apply any dirty changes.
	// -------------------------------------------------------------------------
	$('#wbe-groupby').on('change', function () {
		if (state.rows && state.rows.length) {
			renderRows(state.rows);
			reapplyChanges();
		}
	});

	// Collapse / expand a group's member rows by clicking its header label.
	$tbody.on('click', '.wbe-row-group .wbe-col-grouphdr', function () {
		const $hdr      = $(this).closest('tr');
		const pid       = String($hdr.data('parent-id'));
		const gval      = String($hdr.data('group-value'));
		const collapsed = $hdr.toggleClass('is-collapsed').hasClass('is-collapsed');
		$('#wbe-tbody tr.wbe-row-variation').each(function () {
			const $row = $(this);
			if (String($row.data('parent-id')) === pid && String($row.data('group-value')) === gval) {
				$row.toggle(!collapsed);
			}
		});
	});

	// Clicking the group's Fabric Group control must not toggle the collapse.
	$tbody.on('click', '.wbe-group-fg', function (e) { e.stopPropagation(); });

	// Apply a Fabric Group to every variation in the group at once.
	$tbody.on('change', '.wbe-group-fg-select', function () {
		const $hdr  = $(this).closest('tr');
		const pid   = String($hdr.data('parent-id'));
		const gval  = String($hdr.data('group-value'));
		const value = $(this).val();
		let n = 0;
		$('#wbe-tbody tr.wbe-row-variation').each(function () {
			const $row = $(this);
			if (String($row.data('parent-id')) !== pid || String($row.data('group-value')) !== gval) return;
			const $sel = $row.find('.wbe-cell-select[data-field="acvs_fabric_group"]');
			if ($sel.length) { $sel.val(value).trigger('change'); n++; }
		});
		showStatus('Set Fabric Group on ' + n + ' variation' + (n !== 1 ? 's' : '') + ' in this group. Review, then Save All Changes.', 'info');
	});

	// After a re-render (e.g. toggling grouping), re-paint any unsaved edits onto
	// the fresh cells so the dirty state survives the re-render.
	function reapplyChanges() {
		Object.values(state.changes).forEach(c => {
			const $cell = $tbody.find('.wbe-cell[data-id="' + c.id + '"][data-field="' + c.field + '"]');
			if ($cell.length) { $cell.text(c.value).addClass('is-dirty'); }
			const $sel = $tbody.find('.wbe-cell-select[data-id="' + c.id + '"][data-field="' + c.field + '"]');
			if ($sel.length) { $sel.val(c.value).addClass('is-dirty'); }
			const $chk = $tbody.find('.wbe-cell-check[data-id="' + c.id + '"][data-field="' + c.field + '"]');
			if ($chk.length) { $chk.prop('checked', c.value === 'yes').closest('td').addClass('is-dirty'); }
			if (c.field === 'image' || c.field === 'acvs_lifestyle') {
				const $wrap = $tbody.find('.wbe-img-wrap[data-id="' + c.id + '"][data-field="' + c.field + '"]').not('.is-group');
				if ($wrap.length) {
					$wrap.addClass('is-dirty');
					if (c.thumb) {
						$wrap.find('.wbe-img-placeholder').remove();
						let $img = $wrap.find('.wbe-img-thumb');
						if (!$img.length) { $img = $('<img>').addClass('wbe-img-thumb').attr('alt', ''); $wrap.prepend($img); }
						$img.attr('src', c.thumb);
						$wrap.attr('data-current-thumb', c.thumb);
					}
				}
			}
		});
	}

	// -------------------------------------------------------------------------
	// Load products via AJAX
	// -------------------------------------------------------------------------
	function loadProducts(page = 1) {
		if (state.loading) return;
		state.loading = true;

		const search   = $('#wbe-search').val().trim();
		const category = $('#wbe-category').val();

		showStatus(octwbe.i18n.loading, 'info');
		$tbody.html('<tr class="wbe-placeholder"><td colspan="21">Loading…</td></tr>');
		$('.wbe-table-wrapper').addClass('wbe-loading-overlay');

		$.post(octwbe.ajaxUrl, {
			action:   'octwbe_get_products',
			nonce:    octwbe.nonce,
			search:   search,
			category: category,
			page:     page,
		}, function (response) {
			state.loading = false;
			$('.wbe-table-wrapper').removeClass('wbe-loading-overlay');

			if (!response.success) {
				showStatus('Error loading products.', 'error');
				return;
			}

			const data = response.data;
			state.page       = data.page;
			state.totalPages = data.total_pages;

			renderRows(data.rows);
			renderPagination(data.page, data.total_pages, data.total);
			hideStatus();
		}).fail(function () {
			state.loading = false;
			$('.wbe-table-wrapper').removeClass('wbe-loading-overlay');
			showStatus('Request failed. Check your connection.', 'error');
		});
	}

	function renderRows(rows) {
		state.rows = rows;
		populateGroupBy(rows);
		$tbody.empty();

		if (!rows.length) {
			$tbody.html('<tr class="wbe-placeholder"><td colspan="21">No products found.</td></tr>');
			return;
		}

		const groupBy = $('#wbe-groupby').val() || '';

		// Walk the flat list: a parent is immediately followed by its variations.
		let i = 0;
		while (i < rows.length) {
			const row = rows[i];
			if (row.type === 'parent') {
				$tbody.append(buildRow(row));
				const vars = [];
				i++;
				while (i < rows.length && rows[i].type === 'variation' && String(rows[i].parent_id) === String(row.id)) {
					vars.push(rows[i]);
					i++;
				}
				renderVariations(row, vars, groupBy);
			} else {
				$tbody.append(buildRow(row)); // simple product
				i++;
			}
		}

		// Re-apply hidden columns
		$('.wbe-col-toggle-cb').each(function () {
			if (!this.checked) {
				const col = $(this).data('col');
				$('#wbe-table [data-col="' + col + '"]').hide();
			}
		});

		// Fresh rows start unselected; reset the select-all / bulk bar state.
		updateSelectionUI();
	}

	// Render a parent's variations — flat, or grouped under headers when a
	// group-by attribute is active and these variations carry it.
	function renderVariations(parent, vars, groupBy) {
		const hasAttr = groupBy && vars.some(v => (v.attributes || []).some(a => a.name === groupBy));
		if (!hasAttr) {
			vars.forEach(v => $tbody.append(buildRow(v)));
			return;
		}

		const groups = {};
		const order  = [];
		let attrLabel = groupBy;
		vars.forEach(v => {
			const a   = (v.attributes || []).find(x => x.name === groupBy);
			const key = a ? a.value : '';
			if (a && a.label) attrLabel = a.label;
			if (!groups[key]) {
				groups[key] = { value: key, label: a ? a.value_label : 'Any', rows: [] };
				order.push(key);
			}
			groups[key].rows.push(v);
		});

		order.forEach(key => {
			const g = groups[key];
			$tbody.append(buildGroupHeader(parent.id, attrLabel, g));
			g.rows.forEach(v => {
				const $vr = buildRow(v);
				$vr.attr('data-parent-id', parent.id).attr('data-group-value', key);
				$tbody.append($vr);
			});
		});
	}

	// A collapsible group header with an image cell that fills the whole group.
	function buildGroupHeader(parentId, attrLabel, g) {
		const $tr = $('<tr>')
			.addClass('wbe-row-group')
			.attr({ 'data-parent-id': parentId, 'data-group-value': g.value });

		$tr.append('<td class="wbe-col-check"></td>');

		// Group image: show the shared image if every member already matches.
		const ids     = g.rows.map(r => String(r.image_id || ''));
		const allSame = ids.length > 0 && ids.every(x => x === ids[0] && x !== '');
		const thumb   = allSame ? (g.rows[0].image_thumb || '') : '';
		const $imgTd  = buildImageCell(parentId, '', thumb, 'image', 'image');
		$imgTd.find('.wbe-img-wrap')
			.addClass('is-group')
			.attr({ 'data-parent-id': parentId, 'data-group-value': g.value })
			.attr('title', 'Set the image for all ' + g.rows.length + ' variations in this group');
		$tr.append($imgTd);

		// Lifestyle column placeholder (keeps column alignment / respects its toggle).
		$tr.append('<td class="wbe-col-image wbe-col-lifestyle" data-col="acvs_lifestyle"></td>');

		// Optional "set Fabric Group for the whole group" control. Built from the
		// members' fabric_group_options (same for every variation of a product);
		// only shown when the product actually defines groups beyond Default.
		let fgControl = '';
		const fgOptions = (g.rows[0] && g.rows[0].fabric_group_options) || [];
		if (Array.isArray(fgOptions) && fgOptions.length > 1) {
			// Preselect the group's current value when every member already shares one.
			const fgVals   = g.rows.map(r => String(r.fabric_group || ''));
			const fgCommon = fgVals.every(v => v === fgVals[0]) ? fgVals[0] : '';
			fgControl = '<span class="wbe-group-fg"><label>Fabric Group for all:</label> <select class="wbe-group-fg-select">';
			fgOptions.forEach(o => {
				const sel = String(o.value) === fgCommon ? ' selected' : '';
				fgControl += '<option value="' + esc(o.value) + '"' + sel + '>' + esc(o.label) + '</option>';
			});
			fgControl += '</select></span>';
		}

		// Label spans the remaining 14 columns.
		const caret = '<span class="wbe-group-caret dashicons dashicons-arrow-down-alt2"></span>';
		$tr.append(
			'<td class="wbe-col-grouphdr" colspan="18">' + caret +
			'<strong>' + esc(attrLabel) + ': ' + esc(g.label) + '</strong> ' +
			'<span class="wbe-group-count">(' + g.rows.length + ' variation' + (g.rows.length !== 1 ? 's' : '') + ')</span>' +
			fgControl + '</td>'
		);

		return $tr;
	}

	// Populate the "Group variations by" dropdown from the loaded variation
	// attributes, preserving the current choice when it's still available.
	function populateGroupBy(rows) {
		const $gb = $('#wbe-groupby');
		if (!$gb.length) return;
		const seen = {};
		const opts = [];
		rows.forEach(r => {
			if (r.type !== 'variation') return;
			(r.attributes || []).forEach(a => {
				if (!seen[a.name]) { seen[a.name] = true; opts.push({ name: a.name, label: a.label }); }
			});
		});
		const cur = $gb.val();
		$gb.find('option:not(:first-child)').remove();
		opts.forEach(o => $gb.append($('<option>').val(o.name).text(o.label)));
		$gb.val(cur && seen[cur] ? cur : '');
	}

	function renderPagination(page, totalPages, total) {
		if (totalPages <= 1) {
			$pagination.hide();
			return;
		}
		$pagination.show();
		$pageInfo.text(`Page ${page} of ${totalPages} — ${total} products`);
		$prevBtn.prop('disabled', page <= 1);
		$nextBtn.prop('disabled', page >= totalPages);
	}

	// -------------------------------------------------------------------------
	// Cell change tracking – contenteditable
	// -------------------------------------------------------------------------
	$tbody.on('blur', '.wbe-cell', function () {
		const $cell = $(this);
		const id    = $cell.data('id');
		const field = $cell.data('field');
		const orig  = String($cell.data('original') ?? '');
		let   value = $cell.text().trim();

		// Normalise price values
		if ($cell.data('type') === 'number' && value !== '') {
			const n = parseFloat(value);
			value = isNaN(n) ? value : (field.includes('price') ? n.toFixed(2) : String(n));
		}

		const key = changeKey(id, field);

		if (value !== orig) {
			state.changes[key] = { id, field, value, originalValue: orig };
			$cell.addClass('is-dirty');
		} else {
			delete state.changes[key];
			$cell.removeClass('is-dirty');
		}

		updateToolbar();
	});

	// Prevent newlines in contenteditable cells
	$tbody.on('keydown', '.wbe-cell', function (e) {
		if (e.key === 'Enter') {
			e.preventDefault();
			this.blur();
			// Move focus to next cell in same column
			const $row  = $(this).closest('tr');
			const $next = $row.next().find(`.wbe-cell[data-field="${$(this).data('field')}"]`);
			if ($next.length) $next.focus();
		}
		if (e.key === 'Escape') {
			// Restore original value
			$(this).text($(this).data('original'));
			this.blur();
		}
		if (e.key === 'Tab') {
			e.preventDefault();
			const $cells = $(this).closest('tr').find('.wbe-cell, .wbe-cell-select');
			const idx    = $cells.index(this);
			const $next  = $cells.eq(idx + (e.shiftKey ? -1 : 1));
			if ($next.length) $next.focus();
		}
	});

	// Validate numeric-only cells
	$tbody.on('input', '.wbe-cell', function () {
		const type = $(this).data('type');
		if (type !== 'number') return;
		const val = $(this).text();
		if (val !== '' && isNaN(parseFloat(val))) {
			$(this).css('color', '#d9534f');
		} else {
			$(this).css('color', '');
		}
	});

	// -------------------------------------------------------------------------
	// Cell change tracking – select dropdowns
	// -------------------------------------------------------------------------
	$tbody.on('change', '.wbe-cell-select', function () {
		const $sel  = $(this);
		const id    = $sel.data('id');
		const field = $sel.data('field');
		const orig  = String($sel.data('original') ?? '');
		const value = $sel.val();
		const key   = changeKey(id, field);

		if (value !== orig) {
			state.changes[key] = { id, field, value, originalValue: orig };
			$sel.addClass('is-dirty');
		} else {
			delete state.changes[key];
			$sel.removeClass('is-dirty');
		}

		updateToolbar();
	});

	// -------------------------------------------------------------------------
	// Cell change tracking – "On Category Page" checkbox
	// -------------------------------------------------------------------------
	$tbody.on('change', '.wbe-cell-check', function () {
		const $cb   = $(this);
		const id    = $cb.data('id');
		const field = $cb.data('field');
		const orig  = String($cb.data('original') ?? 'no');
		const value = $cb.is(':checked') ? 'yes' : 'no';
		const key   = changeKey(id, field);

		if (value !== orig) {
			state.changes[key] = { id, field, value, originalValue: orig };
			$cb.closest('td').addClass('is-dirty');
		} else {
			delete state.changes[key];
			$cb.closest('td').removeClass('is-dirty');
		}

		updateToolbar();
	});

	// -------------------------------------------------------------------------
	// Save
	// -------------------------------------------------------------------------
	$saveBtn.on('click', function () {
		const changeList = Object.values(state.changes);
		if (!changeList.length) {
			showStatus(octwbe.i18n.noChanges, 'info');
			return;
		}

		$saveBtn.prop('disabled', true).text(octwbe.i18n.saving);
		showStatus(octwbe.i18n.saving, 'info');

		$.post(octwbe.ajaxUrl, {
			action:  'octwbe_save_changes',
			nonce:   octwbe.nonce,
			changes: JSON.stringify(changeList),
		}, function (response) {
			$saveBtn.text('Save All Changes');

			if (!response.success) {
				const msg = response.data?.errors?.join(' | ') || octwbe.i18n.saveError;
				showStatus(msg, 'error');
				updateToolbar();
				return;
			}

			// Mark saved cells
			const savedIds = response.data.saved || [];
			savedIds.forEach(id => {
				$(`#wbe-tbody tr[data-id="${id}"]`).addClass('wbe-row-saved');
				setTimeout(() => $(`#wbe-tbody tr[data-id="${id}"]`).removeClass('wbe-row-saved'), 600);
			});

			// Clear dirty state for saved rows
			changeList.forEach(c => {
				if (savedIds.includes(c.id)) {
					const key = changeKey(c.id, c.field);
					delete state.changes[key];

					// Update original values so further edits compare from new baseline
					$tbody.find(`.wbe-cell[data-id="${c.id}"][data-field="${c.field}"]`)
						.attr('data-original', c.value)
						.removeClass('is-dirty');
					$tbody.find(`.wbe-cell-select[data-id="${c.id}"][data-field="${c.field}"]`)
						.attr('data-original', c.value)
						.removeClass('is-dirty');
					if (c.field === 'image' || c.field === 'acvs_lifestyle') {
						$tbody.find(`.wbe-img-wrap[data-id="${c.id}"][data-field="${c.field}"]`)
							.attr('data-original', c.value)
							.removeClass('is-dirty');
					}
					const $savedCb = $tbody.find(`.wbe-cell-check[data-id="${c.id}"][data-field="${c.field}"]`);
					if ($savedCb.length) {
						$savedCb.attr('data-original', c.value);
						$savedCb.closest('td').removeClass('is-dirty');
					}
				}
			});

			showStatus(octwbe.i18n.saved, 'success');
			updateToolbar();
		}).fail(function () {
			$saveBtn.prop('disabled', false).text('Save All Changes');
			showStatus(octwbe.i18n.saveError, 'error');
			updateToolbar();
		});
	});

	// -------------------------------------------------------------------------
	// Discard
	// -------------------------------------------------------------------------
	$discardBtn.on('click', function () {
		if (!confirm(octwbe.i18n.confirmDiscard)) return;

		// Restore all original values
		Object.values(state.changes).forEach(c => {
			$tbody.find(`.wbe-cell[data-id="${c.id}"][data-field="${c.field}"]`)
				.text(c.originalValue)
				.removeClass('is-dirty');
			const $sel = $tbody.find(`.wbe-cell-select[data-id="${c.id}"][data-field="${c.field}"]`);
			if ($sel.length) {
				$sel.val(c.originalValue).removeClass('is-dirty');
			}
			// "On Category Page" checkbox
			const $cb = $tbody.find(`.wbe-cell-check[data-id="${c.id}"][data-field="${c.field}"]`);
			if ($cb.length) {
				$cb.prop('checked', c.originalValue === 'yes');
				$cb.closest('td').removeClass('is-dirty');
			}
			// Image cells (main + lifestyle)
			if (c.field === 'image' || c.field === 'acvs_lifestyle') {
				const $wrap = $tbody.find(`.wbe-img-wrap[data-id="${c.id}"][data-field="${c.field}"]`);
				$wrap.removeClass('is-dirty');
				$wrap.find('.wbe-img-thumb').remove();
				if (c.originalThumb) {
					$wrap.prepend($('<img>').addClass('wbe-img-thumb').attr('src', c.originalThumb).attr('alt', ''));
					$wrap.find('.wbe-img-placeholder').remove();
				} else if (!$wrap.find('.wbe-img-placeholder').length) {
					$wrap.prepend($('<span>').addClass('wbe-img-placeholder').html('<span class="dashicons dashicons-camera-alt"></span>'));
				}
			}
		});

		state.changes = {};
		updateToolbar();
		hideStatus();
	});

	// -------------------------------------------------------------------------
	// Pagination
	// -------------------------------------------------------------------------
	$prevBtn.on('click', function () {
		if (state.page > 1) loadProducts(state.page - 1);
	});

	$nextBtn.on('click', function () {
		if (state.page < state.totalPages) loadProducts(state.page + 1);
	});

	// -------------------------------------------------------------------------
	// Load / search triggers
	// -------------------------------------------------------------------------
	$('#wbe-load').on('click', function () {
		state.changes = {};
		updateToolbar();
		loadProducts(1);
	});

	// Search on Enter
	$('#wbe-search').on('keydown', function (e) {
		if (e.key === 'Enter') {
			state.changes = {};
			updateToolbar();
			loadProducts(1);
		}
	});

	// Category change auto-loads
	$('#wbe-category').on('change', function () {
		state.changes = {};
		updateToolbar();
		loadProducts(1);
	});

	// -------------------------------------------------------------------------
	// Bulk edit: set one field's value across every loaded row at once. Reuses
	// the existing per-cell change tracking by triggering the same events, so the
	// changes flow through the normal Save / Discard machinery.
	// -------------------------------------------------------------------------
	var BULK_VALUES = {
		stock_status:  { type: 'select', options: [ [ 'instock', 'In stock' ], [ 'outofstock', 'Out of stock' ], [ 'onbackorder', 'On backorder' ] ] },
		status:        { type: 'select', options: [ [ 'publish', 'Published' ], [ 'draft', 'Draft' ], [ 'private', 'Private' ], [ 'pending', 'Pending review' ] ] },
		acvs_show:     { type: 'select', options: [ [ 'yes', 'Yes' ], [ 'no', 'No' ] ] },
		stock_qty:     { type: 'number' },
		regular_price: { type: 'number' },
		sale_price:    { type: 'number' },
		price_eur:        { type: 'number' },
		sale_price_eur:   { type: 'number' },
		price_usd:        { type: 'number' },
		sale_price_usd:   { type: 'number' },
		acvs_fabric_group: { type: 'text', placeholder: 'Fabric group key (e.g. outdoor)' },
		acvs_catalog_order: { type: 'number' },
		acvs_card_title:    { type: 'text', placeholder: 'Card title' },
		manage_stock:  { type: 'select', options: [ [ 'no', 'No (inherit)' ], [ 'yes', 'Yes' ] ] },
		backorders:    { type: 'select', options: [ [ 'no', 'Do not allow' ], [ 'notify', 'Allow, but notify' ], [ 'yes', 'Allow' ] ] },
	};

	function renderBulkValue() {
		var def   = BULK_VALUES[ $( '#wbe-bulk-field' ).val() ] || { type: 'number' };
		var $wrap = $( '#wbe-bulk-value' );
		if ( def.type === 'select' ) {
			var html = '<select class="wbe-input" id="wbe-bulk-value-input">';
			def.options.forEach( function ( o ) { html += '<option value="' + o[ 0 ] + '">' + o[ 1 ] + '</option>'; } );
			$wrap.html( html + '</select>' );
		} else if ( def.type === 'text' ) {
			$wrap.html( '<input type="text" class="wbe-input" id="wbe-bulk-value-input" placeholder="' + ( def.placeholder || 'Value' ) + '" />' );
		} else {
			$wrap.html( '<input type="number" step="0.01" class="wbe-input" id="wbe-bulk-value-input" placeholder="Value" />' );
		}
	}

	$( '#wbe-bulk-field' ).on( 'change', renderBulkValue );
	renderBulkValue();

	// Row selection (ported from the select-all branch): a checkbox column with a
	// header select-all and parent-row checkboxes that toggle their children.
	var $selectAll = $( '#wbe-select-all' );

	function updateSelectionUI() {
		var $all = $tbody.find( '.wbe-row-check' );
		var n    = $tbody.find( '.wbe-row-check:checked' ).length;
		$selectAll.prop( 'indeterminate', n > 0 && n < $all.length );
		$selectAll.prop( 'checked', n > 0 && n === $all.length );
		if ( n > 0 ) {
			$( '#wbe-bulk-selcount' ).text( n + ' selected' ).show();
			$( '#wbe-bulk-clear' ).show();
			$( '#wbe-bulk-apply' ).text( 'Apply to ' + n + ' selected' );
		} else {
			$( '#wbe-bulk-selcount' ).hide();
			$( '#wbe-bulk-clear' ).hide();
			$( '#wbe-bulk-apply' ).text( 'Apply to all rows' );
		}
	}

	$selectAll.on( 'change', function () {
		$tbody.find( '.wbe-row-check, .wbe-parent-check' ).prop( 'checked', this.checked );
		updateSelectionUI();
	} );

	$tbody.on( 'change', '.wbe-parent-check', function () {
		var pid = $( this ).data( 'parent-id' );
		$tbody.find( '.wbe-row-check[data-parent-id="' + pid + '"]' ).prop( 'checked', this.checked );
		updateSelectionUI();
	} );

	$tbody.on( 'change', '.wbe-row-check', function () {
		var pid = $( this ).data( 'parent-id' );
		if ( pid ) {
			var $sib = $tbody.find( '.wbe-row-check[data-parent-id="' + pid + '"]' );
			$tbody.find( '.wbe-parent-check[data-parent-id="' + pid + '"]' )
				.prop( 'checked', $sib.length === $sib.filter( ':checked' ).length );
		}
		updateSelectionUI();
	} );

	$( '#wbe-bulk-clear' ).on( 'click', function () {
		$tbody.find( '.wbe-row-check, .wbe-parent-check' ).prop( 'checked', false );
		$selectAll.prop( 'checked', false ).prop( 'indeterminate', false );
		updateSelectionUI();
	} );

	$( '#wbe-bulk-apply' ).on( 'click', function () {
		var field = $( '#wbe-bulk-field' ).val();
		var value = $( '#wbe-bulk-value-input' ).val();
		if ( value === null || typeof value === 'undefined' ) { return; }

		// Target the selected rows if any are ticked; otherwise every loaded row.
		var $checked = $tbody.find( '.wbe-row-check:checked' );
		var $rows = $checked.length
			? $checked.closest( 'tr' )
			: $( '#wbe-tbody tr' ).not( '.wbe-row-parent' ).not( '.wbe-placeholder' );
		if ( ! $rows.length ) { showStatus( 'No rows to apply to. Load products first.', 'error' ); return; }

		var applied = 0;
		$rows.each( function () {
			var $row = $( this );

			var $sel = $row.find( '.wbe-cell-select[data-field="' + field + '"]' );
			if ( $sel.length ) { $sel.val( value ).trigger( 'change' ); applied++; return; }

			var $cb = $row.find( '.wbe-cell-check[data-field="' + field + '"]' );
			if ( $cb.length ) { $cb.prop( 'checked', value === 'yes' ).trigger( 'change' ); applied++; return; }

			var $cell = $row.find( '.wbe-cell[data-field="' + field + '"]' );
			if ( $cell.length ) {
				var v = value;
				if ( $cell.data( 'type' ) === 'number' && v !== '' ) {
					var n = parseFloat( v );
					v = isNaN( n ) ? v : ( field.indexOf( 'price' ) !== -1 ? n.toFixed( 2 ) : String( n ) );
				}
				$cell.text( v ).trigger( 'blur' );
				applied++;
			}
		} );

		showStatus( 'Applied to ' + applied + ' row' + ( applied !== 1 ? 's' : '' ) + '. Review, then Save All Changes.', 'info' );
	} );

	// -------------------------------------------------------------------------
	// Export / Import CSV
	// -------------------------------------------------------------------------
	$( '#wbe-export' ).on( 'click', function () {
		var params = $.param( {
			action:   'octwbe_export',
			_wpnonce: octwbe.exportNonce,
			search:   $( '#wbe-search' ).val().trim(),
			category: $( '#wbe-category' ).val(),
		} );
		window.location = octwbe.exportUrl + '?' + params;
	} );

	$( '#wbe-import-file' ).on( 'change', function () {
		var file = this.files && this.files[ 0 ];
		var $input = $( this );
		if ( ! file ) { return; }

		var formData = new FormData();
		formData.append( 'action', 'octwbe_import' );
		formData.append( 'nonce', octwbe.importNonce );
		formData.append( 'file', file, file.name );

		showStatus( 'Importing ' + file.name + '…', 'info' );

		$.ajax( {
			url:         octwbe.ajaxUrl,
			type:        'POST',
			data:        formData,
			processData: false,
			contentType: false,
		} ).done( function ( res ) {
			if ( ! res.success ) {
				showStatus( res.data || 'Import failed.', 'error' );
				return;
			}
			var d = res.data;
			var msg = 'Imported: ' + d.updated + ' row' + ( d.updated !== 1 ? 's' : '' ) + ' updated.';
			if ( d.errors && d.errors.length ) {
				msg += ' ' + d.errors.length + ' issue' + ( d.errors.length !== 1 ? 's' : '' ) + ': ' + d.errors.slice( 0, 5 ).join( ' | ' );
			}
			showStatus( msg, d.errors && d.errors.length ? 'error' : 'success' );
			state.changes = {};
			updateToolbar();
			loadProducts( state.page ); // refresh to show imported values
		} ).fail( function () {
			showStatus( 'Import request failed.', 'error' );
		} ).always( function () {
			$input.val( '' );
		} );
	} );

	// Apply saved column visibility (Showcase columns hidden by default), then load.
	applyColPrefs();

	// Auto-load on page open
	loadProducts(1);

})(jQuery);
