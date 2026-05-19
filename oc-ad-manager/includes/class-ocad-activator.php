<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCAD_Activator {

	public static function activate() {
		global $wpdb;
		$charset = $wpdb->get_charset_collate();

		$campaigns_table = $wpdb->prefix . 'ocad_campaigns';
		$ads_table       = $wpdb->prefix . 'ocad_ads';
		$tracking_table  = $wpdb->prefix . 'ocad_tracking';

		$sql = "
			CREATE TABLE {$campaigns_table} (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				name varchar(255) NOT NULL,
				client_name varchar(255) NOT NULL DEFAULT '',
				url varchar(500) NOT NULL,
				status varchar(20) NOT NULL DEFAULT 'active',
				start_date date DEFAULT NULL,
				end_date date DEFAULT NULL,
				max_impressions bigint(20) DEFAULT NULL,
				max_clicks bigint(20) DEFAULT NULL,
				restrict_impressions tinyint(1) NOT NULL DEFAULT 0,
				restrict_clicks tinyint(1) NOT NULL DEFAULT 0,
				created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
				PRIMARY KEY (id),
				KEY status (status)
			) {$charset};

			CREATE TABLE {$ads_table} (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				campaign_id bigint(20) unsigned NOT NULL,
				format varchar(50) NOT NULL,
				image_url varchar(500) NOT NULL,
				alt_text varchar(255) NOT NULL DEFAULT '',
				created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
				PRIMARY KEY (id),
				KEY campaign_id (campaign_id),
				KEY format (format),
				UNIQUE KEY campaign_format (campaign_id, format)
			) {$charset};

			CREATE TABLE {$tracking_table} (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				campaign_id bigint(20) unsigned NOT NULL,
				ad_id bigint(20) unsigned NOT NULL,
				type varchar(20) NOT NULL,
				ip_hash varchar(64) DEFAULT NULL,
				user_agent_hash varchar(64) DEFAULT NULL,
				source_url varchar(500) DEFAULT NULL,
				created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
				PRIMARY KEY (id),
				KEY campaign_type (campaign_id, type),
				KEY ad_type (ad_id, type),
				KEY created_at (created_at)
			) {$charset};
		";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );

		update_option( 'ocad_version', OCAD_VERSION );
	}

	public static function deactivate() {
		// Tables are preserved on deactivation; only removed on uninstall.
	}
}
