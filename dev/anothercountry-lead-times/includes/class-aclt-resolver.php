<?php
/**
 * Resolves the effective lead-time notice for a given product.
 *
 * Resolution order:
 *   1. Per-product override (the escape hatch for genuine one-offs).
 *   2. Supplier seasonal text, if a seasonal window is active today.
 *   3. Supplier out-of-stock text, if the product is not in stock.
 *   4. Supplier base text.
 * An optional supplier note is appended in cases 2&ndash;4.
 */

defined( 'ABSPATH' ) || exit;

class ACLT_Resolver {

	/**
	 * Compute the lead-time string for a product (no markup, no prefix).
	 * Returns '' when nothing should be shown.
	 */
	public static function resolve_text( int $product_id ): string {
		// 1. Per-product override wins outright.
		if ( get_post_meta( $product_id, '_aclt_override_enabled', true ) ) {
			$override = trim( (string) get_post_meta( $product_id, '_aclt_override_text', true ) );
			if ( $override !== '' ) {
				return $override;
			}
		}

		$term = self::get_supplier_term( $product_id );
		if ( ! $term ) {
			$settings = aclt_get_settings();
			return (string) ( $settings['fallback'] ?? '' );
		}

		$d = ACLT_Taxonomy::get_data( $term->term_id );
		if ( empty( $d['enabled'] ) ) {
			return '';
		}

		$text = '';

		// 2. Seasonal window active.
		if ( ! empty( $d['season_enabled'] ) && $d['season_text'] !== ''
			&& self::in_season( $d['season_start'], $d['season_end'] ) ) {
			$text = $d['season_text'];
		}

		// 3. Out of stock.
		if ( $text === '' && $d['oos'] !== '' && self::is_out_of_stock( $product_id ) ) {
			$text = $d['oos'];
		}

		// 4. Base.
		if ( $text === '' ) {
			$text = $d['base'];
		}

		if ( $text === '' ) {
			return '';
		}

		if ( ! empty( $d['note'] ) ) {
			$text .= ' ' . $d['note'];
		}

		return $text;
	}

	/**
	 * Return the first supplier term assigned to a product, or null.
	 */
	public static function get_supplier_term( int $product_id ): ?WP_Term {
		$terms = get_the_terms( $product_id, ACLT_TAX );
		if ( is_wp_error( $terms ) || empty( $terms ) ) {
			return null;
		}
		return $terms[0];
	}

	/**
	 * Whether a product (or its variations) is out of stock / on backorder.
	 */
	public static function is_out_of_stock( int $product_id ): bool {
		if ( ! function_exists( 'wc_get_product' ) ) {
			return false;
		}
		$product = wc_get_product( $product_id );
		if ( ! $product ) {
			return false;
		}
		return ! $product->is_in_stock();
	}

	/**
	 * Is today inside a recurring MM-DD window? Supports windows that wrap the
	 * year boundary (e.g. 11-01 → 02-28).
	 */
	public static function in_season( string $start, string $end ): bool {
		$start = self::sanitize_md( $start );
		$end   = self::sanitize_md( $end );
		if ( $start === '' || $end === '' ) {
			return false;
		}

		$today = (int) current_time( 'md' ); // e.g. 0719 → 719
		$s     = (int) str_replace( '-', '', $start );
		$e     = (int) str_replace( '-', '', $end );

		if ( $s <= $e ) {
			return $today >= $s && $today <= $e;
		}
		// Wrapping window: active if after start OR before end.
		return $today >= $s || $today <= $e;
	}

	/**
	 * Normalise a MM-DD string. Returns '' if invalid.
	 */
	public static function sanitize_md( string $value ): string {
		$value = trim( $value );
		if ( ! preg_match( '/^(\d{1,2})-(\d{1,2})$/', $value, $m ) ) {
			return '';
		}
		$month = (int) $m[1];
		$day   = (int) $m[2];
		if ( $month < 1 || $month > 12 || $day < 1 || $day > 31 ) {
			return '';
		}
		return sprintf( '%02d-%02d', $month, $day );
	}
}
