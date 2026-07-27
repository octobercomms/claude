<?php
/**
 * Plugin Name: October Popups
 * Plugin URI: https://octobercomms.com
 * Description: Lightweight, occasional-use popups (competitions, announcements, offers) whose content you build with WP Bakery or Elementor. Rich trigger, scheduling and targeting options, with a built-in one-click self-updater.
 * Version: 1.0.2
 * Author: October Comms
 * Author URI: https://octobercomms.com
 * License: GPL v2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: october-popups
 * Requires at least: 6.0
 * Requires PHP: 7.4
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'OCPOP_VERSION', '1.0.2' );
define( 'OCPOP_PATH', plugin_dir_path( __FILE__ ) );
define( 'OCPOP_URL', plugin_dir_url( __FILE__ ) );
define( 'OCPOP_BASENAME', plugin_basename( __FILE__ ) );
define( 'OCPOP_CPT', 'ocpop_popup' );

require_once OCPOP_PATH . 'includes/class-ocpop-cpt.php';
require_once OCPOP_PATH . 'includes/class-ocpop-meta.php';
require_once OCPOP_PATH . 'includes/class-ocpop-builders.php';
require_once OCPOP_PATH . 'includes/class-ocpop-frontend.php';
require_once OCPOP_PATH . 'includes/class-ocpop-analytics.php';
require_once OCPOP_PATH . 'includes/class-ocpop-settings.php';
require_once OCPOP_PATH . 'includes/class-ocpop-updater.php';

/**
 * Activation: register the CPT once so its rewrite rules exist, then flush.
 */
function ocpop_activate() {
	OCPOP_CPT_Registrar::register();
	flush_rewrite_rules();
	// Make sure the page builders offer their editor on our post type.
	OCPOP_Builders::enable_builder_support();
}
register_activation_hook( __FILE__, 'ocpop_activate' );

function ocpop_deactivate() {
	flush_rewrite_rules();
}
register_deactivation_hook( __FILE__, 'ocpop_deactivate' );

/**
 * Boot the plugin.
 */
function ocpop_boot() {
	OCPOP_CPT_Registrar::init();
	OCPOP_Meta::init();
	OCPOP_Builders::init();
	OCPOP_Frontend::init();
	OCPOP_Analytics::init();
	OCPOP_Settings::init();

	// Self-updater (pulls signed release zips from the private monorepo).
	$token = OCPOP_Settings::get( 'github_token' );
	$repo  = OCPOP_Settings::get( 'github_repo', 'octobercomms/claude' );
	if ( $token && $repo ) {
		new OCPOP_Updater( OCPOP_BASENAME, OCPOP_VERSION, $repo, $token, 'ocpop-v' );
	}
}
add_action( 'plugins_loaded', 'ocpop_boot' );
