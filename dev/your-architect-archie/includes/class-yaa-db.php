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
	const SCHEMA        = '2';

	public static function projects_table() {
		global $wpdb;
		return $wpdb->prefix . 'yaa_projects';
	}
	public static function events_table() {
		global $wpdb;
		return $wpdb->prefix . 'yaa_events';
	}
	public static function emails_table() {
		global $wpdb;
		return $wpdb->prefix . 'yaa_emails';
	}
	public static function files_table() {
		global $wpdb;
		return $wpdb->prefix . 'yaa_files';
	}

	/** Create/upgrade the tables. Safe to call repeatedly (dbDelta diffs). */
	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$charset  = $wpdb->get_charset_collate();
		$projects = self::projects_table();
		$events   = self::events_table();
		$emails   = self::emails_table();
		$files    = self::files_table();

		$sql_projects = "CREATE TABLE {$projects} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			uuid CHAR(36) NOT NULL,
			ref VARCHAR(20) NULL,
			token CHAR(32) NULL,
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
			paid TINYINT(1) NOT NULL DEFAULT 0,
			amount_paid INT NOT NULL DEFAULT 0,
			stripe_intent VARCHAR(190) NULL,
			stripe_session VARCHAR(190) NULL,
			state_json LONGTEXT NULL,
			messages_json LONGTEXT NULL,
			package_json LONGTEXT NULL,
			created DATETIME NOT NULL,
			updated DATETIME NOT NULL,
			submitted_at DATETIME NULL,
			approved_at DATETIME NULL,
			paid_at DATETIME NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY uuid (uuid),
			KEY token (token),
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

		$sql_emails = "CREATE TABLE {$emails} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			project_id BIGINT UNSIGNED NOT NULL,
			subject TEXT NULL,
			body LONGTEXT NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'draft',
			provider_id VARCHAR(190) NULL,
			opens INT NOT NULL DEFAULT 0,
			clicks INT NOT NULL DEFAULT 0,
			opened_at DATETIME NULL,
			clicked_at DATETIME NULL,
			created DATETIME NOT NULL,
			sent_at DATETIME NULL,
			PRIMARY KEY  (id),
			KEY project_id (project_id),
			KEY provider_id (provider_id)
		) {$charset};";

		$sql_files = "CREATE TABLE {$files} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			project_id BIGINT UNSIGNED NOT NULL,
			kind VARCHAR(20) NOT NULL DEFAULT 'drawing',
			label VARCHAR(190) NULL,
			source VARCHAR(190) NULL,
			attachment_id BIGINT UNSIGNED NULL,
			mime VARCHAR(100) NULL,
			size BIGINT UNSIGNED NOT NULL DEFAULT 0,
			gated TINYINT(1) NOT NULL DEFAULT 1,
			created DATETIME NOT NULL,
			PRIMARY KEY  (id),
			KEY project_id (project_id),
			KEY kind (kind)
		) {$charset};";

		dbDelta( $sql_projects );
		dbDelta( $sql_events );
		dbDelta( $sql_emails );
		dbDelta( $sql_files );

		update_option( self::SCHEMA_OPTION, self::SCHEMA );
	}

	/** Run the installer if the plugin was upgraded without re-activation. */
	public static function maybe_upgrade() {
		if ( get_option( self::SCHEMA_OPTION ) !== self::SCHEMA ) {
			self::install();
		}
	}
}
