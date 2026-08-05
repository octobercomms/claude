<?php
/**
 * Custom tables for the project side (Hillcroft-style, not a CPT).
 *
 * A CPT + postmeta made the funnel, the started-vs-submitted split, event
 * tracking and date-toggled analytics awkward. Real tables make those cheap:
 *
 *   {prefix}yaa_projects  one row per visitor (cookie/uuid), with the status
 *                         state-machine, denormalised columns for fast lists +
 *                         reporting, and the conversation/state/package as JSON.
 *   {prefix}yaa_events    an append-only audit + funnel log (created, submitted,
 *                         status_change, and — in later phases — email_opened,
 *                         link_clicked, paid, file_uploaded).
 *
 * install() runs on activation and whenever YAA_VERSION moves, via dbDelta.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_DB {

	const SCHEMA_OPTION = 'yaa_db_version';
	const SCHEMA        = '1';

	public static function projects_table() {
		global $wpdb;
		return $wpdb->prefix . 'yaa_projects';
	}
	public static function events_table() {
		global $wpdb;
		return $wpdb->prefix . 'yaa_events';
	}

	/** Create/upgrade the tables. Safe to call repeatedly (dbDelta diffs). */
	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$charset = $wpdb->get_charset_collate();
		$projects = self::projects_table();
		$events   = self::events_table();

		$sql_projects = "CREATE TABLE {$projects} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			uuid CHAR(36) NOT NULL,
			ref VARCHAR(20) NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'partial',
			name VARCHAR(190) NULL,
			email VARCHAR(190) NULL,
			postcode VARCHAR(190) NULL,
			london TINYINT(1) NOT NULL DEFAULT 0,
			listed TINYINT(1) NOT NULL DEFAULT 0,
			conservation TINYINT(1) NOT NULL DEFAULT 0,
			project_type VARCHAR(40) NULL,
			package VARCHAR(20) NULL,
			total INT NOT NULL DEFAULT 0,
			state_json LONGTEXT NULL,
			messages_json LONGTEXT NULL,
			package_json LONGTEXT NULL,
			created DATETIME NOT NULL,
			updated DATETIME NOT NULL,
			submitted_at DATETIME NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY uuid (uuid),
			KEY status (status),
			KEY email (email),
			KEY created (created),
			KEY submitted_at (submitted_at)
		) {$charset};";

		$sql_events = "CREATE TABLE {$events} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			project_id BIGINT UNSIGNED NOT NULL,
			type VARCHAR(40) NOT NULL,
			meta_json LONGTEXT NULL,
			created DATETIME NOT NULL,
			PRIMARY KEY  (id),
			KEY project_id (project_id),
			KEY type (type),
			KEY created (created)
		) {$charset};";

		dbDelta( $sql_projects );
		dbDelta( $sql_events );

		update_option( self::SCHEMA_OPTION, self::SCHEMA );
	}

	/** Run the installer if the plugin was upgraded without re-activation. */
	public static function maybe_upgrade() {
		if ( get_option( self::SCHEMA_OPTION ) !== self::SCHEMA ) {
			self::install();
		}
	}
}
