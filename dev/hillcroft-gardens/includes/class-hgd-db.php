<?php
/**
 * Database schema + table-name helpers.
 *
 * The plant catalogue and API-usage log are stored in dedicated custom tables.
 * Projects, proposals, payments etc. will be added in later feature PRs.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_DB {

	/**
	 * Bump this whenever the schema changes so dbDelta re-runs on the next load.
	 */
	const SCHEMA_VERSION = '1';

	public static function plants_table() {
		global $wpdb;
		return $wpdb->prefix . 'hgd_plants';
	}

	public static function api_usage_table() {
		global $wpdb;
		return $wpdb->prefix . 'hgd_api_usage';
	}

	/**
	 * Return the dbDelta schema statements for all tables.
	 *
	 * @return string[]
	 */
	public static function schema() {
		global $wpdb;
		$charset_collate = $wpdb->get_charset_collate();
		$plants          = self::plants_table();
		$usage           = self::api_usage_table();

		$statements = array();

		// --- Plant catalogue -------------------------------------------------
		$statements[] = "CREATE TABLE {$plants} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			botanical_name VARCHAR(191) NOT NULL DEFAULT '',
			common_name VARCHAR(191) NOT NULL DEFAULT '',
			plant_type VARCHAR(40) NOT NULL DEFAULT '',
			pot_size VARCHAR(40) NOT NULL DEFAULT '',
			unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0.00,
			markup_pct DECIMAL(5,2) NOT NULL DEFAULT 0.00,
			supplier VARCHAR(191) NOT NULL DEFAULT '',
			supplier_sku VARCHAR(100) NOT NULL DEFAULT '',
			lead_time_days INT NOT NULL DEFAULT 0,
			min_order_qty INT NOT NULL DEFAULT 1,
			mature_height_cm INT NOT NULL DEFAULT 0,
			mature_spread_cm INT NOT NULL DEFAULT 0,
			spacing_per_sqm DECIMAL(6,2) NOT NULL DEFAULT 0.00,
			sun VARCHAR(40) NOT NULL DEFAULT '',
			soil VARCHAR(100) NOT NULL DEFAULT '',
			hardiness VARCHAR(40) NOT NULL DEFAULT '',
			foliage VARCHAR(20) NOT NULL DEFAULT '',
			flowering_months VARCHAR(40) NOT NULL DEFAULT '',
			toxicity VARCHAR(20) NOT NULL DEFAULT 'none',
			gbif_id VARCHAR(40) NOT NULL DEFAULT '',
			notes TEXT NULL,
			created_at DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00',
			updated_at DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00',
			PRIMARY KEY  (id),
			KEY botanical_name (botanical_name),
			KEY plant_type (plant_type),
			KEY supplier (supplier)
		) {$charset_collate};";

		// --- API usage log ---------------------------------------------------
		$statements[] = "CREATE TABLE {$usage} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			api VARCHAR(40) NOT NULL DEFAULT '',
			units DECIMAL(14,4) NOT NULL DEFAULT 0,
			unit_type VARCHAR(40) NOT NULL DEFAULT '',
			cost_gbp DECIMAL(10,4) NOT NULL DEFAULT 0,
			project_id BIGINT UNSIGNED NULL,
			meta TEXT NULL,
			created_at DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00',
			PRIMARY KEY  (id),
			KEY api (api),
			KEY project_id (project_id),
			KEY created_at (created_at)
		) {$charset_collate};";

		return $statements;
	}
}
