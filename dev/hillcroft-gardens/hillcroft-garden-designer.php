<?php
/**
 * Plugin Name: Hillcroft Garden Designer
 * Plugin URI: https://octobercomms.com
 * Description: AI-powered garden design system for Hillcroft Gardens — consultation capture, plant catalogue, pricing, visual renders, client proposals and payments. Foundation build.
 * Version: 0.1.0
 * Author: October Comms
 * Author URI: https://octobercomms.com
 * License: GPL v2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: hillcroft-garden-designer
 * Requires at least: 6.0
 * Requires PHP: 7.4
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'HGD_VERSION', '0.1.0' );
define( 'HGD_PATH', plugin_dir_path( __FILE__ ) );
define( 'HGD_URL', plugin_dir_url( __FILE__ ) );
define( 'HGD_BASENAME', plugin_basename( __FILE__ ) );

require_once HGD_PATH . 'includes/class-hgd-db.php';
require_once HGD_PATH . 'includes/class-hgd-activator.php';
require_once HGD_PATH . 'includes/class-hgd-settings.php';
require_once HGD_PATH . 'includes/class-hgd-plant.php';
require_once HGD_PATH . 'includes/class-hgd-api-usage.php';
require_once HGD_PATH . 'includes/class-hgd-updater.php';

register_activation_hook( __FILE__, array( 'HGD_Activator', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'HGD_Activator', 'deactivate' ) );

// Ensure the schema is current even when updated without reactivation (e.g. via the self-updater).
add_action( 'plugins_loaded', function () {
	if ( get_option( 'hgd_db_version' ) !== HGD_DB::SCHEMA_VERSION ) {
		HGD_Activator::activate();
	}
} );

// Self-updater: pulls signed release zips from the private GitHub repo using a stored token.
add_action( 'plugins_loaded', function () {
	$settings = HGD_Settings::all();
	if ( ! empty( $settings['github_token'] ) && ! empty( $settings['github_repo'] ) ) {
		new HGD_Updater(
			HGD_BASENAME,
			HGD_VERSION,
			$settings['github_repo'],
			$settings['github_token'],
			isset( $settings['github_tag_prefix'] ) ? $settings['github_tag_prefix'] : 'hgd-v'
		);
	}
} );

if ( is_admin() ) {
	require_once HGD_PATH . 'admin/class-hgd-admin.php';
	new HGD_Admin();
}

// Load text domain for translations.
add_action( 'init', function () {
	load_plugin_textdomain( 'hillcroft-garden-designer', false, dirname( HGD_BASENAME ) . '/languages' );
} );
