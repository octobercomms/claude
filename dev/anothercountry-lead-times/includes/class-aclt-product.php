<?php
/**
 * Per-product lead-time override.
 *
 * Reuses the site's existing `_ac_lead_time` meta (already populated on hundreds
 * of products) as the per-product override. The plugin now owns this field on
 * the product General tab, so the duplicate definition can be removed from the
 * theme's functions.php. Leave the field blank to inherit from the supplier /
 * global default.
 */

defined( 'ABSPATH' ) || exit;

class ACLT_Product {

	public function __construct() {
		add_action( 'woocommerce_product_options_general_product_data', [ $this, 'field' ] );
		add_action( 'woocommerce_process_product_meta', [ $this, 'save' ] );
	}

	public function field(): void {
		global $post;
		wp_nonce_field( 'aclt_product', 'aclt_product_nonce' );

		woocommerce_wp_text_input( [
			'id'          => '_ac_lead_time',
			'label'       => __( 'Lead time', 'anothercountry-lead-times' ),
			'placeholder' => '8-12 weeks',
			'description' => __( 'Per-product override shown near the price. Leave blank to inherit from this product\'s supplier, or the global default.', 'anothercountry-lead-times' ),
			'desc_tip'    => true,
		] );

		$resolved = ACLT_Resolver::get_lead_time( (int) $post->ID );
		echo '<p class="form-field"><span class="description">' .
			esc_html__( 'Currently showing:', 'anothercountry-lead-times' ) . ' <strong>' . esc_html( $resolved ) . '</strong></span></p>';
	}

	public function save( int $post_id ): void {
		if ( ! isset( $_POST['aclt_product_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['aclt_product_nonce'] ) ), 'aclt_product' ) ) {
			return;
		}
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}
		if ( isset( $_POST['_ac_lead_time'] ) ) {
			update_post_meta( $post_id, '_ac_lead_time', sanitize_text_field( wp_unslash( $_POST['_ac_lead_time'] ) ) );
		}
	}
}
