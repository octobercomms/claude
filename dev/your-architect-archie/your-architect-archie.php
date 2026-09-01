<?php
/**
 * Plugin Name: Your Architect – Archie
 * Plugin URI: https://yourarchitect.uk
 * Description: Archie — the conversational, fixed-price project builder for Your Architect. A two-panel AI assistant (embeddable with [archie] or the Elementor widget) that builds a homeowner's drawing package and price through a short chat, opens a project record, and gates full drawings behind payment. Trading name of Tiam Architects LLP.
 * Version: 0.5.3
 * Author: October Communications
 * Author URI: https://octobercomms.com
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: your-architect-archie
 * Requires at least: 6.0
 * Requires PHP: 7.4
 *
 * Architecture mirrors the Hillcroft Garden Designer plugin: class-per-concern
 * under includes/, a server-side Claude wrapper, encrypted secrets, rate
 * limiting, and a shortcode/Elementor front end. The two-panel UI is the
 * design already built for the Your Architect site; here it talks to a real
 * Claude turn over REST instead of a scripted flow.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'YAA_VERSION', '0.5.3' );
define( 'YAA_PATH', plugin_dir_path( __FILE__ ) );
define( 'YAA_URL', plugin_dir_url( __FILE__ ) );
define( 'YAA_BASENAME', plugin_basename( __FILE__ ) );

require_once YAA_PATH . 'includes/class-yaa-log.php';
require_once YAA_PATH . 'includes/class-yaa-crypto.php';
require_once YAA_PATH . 'includes/class-yaa-settings.php';
require_once YAA_PATH . 'includes/class-yaa-rate-limit.php';
require_once YAA_PATH . 'includes/class-yaa-pricing.php';
require_once YAA_PATH . 'includes/class-yaa-db.php';
require_once YAA_PATH . 'includes/class-yaa-project.php';
require_once YAA_PATH . 'includes/class-yaa-historic-england.php';
require_once YAA_PATH . 'includes/class-yaa-claude.php';
require_once YAA_PATH . 'includes/class-yaa-archie.php';
require_once YAA_PATH . 'includes/class-yaa-rest.php';
require_once YAA_PATH . 'includes/class-yaa-shortcode.php';
require_once YAA_PATH . 'includes/class-yaa-stripe.php';
require_once YAA_PATH . 'includes/class-yaa-email.php';
require_once YAA_PATH . 'includes/class-yaa-files.php';
require_once YAA_PATH . 'includes/class-yaa-portal.php';
require_once YAA_PATH . 'includes/class-yaa-followups.php';
require_once YAA_PATH . 'includes/class-yaa-admin.php';
require_once YAA_PATH . 'includes/class-yaa-pricing-admin.php';
require_once YAA_PATH . 'includes/class-yaa-projects-admin.php';
require_once YAA_PATH . 'includes/class-yaa-analytics.php';

/**
 * Activation: create the custom tables, the client-portal page, and the cron.
 */
function yaa_activate() {
	YAA_DB::install();
	yaa_ensure_portal_page();
	YAA_Followups::schedule();
}
register_activation_hook( __FILE__, 'yaa_activate' );

/** Create the [archie_portal] page once and remember its ID in settings. */
function yaa_ensure_portal_page() {
	$existing = (int) YAA_Settings::get( 'portal_page_id', 0 );
	if ( $existing && 'page' === get_post_type( $existing ) && 'trash' !== get_post_status( $existing ) ) {
		return;
	}
	$page_id = wp_insert_post( array(
		'post_title'   => 'Your project',
		'post_name'    => 'your-project',
		'post_content' => '[archie_portal]',
		'post_status'  => 'publish',
		'post_type'    => 'page',
	) );
	if ( $page_id && ! is_wp_error( $page_id ) ) {
		YAA_Settings::update( array( 'portal_page_id' => (int) $page_id ) );
	}
}

/**
 * Deactivation: clear scheduled events.
 */
function yaa_deactivate() {
	YAA_Followups::unschedule();
	flush_rewrite_rules();
}
register_deactivation_hook( __FILE__, 'yaa_deactivate' );

/**
 * Boot.
 */
function yaa_boot() {
	YAA_Project::init();
	YAA_Rest::init();
	YAA_Shortcode::init();
	YAA_Stripe::init();
	YAA_Email::init();
	YAA_Files::init();
	YAA_Portal::init();
	YAA_Followups::init();
	if ( is_admin() ) {
		YAA_Projects_Admin::init();
		YAA_Analytics::init();
		YAA_Admin::init();
		YAA_Pricing_Admin::init();
	}
}
add_action( 'plugins_loaded', 'yaa_boot' );
