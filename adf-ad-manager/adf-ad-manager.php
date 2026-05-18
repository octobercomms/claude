<?php
/**
 * Plugin Name: ADF Ad Manager
 * Plugin URI: https://octobercomms.com
 * Description: Advertising rotation manager for Atlanta Design Festival. Supports MPU, Leaderboard, and Skyscraper formats with click and impression tracking, campaign scheduling, and flexible restriction controls.
 * Version: 1.0.0
 * Author: October Comms
 * Author URI: https://octobercomms.com
 * License: GPL v2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: adf-ad-manager
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ADF_VERSION', '1.0.0' );
define( 'ADF_PATH', plugin_dir_path( __FILE__ ) );
define( 'ADF_URL', plugin_dir_url( __FILE__ ) );

define( 'ADF_FORMATS', array(
	'mpu'         => array( 'label' => 'MPU',         'width' => 300, 'height' => 250 ),
	'leaderboard' => array( 'label' => 'Leaderboard', 'width' => 728, 'height' => 90  ),
	'skyscraper'  => array( 'label' => 'Skyscraper',  'width' => 160, 'height' => 600 ),
) );

require_once ADF_PATH . 'includes/class-adf-activator.php';
require_once ADF_PATH . 'includes/class-adf-campaign.php';
require_once ADF_PATH . 'includes/class-adf-tracker.php';
require_once ADF_PATH . 'includes/class-adf-partner.php';
require_once ADF_PATH . 'includes/class-adf-shortcodes.php';
require_once ADF_PATH . 'includes/class-adf-rest-api.php';

register_activation_hook( __FILE__, array( 'ADF_Activator', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'ADF_Activator', 'deactivate' ) );

if ( is_admin() ) {
	require_once ADF_PATH . 'admin/class-adf-admin.php';
	require_once ADF_PATH . 'admin/class-adf-settings.php';
	new ADF_Admin();
	new ADF_Settings();
}

$adf_shortcodes = new ADF_Shortcodes();
$adf_shortcodes->register();

new ADF_REST_API();

// Handle click-tracking redirect before any output.
add_action( 'template_redirect', 'adf_handle_click_redirect' );
function adf_handle_click_redirect() {
	if ( ! isset( $_GET['adf_click'] ) ) {
		return;
	}

	$ad_id = absint( $_GET['adf_click'] );
	if ( ! $ad_id ) {
		wp_safe_redirect( home_url( '/' ) );
		exit;
	}

	$ad = ADF_Campaign::get_ad( $ad_id );
	if ( ! $ad ) {
		wp_safe_redirect( home_url( '/' ) );
		exit;
	}

	ADF_Tracker::log_click( $ad->campaign_id, $ad_id );

	$campaign = ADF_Campaign::get( $ad->campaign_id );
	$redirect  = $campaign ? $campaign->url : home_url( '/' );

	wp_redirect( esc_url_raw( $redirect ) );
	exit;
}
