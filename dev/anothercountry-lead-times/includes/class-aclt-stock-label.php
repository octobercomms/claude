<?php
/**
 * Stock-label relabelling — absorbs the "Woo Custom Stock Status" plugin so it
 * can be deactivated (fewer plugins).
 *
 * It reproduces the live configuration: WooCommerce's "on backorder" status is
 * shown as "Made to Order", "out of stock" as "Out of Stock", coloured to
 * match. The approved green "Made to Order / In Stock" badge by the price is
 * unchanged for the customer.
 *
 * Scope: this covers the product page availability text + colour. If the team
 * also relies on custom labels in the cart/checkout, that can be extended here.
 */

defined( 'ABSPATH' ) || exit;

class ACLT_Stock_Label {

	public function __construct() {
		$s = aclt_get_settings();
		if ( empty( $s['relabel_stock'] ) ) {
			return;
		}
		add_filter( 'woocommerce_get_availability_text', [ $this, 'availability_text' ], 10, 2 );
		add_action( 'wp_head', [ $this, 'colour_css' ] );
	}

	/** Relabel the availability text per stock status. */
	public function availability_text( $text, $product ) {
		$s      = aclt_get_settings();
		$status = is_object( $product ) ? $product->get_stock_status() : '';

		if ( 'onbackorder' === $status && '' !== $s['label_backorder'] ) {
			return $s['label_backorder'];
		}
		if ( 'outofstock' === $status && '' !== $s['label_outofstock'] ) {
			return $s['label_outofstock'];
		}
		return $text;
	}

	/** Colour the labels to match the approved design. */
	public function colour_css(): void {
		if ( ! function_exists( 'is_product' ) || ! is_product() ) {
			return;
		}
		$s = aclt_get_settings();
		printf(
			'<style id="aclt-stock-colour">.single-product p.stock.available-on-backorder{color:%1$s !important;}.single-product p.stock.in-stock{color:%1$s !important;}.single-product p.stock.out-of-stock{color:%2$s !important;}</style>',
			esc_attr( $s['label_color'] ),
			esc_attr( $s['label_color_oos'] )
		);
	}
}
