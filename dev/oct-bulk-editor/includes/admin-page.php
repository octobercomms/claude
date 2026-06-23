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
			<span id="wbe-change-count" class="wbe-change-badge" style="display:none"></span>
			<button id="wbe-discard" class="button button-secondary" style="display:none">
				<?php esc_html_e( 'Discard Changes', 'oct-bulk-editor' ); ?>
			</button>
			<button id="wbe-save" class="button button-primary" disabled>
				<?php esc_html_e( 'Save All Changes', 'oct-bulk-editor' ); ?>
			</button>
		</div>
	</div>

	<!-- Status bar -->
	<div id="wbe-status" class="wbe-status" style="display:none"></div>

	<!-- Column visibility -->
	<div class="wbe-col-toggle">
		<strong><?php esc_html_e( 'Columns:', 'oct-bulk-editor' ); ?></strong>
		<?php
		$columns = [
			'image'         => __( 'Image', 'oct-bulk-editor' ),
			'acvs_lifestyle'=> __( 'Lifestyle Image', 'oct-bulk-editor' ),
			'acvs_catalog'  => __( 'On Category Page', 'oct-bulk-editor' ),
			'sku'          => __( 'SKU', 'oct-bulk-editor' ),
			'regular_price'=> __( 'Regular Price', 'oct-bulk-editor' ),
			'sale_price'   => __( 'Sale Price', 'oct-bulk-editor' ),
			'stock_qty'    => __( 'Stock Qty', 'oct-bulk-editor' ),
			'stock_status' => __( 'Stock Status', 'oct-bulk-editor' ),
			'status'       => __( 'Publish Status', 'oct-bulk-editor' ),
			'fabric_group' => __( 'Fabric Group', 'oct-bulk-editor' ),
			'price_eur'      => __( 'Regular € (EUR)', 'oct-bulk-editor' ),
			'sale_price_eur' => __( 'Sale € (EUR)', 'oct-bulk-editor' ),
			'price_usd'      => __( 'Regular $ (USD)', 'oct-bulk-editor' ),
			'sale_price_usd' => __( 'Sale $ (USD)', 'oct-bulk-editor' ),
		];
		foreach ( $columns as $key => $label ) :
		?>
		<label class="wbe-col-label">
			<input type="checkbox" class="wbe-col-toggle-cb" data-col="<?php echo esc_attr( $key ); ?>" checked />
			<?php echo esc_html( $label ); ?>
		</label>
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
		</select>
		<span id="wbe-bulk-value"></span>
		<button id="wbe-bulk-apply" class="button button-secondary"><?php esc_html_e( 'Apply to all rows', 'oct-bulk-editor' ); ?></button>
		<span id="wbe-bulk-selcount" class="wbe-bulk-selcount" style="display:none"></span>
		<button id="wbe-bulk-clear" class="button button-link" style="display:none"><?php esc_html_e( 'Clear selection', 'oct-bulk-editor' ); ?></button>
		<span class="wbe-bulkedit-hint"><?php esc_html_e( 'Tick rows to target a selection, or apply to every loaded row.', 'oct-bulk-editor' ); ?></span>

		<span class="wbe-ie">
			<button id="wbe-export" class="button"><?php esc_html_e( 'Export CSV', 'oct-bulk-editor' ); ?></button>
			<label class="button wbe-import-label">
				<?php esc_html_e( 'Import CSV', 'oct-bulk-editor' ); ?>
				<input type="file" id="wbe-import-file" accept=".csv,text/csv" />
			</label>
			<span class="wbe-bulkedit-hint"><?php esc_html_e( 'Export the current filter, edit in Excel, re-import (matched by id).', 'oct-bulk-editor' ); ?></span>
		</span>
	</div>

	<!-- Spreadsheet table -->
	<div class="wbe-table-wrapper">
		<table id="wbe-table" class="wbe-table widefat">
			<thead>
				<tr>
					<th class="wbe-col-check"><input type="checkbox" id="wbe-select-all" title="<?php esc_attr_e( 'Select all', 'oct-bulk-editor' ); ?>" /></th>
					<th class="wbe-col-image" data-col="image"><?php esc_html_e( 'Image', 'oct-bulk-editor' ); ?></th>
					<th class="wbe-col-image wbe-col-lifestyle" data-col="acvs_lifestyle"><?php esc_html_e( 'Lifestyle', 'oct-bulk-editor' ); ?></th>
					<th class="wbe-col-name"><?php esc_html_e( 'Product / Variation', 'oct-bulk-editor' ); ?></th>
					<th class="wbe-col-catalog" data-col="acvs_catalog"><?php esc_html_e( 'On Category Page', 'oct-bulk-editor' ); ?></th>
					<th class="wbe-col-sku" data-col="sku"><?php esc_html_e( 'SKU', 'oct-bulk-editor' ); ?></th>
					<th class="wbe-col-price" data-col="regular_price"><?php esc_html_e( 'Regular Price', 'oct-bulk-editor' ); ?></th>
					<th class="wbe-col-price" data-col="sale_price"><?php esc_html_e( 'Sale Price', 'oct-bulk-editor' ); ?></th>
					<th class="wbe-col-stock" data-col="stock_qty"><?php esc_html_e( 'Stock Qty', 'oct-bulk-editor' ); ?></th>
					<th class="wbe-col-status" data-col="stock_status"><?php esc_html_e( 'Stock Status', 'oct-bulk-editor' ); ?></th>
					<th class="wbe-col-status" data-col="status"><?php esc_html_e( 'Publish Status', 'oct-bulk-editor' ); ?></th>
					<th class="wbe-col-fabricgroup" data-col="fabric_group"><?php esc_html_e( 'Fabric Group', 'oct-bulk-editor' ); ?></th>
					<th class="wbe-col-price" data-col="price_eur"><?php esc_html_e( 'Regular € (EUR)', 'oct-bulk-editor' ); ?></th>
					<th class="wbe-col-price" data-col="sale_price_eur"><?php esc_html_e( 'Sale € (EUR)', 'oct-bulk-editor' ); ?></th>
					<th class="wbe-col-price" data-col="price_usd"><?php esc_html_e( 'Regular $ (USD)', 'oct-bulk-editor' ); ?></th>
					<th class="wbe-col-price" data-col="sale_price_usd"><?php esc_html_e( 'Sale $ (USD)', 'oct-bulk-editor' ); ?></th>
					<th class="wbe-col-actions"><?php esc_html_e( 'Actions', 'oct-bulk-editor' ); ?></th>
				</tr>
			</thead>
			<tbody id="wbe-tbody">
				<tr class="wbe-placeholder">
					<td colspan="17">
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
