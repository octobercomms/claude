<?php defined( 'ABSPATH' ) || exit; ?>

<div class="wrap wbe-wrap">

	<h1 class="wbe-header">
		<?php esc_html_e( 'WooCommerce Bulk Editor', 'oct-bulk-editor' ); ?>
		<span class="wbe-badge"><?php esc_html_e( 'Spreadsheet Mode', 'oct-bulk-editor' ); ?></span>
	</h1>

	<!-- Toolbar -->
	<div class="wbe-toolbar">
		<div class="wbe-filters">
			<input
				type="search"
				id="wbe-search"
				class="wbe-input"
				placeholder="<?php esc_attr_e( 'Search products…', 'oct-bulk-editor' ); ?>"
			/>

			<select id="wbe-category" class="wbe-input">
				<option value="0"><?php esc_html_e( 'All categories', 'oct-bulk-editor' ); ?></option>
				<?php
				$categories = get_terms( [
					'taxonomy'   => 'product_cat',
					'hide_empty' => true,
					'orderby'    => 'name',
				] );
				foreach ( $categories as $cat ) {
					printf(
						'<option value="%d">%s (%d)</option>',
						esc_attr( $cat->term_id ),
						esc_html( $cat->name ),
						esc_html( $cat->count )
					);
				}
				?>
			</select>

			<button id="wbe-load" class="button button-secondary">
				<?php esc_html_e( 'Load Products', 'oct-bulk-editor' ); ?>
			</button>
		</div>

		<div class="wbe-actions">
			<span class="wbe-io" title="<?php esc_attr_e( 'Export the current filter to CSV, edit in Excel, then re-import (rows matched by id).', 'oct-bulk-editor' ); ?>">
				<button id="wbe-export" class="button"><?php esc_html_e( 'Export CSV', 'oct-bulk-editor' ); ?></button>
				<label class="button wbe-import-label">
					<?php esc_html_e( 'Import CSV', 'oct-bulk-editor' ); ?>
					<input type="file" id="wbe-import-file" accept=".csv,text/csv" />
				</label>
			</span>
			<span id="wbe-change-count" class="wbe-change-badge" style="display:none"></span>
			<button id="wbe-discard" class="button button-secondary" style="display:none">
				<?php esc_html_e( 'Discard Changes', 'oct-bulk-editor' ); ?>
			</button>
			<button id="wbe-save" class="button button-primary" title="<?php esc_attr_e( 'Save every unsaved change across all loaded rows', 'oct-bulk-editor' ); ?>" disabled>
				<?php esc_html_e( 'Save All Changes', 'oct-bulk-editor' ); ?>
			</button>
		</div>
	</div>

	<!-- Status bar -->
	<div id="wbe-status" class="wbe-status" style="display:none"></div>

	<!-- Column visibility, grouped by purpose so the (many) columns are easy to find -->
	<div class="wbe-col-toggle">
		<span class="wbe-col-toggle-head">
			<strong><?php esc_html_e( 'Columns', 'oct-bulk-editor' ); ?></strong>
			<a href="#" class="wbe-col-showall"><?php esc_html_e( 'Show all', 'oct-bulk-editor' ); ?></a>
			<span class="wbe-col-sep">·</span>
			<a href="#" class="wbe-col-hideall"><?php esc_html_e( 'Hide all', 'oct-bulk-editor' ); ?></a>
		</span>
		<?php
		$column_groups = [
			__( 'Core', 'oct-bulk-editor' ) => [
				'image'  => __( 'Image', 'oct-bulk-editor' ),
				'sku'    => __( 'SKU', 'oct-bulk-editor' ),
				'status' => __( 'Publish Status', 'oct-bulk-editor' ),
			],
			__( 'Pricing', 'oct-bulk-editor' ) => [
				'regular_price'  => __( 'Regular Price', 'oct-bulk-editor' ),
				'sale_price'     => __( 'Sale Price', 'oct-bulk-editor' ),
				'price_eur'      => __( 'Regular € (EUR)', 'oct-bulk-editor' ),
				'sale_price_eur' => __( 'Sale € (EUR)', 'oct-bulk-editor' ),
				'price_usd'      => __( 'Regular $ (USD)', 'oct-bulk-editor' ),
				'sale_price_usd' => __( 'Sale $ (USD)', 'oct-bulk-editor' ),
			],
			__( 'Stock', 'oct-bulk-editor' ) => [
				'stock_qty'    => __( 'Stock Qty', 'oct-bulk-editor' ),
				'stock_status' => __( 'Stock Status', 'oct-bulk-editor' ),
				'manage_stock' => __( 'Manage Stock', 'oct-bulk-editor' ),
				'backorders'   => __( 'Backorders', 'oct-bulk-editor' ),
			],
			__( 'Catalogue', 'oct-bulk-editor' ) => [
				'acvs_lifestyle'     => __( 'Lifestyle Image', 'oct-bulk-editor' ),
				'acvs_catalog'       => __( 'On Category Page', 'oct-bulk-editor' ),
				'acvs_card_title'    => __( 'Card Title', 'oct-bulk-editor' ),
				'acvs_catalog_order' => __( 'Catalog Order', 'oct-bulk-editor' ),
			],
			__( 'Fabric', 'oct-bulk-editor' ) => [
				'fabric_group' => __( 'Fabric Group', 'oct-bulk-editor' ),
			],
		];
		foreach ( $column_groups as $group_label => $cols ) :
		?>
		<div class="wbe-col-group">
			<span class="wbe-col-group-title" title="<?php esc_attr_e( 'Click to show/hide this whole group', 'oct-bulk-editor' ); ?>"><?php echo esc_html( $group_label ); ?></span>
			<div class="wbe-col-group-items">
				<?php foreach ( $cols as $key => $label ) : ?>
				<label class="wbe-col-label">
					<input type="checkbox" class="wbe-col-toggle-cb" data-col="<?php echo esc_attr( $key ); ?>" checked />
					<?php echo esc_html( $label ); ?>
				</label>
				<?php endforeach; ?>
			</div>
		</div>
		<?php endforeach; ?>
	</div>

	<!-- Group variations by a shared attribute (e.g. Fabric) for one-image-fits-group editing -->
	<div class="wbe-groupby-bar">
		<strong><?php esc_html_e( 'Group variations by:', 'oct-bulk-editor' ); ?></strong>
		<select id="wbe-groupby" class="wbe-input">
			<option value=""><?php esc_html_e( '— No grouping —', 'oct-bulk-editor' ); ?></option>
		</select>
		<span class="wbe-bulkedit-hint"><?php esc_html_e( 'Collapse variations under a shared attribute and set one image for the whole group (e.g. all cushion fillings of a fabric).', 'oct-bulk-editor' ); ?></span>
	</div>

	<!-- Bulk edit: set one field across every loaded row at once -->
	<div class="wbe-bulkedit">
		<strong><?php esc_html_e( 'Bulk edit:', 'oct-bulk-editor' ); ?></strong>
		<select id="wbe-bulk-field" class="wbe-input">
			<option value="stock_status"><?php esc_html_e( 'Stock Status', 'oct-bulk-editor' ); ?></option>
			<option value="status"><?php esc_html_e( 'Publish Status', 'oct-bulk-editor' ); ?></option>
			<option value="stock_qty"><?php esc_html_e( 'Stock Qty', 'oct-bulk-editor' ); ?></option>
			<option value="regular_price"><?php esc_html_e( 'Regular Price', 'oct-bulk-editor' ); ?></option>
			<option value="sale_price"><?php esc_html_e( 'Sale Price', 'oct-bulk-editor' ); ?></option>
			<option value="acvs_show"><?php esc_html_e( 'On Category Page', 'oct-bulk-editor' ); ?></option>
			<option value="acvs_fabric_group"><?php esc_html_e( 'Fabric Group', 'oct-bulk-editor' ); ?></option>
			<option value="price_eur"><?php esc_html_e( 'Regular € (EUR)', 'oct-bulk-editor' ); ?></option>
			<option value="sale_price_eur"><?php esc_html_e( 'Sale € (EUR)', 'oct-bulk-editor' ); ?></option>
			<option value="price_usd"><?php esc_html_e( 'Regular $ (USD)', 'oct-bulk-editor' ); ?></option>
			<option value="sale_price_usd"><?php esc_html_e( 'Sale $ (USD)', 'oct-bulk-editor' ); ?></option>
			<option value="acvs_catalog_order"><?php esc_html_e( 'Catalog Order', 'oct-bulk-editor' ); ?></option>
			<option value="acvs_card_title"><?php esc_html_e( 'Card Title', 'oct-bulk-editor' ); ?></option>
			<option value="manage_stock"><?php esc_html_e( 'Manage Stock', 'oct-bulk-editor' ); ?></option>
			<option value="backorders"><?php esc_html_e( 'Backorders', 'oct-bulk-editor' ); ?></option>
		</select>
		<span id="wbe-bulk-value"></span>
		<button id="wbe-bulk-apply" class="button button-secondary" title="<?php esc_attr_e( 'Set the chosen field to the chosen value on every loaded row (or just the ticked rows)', 'oct-bulk-editor' ); ?>"><?php esc_html_e( 'Apply to all rows', 'oct-bulk-editor' ); ?></button>
		<span id="wbe-bulk-selcount" class="wbe-bulk-selcount" style="display:none"></span>
		<button id="wbe-bulk-clear" class="button button-link" style="display:none"><?php esc_html_e( 'Clear selection', 'oct-bulk-editor' ); ?></button>
		<span class="wbe-bulkedit-hint"><?php esc_html_e( 'Tick rows to target a selection, or apply to every loaded row.', 'oct-bulk-editor' ); ?></span>
	</div>

	<!-- Spreadsheet table -->
	<div class="wbe-table-wrapper">
		<table id="wbe-table" class="wbe-table widefat">
			<thead>
				<?php
				// Sortable headers: data-sort = the row field to sort variations by
				// (click to sort within each product, click again to reverse). title
				// = tooltip explaining the column. arrow span shows the sort state.
				$sort_arrow = '<span class="wbe-sort-arrow" aria-hidden="true"></span>';
				?>
				<tr>
					<th class="wbe-col-check"><input type="checkbox" id="wbe-select-all" title="<?php esc_attr_e( 'Select all', 'oct-bulk-editor' ); ?>" /></th>
					<th class="wbe-col-image" data-col="image" title="<?php esc_attr_e( 'Main product/variation image — click a cell to choose or drag-and-drop a file', 'oct-bulk-editor' ); ?>"><?php esc_html_e( 'Image', 'oct-bulk-editor' ); ?></th>
					<th class="wbe-col-image wbe-col-lifestyle" data-col="acvs_lifestyle" title="<?php esc_attr_e( 'Lifestyle (hover) image shown on shop/category cards', 'oct-bulk-editor' ); ?>"><?php esc_html_e( 'Lifestyle', 'oct-bulk-editor' ); ?></th>
					<th class="wbe-col-name wbe-sortable" data-sort="name" title="<?php esc_attr_e( 'Product / variation name. Click to sort variations A–Z within each product.', 'oct-bulk-editor' ); ?>"><?php esc_html_e( 'Product / Variation', 'oct-bulk-editor' ); ?><?php echo $sort_arrow; // phpcs:ignore ?></th>
					<th class="wbe-col-catalog wbe-sortable" data-col="acvs_catalog" data-sort="acvs_show" title="<?php esc_attr_e( 'Show this variation as its own card on the category page. Click to sort the shown-on-category ones together.', 'oct-bulk-editor' ); ?>"><?php esc_html_e( 'On Category Page', 'oct-bulk-editor' ); ?><?php echo $sort_arrow; // phpcs:ignore ?></th>
					<th class="wbe-col-sku wbe-sortable" data-col="sku" data-sort="sku" title="<?php esc_attr_e( 'Stock keeping unit. Click to sort.', 'oct-bulk-editor' ); ?>"><?php esc_html_e( 'SKU', 'oct-bulk-editor' ); ?><?php echo $sort_arrow; // phpcs:ignore ?></th>
					<th class="wbe-col-price wbe-sortable" data-col="regular_price" data-sort="regular_price" title="<?php esc_attr_e( 'Regular price (store currency). Click to sort.', 'oct-bulk-editor' ); ?>"><?php esc_html_e( 'Regular Price', 'oct-bulk-editor' ); ?><?php echo $sort_arrow; // phpcs:ignore ?></th>
					<th class="wbe-col-price wbe-sortable" data-col="sale_price" data-sort="sale_price" title="<?php esc_attr_e( 'Sale price (store currency). Click to sort.', 'oct-bulk-editor' ); ?>"><?php esc_html_e( 'Sale Price', 'oct-bulk-editor' ); ?><?php echo $sort_arrow; // phpcs:ignore ?></th>
					<th class="wbe-col-stock wbe-sortable" data-col="stock_qty" data-sort="stock_qty" title="<?php esc_attr_e( 'Stock quantity (blank = not tracking stock). Click to sort.', 'oct-bulk-editor' ); ?>"><?php esc_html_e( 'Stock Qty', 'oct-bulk-editor' ); ?><?php echo $sort_arrow; // phpcs:ignore ?></th>
					<th class="wbe-col-status wbe-sortable" data-col="stock_status" data-sort="stock_status" title="<?php esc_attr_e( 'In stock / out of stock / on backorder. Click to sort.', 'oct-bulk-editor' ); ?>"><?php esc_html_e( 'Stock Status', 'oct-bulk-editor' ); ?><?php echo $sort_arrow; // phpcs:ignore ?></th>
					<th class="wbe-col-status wbe-sortable" data-col="status" data-sort="status" title="<?php esc_attr_e( 'Published / draft / private. Click to sort.', 'oct-bulk-editor' ); ?>"><?php esc_html_e( 'Publish Status', 'oct-bulk-editor' ); ?><?php echo $sort_arrow; // phpcs:ignore ?></th>
					<th class="wbe-col-fabricgroup wbe-sortable" data-col="fabric_group" data-sort="fabric_group" title="<?php esc_attr_e( 'Fabric Drawer group this variation belongs to. Click to sort.', 'oct-bulk-editor' ); ?>"><?php esc_html_e( 'Fabric Group', 'oct-bulk-editor' ); ?><?php echo $sort_arrow; // phpcs:ignore ?></th>
					<th class="wbe-col-price wbe-sortable" data-col="price_eur" data-sort="price_eur" title="<?php esc_attr_e( 'Aelia regular price in EUR. Click to sort.', 'oct-bulk-editor' ); ?>"><?php esc_html_e( 'Regular € (EUR)', 'oct-bulk-editor' ); ?><?php echo $sort_arrow; // phpcs:ignore ?></th>
					<th class="wbe-col-price wbe-sortable" data-col="sale_price_eur" data-sort="sale_price_eur" title="<?php esc_attr_e( 'Aelia sale price in EUR. Click to sort.', 'oct-bulk-editor' ); ?>"><?php esc_html_e( 'Sale € (EUR)', 'oct-bulk-editor' ); ?><?php echo $sort_arrow; // phpcs:ignore ?></th>
					<th class="wbe-col-price wbe-sortable" data-col="price_usd" data-sort="price_usd" title="<?php esc_attr_e( 'Aelia regular price in USD. Click to sort.', 'oct-bulk-editor' ); ?>"><?php esc_html_e( 'Regular $ (USD)', 'oct-bulk-editor' ); ?><?php echo $sort_arrow; // phpcs:ignore ?></th>
					<th class="wbe-col-price wbe-sortable" data-col="sale_price_usd" data-sort="sale_price_usd" title="<?php esc_attr_e( 'Aelia sale price in USD. Click to sort.', 'oct-bulk-editor' ); ?>"><?php esc_html_e( 'Sale $ (USD)', 'oct-bulk-editor' ); ?><?php echo $sort_arrow; // phpcs:ignore ?></th>
					<th class="wbe-col-cardtitle wbe-sortable" data-col="acvs_card_title" data-sort="acvs_card_title" title="<?php esc_attr_e( 'Custom title for the catalogue card (blank = default). Click to sort.', 'oct-bulk-editor' ); ?>"><?php esc_html_e( 'Card Title', 'oct-bulk-editor' ); ?><?php echo $sort_arrow; // phpcs:ignore ?></th>
					<th class="wbe-col-order wbe-sortable" data-col="acvs_catalog_order" data-sort="acvs_catalog_order" title="<?php esc_attr_e( 'Position on the category page (lower shows first). Click to sort.', 'oct-bulk-editor' ); ?>"><?php esc_html_e( 'Catalog Order', 'oct-bulk-editor' ); ?><?php echo $sort_arrow; // phpcs:ignore ?></th>
					<th class="wbe-col-status wbe-sortable" data-col="manage_stock" data-sort="manage_stock" title="<?php esc_attr_e( 'Whether this row manages its own stock. Click to sort.', 'oct-bulk-editor' ); ?>"><?php esc_html_e( 'Manage Stock', 'oct-bulk-editor' ); ?><?php echo $sort_arrow; // phpcs:ignore ?></th>
					<th class="wbe-col-status wbe-sortable" data-col="backorders" data-sort="backorders" title="<?php esc_attr_e( 'Backorders: do not allow / allow & notify / allow. Click to sort.', 'oct-bulk-editor' ); ?>"><?php esc_html_e( 'Backorders', 'oct-bulk-editor' ); ?><?php echo $sort_arrow; // phpcs:ignore ?></th>
					<th class="wbe-col-actions"><?php esc_html_e( 'Actions', 'oct-bulk-editor' ); ?></th>
				</tr>
			</thead>
			<tbody id="wbe-tbody">
				<tr class="wbe-placeholder">
					<td colspan="21">
						<?php esc_html_e( 'Use the filters above and click "Load Products" to begin editing.', 'oct-bulk-editor' ); ?>
					</td>
				</tr>
			</tbody>
		</table>
	</div>

	<!-- Pagination -->
	<div id="wbe-pagination" class="wbe-pagination" style="display:none">
		<button id="wbe-prev" class="button" disabled><?php esc_html_e( '&larr; Previous', 'oct-bulk-editor' ); ?></button>
		<span id="wbe-page-info"></span>
		<button id="wbe-next" class="button"><?php esc_html_e( 'Next &rarr;', 'oct-bulk-editor' ); ?></button>
	</div>

	<!-- Floating save bar — follows the page so the Save button is never missed -->
	<div id="wbe-float-actions" class="wbe-float-actions" style="display:none">
		<span id="wbe-float-count" class="wbe-change-badge"></span>
		<button id="wbe-float-discard" class="button button-secondary">
			<?php esc_html_e( 'Discard', 'oct-bulk-editor' ); ?>
		</button>
		<button id="wbe-float-save" class="button button-primary">
			<?php esc_html_e( 'Save All Changes', 'oct-bulk-editor' ); ?>
		</button>
	</div>

</div><!-- .wrap -->
