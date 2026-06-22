<?php
/**
 * Data store for generated payment links.
 *
 * Each row is one Stripe payment link we created: who it's for, the note shown
 * to the customer, the amount, the Stripe IDs/URL and the latest payment status.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ARPL_Store {

	const DB_VERSION_OPTION = 'arpl_db_version';
	const DB_VERSION        = '1';

	/** Fully-qualified table name. */
	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'arpl_links';
	}

	/**
	 * Create the table. Safe to run repeatedly (dbDelta).
	 */
	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$table   = self::table();
		$charset = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$table} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			created_at DATETIME NOT NULL,
			created_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
			customer VARCHAR(191) NOT NULL DEFAULT '',
			note TEXT NULL,
			amount BIGINT UNSIGNED NOT NULL DEFAULT 0,
			currency VARCHAR(3) NOT NULL DEFAULT 'gbp',
			mode VARCHAR(8) NOT NULL DEFAULT 'live',
			stripe_price_id VARCHAR(191) NOT NULL DEFAULT '',
			stripe_link_id VARCHAR(191) NOT NULL DEFAULT '',
			url TEXT NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'unpaid',
			amount_paid BIGINT UNSIGNED NULL,
			paid_at DATETIME NULL,
			checked_at DATETIME NULL,
			active TINYINT(1) NOT NULL DEFAULT 1,
			PRIMARY KEY  (id),
			KEY status (status),
			KEY stripe_link_id (stripe_link_id)
		) {$charset};";

		dbDelta( $sql );
		update_option( self::DB_VERSION_OPTION, self::DB_VERSION );
	}

	/**
	 * Run install() when the stored schema version is behind the code.
	 */
	public static function maybe_upgrade() {
		if ( get_option( self::DB_VERSION_OPTION ) !== self::DB_VERSION ) {
			self::install();
		}
	}

	/**
	 * Insert a new link row. Returns the new row ID.
	 *
	 * @param array $data Already-sanitised values.
	 */
	public static function insert( array $data ) {
		global $wpdb;
		$wpdb->insert(
			self::table(),
			[
				'created_at'      => current_time( 'mysql' ),
				'created_by'      => get_current_user_id(),
				'customer'        => $data['customer'],
				'note'            => $data['note'],
				'amount'          => $data['amount'],
				'currency'        => $data['currency'],
				'mode'            => $data['mode'],
				'stripe_price_id' => $data['stripe_price_id'],
				'stripe_link_id'  => $data['stripe_link_id'],
				'url'             => $data['url'],
				'status'          => 'unpaid',
				'active'          => 1,
			],
			[ '%s', '%d', '%s', '%s', '%d', '%s', '%s', '%s', '%s', '%s', '%s', '%d' ]
		);
		return (int) $wpdb->insert_id;
	}

	public static function get( $id ) {
		global $wpdb;
		return $wpdb->get_row(
			$wpdb->prepare( 'SELECT * FROM ' . self::table() . ' WHERE id = %d', $id )
		);
	}

	/**
	 * @return array Rows ordered newest-first.
	 */
	public static function all( $limit = 200 ) {
		global $wpdb;
		return $wpdb->get_results(
			$wpdb->prepare( 'SELECT * FROM ' . self::table() . ' ORDER BY id DESC LIMIT %d', $limit )
		);
	}

	public static function update( $id, array $fields, array $formats ) {
		global $wpdb;
		return $wpdb->update( self::table(), $fields, [ 'id' => $id ], $formats, [ '%d' ] );
	}

	public static function delete( $id ) {
		global $wpdb;
		return $wpdb->delete( self::table(), [ 'id' => $id ], [ '%d' ] );
	}
}
