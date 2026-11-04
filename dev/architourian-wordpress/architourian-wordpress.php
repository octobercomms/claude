<?php
/**
 * Plugin Name: Architourian WordPress Integration
 * Plugin URI:  https://architourian.com
 * Description: Secure REST API for managing tours and content via Claude AI. Provides API key authentication and endpoints for tour CRUD operations, with JetEngine/Crocoblock field auto-discovery.
 * Version:     1.0.0
 * Author:      October Communications
 * License:     GPL-2.0-or-later
 * Text Domain: architourian-wordpress
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ATWP_VERSION', '1.0.0' );
define( 'ATWP_PATH', plugin_dir_path( __FILE__ ) );
define( 'ATWP_URL', plugin_dir_url( __FILE__ ) );
define( 'ATWP_UPDATE_REPO', 'octobercomms/claude' );
define( 'ATWP_UPDATE_TAG_PREFIX', 'atwp-v' );

require_once ATWP_PATH . 'includes/class-atwp-auth.php';
require_once ATWP_PATH . 'includes/class-atwp-jetengine.php';
require_once ATWP_PATH . 'includes/class-atwp-settings.php';
require_once ATWP_PATH . 'includes/class-atwp-rest-tours.php';
require_once ATWP_PATH . 'includes/class-atwp-rest-content.php';

if ( is_admin() ) {
	require_once ATWP_PATH . 'includes/class-atwp-updater.php';
	new ATWP_Updater(
		plugin_basename( __FILE__ ),
		ATWP_VERSION,
		ATWP_UPDATE_REPO,
		ATWP_UPDATE_TAG_PREFIX
	);
}

function atwp_init() {
	ATWP_Auth::init();
	ATWP_Settings::init();
}
add_action( 'plugins_loaded', 'atwp_init' );

function atwp_register_rest_routes() {
	$tours   = new ATWP_REST_Tours();
	$content = new ATWP_REST_Content();

	$tours->register_routes();
	$content->register_routes();
}
add_action( 'rest_api_init', 'atwp_register_rest_routes' );

function atwp_activate() {
	global $wpdb;

	$table   = $wpdb->prefix . 'atwp_audit_log';
	$charset = $wpdb->get_charset_collate();

	$sql = "CREATE TABLE IF NOT EXISTS {$table} (
		id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
		api_key_id varchar(64) NOT NULL DEFAULT '',
		endpoint varchar(255) NOT NULL DEFAULT '',
		method varchar(10) NOT NULL DEFAULT '',
		request_summary text NOT NULL,
		response_code int(5) NOT NULL DEFAULT 0,
		ip_address varchar(45) NOT NULL DEFAULT '',
		created_at datetime NOT NULL DEFAULT '0000-00-00 00:00:00',
		PRIMARY KEY (id),
		KEY api_key_id (api_key_id),
		KEY created_at (created_at)
	) {$charset};";

	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	dbDelta( $sql );

	update_option( 'atwp_db_version', '1.0.0' );
}
register_activation_hook( __FILE__, 'atwp_activate' );
