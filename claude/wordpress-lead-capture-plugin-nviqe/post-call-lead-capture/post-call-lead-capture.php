<?php
/**
 * Plugin Name: Brevo Post-Call Lead Capture
 * Plugin URI:  https://github.com/octobercomms/claude
 * Description: After a client call, capture prospect details and send a branded follow-up email via Brevo with report, booking, and payment links.
 * Version:     1.1.0
 * Author:      OctoberComms
 * License:     GPL-2.0-or-later
 * Text Domain: post-call-lead-capture
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'PCLC_VERSION', '1.1.0' );
define( 'PCLC_PLUGIN_FILE', __FILE__ );
define( 'PCLC_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'PCLC_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

require_once PCLC_PLUGIN_DIR . 'includes/class-pclc-database.php';
require_once PCLC_PLUGIN_DIR . 'includes/class-pclc-settings.php';
require_once PCLC_PLUGIN_DIR . 'includes/class-pclc-email.php';
require_once PCLC_PLUGIN_DIR . 'includes/class-pclc-scheduler.php';
require_once PCLC_PLUGIN_DIR . 'includes/class-pclc-form.php';
require_once PCLC_PLUGIN_DIR . 'includes/class-pclc-actions.php';

register_activation_hook( __FILE__, array( 'PCLC_Database', 'create_table' ) );
register_deactivation_hook( __FILE__, array( 'PCLC_Scheduler', 'clear_all_cron' ) );

function pclc_init() {
	PCLC_Settings::init();
	PCLC_Form::init();
	PCLC_Scheduler::init();
	PCLC_Actions::init();
}
add_action( 'init', 'pclc_init' );
