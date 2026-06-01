<?php
/**
 * Plant catalogue model — CRUD over the hgd_plants table.
 *
 * This is the in-plugin database Donna maintains (no CSV-upload-as-primary). It
 * is the source of truth for pricing. CSV import/export will be layered on later.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Plant {

	const TYPES = array( 'tree', 'shrub', 'perennial', 'grass', 'bulb', 'climber', 'hedging', 'aquatic' );
	const SUN   = array( 'full_sun', 'part_shade', 'shade' );
	const FOLIAGE = array( 'evergreen', 'deciduous', 'semi_evergreen' );
	const TOXICITY = array( 'none', 'pets', 'children', 'both' );

	/** Editable columns and their sanitiser type. */
	public static function fields() {
		return array(
			'botanical_name'   => 'text',
			'common_name'      => 'text',
			'plant_type'       => 'text',
			'pot_size'         => 'text',
			'unit_cost'        => 'money',
			'markup_pct'       => 'decimal',
			'supplier'         => 'text',
			'supplier_sku'     => 'text',
			'lead_time_days'   => 'int',
			'min_order_qty'    => 'int',
			'mature_height_cm' => 'int',
			'mature_spread_cm' => 'int',
			'spacing_per_sqm'  => 'decimal',
			'sun'              => 'text',
			'soil'             => 'text',
			'hardiness'        => 'text',
			'foliage'          => 'text',
			'flowering_months' => 'text',
			'toxicity'         => 'text',
			'gbif_id'          => 'text',
			'image_id'         => 'int',
			'notes'            => 'textarea',
		);
	}

	/**
	 * Sanitise a raw input array down to the known columns.
	 */
	public static function sanitise( array $raw ) {
		$clean = array();
		foreach ( self::fields() as $key => $type ) {
			$value = isset( $raw[ $key ] ) ? wp_unslash( $raw[ $key ] ) : '';
			switch ( $type ) {
				case 'int':
					$clean[ $key ] = (int) $value;
					break;
				case 'money':
				case 'decimal':
					$clean[ $key ] = round( (float) $value, 2 );
					break;
				case 'textarea':
					$clean[ $key ] = sanitize_textarea_field( $value );
					break;
				default:
					$clean[ $key ] = sanitize_text_field( $value );
			}
		}
		return $clean;
	}

	/**
	 * Column order for CSV export/import — the editable field keys in a sensible order.
	 *
	 * @return string[]
	 */
	public static function csv_headers() {
		return array_keys( self::fields() );
	}

	/**
	 * All plants (no paging), ordered by botanical name — used by CSV export.
	 *
	 * @return array[]
	 */
	public static function all() {
		global $wpdb;
		$table = HGD_DB::plants_table();
		$items = $wpdb->get_results( "SELECT * FROM {$table} ORDER BY botanical_name ASC", ARRAY_A );
		return $items ? $items : array();
	}

	public static function get( $id ) {
		global $wpdb;
		$table = HGD_DB::plants_table();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", $id ), ARRAY_A );
	}

	/**
	 * @param array $args search (string), type (string), orderby, order, per_page, page
	 * @return array{items: array, total: int}
	 */
	public static function query( array $args = array() ) {
		global $wpdb;
		$table = HGD_DB::plants_table();

		$args = wp_parse_args( $args, array(
			'search'   => '',
			'type'     => '',
			'orderby'  => 'botanical_name',
			'order'    => 'ASC',
			'per_page' => 25,
			'page'     => 1,
		) );

		$where  = '1=1';
		$params = array();

		if ( '' !== $args['search'] ) {
			$like   = '%' . $wpdb->esc_like( $args['search'] ) . '%';
			$where .= ' AND (botanical_name LIKE %s OR common_name LIKE %s OR supplier LIKE %s)';
			array_push( $params, $like, $like, $like );
		}
		if ( '' !== $args['type'] && in_array( $args['type'], self::TYPES, true ) ) {
			$where   .= ' AND plant_type = %s';
			$params[] = $args['type'];
		}

		$allowed_orderby = array_merge( array_keys( self::fields() ), array( 'id', 'updated_at' ) );
		$orderby = in_array( $args['orderby'], $allowed_orderby, true ) ? $args['orderby'] : 'botanical_name';
		$order   = strtoupper( $args['order'] ) === 'DESC' ? 'DESC' : 'ASC';

		$per_page = max( 1, (int) $args['per_page'] );
		$offset   = ( max( 1, (int) $args['page'] ) - 1 ) * $per_page;

		// Total (same WHERE).
		$count_sql = "SELECT COUNT(*) FROM {$table} WHERE {$where}";
		$total     = (int) ( $params ? $wpdb->get_var( $wpdb->prepare( $count_sql, $params ) ) : $wpdb->get_var( $count_sql ) );

		$sql         = "SELECT * FROM {$table} WHERE {$where} ORDER BY {$orderby} {$order} LIMIT %d OFFSET %d";
		$query_args  = array_merge( $params, array( $per_page, $offset ) );
		$items       = $wpdb->get_results( $wpdb->prepare( $sql, $query_args ), ARRAY_A );

		return array( 'items' => $items ? $items : array(), 'total' => $total );
	}

	public static function insert( array $clean ) {
		global $wpdb;
		$now             = current_time( 'mysql' );
		$clean['created_at'] = $now;
		$clean['updated_at'] = $now;
		$wpdb->insert( HGD_DB::plants_table(), $clean );
		return (int) $wpdb->insert_id;
	}

	public static function update( $id, array $clean ) {
		global $wpdb;
		$clean['updated_at'] = current_time( 'mysql' );
		return false !== $wpdb->update( HGD_DB::plants_table(), $clean, array( 'id' => (int) $id ) );
	}

	public static function delete( $id ) {
		global $wpdb;
		return false !== $wpdb->delete( HGD_DB::plants_table(), array( 'id' => (int) $id ) );
	}

	public static function count() {
		global $wpdb;
		$table = HGD_DB::plants_table();
		return (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" );
	}

	/** Sale price for one unit = cost + markup. */
	public static function unit_price( array $plant ) {
		$cost   = isset( $plant['unit_cost'] ) ? (float) $plant['unit_cost'] : 0;
		$markup = isset( $plant['markup_pct'] ) ? (float) $plant['markup_pct'] : 0;
		return round( $cost * ( 1 + $markup / 100 ), 2 );
	}
}
