<?php
/**
 * Per-product lead-time override.
 *
 * Most products inherit their lead time from their supplier. This metabox is the
 * escape hatch for the genuine one-offs ("this specific product is different"),
 * shown in the WooCommerce Product Data panel.
 */

defined( 'ABSPATH' ) || exit;

class ACLT_Product {

	public function __construct() {
		add_filter( 'woocommerce_product_data_tabs', [ $this, 'add_tab' ] );
		add_action( 'woocommerce_product_data_panels', [ $this, 'render_panel' ] );
		add_action( 'woocommerce_process_product_meta', [ $this, 'save' ] );
	}

	public function add_tab( array $tabs ): array {
		$tabs['aclt_lead_time'] = [
			'label'    => __( 'Lead Time', 'anothercountry-lead-times' ),
			'target'   => 'aclt_lead_time_panel',
			'class'    => [],
			'priority' => 65,
		];
		return $tabs;
	}

	public function render_panel(): void {
		global $post;
		$enabled = get_post_meta( $post->ID, '_aclt_override_enabled', true );
		$text    = get_post_meta( $post->ID, '_aclt_override_text', true );
		$term    = ACLT_Resolver::get_supplier_term( $post->ID );

		echo '<div id="aclt_lead_time_panel" class="panel woocommerce_options_panel">';
		wp_nonce_field( 'aclt_product', 'aclt_product_nonce' );

		echo '<div class="options_group">';

		if ( $term ) {
			echo '<p class="form-field"><label>' . esc_html__( 'Supplier', 'anothercountry-lead-times' ) . '</label><span>' .
				esc_html( $term->name ) . ' &mdash; ' . esc_html( ACLT_Resolver::resolve_text( $post->ID ) ?: __( '(no lead time set)', 'anothercountry-lead-times' ) ) .
				'</span></p>';
		} else {
			echo '<p class="form-field"><label>' . esc_html__( 'Supplier', 'anothercountry-lead-times' ) . '</label><span>' .
				esc_html__( 'Not assigned — set a supplier in the Suppliers box, or override below.', 'anothercountry-lead-times' ) .
				'</span></p>';
		}

		woocommerce_wp_checkbox( [
			'id'          => '_aclt_override_enabled',
			'value'       => $enabled ? 'yes' : 'no',
			'label'       => __( 'Override lead time', 'anothercountry-lead-times' ),
			'description' => __( 'Ignore the supplier lead time and use the custom text below for this product only.', 'anothercountry-lead-times' ),
		] );

		woocommerce_wp_text_input( [
			'id'          => '_aclt_override_text',
			'value'       => $text,
			'label'       => __( 'Custom lead time', 'anothercountry-lead-times' ),
			'placeholder' => 'e.g. 12–15 weeks',
		] );

		echo '</div></div>';
	}

	public function save( int $post_id ): void {
		if ( ! isset( $_POST['aclt_product_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['aclt_product_nonce'] ) ), 'aclt_product' ) ) {
			return;
		}
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}

		update_post_meta( $post_id, '_aclt_override_enabled', isset( $_POST['_aclt_override_enabled'] ) && 'yes' === $_POST['_aclt_override_enabled'] ? 1 : 0 );
		update_post_meta( $post_id, '_aclt_override_text', sanitize_text_field( wp_unslash( $_POST['_aclt_override_text'] ?? '' ) ) );
	}
}
