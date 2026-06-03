<?php
/**
 * Project model — CRUD over the hgd_projects table. One garden for one client.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Project {

	/** Ordered lifecycle. */
	const STATUSES = array(
		'lead'        => 'Lead',
		'enquiry'     => 'Enquiry',
		'booked'      => 'Consultation booked',
		'capture'     => 'Capture',
		'design'      => 'Design',
		'rendered'    => 'Rendered',
		'proposed'    => 'Proposed',
		'accepted'    => 'Accepted',
		'in_progress' => 'In progress',
		'complete'    => 'Complete',
	);

	const SOURCES = array(
		'manual'        => 'Manual',
		'enquiry_form'  => 'Enquiry form',
		'booking'       => 'Consultation booking',
	);

	public static function fields() {
		return array(
			'client_id'    => 'int',
			'title'        => 'text',
			'status'       => 'text',
			'source'       => 'text',
			'address'      => 'text',
			'postcode'     => 'text',
			'budget_range' => 'text',
			'style_prefs'  => 'text',
			'has_pets'     => 'bool',
			'has_children' => 'bool',
			'brief_notes'  => 'textarea',
		);
	}

	public static function sanitise( array $raw ) {
		$clean = array();
		foreach ( self::fields() as $key => $type ) {
			$value = isset( $raw[ $key ] ) ? wp_unslash( $raw[ $key ] ) : '';
			switch ( $type ) {
				case 'int':
					$clean[ $key ] = $value ? (int) $value : null;
					break;
				case 'bool':
					$clean[ $key ] = empty( $value ) ? 0 : 1;
					break;
				case 'textarea':
					$clean[ $key ] = sanitize_textarea_field( $value );
					break;
				default:
					$clean[ $key ] = sanitize_text_field( $value );
			}
		}
		if ( ! isset( self::STATUSES[ $clean['status'] ] ) ) {
			$clean['status'] = 'lead';
		}
		if ( ! isset( self::SOURCES[ $clean['source'] ] ) ) {
			$clean['source'] = 'manual';
		}
		return $clean;
	}

	public static function get( $id ) {
		global $wpdb;
		$table = HGD_DB::projects_table();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", $id ), ARRAY_A );
	}

	/**
	 * @param array $args status, search, orderby, order
	 */
	public static function query( array $args = array() ) {
		global $wpdb;
		$p = HGD_DB::projects_table();
		$c = HGD_DB::clients_table();

		$args = wp_parse_args( $args, array(
			'status'  => '',
			'search'  => '',
			'orderby' => 'created_at',
			'order'   => 'DESC',
		) );

		$where  = '1=1';
		$params = array();

		if ( '' !== $args['status'] && isset( self::STATUSES[ $args['status'] ] ) ) {
			$where   .= ' AND p.status = %s';
			$params[] = $args['status'];
		}
		if ( '' !== $args['search'] ) {
			$like   = '%' . $wpdb->esc_like( $args['search'] ) . '%';
			$where .= ' AND (p.title LIKE %s OR c.first_name LIKE %s OR c.last_name LIKE %s OR c.email LIKE %s)';
			array_push( $params, $like, $like, $like, $like );
		}

		$orderby = in_array( $args['orderby'], array( 'created_at', 'title', 'status' ), true ) ? $args['orderby'] : 'created_at';
		$order   = strtoupper( $args['order'] ) === 'ASC' ? 'ASC' : 'DESC';

		$sql = "SELECT p.*, c.first_name, c.last_name, c.email
			FROM {$p} p LEFT JOIN {$c} c ON c.id = p.client_id
			WHERE {$where} ORDER BY p.{$orderby} {$order}";

		$rows = $params ? $wpdb->get_results( $wpdb->prepare( $sql, $params ), ARRAY_A ) : $wpdb->get_results( $sql, ARRAY_A );
		return $rows ? $rows : array();
	}

	public static function insert( array $clean ) {
		global $wpdb;
		$now                 = current_time( 'mysql' );
		$clean['created_at'] = $now;
		$clean['updated_at'] = $now;
		$wpdb->insert( HGD_DB::projects_table(), $clean );
		return (int) $wpdb->insert_id;
	}

	public static function update( $id, array $clean ) {
		global $wpdb;
		$clean['updated_at'] = current_time( 'mysql' );
		return false !== $wpdb->update( HGD_DB::projects_table(), $clean, array( 'id' => (int) $id ) );
	}

	public static function delete( $id ) {
		global $wpdb;
		return false !== $wpdb->delete( HGD_DB::projects_table(), array( 'id' => (int) $id ) );
	}

	public static function count( $status = '' ) {
		global $wpdb;
		$table = HGD_DB::projects_table();
		if ( '' !== $status ) {
			return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$table} WHERE status = %s", $status ) );
		}
		return (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" );
	}

	/** Count of open (not complete) projects. */
	public static function count_open() {
		global $wpdb;
		$table = HGD_DB::projects_table();
		return (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table} WHERE status <> 'complete'" );
	}

	public static function status_label( $status ) {
		return isset( self::STATUSES[ $status ] ) ? self::STATUSES[ $status ] : ucfirst( $status );
	}
}
