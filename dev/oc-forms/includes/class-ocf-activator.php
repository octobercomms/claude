<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCF_Activator {

	public static function activate() {
		global $wpdb;
		$charset_collate = $wpdb->get_charset_collate();
		$submissions     = $wpdb->prefix . 'ocf_submissions';
		$uploads         = $wpdb->prefix . 'ocf_uploads';
		$events          = $wpdb->prefix . 'ocf_events';
		$views           = $wpdb->prefix . 'ocf_views';

		$sql = "CREATE TABLE {$submissions} (
			id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			form_id BIGINT(20) UNSIGNED NOT NULL,
			token VARCHAR(64) NOT NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'partial',
			email VARCHAR(255) DEFAULT NULL,
			payload LONGTEXT NULL,
			meta LONGTEXT NULL,
			ip_address VARCHAR(64) DEFAULT NULL,
			user_agent VARCHAR(255) DEFAULT NULL,
			referrer TEXT NULL,
			step_reached TINYINT UNSIGNED NOT NULL DEFAULT 0,
			seconds_active INT UNSIGNED NOT NULL DEFAULT 0,
			session_hash VARCHAR(64) DEFAULT NULL,
			created_at DATETIME NOT NULL,
			updated_at DATETIME NOT NULL,
			completed_at DATETIME DEFAULT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY token (token),
			KEY form_id (form_id),
			KEY status (status),
			KEY email (email),
			KEY session_hash (session_hash)
		) {$charset_collate};

		CREATE TABLE {$views} (
			id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			form_id BIGINT(20) UNSIGNED NOT NULL,
			session_hash VARCHAR(64) NOT NULL,
			submission_id BIGINT(20) UNSIGNED DEFAULT NULL,
			ip_address VARCHAR(64) DEFAULT NULL,
			user_agent VARCHAR(255) DEFAULT NULL,
			referrer TEXT NULL,
			created_at DATETIME NOT NULL,
			PRIMARY KEY  (id),
			KEY form_id (form_id),
			KEY session_hash (session_hash),
			KEY created_at (created_at),
			KEY form_session (form_id, session_hash)
		) {$charset_collate};

		CREATE TABLE {$uploads} (
			id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			submission_id BIGINT(20) UNSIGNED NOT NULL,
			question_id VARCHAR(64) NOT NULL,
			filename VARCHAR(255) NOT NULL,
			original_name VARCHAR(255) NOT NULL,
			mime_type VARCHAR(120) NOT NULL,
			size_bytes BIGINT(20) UNSIGNED NOT NULL,
			path TEXT NOT NULL,
			url TEXT NOT NULL,
			created_at DATETIME NOT NULL,
			PRIMARY KEY  (id),
			KEY submission_id (submission_id)
		) {$charset_collate};

		CREATE TABLE {$events} (
			id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			submission_id BIGINT(20) UNSIGNED NOT NULL,
			event_type VARCHAR(60) NOT NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'pending',
			payload LONGTEXT NULL,
			response LONGTEXT NULL,
			attempts INT UNSIGNED NOT NULL DEFAULT 0,
			next_attempt_at DATETIME DEFAULT NULL,
			created_at DATETIME NOT NULL,
			updated_at DATETIME NOT NULL,
			PRIMARY KEY  (id),
			KEY submission_id (submission_id),
			KEY status (status),
			KEY next_attempt_at (next_attempt_at)
		) {$charset_collate};";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );

		self::ensure_upload_dir();
		update_option( 'ocf_db_version', OCF_DB_VERSION );

		if ( ! wp_next_scheduled( 'ocf_retry_events' ) ) {
			wp_schedule_event( time() + 60, 'hourly', 'ocf_retry_events' );
		}
	}

	public static function deactivate() {
		$ts = wp_next_scheduled( 'ocf_retry_events' );
		if ( $ts ) {
			wp_unschedule_event( $ts, 'ocf_retry_events' );
		}
	}

	public static function ensure_upload_dir() {
		$upload = wp_upload_dir();
		$base   = trailingslashit( $upload['basedir'] ) . 'ocf';
		if ( ! file_exists( $base ) ) {
			wp_mkdir_p( $base );
		}
		// Block direct PHP execution + listing.
		$htaccess = $base . '/.htaccess';
		if ( ! file_exists( $htaccess ) ) {
			file_put_contents( $htaccess, "Options -Indexes\n<FilesMatch \"\\.(php|phtml|phar|pl|py|cgi|sh)$\">\nDeny from all\n</FilesMatch>\n" );
		}
		$index = $base . '/index.html';
		if ( ! file_exists( $index ) ) {
			file_put_contents( $index, '' );
		}
	}
}
