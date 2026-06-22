<?php
/**
 * Data store for generated payment links and their activity events.
 *
 * Two tables:
 *   - {prefix}arpl_links  — one row per Stripe payment link we created.
 *   - {prefix}arpl_events — activity log (sent / reminder / opened / clicked /
 *                           paid) so staff can see whether to chase a customer.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ARPL_Store {

	const DB_VERSION_OPTION = 'arpl_db_version';
	const DB_VERSION        = '2';

	/** Activity event types. */
	const EVENTS = [ 'sent', 'reminder', 'opened', 'clicked', 'paid' ];

	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'arpl_links';
	}

	public static function events_table() {
		global $wpdb;
		return $wpdb->prefix . 'arpl_events';
	}

	/**
	 * Create / update both tables. Safe to run repeatedly (dbDelta).
	 */
	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$charset = $wpdb->get_charset_collate();
		$links   = self::table();
		$events  = self::events_table();

		$sql_links = "CREATE TABLE {$links} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			created_at DATETIME NOT NULL,
			created_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
			customer VARCHAR(191) NOT NULL DEFAULT '',
			email VARCHAR(191) NOT NULL DEFAULT '',
			note TEXT NULL,
			amount BIGINT UNSIGNED NOT NULL DEFAULT 0,
			currency VARCHAR(3) NOT NULL DEFAULT 'gbp',
			mode VARCHAR(8) NOT NULL DEFAULT 'live',
			stripe_price_id VARCHAR(191) NOT NULL DEFAULT '',
			stripe_link_id VARCHAR(191) NOT NULL DEFAULT '',
			url TEXT NULL,
			token VARCHAR(32) NOT NULL DEFAULT '',
			status VARCHAR(20) NOT NULL DEFAULT 'unpaid',
			amount_paid BIGINT UNSIGNED NULL,
			paid_at DATETIME NULL,
			checked_at DATETIME NULL,
			active TINYINT(1) NOT NULL DEFAULT 1,
			PRIMARY KEY  (id),
			KEY status (status),
			KEY token (token),
			KEY stripe_link_id (stripe_link_id)
		) {$charset};";

		$sql_events = "CREATE TABLE {$events} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			link_id BIGINT UNSIGNED NOT NULL,
			type VARCHAR(20) NOT NULL,
			created_at DATETIME NOT NULL,
			meta VARCHAR(255) NULL,
			PRIMARY KEY  (id),
			KEY link_id (link_id),
			KEY type (type)
		) {$charset};";

		dbDelta( $sql_links );
		dbDelta( $sql_events );

		self::backfill_tokens();
		update_option( self::DB_VERSION_OPTION, self::DB_VERSION );
	}

	public static function maybe_upgrade() {
		if ( get_option( self::DB_VERSION_OPTION ) !== self::DB_VERSION ) {
			self::install();
		}
	}

	/** Give any pre-existing rows an unguessable tracking token. */
	private static function backfill_tokens() {
		global $wpdb;
		$table = self::table();
		$ids   = $wpdb->get_col( "SELECT id FROM {$table} WHERE token = '' OR token IS NULL" );
		foreach ( (array) $ids as $id ) {
			$wpdb->update( $table, [ 'token' => self::new_token() ], [ 'id' => (int) $id ], [ '%s' ], [ '%d' ] );
		}
	}

	public static function new_token() {
		return wp_generate_password( 24, false, false );
	}

	/**
	 * Insert a new link row. Returns the new row ID.
	 */
	public static function insert( array $data ) {
		global $wpdb;
		$wpdb->insert(
			self::table(),
			[
				'created_at'      => current_time( 'mysql' ),
				'created_by'      => get_current_user_id(),
				'customer'        => $data['customer'],
				'email'           => $data['email'],
				'note'            => $data['note'],
				'amount'          => $data['amount'],
				'currency'        => $data['currency'],
				'mode'            => $data['mode'],
				'stripe_price_id' => $data['stripe_price_id'],
				'stripe_link_id'  => $data['stripe_link_id'],
				'url'             => $data['url'],
				'token'           => self::new_token(),
				'status'          => 'unpaid',
				'active'          => 1,
			],
			[ '%s', '%d', '%s', '%s', '%s', '%d', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%d' ]
		);
		return (int) $wpdb->insert_id;
	}

	public static function get( $id ) {
		global $wpdb;
		return $wpdb->get_row(
			$wpdb->prepare( 'SELECT * FROM ' . self::table() . ' WHERE id = %d', $id )
		);
	}

	public static function get_by_token( $token ) {
		global $wpdb;
		if ( '' === (string) $token ) {
			return null;
		}
		return $wpdb->get_row(
			$wpdb->prepare( 'SELECT * FROM ' . self::table() . ' WHERE token = %s', $token )
		);
	}

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
		$wpdb->delete( self::events_table(), [ 'link_id' => $id ], [ '%d' ] );
		return $wpdb->delete( self::table(), [ 'id' => $id ], [ '%d' ] );
	}

	// ---- Events ------------------------------------------------------------

	public static function log_event( $link_id, $type, $meta = '' ) {
		global $wpdb;
		if ( ! in_array( $type, self::EVENTS, true ) ) {
			return;
		}
		$wpdb->insert(
			self::events_table(),
			[
				'link_id'    => (int) $link_id,
				'type'       => $type,
				'created_at' => current_time( 'mysql' ),
				'meta'       => substr( (string) $meta, 0, 255 ),
			],
			[ '%d', '%s', '%s', '%s' ]
		);
	}

	public static function has_event( $link_id, $type ) {
		global $wpdb;
		return (bool) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT 1 FROM ' . self::events_table() . ' WHERE link_id = %d AND type = %s LIMIT 1',
				$link_id,
				$type
			)
		);
	}

	/**
	 * Per-type summary for one link: count + first/last timestamps.
	 *
	 * @return array<string,array{count:int,first:?string,last:?string}>
	 */
	public static function event_summary( $link_id ) {
		global $wpdb;
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT type, COUNT(*) AS c, MIN(created_at) AS first_at, MAX(created_at) AS last_at
				 FROM ' . self::events_table() . ' WHERE link_id = %d GROUP BY type',
				$link_id
			)
		);
		$summary = [];
		foreach ( self::EVENTS as $type ) {
			$summary[ $type ] = [ 'count' => 0, 'first' => null, 'last' => null ];
		}
		foreach ( (array) $rows as $row ) {
			if ( isset( $summary[ $row->type ] ) ) {
				$summary[ $row->type ] = [
					'count' => (int) $row->c,
					'first' => $row->first_at,
					'last'  => $row->last_at,
				];
			}
		}
		return $summary;
	}
}
