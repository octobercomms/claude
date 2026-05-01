<?php defined( 'ABSPATH' ) || exit; ?>

<div class="wrap wbe-wrap">

	<h1 class="wbe-header">
		<?php esc_html_e( 'WooCommerce Bulk Editor', 'woo-bulk-editor' ); ?>
		<span class="wbe-badge"><?php esc_html_e( 'Spreadsheet Mode', 'woo-bulk-editor' ); ?></span>
	</h1>

	<!-- Toolbar -->
	<div class="wbe-toolbar">
		<div class="wbe-filters">
			<input
				type="search"
				id="wbe-search"
				class="wbe-input"
				placeholder="<?php esc_attr_e( 'Search products…', 'woo-bulk-editor' ); ?>"
			/>

			<select id="wbe-category" class="wbe-input">
				<option value="0"><?php esc_html_e( 'All categories', 'woo-bulk-editor' ); ?></option>
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
				<?php esc_html_e( 'Load Products', 'woo-bulk-editor' ); ?>
			</button>
		</div>

		<div class="wbe-actions">
			<span id="wbe-change-count" class="wbe-change-badge" style="display:none"></span>
			<button id="wbe-discard" class="button button-secondary" style="display:none">
				<?php esc_html_e( 'Discard Changes', 'woo-bulk-editor' ); ?>
			</button>
			<button id="wbe-save" class="button button-primary" disabled>
				<?php esc_html_e( 'Save All Changes', 'woo-bulk-editor' ); ?>
			</button>
		</div>
	</div>

	<!-- Status bar -->
	<div id="wbe-status" class="wbe-status" style="display:none"></div>

	<!-- Column visibility -->
	<div class="wbe-col-toggle">
		<strong><?php esc_html_e( 'Columns:', 'woo-bulk-editor' ); ?></strong>
		<?php
		$columns = [
			'sku'          => __( 'SKU', 'woo-bulk-editor' ),
			'regular_price'=> __( 'Regular Price', 'woo-bulk-editor' ),
			'sale_price'   => __( 'Sale Price', 'woo-bulk-editor' ),
			'stock_qty'    => __( 'Stock Qty', 'woo-bulk-editor' ),
			'stock_status' => __( 'Stock Status', 'woo-bulk-editor' ),
			'status'       => __( 'Publish Status', 'woo-bulk-editor' ),
		];
		foreach ( $columns as $key => $label ) :
		?>
		<label class="wbe-col-label">
			<input type="checkbox" class="wbe-col-toggle-cb" data-col="<?php echo esc_attr( $key ); ?>" checked />
			<?php echo esc_html( $label ); ?>
		</label>
		<?php endforeach; ?>
	</div>

	<!-- Spreadsheet table -->
	<div class="wbe-table-wrapper">
		<table id="wbe-table" class="wbe-table widefat">
			<thead>
				<tr>
					<th class="wbe-col-name"><?php esc_html_e( 'Product / Variation', 'woo-bulk-editor' ); ?></th>
					<th class="wbe-col-sku" data-col="sku"><?php esc_html_e( 'SKU', 'woo-bulk-editor' ); ?></th>
					<th class="wbe-col-price" data-col="regular_price"><?php esc_html_e( 'Regular Price', 'woo-bulk-editor' ); ?></th>
					<th class="wbe-col-price" data-col="sale_price"><?php esc_html_e( 'Sale Price', 'woo-bulk-editor' ); ?></th>
					<th class="wbe-col-stock" data-col="stock_qty"><?php esc_html_e( 'Stock Qty', 'woo-bulk-editor' ); ?></th>
					<th class="wbe-col-status" data-col="stock_status"><?php esc_html_e( 'Stock Status', 'woo-bulk-editor' ); ?></th>
					<th class="wbe-col-status" data-col="status"><?php esc_html_e( 'Publish Status', 'woo-bulk-editor' ); ?></th>
					<th class="wbe-col-actions"><?php esc_html_e( 'Actions', 'woo-bulk-editor' ); ?></th>
				</tr>
			</thead>
			<tbody id="wbe-tbody">
				<tr class="wbe-placeholder">
					<td colspan="8">
						<?php esc_html_e( 'Use the filters above and click "Load Products" to begin editing.', 'woo-bulk-editor' ); ?>
					</td>
				</tr>
			</tbody>
		</table>
	</div>

	<!-- Pagination -->
	<div id="wbe-pagination" class="wbe-pagination" style="display:none">
		<button id="wbe-prev" class="button" disabled><?php esc_html_e( '&larr; Previous', 'woo-bulk-editor' ); ?></button>
		<span id="wbe-page-info"></span>
		<button id="wbe-next" class="button"><?php esc_html_e( 'Next &rarr;', 'woo-bulk-editor' ); ?></button>
	</div>

</div><!-- .wrap -->
