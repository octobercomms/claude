<?php
/**
 * Shared field IO for the bulk editor.
 *
 * Centralises how a product field is read (in a canonical string form),
 * compared for conflict detection, and written. Both the admin-ajax editor
 * and the Google Sheets REST sync use this so the two paths always agree on
 * what a field's value is and how it gets saved.
 *
 * @package WooBulkEditor
 */

defined( 'ABSPATH' ) || exit;

class WBE_Fields {

	/** Fields the sheet / editor may write. */
	public static function editable_fields(): array {
		return [
			'regular_price',
			'sale_price',
			'sku',
			'stock_qty',
			'stock_status',
			'status',
			'date_on_sale_from',
			'date_on_sale_to',
		];
	}

	/** Columns exported to the spreadsheet, in order. */
	public static function sheet_fields(): array {
		return [
			'id',
			'type',
			'name',
			'sku',
			'regular_price',
			'sale_price',
			'stock_qty',
			'stock_status',
			'status',
			'date_on_sale_from',
			'date_on_sale_to',
		];
	}

	/**
	 * Canonical string value of a field for a product. Everything we send to
	 * the sheet and every live value we compare against on push runs through
	 * here, so two equal values always serialise identically.
	 */
	public static function current( WC_Product $p, string $field ): string {
		switch ( $field ) {
			case 'id':                return (string) $p->get_id();
			case 'type':              return $p->get_type();
			case 'name':              return $p->get_name();
			case 'sku':               return (string) $p->get_sku();
			case 'regular_price':     return self::num( $p->get_regular_price() );
			case 'sale_price':        return self::num( $p->get_sale_price() );
			case 'stock_qty':         return $p->get_manage_stock() ? (string) wc_stock_amount( $p->get_stock_quantity() ) : '';
			case 'stock_status':      return $p->get_stock_status();
			case 'status':            return $p->get_status();
			case 'date_on_sale_from': return self::date( $p->get_date_on_sale_from() );
			case 'date_on_sale_to':   return self::date( $p->get_date_on_sale_to() );
		}
		return '';
	}

	private static function num( $v ): string {
		return ( $v === '' || $v === null ) ? '' : (string) wc_format_decimal( $v );
	}

	private static function date( $d ): string {
		return $d ? $d->date( 'Y-m-d' ) : '';
	}

	/** Do two values for the same field mean the same thing? */
	public static function matches( string $field, string $a, string $b ): bool {
		if ( in_array( $field, [ 'regular_price', 'sale_price', 'stock_qty' ], true ) ) {
			$a = trim( $a );
			$b = trim( $b );
			if ( $a === '' || $b === '' ) {
				return $a === $b;
			}
			return (float) $a === (float) $b;
		}
		return trim( $a ) === trim( $b );
	}

	/**
	 * Apply a single field edit to a product. Does NOT save — the caller
	 * applies every field for a product, then saves once.
	 *
	 * @return true|WP_Error
	 */
	public static function apply( WC_Product $product, string $field, string $value ): true|WP_Error {
		$id = $product->get_id();

		switch ( $field ) {
			case 'regular_price':
				if ( $value !== '' && ! is_numeric( $value ) ) {
					return new WP_Error( 'invalid', "Invalid regular price for product {$id}." );
				}
				$product->set_regular_price( $value );
				break;

			case 'sale_price':
				if ( $value !== '' && ! is_numeric( $value ) ) {
					return new WP_Error( 'invalid', "Invalid sale price for product {$id}." );
				}
				$product->set_sale_price( $value );
				break;

			case 'sku':
				try {
					$product->set_sku( $value );
				} catch ( WC_Data_Exception $e ) {
					return new WP_Error( 'sku', $e->getMessage() );
				}
				break;

			case 'stock_qty':
				if ( $value !== '' ) {
					if ( ! is_numeric( $value ) ) {
						return new WP_Error( 'invalid', "Invalid stock qty for product {$id}." );
					}
					$product->set_manage_stock( true );
					$product->set_stock_quantity( (float) $value );
				} else {
					$product->set_manage_stock( false );
				}
				break;

			case 'stock_status':
				$allowed = [ 'instock', 'outofstock', 'onbackorder' ];
				if ( ! in_array( $value, $allowed, true ) ) {
					return new WP_Error( 'invalid', "Invalid stock status '{$value}'." );
				}
				$product->set_stock_status( $value );
				break;

			case 'status':
				$allowed = [ 'publish', 'draft', 'private', 'pending' ];
				if ( ! in_array( $value, $allowed, true ) ) {
					return new WP_Error( 'invalid', "Invalid status '{$value}'." );
				}
				$product->set_status( $value );
				break;

			case 'date_on_sale_from':
				if ( $value !== '' && ! self::valid_date( $value ) ) {
					return new WP_Error( 'invalid', "Invalid sale start date for product {$id} (use YYYY-MM-DD)." );
				}
				$product->set_date_on_sale_from( $value !== '' ? $value : null );
				break;

			case 'date_on_sale_to':
				if ( $value !== '' && ! self::valid_date( $value ) ) {
					return new WP_Error( 'invalid', "Invalid sale end date for product {$id} (use YYYY-MM-DD)." );
				}
				$product->set_date_on_sale_to( $value !== '' ? $value : null );
				break;

			default:
				return new WP_Error( 'field', "Field '{$field}' is not editable." );
		}

		return true;
	}

	private static function valid_date( string $v ): bool {
		$d = DateTime::createFromFormat( 'Y-m-d', $v );
		return $d && $d->format( 'Y-m-d' ) === $v;
	}
}
