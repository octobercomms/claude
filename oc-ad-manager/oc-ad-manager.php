<?php
/**
 * Plugin Name: Ad Manager by October Communications
 * Plugin URI: https://octobercomms.com
 * Description: Advertising rotation manager for Atlanta Design Festival. Supports MPU, Leaderboard, and Skyscraper formats with click and impression tracking, campaign scheduling, and flexible restriction controls.
 * Version: 1.2.2
 * Author: October Comms
 * Author URI: https://octobercomms.com
 * License: GPL v2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: oc-ad-manager
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'OCAD_VERSION', '1.2.2' );
define( 'OCAD_PATH', plugin_dir_path( __FILE__ ) );
define( 'OCAD_URL', plugin_dir_url( __FILE__ ) );

define( 'OCAD_FORMATS', array(
	'mpu'         => array( 'label' => 'MPU',         'width' => 300, 'height' => 250 ),
	'leaderboard' => array( 'label' => 'Leaderboard', 'width' => 728, 'height' => 90  ),
	'skyscraper'  => array( 'label' => 'Skyscraper',  'width' => 160, 'height' => 600 ),
) );

require_once OCAD_PATH . 'includes/class-ocad-activator.php';
require_once OCAD_PATH . 'includes/class-ocad-campaign.php';
require_once OCAD_PATH . 'includes/class-ocad-tracker.php';
require_once OCAD_PATH . 'includes/class-ocad-partner.php';
require_once OCAD_PATH . 'includes/class-ocad-shortcodes.php';
require_once OCAD_PATH . 'includes/class-ocad-rest-api.php';
require_once OCAD_PATH . 'includes/class-ocad-stripe.php';
require_once OCAD_PATH . 'includes/class-ocad-booking-form.php';

register_activation_hook( __FILE__, array( 'OCAD_Activator', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'OCAD_Activator', 'deactivate' ) );

// Ensure tables exist even when the plugin is updated without reactivation.
add_action( 'plugins_loaded', function() {
	if ( get_option( 'ocad_version' ) !== OCAD_VERSION ) {
		OCAD_Activator::activate();
	}
} );

if ( is_admin() ) {
	require_once OCAD_PATH . 'admin/class-ocad-admin.php';
	require_once OCAD_PATH . 'admin/class-ocad-settings.php';
	require_once OCAD_PATH . 'admin/class-ocad-report.php';
	require_once OCAD_PATH . 'admin/class-ocad-bookings.php';
	new OCAD_Admin();
	new OCAD_Settings();
	new OCAD_Report();
	new OCAD_Bookings();
}

$ocad_shortcodes = new OCAD_Shortcodes();
$ocad_shortcodes->register();

new OCAD_REST_API();
new OCAD_Booking_Form();

// Enqueue lightweight frontend script that loads ads via REST, bypassing page cache.
// No JS data localisation needed — all URLs are baked into data-render / data-ocad-track
// attributes on the placeholder divs at PHP render time.
add_action( 'wp_enqueue_scripts', 'ocad_enqueue_frontend_assets' );
function ocad_enqueue_frontend_assets() {
	wp_enqueue_script(
		'ocad-frontend',
		OCAD_URL . 'assets/js/frontend.js',
		array(),
		OCAD_VERSION,
		true
	);
}

// Handle click-tracking redirect before any output.
add_action( 'template_redirect', 'ocad_handle_click_redirect' );
function ocad_handle_click_redirect() {
	if ( ! isset( $_GET['ocad_click'] ) ) {
		return;
	}

	$ad_id = absint( $_GET['ocad_click'] );
	if ( ! $ad_id ) {
		wp_safe_redirect( home_url( '/' ) );
		exit;
	}

	$ad = OCAD_Campaign::get_ad( $ad_id );
	if ( ! $ad ) {
		wp_safe_redirect( home_url( '/' ) );
		exit;
	}

	$source_url = isset( $_GET['page'] ) ? sanitize_text_field( wp_unslash( $_GET['page'] ) ) : '';
	OCAD_Tracker::log_click( $ad->campaign_id, $ad_id, $source_url );

	$campaign = OCAD_Campaign::get( $ad->campaign_id );
	$redirect  = $campaign ? $campaign->url : home_url( '/' );

	wp_redirect( esc_url_raw( $redirect ) );
	exit;
}
