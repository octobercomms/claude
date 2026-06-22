<?php defined( 'ABSPATH' ) || exit; ?>

<div class="wrap wbe-wrap octwbe-merge">

	<h1 class="wbe-header">
		<?php esc_html_e( 'Merge Products', 'oct-bulk-editor' ); ?>
		<span class="wbe-badge"><?php esc_html_e( 'Variant Showcase', 'oct-bulk-editor' ); ?></span>
	</h1>

	<div class="octwbe-merge-intro notice notice-warning inline">
		<p>
			<strong><?php esc_html_e( 'Run this on staging with a fresh backup first.', 'oct-bulk-editor' ); ?></strong>
			<?php esc_html_e( 'This combines the selected products into one new variable product (created as a draft). The originals are set to draft and 301-redirected to the new product — nothing is deleted, so it is reversible.', 'oct-bulk-editor' ); ?>
		</p>
	</div>

	<div id="octwbe-merge-status" class="wbe-status" style="display:none"></div>

	<div class="octwbe-merge-grid">

		<!-- Step 1: pick products -->
		<div class="octwbe-merge-col">
			<h2><?php esc_html_e( '1. Choose products to merge', 'oct-bulk-editor' ); ?></h2>
			<input type="search" id="octwbe-merge-search" class="wbe-input" placeholder="<?php esc_attr_e( 'Search products…', 'oct-bulk-editor' ); ?>" />
			<div id="octwbe-merge-list" class="octwbe-merge-list">
				<p class="octwbe-merge-loading"><?php esc_html_e( 'Loading products…', 'oct-bulk-editor' ); ?></p>
			</div>
		</div>

		<!-- Step 2: configure -->
		<div class="octwbe-merge-col">
			<h2><?php esc_html_e( '2. Configure the merged product', 'oct-bulk-editor' ); ?></h2>

			<p class="form-field">
				<label for="octwbe-merge-title"><strong><?php esc_html_e( 'New product name', 'oct-bulk-editor' ); ?></strong></label>
				<input type="text" id="octwbe-merge-title" class="wbe-input" style="width:100%" placeholder="<?php esc_attr_e( 'e.g. Another Sofa', 'oct-bulk-editor' ); ?>" />
			</p>

			<p class="description"><?php esc_html_e( 'Selected products appear below. Set the Model name each becomes, and pick which one seeds the description, gallery and categories.', 'oct-bulk-editor' ); ?></p>

			<table class="widefat octwbe-merge-selected">
				<thead>
					<tr>
						<th><?php esc_html_e( 'Product', 'oct-bulk-editor' ); ?></th>
						<th><?php esc_html_e( 'Model name', 'oct-bulk-editor' ); ?></th>
						<th><?php esc_html_e( 'Base', 'oct-bulk-editor' ); ?></th>
					</tr>
				</thead>
				<tbody id="octwbe-merge-selected-body">
					<tr class="octwbe-merge-empty"><td colspan="3"><?php esc_html_e( 'No products selected yet.', 'oct-bulk-editor' ); ?></td></tr>
				</tbody>
			</table>

			<div class="octwbe-merge-actions">
				<button id="octwbe-merge-preview" class="button button-secondary"><?php esc_html_e( 'Preview', 'oct-bulk-editor' ); ?></button>
			</div>

			<div id="octwbe-merge-previewbox" class="octwbe-merge-previewbox" style="display:none"></div>

			<div class="octwbe-merge-confirm" style="display:none">
				<label>
					<input type="checkbox" id="octwbe-merge-backup" />
					<?php esc_html_e( 'I am on staging and/or have taken a fresh backup.', 'oct-bulk-editor' ); ?>
				</label>
				<button id="octwbe-merge-run" class="button button-primary" disabled><?php esc_html_e( 'Create merged product', 'oct-bulk-editor' ); ?></button>
			</div>
		</div>
	</div>

</div><!-- .wrap -->
