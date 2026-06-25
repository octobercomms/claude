<?php
/**
 * Spreadsheet column model for the bulk editor's Google Sheets sync.
 *
 * Knows how each sheet column maps to a product field, how to read its current
 * value as a canonical string, and how to compare two values for conflict
 * detection. Writing is delegated to OctBulkEditor::set_field_value() so the
 * sync, the in-app editor and the CSV import all save through one code path.
 *
 * Columns mirror the CSV export/import so the sheet is the same mental model.
 *
 * @package OctBulkEditor
 */

defined( 'ABSPATH' ) || exit;

class OCTWBE_Fields {

	/** Spreadsheet columns, in order. Mirrors the CSV export header. */
	public static function columns(): array {
		return [
			'id', 'type', 'parent_id', 'product', 'variation',
			'sku', 'regular_price', 'sale_price', 'stock_qty', 'stock_status', 'status',
			'on_category', 'lifestyle_image_id', 'fabric_group',
			'price_eur', 'sale_price_eur', 'price_usd', 'sale_price_usd',
			'card_title', 'catalog_order', 'manage_stock', 'backorders',
			'sale_from', 'sale_to',
		];
	}

	/** Writable column => internal editor field. Mirrors the CSV import map. */
	public static function editable_map(): array {
		return [
			'sku'                => 'sku',
			'regular_price'      => 'regular_price',
			'sale_price'         => 'sale_price',
			'stock_qty'          => 'stock_qty',
			'stock_status'       => 'stock_status',
			'status'             => 'status',
			'on_category'        => 'acvs_show',
			'lifestyle_image_id' => 'acvs_lifestyle',
			'fabric_group'       => 'acvs_fabric_group',
			'price_eur'          => 'price_eur',
			'sale_price_eur'     => 'sale_price_eur',
			'price_usd'          => 'price_usd',
			'sale_price_usd'     => 'sale_price_usd',
			'card_title'         => 'acvs_card_title',
			'catalog_order'      => 'acvs_catalog_order',
			'manage_stock'       => 'manage_stock',
			'backorders'         => 'backorders',
			'sale_from'          => 'sale_from',
			'sale_to'            => 'sale_to',
		];
	}

	/** Columns compared numerically (everything else compares as a string). */
	private static function numeric_columns(): array {
		return [ 'regular_price', 'sale_price', 'stock_qty', 'price_eur', 'sale_price_eur', 'price_usd', 'sale_price_usd' ];
	}

	/**
	 * Current value of a column for a product, as a string. Used both for the
	 * data sent to the sheet and for the live value compared on push, so equal
	 * values always serialise identically. $parent is only needed for the
	 * display columns (product / variation).
	 */
	public static function read( WC_Product $p, string $column, ?WC_Product $parent = null ): string {
		switch ( $column ) {
			case 'id':            return (string) $p->get_id();
			case 'type':          return $p->is_type( 'variation' ) ? 'variation' : 'simple';
			case 'parent_id':     return $parent ? (string) $parent->get_id() : '';
			case 'product':       return $parent ? $parent->get_name() : $p->get_name();
			case 'variation':     return self::variation_label( $p );
			case 'sku':           return (string) $p->get_sku();
			case 'regular_price': return (string) $p->get_regular_price();
			case 'sale_price':    return (string) $p->get_sale_price();
			case 'stock_qty':     return $p->get_manage_stock() ? (string) wc_stock_amount( $p->get_stock_quantity() ) : '';
			case 'stock_status':  return $p->get_stock_status();
			case 'status':        return $p->get_status();
			case 'on_category':   return $p->get_meta( OCTWBE_ACVS_SHOW ) === 'yes' ? 'yes' : 'no';
			case 'lifestyle_image_id': return (string) ( (int) $p->get_meta( OCTWBE_ACVS_LIFESTYLE ) ?: '' );
			case 'fabric_group':  return (string) $p->get_meta( '_ac_fabric_group_key' );
			case 'price_eur':      return self::currency_price( $p, '_regular_currency_prices', 'EUR' );
			case 'sale_price_eur': return self::currency_price( $p, '_sale_currency_prices', 'EUR' );
			case 'price_usd':      return self::currency_price( $p, '_regular_currency_prices', 'USD' );
			case 'sale_price_usd': return self::currency_price( $p, '_sale_currency_prices', 'USD' );
			case 'card_title':    return (string) $p->get_meta( '_acvs_card_title' );
			case 'catalog_order':
				return $p->is_type( 'variation' )
					? (string) $p->get_meta( '_acvs_catalog_order' )
					: ( $p->get_menu_order() ? (string) $p->get_menu_order() : '' );
			case 'manage_stock':  return $p->get_manage_stock() ? 'yes' : 'no';
			case 'backorders':    return $p->get_backorders() ?: 'no';
			case 'sale_from':     return $p->get_date_on_sale_from() ? $p->get_date_on_sale_from()->date( 'Y-m-d H:i' ) : '';
			case 'sale_to':       return $p->get_date_on_sale_to() ? $p->get_date_on_sale_to()->date( 'Y-m-d H:i' ) : '';
		}
		return '';
	}

	/** One currency's price from an Aelia serialized price map (e.g. EUR / USD). */
	private static function currency_price( WC_Product $p, string $meta_key, string $currency ): string {
		$prices = $p->get_meta( $meta_key );
		return is_array( $prices ) && isset( $prices[ $currency ] ) ? (string) $prices[ $currency ] : '';
	}

	/** The "Attr: value / …" label used in the CSV variation column. */
	private static function variation_label( WC_Product $p ): string {
		if ( ! $p->is_type( 'variation' ) ) {
			return '';
		}
		$bits = [];
		foreach ( $p->get_variation_attributes() as $key => $val ) {
			$tax    = str_replace( 'attribute_', '', $key );
			$bits[] = wc_attribute_label( $tax ) . ': ' . $val;
		}
		return implode( ' / ', $bits );
	}

	/** Do two values for a column mean the same thing? */
	public static function matches( string $column, string $a, string $b ): bool {
		$a = trim( $a );
		$b = trim( $b );
		if ( in_array( $column, self::numeric_columns(), true ) ) {
			if ( $a === '' || $b === '' ) {
				return $a === $b;
			}
			return (float) $a === (float) $b;
		}
		return $a === $b;
	}
}
