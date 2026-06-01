<?php
/**
 * Plugin Name: Hillcroft Garden Designer
 * Plugin URI: https://octobercomms.com
 * Description: AI-powered garden design system for Hillcroft Gardens — consultation capture, plant catalogue, pricing, visual renders, client proposals and payments. Foundation build.
 * Version: 1.3.4
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

define( 'HGD_VERSION', '1.3.4' );
define( 'HGD_PATH', plugin_dir_path( __FILE__ ) );
define( 'HGD_URL', plugin_dir_url( __FILE__ ) );
define( 'HGD_BASENAME', plugin_basename( __FILE__ ) );

// Forms subsystem (ported from October Forms). Reuses the Hillcroft paths/URL/version.
define( 'HGDF_CPT', 'hgd_form' );
define( 'HGDF_DB_VERSION', '1' );
define( 'HGDF_PATH', HGD_PATH );
define( 'HGDF_URL', HGD_URL );
define( 'HGDF_VERSION', HGD_VERSION );

require_once HGD_PATH . 'includes/class-hgd-db.php';
require_once HGD_PATH . 'includes/class-hgd-activator.php';
require_once HGD_PATH . 'includes/class-hgd-settings.php';
require_once HGD_PATH . 'includes/class-hgd-plant.php';
require_once HGD_PATH . 'includes/class-hgd-client.php';
require_once HGD_PATH . 'includes/class-hgd-project.php';
require_once HGD_PATH . 'includes/class-hgd-project-asset.php';
require_once HGD_PATH . 'includes/class-hgd-quote.php';
require_once HGD_PATH . 'includes/class-hgd-proposal.php';
require_once HGD_PATH . 'includes/class-hgd-payment.php';
require_once HGD_PATH . 'includes/class-hgd-claude.php';
require_once HGD_PATH . 'includes/class-hgd-chat.php';
require_once HGD_PATH . 'includes/class-hgd-gemini.php';
require_once HGD_PATH . 'includes/class-hgd-maps.php';
require_once HGD_PATH . 'includes/class-hgd-render-pack.php';
require_once HGD_PATH . 'includes/class-hgd-booking.php';
require_once HGD_PATH . 'includes/class-hgd-stripe.php';
require_once HGD_PATH . 'includes/class-hgd-google.php';
require_once HGD_PATH . 'includes/class-hgd-availability.php';
require_once HGD_PATH . 'includes/class-hgd-booking-page.php';
require_once HGD_PATH . 'includes/class-hgd-proposal-portal.php';
require_once HGD_PATH . 'includes/class-hgd-documents.php';
require_once HGD_PATH . 'includes/class-hgd-api-usage.php';
require_once HGD_PATH . 'includes/class-hgd-lead-form.php';
require_once HGD_PATH . 'includes/class-hgd-demo.php';
require_once HGD_PATH . 'includes/class-hgd-updater.php';

// Forms subsystem (ported engine).
require_once HGD_PATH . 'includes/forms/class-hgdf-activator.php';
require_once HGD_PATH . 'includes/forms/class-hgdf-schema.php';
require_once HGD_PATH . 'includes/forms/class-hgdf-cpt.php';
require_once HGD_PATH . 'includes/forms/class-hgdf-logic.php';
require_once HGD_PATH . 'includes/forms/class-hgdf-submission.php';
require_once HGD_PATH . 'includes/forms/class-hgdf-spam.php';
require_once HGD_PATH . 'includes/forms/class-hgdf-analytics.php';
require_once HGD_PATH . 'includes/forms/class-hgdf-renderer.php';
require_once HGD_PATH . 'includes/forms/class-hgdf-rest-api.php';
require_once HGD_PATH . 'includes/forms/class-hgdf-mail.php';

// Closed-loop bridge: turns completed form submissions into Hillcroft clients/projects.
require_once HGD_PATH . 'includes/class-hgd-form-bridge.php';

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

// Public-facing lead-capture form ([hgd_enquiry] shortcode + submit handler).
$hgd_lead_form = new HGD_Lead_Form();
$hgd_lead_form->register();

// Paid consultation booking ([hgd_booking] shortcode, REST routes + Stripe webhook).
HGD_Booking_Page::init();

// Public proposal client portal (tokenised page + accept/pay REST routes).
HGD_Proposal_Portal::init();

// Client-facing keepsakes: plant book, printable proposal keepsake, seasonal film.
HGD_Documents::init();

// Forms subsystem runtime.
add_action( 'plugins_loaded', function () {
	HGDF_CPT::init();
	HGDF_Renderer::init();
	HGDF_REST_API::init();
	HGDF_Spam::init();
	HGDF_Mail::init();
	HGD_Form_Bridge::init();

	if ( is_admin() ) {
		require_once HGD_PATH . 'admin/forms/class-hgdf-builder.php';
		require_once HGD_PATH . 'admin/forms/class-hgdf-submissions-list.php';
		require_once HGD_PATH . 'admin/forms/class-hgdf-analytics-page.php';
		HGDF_Builder::init();
		HGDF_Submissions_List::init();
		HGDF_Analytics_Page::init();
	}

	// Run any deferred forms DB upgrade.
	if ( get_option( 'hgd_form_db_version' ) !== HGDF_DB_VERSION ) {
		HGDF_Activator::activate();
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
