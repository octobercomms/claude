<?php
/**
 * Plugin Name: Architourian Payment Links
 * Plugin URI:  https://architourian.com
 * Description: Generate Stripe payment links for tour balances right inside WordPress. Type a customer name, a note and the amount to pay, and get a shareable Stripe link with a QR code. Keeps a log of every link and tracks which have been paid.
 * Version:     1.0.1
 * Author:      Architourian
 * License:     GPL-2.0-or-later
 * Text Domain: architourian-payments
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ARPL_VERSION', '1.0.1' );
define( 'ARPL_PATH', plugin_dir_path( __FILE__ ) );
define( 'ARPL_URL', plugin_dir_url( __FILE__ ) );

// Released from the public October monorepo (octobercomms/claude) as a GitHub
// Release tagged "arpl-v<version>" so it doesn't collide with the other plugins
// in the repo. The built-in updater offers it to the live site as a one-click
// update — the repo is public, so no token is needed on the site.
define( 'ARPL_UPDATE_REPO', 'octobercomms/claude' );
define( 'ARPL_UPDATE_TAG_PREFIX', 'arpl-v' );

require_once ARPL_PATH . 'includes/class-arpl-store.php';
require_once ARPL_PATH . 'includes/class-arpl-stripe.php';
require_once ARPL_PATH . 'includes/class-arpl-settings.php';
require_once ARPL_PATH . 'includes/class-arpl-admin.php';

/**
 * Self-update from the monorepo's GitHub Releases.
 */
if ( is_admin() ) {
	require_once ARPL_PATH . 'includes/class-arpl-updater.php';
	new ARPL_Updater(
		plugin_basename( __FILE__ ),
		ARPL_VERSION,
		ARPL_UPDATE_REPO,
		ARPL_UPDATE_TAG_PREFIX
	);
}

/**
 * Boot the plugin.
 */
function arpl_init() {
	ARPL_Settings::init();
	ARPL_Admin::init();
}
add_action( 'plugins_loaded', 'arpl_init' );

/**
 * Create / upgrade the links log table on activation.
 */
function arpl_activate() {
	ARPL_Store::install();
}
register_activation_hook( __FILE__, 'arpl_activate' );

// Keep the schema current after a plugin update without needing reactivation.
add_action( 'plugins_loaded', [ 'ARPL_Store', 'maybe_upgrade' ], 5 );
