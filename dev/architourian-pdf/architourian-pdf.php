<?php
/**
 * Plugin Name: Architourian PDF Generator
 * Plugin URI:  https://architourian.com
 * Description: Generates branded itinerary PDFs from tour custom fields. Works with JetEngine, ACF, or standard WordPress post meta.
 * Version:     1.3.3
 * Author:      Architourian
 * License:     GPL-2.0-or-later
 * Text Domain: architourian-pdf
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'AIPDF_VERSION', '1.3.3' );
define( 'AIPDF_PATH', plugin_dir_path( __FILE__ ) );
define( 'AIPDF_URL', plugin_dir_url( __FILE__ ) );
define( 'AIPDF_VENDOR', AIPDF_PATH . 'vendor/autoload.php' );

// The plugin is developed and released from the public October monorepo
// (octobercomms/claude), which publishes a GitHub Release per version tagged
// "aipdf-v<version>". WordPress checks that repo for updates — it's public, so
// no token is needed on the site.
define( 'AIPDF_UPDATE_REPO', 'octobercomms/claude' );
define( 'AIPDF_UPDATE_TAG_PREFIX', 'aipdf-v' );

require_once AIPDF_PATH . 'includes/class-settings.php';
require_once AIPDF_PATH . 'includes/class-pdf-generator.php';

/**
 * Self-update from the monorepo's GitHub Releases.
 *
 * Surfaces "Update available" on the Plugins screen whenever a newer aipdf-v*
 * Release is published, and installs the built zip attached to that Release
 * (mPDF bundled) rather than a bare source zipball.
 */
if ( is_admin() ) {
	require_once AIPDF_PATH . 'includes/class-aipdf-updater.php';
	new AIPDF_Updater(
		plugin_basename( __FILE__ ),
		AIPDF_VERSION,
		AIPDF_UPDATE_REPO,
		AIPDF_UPDATE_TAG_PREFIX
	);
}

/**
 * Boot the plugin.
 */
function aipdf_init() {
	AIPDF_Settings::init();
	AIPDF_PDF_Generator::init();
}
add_action( 'plugins_loaded', 'aipdf_init' );

/**
 * Allow TTF/OTF font uploads via the WordPress media library.
 */
add_filter( 'upload_mimes', function( $mimes ) {
	$mimes['ttf']  = 'font/ttf';
	$mimes['otf']  = 'font/otf';
	$mimes['woff'] = 'font/woff';
	return $mimes;
} );

/**
 * Check mPDF is installed on activation.
 */
function aipdf_activate() {
	if ( ! file_exists( AIPDF_VENDOR ) ) {
		deactivate_plugins( plugin_basename( __FILE__ ) );
		wp_die(
			'<p><strong>Architourian PDF Generator</strong> requires mPDF. Please run <code>composer install</code> inside the plugin directory, then reactivate.</p>',
			'Plugin Activation Error',
			[ 'back_link' => true ]
		);
	}
}
register_activation_hook( __FILE__, 'aipdf_activate' );
