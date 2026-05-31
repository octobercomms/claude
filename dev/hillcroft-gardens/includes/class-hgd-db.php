<?php
/**
 * Database schema + table-name helpers.
 *
 * Tables: plant catalogue, API-usage log, clients (CRM), and projects.
 * Proposals, payments etc. will be added in later feature PRs.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_DB {

	/**
	 * Bump this whenever the schema changes so dbDelta re-runs on the next load.
	 */
	const SCHEMA_VERSION = '5';

	public static function plants_table() {
		global $wpdb;
		return $wpdb->prefix . 'hgd_plants';
	}

	public static function api_usage_table() {
		global $wpdb;
		return $wpdb->prefix . 'hgd_api_usage';
	}

	public static function clients_table() {
		global $wpdb;
		return $wpdb->prefix . 'hgd_clients';
	}

	public static function projects_table() {
		global $wpdb;
		return $wpdb->prefix . 'hgd_projects';
	}

	public static function bookings_table() {
		global $wpdb;
		return $wpdb->prefix . 'hgd_bookings';
	}

	public static function project_assets_table() {
		global $wpdb;
		return $wpdb->prefix . 'hgd_project_assets';
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
		$clients         = self::clients_table();
		$projects        = self::projects_table();
		$bookings        = self::bookings_table();
		$project_assets  = self::project_assets_table();

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

		// --- Clients (CRM) ---------------------------------------------------
		$statements[] = "CREATE TABLE {$clients} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			first_name VARCHAR(100) NOT NULL DEFAULT '',
			last_name VARCHAR(100) NOT NULL DEFAULT '',
			email VARCHAR(191) NOT NULL DEFAULT '',
			phone VARCHAR(40) NOT NULL DEFAULT '',
			address_line1 VARCHAR(191) NOT NULL DEFAULT '',
			address_line2 VARCHAR(191) NOT NULL DEFAULT '',
			city VARCHAR(100) NOT NULL DEFAULT '',
			postcode VARCHAR(20) NOT NULL DEFAULT '',
			notes TEXT NULL,
			created_at DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00',
			updated_at DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00',
			PRIMARY KEY  (id),
			KEY email (email)
		) {$charset_collate};";

		// --- Projects --------------------------------------------------------
		$statements[] = "CREATE TABLE {$projects} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			client_id BIGINT UNSIGNED NULL,
			title VARCHAR(191) NOT NULL DEFAULT '',
			status VARCHAR(30) NOT NULL DEFAULT 'lead',
			source VARCHAR(30) NOT NULL DEFAULT 'manual',
			address VARCHAR(255) NOT NULL DEFAULT '',
			postcode VARCHAR(20) NOT NULL DEFAULT '',
			budget_range VARCHAR(60) NOT NULL DEFAULT '',
			style_prefs VARCHAR(255) NOT NULL DEFAULT '',
			has_pets TINYINT(1) NOT NULL DEFAULT 0,
			has_children TINYINT(1) NOT NULL DEFAULT 0,
			brief_notes TEXT NULL,
			ai_reading LONGTEXT NULL,
			ai_questions LONGTEXT NULL,
			design_brief LONGTEXT NULL,
			render_prompt LONGTEXT NULL,
			consultation_paid TINYINT(1) NOT NULL DEFAULT 0,
			consultation_at DATETIME NULL,
			created_at DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00',
			updated_at DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00',
			PRIMARY KEY  (id),
			KEY client_id (client_id),
			KEY status (status),
			KEY created_at (created_at)
		) {$charset_collate};";

		// --- Consultation bookings ------------------------------------------
		$statements[] = "CREATE TABLE {$bookings} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			client_id BIGINT UNSIGNED NULL,
			project_id BIGINT UNSIGNED NULL,
			name VARCHAR(191) NOT NULL DEFAULT '',
			email VARCHAR(191) NOT NULL DEFAULT '',
			phone VARCHAR(40) NOT NULL DEFAULT '',
			address VARCHAR(255) NOT NULL DEFAULT '',
			postcode VARCHAR(20) NOT NULL DEFAULT '',
			slot_start DATETIME NULL,
			slot_end DATETIME NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'pending',
			amount_gbp DECIMAL(10,2) NOT NULL DEFAULT 0.00,
			stripe_payment_intent VARCHAR(80) NOT NULL DEFAULT '',
			google_event_id VARCHAR(191) NOT NULL DEFAULT '',
			notes TEXT NULL,
			created_at DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00',
			updated_at DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00',
			PRIMARY KEY  (id),
			KEY client_id (client_id),
			KEY status (status),
			KEY slot_start (slot_start),
			KEY stripe_payment_intent (stripe_payment_intent)
		) {$charset_collate};";

		// --- Project assets (consultation capture: sketches/photos) ----------
		$statements[] = "CREATE TABLE {$project_assets} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			project_id BIGINT UNSIGNED NULL,
			attachment_id BIGINT UNSIGNED NULL,
			role VARCHAR(20) NOT NULL DEFAULT 'photo',
			created_at DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00',
			PRIMARY KEY  (id),
			KEY project_id (project_id)
		) {$charset_collate};";

		return $statements;
	}
}
