<?php
/**
 * Versioned Terms & Conditions.
 *
 * A proposal snapshots the current terms version at send time, so later edits
 * never change what a client agreed to. The studio pastes its T&Cs in the admin;
 * each save that changes the body creates a new version and marks it current.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCP_Terms {

	public static function all() {
		return OCP_Repo::all( OCP_DB::terms_table(), 'id DESC' );
	}

	public static function get( $id ) {
		return OCP_Repo::get( OCP_DB::terms_table(), $id );
	}

	public static function current() {
		global $wpdb;
		$table = OCP_DB::terms_table();
		return $wpdb->get_row( "SELECT * FROM {$table} WHERE is_current = 1 ORDER BY id DESC LIMIT 1", ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL
	}

	/**
	 * Save the terms body. If it differs from the current version, create a new
	 * version (incrementing the version number) and make it current.
	 *
	 * @return int Version row id.
	 */
	public static function save_body( $body ) {
		$body    = wp_kses_post( $body );
		$current = self::current();
		if ( $current && trim( $current['body'] ) === trim( $body ) ) {
			return (int) $current['id'];
		}
		global $wpdb;
		$wpdb->update( OCP_DB::terms_table(), array( 'is_current' => 0 ), array( 'is_current' => 1 ) );
		$next = $current ? ( (int) $current['version'] + 1 ) : 1;
		return OCP_Repo::insert( OCP_DB::terms_table(), array(
			'version'    => (string) $next,
			'body'       => $body,
			'is_current' => 1,
		) );
	}

	/** Snapshot the current terms id onto a proposal (called when it's sent). */
	public static function snapshot_for( $proposal_id ) {
		$current = self::current();
		if ( $current ) {
			OCP_Proposal::update( $proposal_id, array( 'terms_version_id' => (int) $current['id'] ) );
		}
		return $current ? (int) $current['id'] : 0;
	}
}
