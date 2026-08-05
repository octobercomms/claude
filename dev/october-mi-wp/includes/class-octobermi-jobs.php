<?php
/**
 * Background job runner.
 *
 * Everything expensive — model calls, learning the site, the whole content
 * pipeline — runs here, never in a page request. A job is queued, WP-Cron picks
 * it up (nudged immediately with spawn_cron so it feels instant), a registered
 * handler runs it, and progress/result are written back for the admin UI to poll.
 *
 * Handlers are registered by modules in their boot() so they exist in the cron
 * request too. A job with no handler (its module switched off) simply stays
 * queued until the module is on again.
 *
 * Storage: a single custom table. Kept deliberately small; old finished jobs are
 * trimmed so it never grows unbounded.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OctoberMI_Jobs {

	const CRON_HOOK = 'octobermi_run_job';
	const DB_OPTION = 'octobermi_jobs_db_version';
	const DB_VERSION = '1';

	/** @var array<string,callable> type => handler( array $job, int $job_id ) */
	protected static $handlers = array();

	/** Wire the cron handler. Called once, unconditionally, from the main file. */
	public static function init() {
		add_action( self::CRON_HOOK, array( __CLASS__, 'run' ) );
		add_action( 'plugins_loaded', array( __CLASS__, 'maybe_install' ), 5 );
	}

	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'octobermi_jobs';
	}

	/** Create/upgrade the jobs table when the schema version changes. */
	public static function maybe_install() {
		if ( get_option( self::DB_OPTION ) === self::DB_VERSION ) {
			return;
		}
		global $wpdb;
		$table   = self::table();
		$charset = $wpdb->get_charset_collate();

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( "CREATE TABLE {$table} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			type VARCHAR(64) NOT NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'queued',
			progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
			note VARCHAR(255) NOT NULL DEFAULT '',
			payload LONGTEXT NULL,
			result LONGTEXT NULL,
			error TEXT NULL,
			created_at DATETIME NOT NULL,
			updated_at DATETIME NOT NULL,
			PRIMARY KEY  (id),
			KEY type_status (type, status)
		) {$charset};" );

		update_option( self::DB_OPTION, self::DB_VERSION, false );
	}

	/** Register a handler for a job type. Modules call this from boot(). */
	public static function register_handler( $type, $handler ) {
		self::$handlers[ $type ] = $handler;
	}

	/**
	 * Queue a job and nudge cron to run it now. Returns the new job id.
	 */
	public static function enqueue( $type, array $payload = array() ) {
		global $wpdb;
		$now = current_time( 'mysql', true );
		$wpdb->insert( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			self::table(),
			array(
				'type'       => (string) $type,
				'status'     => 'queued',
				'progress'   => 0,
				'note'       => '',
				'payload'    => wp_json_encode( $payload ),
				'created_at' => $now,
				'updated_at' => $now,
			),
			array( '%s', '%s', '%d', '%s', '%s', '%s', '%s' )
		);
		$job_id = (int) $wpdb->insert_id;

		if ( ! wp_next_scheduled( self::CRON_HOOK, array( $job_id ) ) ) {
			wp_schedule_single_event( time(), self::CRON_HOOK, array( $job_id ) );
		}
		if ( ! defined( 'DISABLE_WP_CRON' ) || ! DISABLE_WP_CRON ) {
			spawn_cron(); // fire it (near-)immediately rather than waiting for traffic
		}

		return $job_id;
	}

	/** Cron entry point: run a single job. Idempotent — only 'queued' runs. */
	public static function run( $job_id ) {
		$job_id = (int) $job_id;
		$job    = self::get( $job_id );
		if ( ! $job || 'queued' !== $job['status'] ) {
			return;
		}
		self::update( $job_id, array( 'status' => 'running', 'progress' => 1 ) );

		if ( empty( self::$handlers[ $job['type'] ] ) ) {
			self::fail( $job_id, __( 'No handler registered for this job type (is the module switched on?).', 'october-mi' ) );
			return;
		}

		try {
			$result = call_user_func( self::$handlers[ $job['type'] ], $job, $job_id );
			self::update( $job_id, array(
				'status'   => 'done',
				'progress' => 100,
				'result'   => wp_json_encode( $result ),
				'note'     => '',
			) );
		} catch ( Throwable $e ) {
			self::fail( $job_id, $e->getMessage() );
		}

		self::trim();
	}

	// --- progress / state -------------------------------------------------

	public static function progress( $job_id, $pct, $note = '' ) {
		self::update( (int) $job_id, array(
			'progress' => max( 0, min( 100, (int) $pct ) ),
			'note'     => (string) $note,
		) );
	}

	private static function fail( $job_id, $message ) {
		self::update( $job_id, array(
			'status' => 'error',
			'error'  => (string) $message,
		) );
		OctoberMI_Log::error( 'job.' . $job_id, 'Job failed', array( 'message' => (string) $message ) );
	}

	private static function update( $job_id, array $fields ) {
		global $wpdb;
		$fields['updated_at'] = current_time( 'mysql', true );
		$wpdb->update( self::table(), $fields, array( 'id' => (int) $job_id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
	}

	/** @return array|null decoded job row (payload/result decoded to arrays). */
	public static function get( $job_id ) {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::table() . ' WHERE id = %d', (int) $job_id ), ARRAY_A ); // phpcs:ignore WordPress.DB
		return $row ? self::hydrate( $row ) : null;
	}

	/** @return array|null the most recent job of a type. */
	public static function latest_of_type( $type ) {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::table() . ' WHERE type = %s ORDER BY id DESC LIMIT 1', (string) $type ), ARRAY_A ); // phpcs:ignore WordPress.DB
		return $row ? self::hydrate( $row ) : null;
	}

	/** How many jobs of a type were created in the last N seconds (rate guard). */
	public static function count_recent( $type, $seconds ) {
		global $wpdb;
		$since = gmdate( 'Y-m-d H:i:s', time() - (int) $seconds );
		return (int) $wpdb->get_var( $wpdb->prepare( // phpcs:ignore WordPress.DB
			'SELECT COUNT(*) FROM ' . self::table() . ' WHERE type = %s AND created_at >= %s',
			(string) $type,
			$since
		) );
	}

	private static function hydrate( array $row ) {
		$row['payload'] = $row['payload'] ? json_decode( $row['payload'], true ) : array();
		$row['result']  = $row['result'] ? json_decode( $row['result'], true ) : null;
		return $row;
	}

	/** Keep only the most recent 200 jobs. */
	private static function trim() {
		global $wpdb;
		$table = self::table();
		$wpdb->query( "DELETE FROM {$table} WHERE id < ( SELECT id FROM ( SELECT id FROM {$table} ORDER BY id DESC LIMIT 1 OFFSET 200 ) t )" ); // phpcs:ignore WordPress.DB
	}
}
