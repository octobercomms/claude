<?php
/**
 * Database schema + table-name helpers for October Proposals.
 *
 * The full schema is defined here from the start so feature PRs build on stable
 * tables. Bump SCHEMA_VERSION whenever the schema changes so dbDelta re-runs.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCP_DB {

	/** Bump on any schema change. */
	const SCHEMA_VERSION = '1';

	public static function proposals_table()      { global $wpdb; return $wpdb->prefix . 'ocp_proposals'; }
	public static function items_table()          { global $wpdb; return $wpdb->prefix . 'ocp_proposal_items'; }
	public static function sections_table()       { global $wpdb; return $wpdb->prefix . 'ocp_proposal_sections'; }
	public static function leads_table()          { global $wpdb; return $wpdb->prefix . 'ocp_leads'; }
	public static function case_studies_table()   { global $wpdb; return $wpdb->prefix . 'ocp_case_studies'; }
	public static function testimonials_table()   { global $wpdb; return $wpdb->prefix . 'ocp_testimonials'; }
	public static function services_table()       { global $wpdb; return $wpdb->prefix . 'ocp_services'; }
	public static function awards_table()         { global $wpdb; return $wpdb->prefix . 'ocp_awards'; }
	public static function clients_table()        { global $wpdb; return $wpdb->prefix . 'ocp_showcase_clients'; }
	public static function terms_table()          { global $wpdb; return $wpdb->prefix . 'ocp_terms_versions'; }
	public static function acceptances_table()    { global $wpdb; return $wpdb->prefix . 'ocp_acceptances'; }
	public static function payments_table()       { global $wpdb; return $wpdb->prefix . 'ocp_payments'; }
	public static function events_table()         { global $wpdb; return $wpdb->prefix . 'ocp_proposal_events'; }

	/**
	 * Full set of CREATE TABLE statements, dbDelta-formatted.
	 *
	 * @return string[]
	 */
	public static function schema() {
		global $wpdb;
		$charset = $wpdb->get_charset_collate();
		$p       = $wpdb->prefix;

		$sql = array();

		// --- Proposals -------------------------------------------------------
		$sql[] = "CREATE TABLE {$p}ocp_proposals (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			lead_id BIGINT UNSIGNED NULL,
			token CHAR(64) NOT NULL,
			type VARCHAR(40) NOT NULL DEFAULT 'retainer',
			status VARCHAR(20) NOT NULL DEFAULT 'draft',
			title VARCHAR(255) NOT NULL DEFAULT '',
			client_name VARCHAR(255) NOT NULL DEFAULT '',
			client_contacts TEXT NULL,
			sector VARCHAR(80) NOT NULL DEFAULT '',
			region VARCHAR(20) NOT NULL DEFAULT 'global',
			currency CHAR(3) NOT NULL DEFAULT 'GBP',
			vat_applies TINYINT(1) NOT NULL DEFAULT 1,
			website_url VARCHAR(255) NOT NULL DEFAULT '',
			website_image VARCHAR(255) NOT NULL DEFAULT '',
			intro_video VARCHAR(255) NOT NULL DEFAULT '',
			process_video VARCHAR(255) NOT NULL DEFAULT '',
			content LONGTEXT NULL,
			pricing_meta TEXT NULL,
			terms_version_id BIGINT UNSIGNED NULL,
			expires_at DATETIME NULL,
			created_at DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00',
			updated_at DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00',
			sent_at DATETIME NULL,
			first_viewed_at DATETIME NULL,
			accepted_at DATETIME NULL,
			PRIMARY KEY (id),
			UNIQUE KEY token (token),
			KEY status (status),
			KEY lead_id (lead_id)
		) {$charset};";

		// --- Pricing line items ---------------------------------------------
		$sql[] = "CREATE TABLE {$p}ocp_proposal_items (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			proposal_id BIGINT UNSIGNED NOT NULL,
			cadence VARCHAR(20) NOT NULL DEFAULT 'oneoff',
			stage TINYINT UNSIGNED NULL,
			label VARCHAR(255) NOT NULL DEFAULT '',
			detail TEXT NULL,
			qty DECIMAL(10,2) NOT NULL DEFAULT 1,
			unit_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
			hours DECIMAL(8,2) NULL,
			sort_order INT NOT NULL DEFAULT 0,
			PRIMARY KEY (id),
			KEY proposal_id (proposal_id)
		) {$charset};";

		// --- Per-proposal section toggles/order/overrides -------------------
		$sql[] = "CREATE TABLE {$p}ocp_proposal_sections (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			proposal_id BIGINT UNSIGNED NOT NULL,
			section_key VARCHAR(40) NOT NULL,
			enabled TINYINT(1) NOT NULL DEFAULT 1,
			sort_order INT NOT NULL DEFAULT 0,
			body LONGTEXT NULL,
			ref_ids TEXT NULL,
			PRIMARY KEY (id),
			KEY proposal_id (proposal_id)
		) {$charset};";

		// --- CRM leads (modelled on the Sales Leads Tracker) ----------------
		$sql[] = "CREATE TABLE {$p}ocp_leads (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			client_name VARCHAR(255) NOT NULL DEFAULT '',
			status VARCHAR(40) NOT NULL DEFAULT 'lead_in',
			lost_reason VARCHAR(40) NOT NULL DEFAULT '',
			lead_source VARCHAR(60) NOT NULL DEFAULT '',
			lead_source_desc VARCHAR(255) NOT NULL DEFAULT '',
			additional_info TEXT NULL,
			project_type VARCHAR(80) NOT NULL DEFAULT '',
			budget_band VARCHAR(40) NOT NULL DEFAULT '',
			contact_name VARCHAR(255) NOT NULL DEFAULT '',
			email VARCHAR(255) NOT NULL DEFAULT '',
			telephone VARCHAR(60) NOT NULL DEFAULT '',
			address VARCHAR(255) NOT NULL DEFAULT '',
			postcode VARCHAR(40) NOT NULL DEFAULT '',
			lead_date DATE NULL,
			created_at DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00',
			updated_at DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00',
			PRIMARY KEY (id),
			KEY status (status),
			KEY email (email)
		) {$charset};";

		// --- Case studies (library, tagged) ---------------------------------
		$sql[] = "CREATE TABLE {$p}ocp_case_studies (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			title VARCHAR(255) NOT NULL DEFAULT '',
			client VARCHAR(255) NOT NULL DEFAULT '',
			sector VARCHAR(80) NOT NULL DEFAULT '',
			services VARCHAR(255) NOT NULL DEFAULT '',
			summary TEXT NULL,
			body LONGTEXT NULL,
			stats TEXT NULL,
			video_url VARCHAR(255) NOT NULL DEFAULT '',
			link_url VARCHAR(255) NOT NULL DEFAULT '',
			image VARCHAR(255) NOT NULL DEFAULT '',
			status VARCHAR(20) NOT NULL DEFAULT 'published',
			created_at DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00',
			PRIMARY KEY (id),
			KEY sector (sector)
		) {$charset};";

		// --- Testimonials (company logo + quote) ----------------------------
		$sql[] = "CREATE TABLE {$p}ocp_testimonials (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			company VARCHAR(255) NOT NULL DEFAULT '',
			person VARCHAR(255) NOT NULL DEFAULT '',
			role VARCHAR(255) NOT NULL DEFAULT '',
			quote TEXT NULL,
			logo VARCHAR(255) NOT NULL DEFAULT '',
			link_url VARCHAR(255) NOT NULL DEFAULT '',
			sector VARCHAR(80) NOT NULL DEFAULT '',
			sort_order INT NOT NULL DEFAULT 0,
			PRIMARY KEY (id)
		) {$charset};";

		// --- Services (boilerplate blocks) ----------------------------------
		$sql[] = "CREATE TABLE {$p}ocp_services (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			name VARCHAR(255) NOT NULL DEFAULT '',
			slug VARCHAR(80) NOT NULL DEFAULT '',
			body LONGTEXT NULL,
			icon VARCHAR(255) NOT NULL DEFAULT '',
			sort_order INT NOT NULL DEFAULT 0,
			PRIMARY KEY (id),
			KEY slug (slug)
		) {$charset};";

		// --- Awards ----------------------------------------------------------
		$sql[] = "CREATE TABLE {$p}ocp_awards (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			title VARCHAR(255) NOT NULL DEFAULT '',
			body TEXT NULL,
			logo VARCHAR(255) NOT NULL DEFAULT '',
			sort_order INT NOT NULL DEFAULT 0,
			PRIMARY KEY (id)
		) {$charset};";

		// --- Showcase clients (selected-clients list) -----------------------
		$sql[] = "CREATE TABLE {$p}ocp_showcase_clients (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			name VARCHAR(255) NOT NULL DEFAULT '',
			category VARCHAR(80) NOT NULL DEFAULT '',
			logo VARCHAR(255) NOT NULL DEFAULT '',
			sort_order INT NOT NULL DEFAULT 0,
			PRIMARY KEY (id),
			KEY category (category)
		) {$charset};";

		// --- Versioned terms -------------------------------------------------
		$sql[] = "CREATE TABLE {$p}ocp_terms_versions (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			version VARCHAR(20) NOT NULL DEFAULT '1',
			body LONGTEXT NULL,
			is_current TINYINT(1) NOT NULL DEFAULT 0,
			created_at DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00',
			PRIMARY KEY (id),
			KEY is_current (is_current)
		) {$charset};";

		// --- Acceptances (signed records / audit trail) ---------------------
		$sql[] = "CREATE TABLE {$p}ocp_acceptances (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			proposal_id BIGINT UNSIGNED NOT NULL,
			terms_version_id BIGINT UNSIGNED NULL,
			signatory_name VARCHAR(255) NOT NULL DEFAULT '',
			signatory_email VARCHAR(255) NOT NULL DEFAULT '',
			signed_at DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00',
			ip VARCHAR(64) NOT NULL DEFAULT '',
			user_agent VARCHAR(255) NOT NULL DEFAULT '',
			document_hash CHAR(64) NOT NULL DEFAULT '',
			pdf_path VARCHAR(255) NOT NULL DEFAULT '',
			PRIMARY KEY (id),
			KEY proposal_id (proposal_id)
		) {$charset};";

		// --- Payments --------------------------------------------------------
		$sql[] = "CREATE TABLE {$p}ocp_payments (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			proposal_id BIGINT UNSIGNED NOT NULL,
			provider VARCHAR(20) NOT NULL DEFAULT 'stripe',
			kind VARCHAR(20) NOT NULL DEFAULT 'oneoff',
			external_id VARCHAR(191) NOT NULL DEFAULT '',
			amount DECIMAL(12,2) NOT NULL DEFAULT 0,
			currency CHAR(3) NOT NULL DEFAULT 'GBP',
			status VARCHAR(30) NOT NULL DEFAULT 'pending',
			meta TEXT NULL,
			created_at DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00',
			updated_at DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00',
			PRIMARY KEY (id),
			KEY proposal_id (proposal_id),
			KEY external_id (external_id)
		) {$charset};";

		// --- Engagement events ----------------------------------------------
		$sql[] = "CREATE TABLE {$p}ocp_proposal_events (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			proposal_id BIGINT UNSIGNED NOT NULL,
			event VARCHAR(40) NOT NULL DEFAULT '',
			section_key VARCHAR(40) NOT NULL DEFAULT '',
			value VARCHAR(255) NOT NULL DEFAULT '',
			session_id CHAR(32) NOT NULL DEFAULT '',
			created_at DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00',
			PRIMARY KEY (id),
			KEY proposal_id (proposal_id),
			KEY event (event)
		) {$charset};";

		return $sql;
	}
}
