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

		// In-stock products with backorders set to "Allow, notify" get
		// WooCommerce's "(can be backordered)" suffix appended (see
		// wc_format_stock_for_display()). Their status is `instock`, so the
		// relabels above don't touch them and the parenthetical leaks onto the
		// page (e.g. "In Stock (Can Be Backordered)"). Strip it so the label
		// stays clean, without otherwise altering the in-stock wording.
		if ( 'instock' === $status && ! empty( $s['hide_backorder_suffix'] ) ) {
			return self::strip_backorder_suffix( (string) $text );
		}

		return $text;
	}

	/**
	 * Remove WooCommerce's "(can be backordered)" suffix from availability text.
	 * Handles the translated phrase and the English fallback, and tidies any
	 * doubled whitespace left behind.
	 */
	public static function strip_backorder_suffix( string $text ): string {
		$phrase  = __( '(can be backordered)', 'woocommerce' );
		$text    = str_ireplace( [ $phrase, '(can be backordered)' ], '', $text );
		$text    = preg_replace( '/\s{2,}/', ' ', $text );
		return trim( (string) $text );
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
