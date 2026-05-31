<?php
/**
 * Client (CRM) model — CRUD over the hgd_clients table.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Client {

	public static function fields() {
		return array(
			'first_name'    => 'text',
			'last_name'     => 'text',
			'email'         => 'email',
			'phone'         => 'text',
			'address_line1' => 'text',
			'address_line2' => 'text',
			'city'          => 'text',
			'postcode'      => 'text',
			'notes'         => 'textarea',
		);
	}

	public static function sanitise( array $raw ) {
		$clean = array();
		foreach ( self::fields() as $key => $type ) {
			$value = isset( $raw[ $key ] ) ? wp_unslash( $raw[ $key ] ) : '';
			switch ( $type ) {
				case 'email':
					$clean[ $key ] = sanitize_email( $value );
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

	public static function get( $id ) {
		global $wpdb;
		$table = HGD_DB::clients_table();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", $id ), ARRAY_A );
	}

	public static function find_by_email( $email ) {
		global $wpdb;
		$table = HGD_DB::clients_table();
		$email = sanitize_email( $email );
		if ( '' === $email ) {
			return null;
		}
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE email = %s LIMIT 1", $email ), ARRAY_A );
	}

	public static function all( $orderby = 'last_name', $order = 'ASC' ) {
		global $wpdb;
		$table   = HGD_DB::clients_table();
		$allowed = array_merge( array_keys( self::fields() ), array( 'id', 'created_at' ) );
		$orderby = in_array( $orderby, $allowed, true ) ? $orderby : 'last_name';
		$order   = strtoupper( $order ) === 'DESC' ? 'DESC' : 'ASC';
		return $wpdb->get_results( "SELECT * FROM {$table} ORDER BY {$orderby} {$order}", ARRAY_A );
	}

	public static function insert( array $clean ) {
		global $wpdb;
		$now                 = current_time( 'mysql' );
		$clean['created_at'] = $now;
		$clean['updated_at'] = $now;
		$wpdb->insert( HGD_DB::clients_table(), $clean );
		return (int) $wpdb->insert_id;
	}

	public static function update( $id, array $clean ) {
		global $wpdb;
		$clean['updated_at'] = current_time( 'mysql' );
		return false !== $wpdb->update( HGD_DB::clients_table(), $clean, array( 'id' => (int) $id ) );
	}

	public static function delete( $id ) {
		global $wpdb;
		// Detach projects rather than delete them.
		$wpdb->update( HGD_DB::projects_table(), array( 'client_id' => null ), array( 'client_id' => (int) $id ) );
		return false !== $wpdb->delete( HGD_DB::clients_table(), array( 'id' => (int) $id ) );
	}

	/**
	 * Find a client by email or create one. Returns the client id.
	 */
	public static function find_or_create( array $clean ) {
		$existing = self::find_by_email( isset( $clean['email'] ) ? $clean['email'] : '' );
		if ( $existing ) {
			return (int) $existing['id'];
		}
		return self::insert( $clean );
	}

	public static function full_name( array $client ) {
		$name = trim( ( $client['first_name'] ?? '' ) . ' ' . ( $client['last_name'] ?? '' ) );
		return '' !== $name ? $name : ( $client['email'] ?? __( '(no name)', 'hillcroft-garden-designer' ) );
	}

	public static function count() {
		global $wpdb;
		return (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . HGD_DB::clients_table() );
	}
}
