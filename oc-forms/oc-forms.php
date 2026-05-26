<?php
/**
 * Plugin Name: nvelope Forms
 * Plugin URI: https://nvelope.co
 * Description: Multi-step lead generation forms for nvelope.co — image-card pickers, conditional logic, file uploads, partial submission capture, per-client theming, Brevo integration. Self-hosted replacement for Fillout and Gravity Forms.
 * Version: 1.0.0
 * Author: October Comms
 * Author URI: https://octobercomms.com
 * License: GPL v2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: nvelope-forms
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'OCF_VERSION', '1.1.1' );
define( 'OCF_PATH', plugin_dir_path( __FILE__ ) );
define( 'OCF_URL', plugin_dir_url( __FILE__ ) );
define( 'OCF_CPT', 'ocf_form' );
define( 'OCF_DB_VERSION', '1.1.0' );

require_once OCF_PATH . 'includes/class-ocf-activator.php';
require_once OCF_PATH . 'includes/class-ocf-schema.php';
require_once OCF_PATH . 'includes/class-ocf-cpt.php';
require_once OCF_PATH . 'includes/class-ocf-logic.php';
require_once OCF_PATH . 'includes/class-ocf-submission.php';
require_once OCF_PATH . 'includes/class-ocf-brevo.php';
require_once OCF_PATH . 'includes/class-ocf-spam.php';
require_once OCF_PATH . 'includes/class-ocf-analytics.php';
require_once OCF_PATH . 'includes/class-ocf-renderer.php';
require_once OCF_PATH . 'includes/class-ocf-rest-api.php';
require_once OCF_PATH . 'includes/class-ocf-public-api.php';
require_once OCF_PATH . 'includes/class-ocf-compat.php';

if ( is_admin() ) {
	require_once OCF_PATH . 'admin/class-ocf-admin.php';
	require_once OCF_PATH . 'admin/class-ocf-settings.php';
	require_once OCF_PATH . 'admin/class-ocf-builder.php';
	require_once OCF_PATH . 'admin/class-ocf-submissions-list.php';
	require_once OCF_PATH . 'admin/class-ocf-analytics-page.php';
}

register_activation_hook( __FILE__, array( 'OCF_Activator', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'OCF_Activator', 'deactivate' ) );

add_action( 'plugins_loaded', function () {
	OCF_CPT::init();
	OCF_Renderer::init();
	OCF_REST_API::init();
	OCF_Public_API::init();
	OCF_Spam::init();
	OCF_Compat::init();

	if ( is_admin() ) {
		OCF_Admin::init();
		OCF_Settings::init();
		OCF_Builder::init();
		OCF_Submissions_List::init();
		OCF_Analytics_Page::init();
	}

	// Run any deferred DB upgrade.
	if ( get_option( 'ocf_db_version' ) !== OCF_DB_VERSION ) {
		OCF_Activator::activate();
	}
} );
