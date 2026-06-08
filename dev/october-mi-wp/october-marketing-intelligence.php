<?php
/**
 * Plugin Name: October Marketing Intelligence
 * Plugin URI: https://octobercomms.com
 * Description: Connects your WordPress/WooCommerce site to the October Marketing Intelligence platform. The site pushes commerce, content and SEO signals outbound over HTTPS (so web application firewalls never challenge it), and can publish drafts sent back from the platform.
 * Version: 1.0.0
 * Author: October
 * Author URI: https://octobercomms.com
 * License: GPL v2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: october-mi
 * Requires at least: 6.0
 * Requires PHP: 7.4
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'OCTOBERMI_VERSION', '1.0.0' );
define( 'OCTOBERMI_PATH', plugin_dir_path( __FILE__ ) );
define( 'OCTOBERMI_URL', plugin_dir_url( __FILE__ ) );
define( 'OCTOBERMI_BASENAME', plugin_basename( __FILE__ ) );

// The platform base URL. All outbound calls hang off /api/wp-connect/.
if ( ! defined( 'OCTOBERMI_PLATFORM_URL' ) ) {
	define( 'OCTOBERMI_PLATFORM_URL', 'https://platform.octobercomms.com' );
}

// Self-updater settings (mirrors the Hillcroft pattern; tag prefix is omi-wp-v).
if ( ! defined( 'OCTOBERMI_GITHUB_REPO' ) ) {
	define( 'OCTOBERMI_GITHUB_REPO', 'octobercomms/claude' );
}
if ( ! defined( 'OCTOBERMI_GITHUB_TAG_PREFIX' ) ) {
	define( 'OCTOBERMI_GITHUB_TAG_PREFIX', 'omi-wp-v' );
}

require_once OCTOBERMI_PATH . 'includes/class-octobermi-log.php';
require_once OCTOBERMI_PATH . 'includes/class-octobermi-crypto.php';
require_once OCTOBERMI_PATH . 'includes/class-octobermi-settings.php';
require_once OCTOBERMI_PATH . 'includes/class-octobermi-activator.php';
require_once OCTOBERMI_PATH . 'includes/class-octobermi-client.php';
require_once OCTOBERMI_PATH . 'includes/class-octobermi-pairing.php';
require_once OCTOBERMI_PATH . 'includes/class-octobermi-events.php';
require_once OCTOBERMI_PATH . 'includes/class-octobermi-rest.php';
require_once OCTOBERMI_PATH . 'includes/class-octobermi-updater.php';

register_activation_hook( __FILE__, array( 'OctoberMI_Activator', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'OctoberMI_Activator', 'deactivate' ) );

// Outbound event listeners: only attach once the site is paired.
add_action( 'plugins_loaded', function () {
	if ( OctoberMI_Settings::is_connected() ) {
		OctoberMI_Events::init();
	}
}, 20 );

// Inbound REST route (publish a draft from the platform).
add_action( 'rest_api_init', array( 'OctoberMI_REST', 'register_routes' ) );

// Self-updater: pulls new builds from the October platform. The platform is the
// distribution point, so no GitHub token is needed on the site — a new version
// rolls out automatically once it's deployed to the platform.
add_action( 'plugins_loaded', function () {
	new OctoberMI_Updater(
		OCTOBERMI_BASENAME,
		OCTOBERMI_VERSION,
		OCTOBERMI_PLATFORM_URL
	);
} );

// Let WordPress auto-install our updates on its schedule — hands-off rollout.
add_filter( 'auto_update_plugin', function ( $update, $item ) {
	if ( is_object( $item ) && isset( $item->plugin ) && OCTOBERMI_BASENAME === $item->plugin ) {
		return true;
	}
	return $update;
}, 10, 2 );

if ( is_admin() ) {
	require_once OCTOBERMI_PATH . 'admin/class-octobermi-admin.php';
	new OctoberMI_Admin();
}

// Load text domain for translations.
add_action( 'init', function () {
	load_plugin_textdomain( 'october-mi', false, dirname( OCTOBERMI_BASENAME ) . '/languages' );
} );
