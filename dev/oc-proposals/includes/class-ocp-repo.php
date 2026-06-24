<?php
/**
 * Tiny generic CRUD helper over a custom table. Keeps the library + CRM models
 * thin — each entity is described by a fields registry (see OCP_Library / OCP_Lead)
 * and this handles the database plumbing.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCP_Repo {

	public static function all( $table, $orderby = 'id DESC', $where = '' ) {
		global $wpdb;
		$orderby = preg_replace( '/[^A-Za-z0-9_ ,]/', '', (string) $orderby );
		$sql     = "SELECT * FROM {$table}";
		if ( $where ) {
			$sql .= " WHERE {$where}";
		}
		$sql .= " ORDER BY {$orderby}";
		return $wpdb->get_results( $sql, ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL
	}

	public static function get( $table, $id ) {
		global $wpdb;
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", (int) $id ), ARRAY_A );
	}

	public static function insert( $table, array $data ) {
		global $wpdb;
		$now = current_time( 'mysql' );
		if ( ! isset( $data['created_at'] ) && self::has_column( $table, 'created_at' ) ) {
			$data['created_at'] = $now;
		}
		if ( ! isset( $data['updated_at'] ) && self::has_column( $table, 'updated_at' ) ) {
			$data['updated_at'] = $now;
		}
		$wpdb->insert( $table, $data );
		return (int) $wpdb->insert_id;
	}

	public static function update( $table, $id, array $data ) {
		global $wpdb;
		if ( self::has_column( $table, 'updated_at' ) ) {
			$data['updated_at'] = current_time( 'mysql' );
		}
		return $wpdb->update( $table, $data, array( 'id' => (int) $id ) );
	}

	public static function delete( $table, $id ) {
		global $wpdb;
		return $wpdb->delete( $table, array( 'id' => (int) $id ) );
	}

	public static function count( $table, $where = '' ) {
		global $wpdb;
		$sql = "SELECT COUNT(*) FROM {$table}";
		if ( $where ) {
			$sql .= " WHERE {$where}";
		}
		return (int) $wpdb->get_var( $sql ); // phpcs:ignore WordPress.DB.PreparedSQL
	}

	/** Cache column existence per request to keep created/updated stamping safe. */
	private static $cols = array();
	private static function has_column( $table, $col ) {
		if ( ! isset( self::$cols[ $table ] ) ) {
			global $wpdb;
			$names = $wpdb->get_col( "DESCRIBE {$table}" ); // phpcs:ignore WordPress.DB.PreparedSQL
			self::$cols[ $table ] = is_array( $names ) ? $names : array();
		}
		return in_array( $col, self::$cols[ $table ], true );
	}
}
