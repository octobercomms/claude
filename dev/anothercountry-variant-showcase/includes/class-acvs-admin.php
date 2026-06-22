<?php
/**
 * Admin UI: per-product catalog display mode + lifestyle image, and the
 * per-variation "show as its own card" checkbox + lifestyle image.
 */

defined( 'ABSPATH' ) || exit;

class ACVS_Admin {

	public function __construct() {
		// Product-level fields (General tab of the Product data panel).
		add_action( 'woocommerce_product_options_general_product_data', [ $this, 'product_fields' ] );
		add_action( 'woocommerce_admin_process_product_object', [ $this, 'save_product_fields' ] );

		// Per-variation fields.
		add_action( 'woocommerce_product_after_variable_attributes', [ $this, 'variation_fields' ], 10, 3 );
		add_action( 'woocommerce_save_product_variation', [ $this, 'save_variation_fields' ], 10, 2 );

		// Media picker assets on the product editor.
		add_action( 'admin_enqueue_scripts', [ $this, 'enqueue' ] );
	}

	/* ---------------------------------------------------------------------
	 * Product-level fields
	 * ------------------------------------------------------------------ */

	public function product_fields(): void {
		global $product_object;

		$product = $product_object instanceof WC_Product ? $product_object : null;
		$mode    = $product ? ( $product->get_meta( ACVS_META_MODE ) ?: 'default' ) : 'default';
		$single  = $product ? absint( $product->get_meta( ACVS_META_SINGLE ) ) : 0;
		$life_id = $product ? absint( $product->get_meta( ACVS_META_LIFESTYLE ) ) : 0;

		echo '<div class="options_group acvs-product-options">';

		echo '<p class="form-field"><strong>' .
			esc_html__( 'Variant Showcase', 'anothercountry-variant-showcase' ) .
			'</strong></p>';

		// Catalog display mode.
		woocommerce_wp_select( [
			'id'          => ACVS_META_MODE,
			'label'       => __( 'Catalog display', 'anothercountry-variant-showcase' ),
			'value'       => $mode,
			'description' => __( 'How this product appears on shop and category pages.', 'anothercountry-variant-showcase' ),
			'desc_tip'    => true,
			'options'     => [
				'default' => __( 'Single card (default WooCommerce)', 'anothercountry-variant-showcase' ),
				'expand'  => __( 'Separate card per selected variation', 'anothercountry-variant-showcase' ),
				'single'  => __( 'Feature one variation', 'anothercountry-variant-showcase' ),
			],
		] );

		// Which single variation to feature (only used by "single" mode).
		$options = [ 0 => __( '— Select a variation —', 'anothercountry-variant-showcase' ) ];
		if ( $product && $product->is_type( 'variable' ) ) {
			foreach ( $product->get_children() as $variation_id ) {
				$variation = wc_get_product( $variation_id );
				if ( $variation ) {
					$options[ $variation_id ] = $variation->get_name();
				}
			}
		}
		woocommerce_wp_select( [
			'id'          => ACVS_META_SINGLE,
			'label'       => __( 'Featured variation', 'anothercountry-variant-showcase' ),
			'value'       => $single,
			'description' => __( 'Used when "Feature one variation" is selected above.', 'anothercountry-variant-showcase' ),
			'desc_tip'    => true,
			'options'     => $options,
		] );

		// Product-level lifestyle image (used for the default/single-product card hover).
		$this->image_field(
			ACVS_META_LIFESTYLE,
			$life_id,
			__( 'Lifestyle image (hover)', 'anothercountry-variant-showcase' ),
			__( 'Shown when a shopper hovers the product image on shop/category pages. Variation cards use their own lifestyle image instead (set on each variation).', 'anothercountry-variant-showcase' )
		);

		echo '</div>';
	}

	public function save_product_fields( $product ): void {
		if ( ! $product instanceof WC_Product ) {
			return;
		}

		$mode = isset( $_POST[ ACVS_META_MODE ] ) ? sanitize_key( wp_unslash( $_POST[ ACVS_META_MODE ] ) ) : 'default';
		if ( ! in_array( $mode, [ 'default', 'expand', 'single' ], true ) ) {
			$mode = 'default';
		}
		$product->update_meta_data( ACVS_META_MODE, $mode );

		$single = isset( $_POST[ ACVS_META_SINGLE ] ) ? absint( $_POST[ ACVS_META_SINGLE ] ) : 0;
		$product->update_meta_data( ACVS_META_SINGLE, $single );

		$life = isset( $_POST[ ACVS_META_LIFESTYLE ] ) ? absint( $_POST[ ACVS_META_LIFESTYLE ] ) : 0;
		$product->update_meta_data( ACVS_META_LIFESTYLE, $life );
	}

	/* ---------------------------------------------------------------------
	 * Variation-level fields
	 * ------------------------------------------------------------------ */

	public function variation_fields( $loop, $variation_data, $variation ): void {
		$variation_product = wc_get_product( $variation->ID );
		$show    = $variation_product ? $variation_product->get_meta( ACVS_META_SHOW ) === 'yes' : false;
		$life_id = $variation_product ? absint( $variation_product->get_meta( ACVS_META_LIFESTYLE ) ) : 0;

		echo '<div class="acvs-variation-options">';

		woocommerce_wp_checkbox( [
			'id'            => "acvs_show_in_catalog_{$loop}",
			'name'          => "acvs_show_in_catalog[{$loop}]",
			'label'         => __( 'Show as its own card on shop/category pages', 'anothercountry-variant-showcase' ),
			'value'         => $show ? 'yes' : 'no',
			'wrapper_class' => 'form-row form-row-full',
			'description'   => __( 'Requires the product\'s "Catalog display" to be set to "Separate card per selected variation".', 'anothercountry-variant-showcase' ),
		] );

		// Per-variation lifestyle image.
		$this->image_field(
			"acvs_lifestyle_image_id_{$loop}",
			$life_id,
			__( 'Lifestyle image (hover)', 'anothercountry-variant-showcase' ),
			__( 'Shown on hover when this variation appears as its own card.', 'anothercountry-variant-showcase' ),
			"acvs_lifestyle_image_id[{$loop}]"
		);

		echo '</div>';
	}

	public function save_variation_fields( $variation_id, $i ): void {
		$variation = wc_get_product( $variation_id );
		if ( ! $variation ) {
			return;
		}

		$show = isset( $_POST['acvs_show_in_catalog'][ $i ] ) ? 'yes' : 'no';
		$variation->update_meta_data( ACVS_META_SHOW, $show );

		$life = isset( $_POST['acvs_lifestyle_image_id'][ $i ] ) ? absint( $_POST['acvs_lifestyle_image_id'][ $i ] ) : 0;
		$variation->update_meta_data( ACVS_META_LIFESTYLE, $life );

		$variation->save();
	}

	/* ---------------------------------------------------------------------
	 * Shared media-picker field
	 * ------------------------------------------------------------------ */

	/**
	 * Render a media-library image picker bound to a hidden attachment-ID input.
	 *
	 * @param string $id    Element id (and default name).
	 * @param int    $value Current attachment ID.
	 * @param string $label Field label.
	 * @param string $tip   Tooltip / description.
	 * @param string $name  Optional input name override (for array-style variation fields).
	 */
	private function image_field( string $id, int $value, string $label, string $tip, string $name = '' ): void {
		$name    = $name ?: $id;
		$preview = $value ? wp_get_attachment_image( $value, 'thumbnail' ) : '';

		echo '<p class="form-field acvs-image-field">';
		echo '<label>' . esc_html( $label ) . ' ' . wc_help_tip( $tip ) . '</label>';
		echo '<span class="acvs-image-preview">' . $preview . '</span>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- wp_get_attachment_image() is safe markup.
		echo '<input type="hidden" class="acvs-image-id" name="' . esc_attr( $name ) . '" value="' . esc_attr( (string) $value ) . '" />';
		echo '<button type="button" class="button acvs-upload-image">' . esc_html__( 'Choose image', 'anothercountry-variant-showcase' ) . '</button> ';
		echo '<button type="button" class="button acvs-remove-image"' . ( $value ? '' : ' style="display:none"' ) . '>' . esc_html__( 'Remove', 'anothercountry-variant-showcase' ) . '</button>';
		echo '</p>';
	}

	/* ---------------------------------------------------------------------
	 * Assets
	 * ------------------------------------------------------------------ */

	public function enqueue( string $hook ): void {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( ! $screen || $screen->post_type !== 'product' || ! in_array( $screen->base, [ 'post', 'edit' ], true ) ) {
			return;
		}

		wp_enqueue_media();

		wp_enqueue_style( 'acvs-admin', ACVS_URL . 'assets/css/admin.css', [], ACVS_VERSION );

		wp_enqueue_script( 'acvs-admin', ACVS_URL . 'assets/js/admin.js', [ 'jquery' ], ACVS_VERSION, true );
		wp_localize_script( 'acvs-admin', 'acvs', [
			'title'  => __( 'Select lifestyle image', 'anothercountry-variant-showcase' ),
			'button' => __( 'Use this image', 'anothercountry-variant-showcase' ),
		] );
	}
}
