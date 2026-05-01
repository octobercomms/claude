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
			$changeBadge.text(count + ' unsaved change' + (count !== 1 ? 's' : '')).show();
			$discardBtn.show();
			$saveBtn.prop('disabled', false);
		} else {
			$changeBadge.hide();
			$discardBtn.hide();
			$saveBtn.prop('disabled', true);
		}
	}

	function formatPrice(val) {
		if (val === '' || val === null || val === undefined) return '';
		const n = parseFloat(val);
		return isNaN(n) ? val : n.toFixed(2);
	}

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

		// Name cell
		const nameContent = isParent
			? `<strong>${esc(row.name)}</strong> <span style="color:#999;font-size:11px;font-weight:400">(variable product)</span>`
			: esc(row.name);

		$tr.append(`<td class="wbe-col-name">${nameContent}</td>`);

		if (isParent) {
			// Parent rows span the editable columns but are not editable
			$tr.append('<td colspan="6" style="color:#aaa;font-size:12px;padding:0 12px">Edit individual variations below</td>');
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

	function buildSelectCell(id, field, currentValue, options, colClass) {
		const $td = $('<td>').addClass(colClass).attr('data-col', field);
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
	// Column visibility toggle
	// -------------------------------------------------------------------------
	$(document).on('change', '.wbe-col-toggle-cb', function () {
		const col    = $(this).data('col');
		const hidden = !this.checked;
		$('#wbe-table [data-col="' + col + '"]').toggle(!hidden);
	});

	// -------------------------------------------------------------------------
	// Load products via AJAX
	// -------------------------------------------------------------------------
	function loadProducts(page = 1) {
		if (state.loading) return;
		state.loading = true;

		const search   = $('#wbe-search').val().trim();
		const category = $('#wbe-category').val();

		showStatus(octwbe.i18n.loading, 'info');
		$tbody.html('<tr class="wbe-placeholder"><td colspan="8">Loading…</td></tr>');
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
		$tbody.empty();

		if (!rows.length) {
			$tbody.html('<tr class="wbe-placeholder"><td colspan="8">No products found.</td></tr>');
			return;
		}

		rows.forEach(row => $tbody.append(buildRow(row)));

		// Re-apply hidden columns
		$('.wbe-col-toggle-cb').each(function () {
			if (!this.checked) {
				const col = $(this).data('col');
				$('#wbe-table [data-col="' + col + '"]').hide();
			}
		});
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

	// Auto-load on page open
	loadProducts(1);

})(jQuery);
