<?php
/**
 * Add / edit a plant. Expects $banner_cb and $plant (array, empty for new).
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
$is_edit = ! empty( $plant['id'] );
$val     = function ( $key, $default = '' ) use ( $plant ) {
	return isset( $plant[ $key ] ) ? $plant[ $key ] : $default;
};
$list_url = admin_url( 'admin.php?page=hgd-plants' );
?>
<div class="wrap hgd-wrap">

	<?php call_user_func( $banner_cb ); ?>

	<div class="hgd-page-head">
		<h1><?php echo $is_edit ? esc_html__( 'Edit plant', 'hillcroft-garden-designer' ) : esc_html__( 'Add plant', 'hillcroft-garden-designer' ); ?></h1>
		<a class="hgd-pill hgd-pill-ghost" href="<?php echo esc_url( $list_url ); ?>"><?php esc_html_e( '← Back to catalogue', 'hillcroft-garden-designer' ); ?></a>
	</div>

	<?php if ( isset( $_GET['error'] ) && 'name' === $_GET['error'] ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
		<div class="hgd-flash hgd-flash-error"><?php esc_html_e( 'Please give the plant at least a botanical or common name.', 'hillcroft-garden-designer' ); ?></div>
	<?php endif; ?>

	<?php if ( isset( $_GET['photo_fetched'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
		<div class="hgd-flash"><?php esc_html_e( 'Photo fetched from Wikipedia and set as the plant image.', 'hillcroft-garden-designer' ); ?></div>
	<?php elseif ( isset( $_GET['photo_error'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification
		$photo_err = get_transient( 'hgd_plant_photo_error_' . get_current_user_id() );
		delete_transient( 'hgd_plant_photo_error_' . get_current_user_id() );
		?>
		<div class="hgd-flash hgd-flash-error"><?php echo esc_html( $photo_err ? $photo_err : __( 'Could not fetch a photo. Please try again.', 'hillcroft-garden-designer' ) ); ?></div>
	<?php endif; ?>

	<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="hgd-panel hgd-form">
		<input type="hidden" name="action" value="hgd_save_plant" />
		<input type="hidden" name="id" value="<?php echo esc_attr( (int) $val( 'id', 0 ) ); ?>" />
		<?php wp_nonce_field( 'hgd_save_plant' ); ?>

		<div class="hgd-grid">
			<label><span><?php esc_html_e( 'Botanical name', 'hillcroft-garden-designer' ); ?></span>
				<input type="text" name="botanical_name" value="<?php echo esc_attr( $val( 'botanical_name' ) ); ?>" /></label>
			<label><span><?php esc_html_e( 'Common name', 'hillcroft-garden-designer' ); ?></span>
				<input type="text" name="common_name" value="<?php echo esc_attr( $val( 'common_name' ) ); ?>" /></label>

			<label><span><?php esc_html_e( 'Type', 'hillcroft-garden-designer' ); ?></span>
				<select name="plant_type">
					<option value=""><?php esc_html_e( '—', 'hillcroft-garden-designer' ); ?></option>
					<?php foreach ( HGD_Plant::TYPES as $t ) : ?>
						<option value="<?php echo esc_attr( $t ); ?>" <?php selected( $val( 'plant_type' ), $t ); ?>><?php echo esc_html( ucfirst( $t ) ); ?></option>
					<?php endforeach; ?>
				</select></label>
			<label><span><?php esc_html_e( 'Pot size / grade', 'hillcroft-garden-designer' ); ?></span>
				<input type="text" name="pot_size" value="<?php echo esc_attr( $val( 'pot_size' ) ); ?>" /></label>

			<label><span><?php esc_html_e( 'Unit cost (£)', 'hillcroft-garden-designer' ); ?></span>
				<input type="number" step="0.01" min="0" name="unit_cost" value="<?php echo esc_attr( $val( 'unit_cost', '0.00' ) ); ?>" /></label>
			<label><span><?php esc_html_e( 'Markup (%)', 'hillcroft-garden-designer' ); ?></span>
				<input type="number" step="0.01" min="0" name="markup_pct" value="<?php echo esc_attr( $val( 'markup_pct', '0.00' ) ); ?>" /></label>

			<label><span><?php esc_html_e( 'Supplier', 'hillcroft-garden-designer' ); ?></span>
				<input type="text" name="supplier" value="<?php echo esc_attr( $val( 'supplier' ) ); ?>" /></label>
			<label><span><?php esc_html_e( 'Supplier SKU', 'hillcroft-garden-designer' ); ?></span>
				<input type="text" name="supplier_sku" value="<?php echo esc_attr( $val( 'supplier_sku' ) ); ?>" /></label>

			<label><span><?php esc_html_e( 'Lead time (days)', 'hillcroft-garden-designer' ); ?></span>
				<input type="number" min="0" name="lead_time_days" value="<?php echo esc_attr( $val( 'lead_time_days', '0' ) ); ?>" /></label>
			<label><span><?php esc_html_e( 'Min order qty', 'hillcroft-garden-designer' ); ?></span>
				<input type="number" min="1" name="min_order_qty" value="<?php echo esc_attr( $val( 'min_order_qty', '1' ) ); ?>" /></label>

			<label><span><?php esc_html_e( 'Mature height (cm)', 'hillcroft-garden-designer' ); ?></span>
				<input type="number" min="0" name="mature_height_cm" value="<?php echo esc_attr( $val( 'mature_height_cm', '0' ) ); ?>" /></label>
			<label><span><?php esc_html_e( 'Mature spread (cm)', 'hillcroft-garden-designer' ); ?></span>
				<input type="number" min="0" name="mature_spread_cm" value="<?php echo esc_attr( $val( 'mature_spread_cm', '0' ) ); ?>" /></label>

			<label><span><?php esc_html_e( 'Spacing (plants / m²)', 'hillcroft-garden-designer' ); ?></span>
				<input type="number" step="0.01" min="0" name="spacing_per_sqm" value="<?php echo esc_attr( $val( 'spacing_per_sqm', '0.00' ) ); ?>" /></label>
			<label><span><?php esc_html_e( 'Sun', 'hillcroft-garden-designer' ); ?></span>
				<select name="sun">
					<option value=""><?php esc_html_e( '—', 'hillcroft-garden-designer' ); ?></option>
					<?php foreach ( HGD_Plant::SUN as $opt ) : ?>
						<option value="<?php echo esc_attr( $opt ); ?>" <?php selected( $val( 'sun' ), $opt ); ?>><?php echo esc_html( ucwords( str_replace( '_', ' ', $opt ) ) ); ?></option>
					<?php endforeach; ?>
				</select></label>

			<label><span><?php esc_html_e( 'Soil', 'hillcroft-garden-designer' ); ?></span>
				<input type="text" name="soil" value="<?php echo esc_attr( $val( 'soil' ) ); ?>" /></label>
			<label><span><?php esc_html_e( 'Hardiness', 'hillcroft-garden-designer' ); ?></span>
				<input type="text" name="hardiness" value="<?php echo esc_attr( $val( 'hardiness' ) ); ?>" placeholder="e.g. H5" /></label>

			<label><span><?php esc_html_e( 'Foliage', 'hillcroft-garden-designer' ); ?></span>
				<select name="foliage">
					<option value=""><?php esc_html_e( '—', 'hillcroft-garden-designer' ); ?></option>
					<?php foreach ( HGD_Plant::FOLIAGE as $opt ) : ?>
						<option value="<?php echo esc_attr( $opt ); ?>" <?php selected( $val( 'foliage' ), $opt ); ?>><?php echo esc_html( ucwords( str_replace( '_', ' ', $opt ) ) ); ?></option>
					<?php endforeach; ?>
				</select></label>
			<label><span><?php esc_html_e( 'Flowering months', 'hillcroft-garden-designer' ); ?></span>
				<input type="text" name="flowering_months" value="<?php echo esc_attr( $val( 'flowering_months' ) ); ?>" placeholder="e.g. 6,7,8" /></label>

			<label><span><?php esc_html_e( 'Toxicity / safety', 'hillcroft-garden-designer' ); ?></span>
				<select name="toxicity">
					<?php foreach ( HGD_Plant::TOXICITY as $opt ) : ?>
						<option value="<?php echo esc_attr( $opt ); ?>" <?php selected( $val( 'toxicity', 'none' ), $opt ); ?>><?php echo esc_html( ucfirst( $opt ) ); ?></option>
					<?php endforeach; ?>
				</select></label>
			<label><span><?php esc_html_e( 'GBIF ID', 'hillcroft-garden-designer' ); ?></span>
				<input type="text" name="gbif_id" value="<?php echo esc_attr( $val( 'gbif_id' ) ); ?>" /></label>
		</div>

		<?php
		$image_id  = (int) $val( 'image_id', 0 );
		$image_url = $image_id > 0 ? wp_get_attachment_image_url( $image_id, array( 96, 96 ) ) : '';
		?>
		<div class="hgd-full hgd-plant-image" id="hgd-plant-image">
			<span class="hgd-field-label"><?php esc_html_e( 'Plant photo', 'hillcroft-garden-designer' ); ?></span>
			<input type="hidden" name="image_id" id="hgd-image-id" value="<?php echo esc_attr( $image_id ); ?>" />
			<div class="hgd-plant-image-row">
				<span class="hgd-plant-image-preview" id="hgd-image-preview">
					<?php if ( $image_url ) : ?>
						<img src="<?php echo esc_url( $image_url ); ?>" alt="" />
					<?php else : ?>
						<span class="hgd-plant-thumb hgd-plant-thumb-empty" aria-hidden="true">✿</span>
					<?php endif; ?>
				</span>
				<span class="hgd-plant-image-controls">
					<button type="button" class="hgd-pill hgd-pill-ghost" id="hgd-image-pick"><?php esc_html_e( 'Choose from media library', 'hillcroft-garden-designer' ); ?></button>
					<a href="#" class="hgd-image-remove<?php echo $image_id > 0 ? '' : ' hgd-hidden'; ?>" id="hgd-image-remove"><?php esc_html_e( 'Remove', 'hillcroft-garden-designer' ); ?></a>
				</span>
			</div>
		</div>

		<label class="hgd-full"><span><?php esc_html_e( 'Notes', 'hillcroft-garden-designer' ); ?></span>
			<textarea name="notes" rows="3"><?php echo esc_textarea( $val( 'notes' ) ); ?></textarea></label>

		<div class="hgd-form-actions">
			<button type="submit" class="hgd-pill"><?php echo $is_edit ? esc_html__( 'Save changes', 'hillcroft-garden-designer' ) : esc_html__( 'Add plant', 'hillcroft-garden-designer' ); ?></button>
			<a class="hgd-pill hgd-pill-ghost" href="<?php echo esc_url( $list_url ); ?>"><?php esc_html_e( 'Cancel', 'hillcroft-garden-designer' ); ?></a>
		</div>
	</form>

	<?php if ( $is_edit ) : ?>
		<div class="hgd-plant-fetch">
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="hgd_plant_fetch_photo" />
				<input type="hidden" name="id" value="<?php echo esc_attr( (int) $val( 'id', 0 ) ); ?>" />
				<?php wp_nonce_field( 'hgd_plant_fetch_photo_' . (int) $val( 'id', 0 ) ); ?>
				<button type="submit" class="hgd-pill hgd-pill-ghost"><?php esc_html_e( 'Fetch photo from Wikipedia', 'hillcroft-garden-designer' ); ?></button>
			</form>
			<p class="hgd-muted"><?php esc_html_e( 'Pulls a freely-licensed photo from Wikipedia by botanical name.', 'hillcroft-garden-designer' ); ?></p>
		</div>
	<?php endif; ?>

</div>
