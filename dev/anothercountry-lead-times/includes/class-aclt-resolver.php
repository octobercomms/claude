<?php
/**
 * Resolves lead-time wording for a product from three layers, in order:
 *
 *   1. Per-product override  — the existing `_ac_lead_time` field (already
 *      populated on hundreds of products). Untouched, so those keep showing
 *      exactly what they show today.
 *   2. Per-supplier          — base / out-of-stock figures + note from the
 *      assigned supplier term (the central screen), once configured.
 *   3. Global default        — a single fallback figure, seeded to match the
 *      site's current behaviour.
 *
 * The seasonal note is resolved independently (it's a workshop-closure caveat
 * that applies regardless of which figure layer wins): supplier seasonal note
 * when a supplier is configured, otherwise the global default note.
 */

defined( 'ABSPATH' ) || exit;

class ACLT_Resolver {

	/** The lead-time figure, e.g. "8-10 weeks". Never empty (global default). */
	public static function get_lead_time( int $product_id ): string {
		// 1. Per-product (or per-variation) override.
		$override = trim( (string) get_post_meta( $product_id, '_ac_lead_time', true ) );
		if ( '' !== $override ) {
			return $override;
		}

		// 1b. A variation with no override inherits its parent product.
		if ( 'product_variation' === get_post_type( $product_id ) ) {
			$parent = wp_get_post_parent_id( $product_id );
			if ( $parent ) {
				return self::get_lead_time( $parent );
			}
		}

		// 2. Supplier.
		$term = self::get_supplier_term( $product_id );
		if ( $term ) {
			$d = ACLT_Taxonomy::get_data( $term->term_id );
			if ( ! empty( $d['enabled'] ) ) {
				if ( '' !== $d['oos'] && self::is_out_of_stock( $product_id ) ) {
					return $d['oos'];
				}
				if ( '' !== $d['base'] ) {
					return $d['base'];
				}
			}
		}

		// 3. Global default.
		$s = aclt_get_settings();
		return (string) $s['default_lead'];
	}

	/**
	 * The status label shown before the lead time (e.g. "Made to Order",
	 * "Available"). Supplier label wins when set; otherwise the global default.
	 * A per-product override has no supplier, so it uses the global default.
	 */
	public static function get_badge_label( int $product_id ): string {
		// Variations inherit their parent's supplier/label.
		if ( 'product_variation' === get_post_type( $product_id ) ) {
			$parent = wp_get_post_parent_id( $product_id );
			if ( $parent ) {
				return self::get_badge_label( $parent );
			}
		}
		$term = self::get_supplier_term( $product_id );
		if ( $term ) {
			$d = ACLT_Taxonomy::get_data( $term->term_id );
			if ( ! empty( $d['enabled'] ) && '' !== trim( (string) $d['label'] ) ) {
				return trim( (string) $d['label'] );
			}
		}
		$s = aclt_get_settings();
		return (string) $s['default_label'];
	}

	/**
	 * Supplier note (e.g. "from receipt of fabric at the warehouse"), or ''.
	 * Only applies when the supplier layer supplies the figure — an explicit
	 * per-product override is treated as a complete statement.
	 */
	public static function get_lead_time_note( int $product_id ): string {
		if ( '' !== trim( (string) get_post_meta( $product_id, '_ac_lead_time', true ) ) ) {
			return '';
		}
		$term = self::get_supplier_term( $product_id );
		if ( $term ) {
			$d = ACLT_Taxonomy::get_data( $term->term_id );
			if ( ! empty( $d['enabled'] ) ) {
				return (string) $d['note'];
			}
		}
		return '';
	}

	/**
	 * The seasonal note active today for a product, or ''.
	 * Supplier-configured products use the supplier's own seasonal setting;
	 * everything else falls back to the global default (preserving today's
	 * behaviour until suppliers are filled in).
	 */
	public static function get_seasonal_note( int $product_id ): string {
		$term = self::get_supplier_term( $product_id );
		if ( $term ) {
			$d = ACLT_Taxonomy::get_data( $term->term_id );
			if ( ! empty( $d['enabled'] ) ) {
				if ( empty( $d['season_enabled'] ) ) {
					return ''; // Supplier configured, no seasonal closure.
				}
				return self::in_season( $d['season_start'], $d['season_end'] ) ? (string) $d['season_note'] : '';
			}
		}

		$s = aclt_get_settings();
		if ( ! empty( $s['default_season_enabled'] )
			&& self::in_season( $s['default_season_start'], $s['default_season_end'] ) ) {
			return (string) $s['default_season_note'];
		}
		return '';
	}

	/** Return the first supplier term assigned to a product, or null. */
	public static function get_supplier_term( int $product_id ): ?WP_Term {
		$terms = get_the_terms( $product_id, ACLT_TAX );
		if ( is_wp_error( $terms ) || empty( $terms ) ) {
			return null;
		}
		return $terms[0];
	}

	/** Whether a product is out of stock / on backorder. */
	public static function is_out_of_stock( int $product_id ): bool {
		if ( ! function_exists( 'wc_get_product' ) ) {
			return false;
		}
		$product = wc_get_product( $product_id );
		return $product ? ! $product->is_in_stock() : false;
	}

	/** A human stock-status label: In stock / Made to order / Out of stock. */
	public static function stock_label( int $product_id ): string {
		if ( ! function_exists( 'wc_get_product' ) ) {
			return '';
		}
		$product = wc_get_product( $product_id );
		if ( ! $product ) {
			return '';
		}
		switch ( $product->get_stock_status() ) {
			case 'onbackorder':
				return __( 'Made to order', 'anothercountry-lead-times' );
			case 'outofstock':
				return __( 'Out of stock', 'anothercountry-lead-times' );
			default:
				return __( 'In stock', 'anothercountry-lead-times' );
		}
	}

	/** The original (pre-migration) ACF lead-time message, still in the DB. */
	public static function old_message( int $product_id ): string {
		$t = (string) get_post_meta( $product_id, 'lead_time_popup_text', true );
		if ( '' === trim( $t ) ) {
			$t = (string) get_option( 'options_lead_time_popup_text', '' );
		}
		return $t;
	}

	/**
	 * Is today inside a recurring MM-DD window? Supports windows that wrap the
	 * year boundary (e.g. 11-01 → 02-28).
	 */
	public static function in_season( string $start, string $end ): bool {
		$start = self::sanitize_md( $start );
		$end   = self::sanitize_md( $end );
		if ( '' === $start || '' === $end ) {
			return false;
		}
		$today = (int) current_time( 'md' );
		$s     = (int) str_replace( '-', '', $start );
		$e     = (int) str_replace( '-', '', $end );
		if ( $s <= $e ) {
			return $today >= $s && $today <= $e;
		}
		return $today >= $s || $today <= $e;
	}

	/** Normalise a MM-DD string. Returns '' if invalid. */
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
