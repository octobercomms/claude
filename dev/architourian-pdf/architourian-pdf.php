<?php
/**
 * Plugin Name: Architourian PDF Generator
 * Plugin URI:  https://architourian.com
 * Description: Generates branded itinerary PDFs from tour custom fields. Works with JetEngine, ACF, or standard WordPress post meta.
 * Version:     1.3.0
 * Author:      Architourian
 * License:     GPL-2.0-or-later
 * Text Domain: architourian-pdf
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'AIPDF_VERSION', '1.3.0' );
define( 'AIPDF_PATH', plugin_dir_path( __FILE__ ) );
define( 'AIPDF_URL', plugin_dir_url( __FILE__ ) );
define( 'AIPDF_VENDOR', AIPDF_PATH . 'vendor/autoload.php' );

// Public GitHub repo that publishes plugin Releases. WordPress checks this for
// updates — keep it pointed at the PUBLIC mirror (no token needed on the site).
define( 'AIPDF_UPDATE_REPO', 'https://github.com/octobercomms/architourian-pdf/' );

require_once AIPDF_PATH . 'includes/class-settings.php';
require_once AIPDF_PATH . 'includes/class-pdf-generator.php';

/**
 * Self-update from GitHub Releases.
 *
 * Shows "Update available" on the Plugins screen whenever a newer Release is
 * published on the public repo above. enableReleaseAssets() makes WordPress
 * install the exact built zip attached to the Release (mPDF bundled) rather
 * than a bare source zipball.
 */
$aipdf_puc = AIPDF_PATH . 'lib/plugin-update-checker/plugin-update-checker.php';
if ( is_admin() && file_exists( $aipdf_puc ) ) {
	require_once $aipdf_puc;
	$aipdf_update_checker = \YahnisElsts\PluginUpdateChecker\v5\PucFactory::buildUpdateChecker(
		AIPDF_UPDATE_REPO,
		__FILE__,
		'architourian-pdf'
	);
	// Use the zip attached to each Release (built via build.sh), not the source zipball.
	$aipdf_update_checker->getVcsApi()->enableReleaseAssets();
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
