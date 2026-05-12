<?php
/**
 * Plugin Name: October Outreach
 * Plugin URI:  https://octobercomms.com
 * Description: AI-powered email outreach platform. Find contacts, write personalised emails with Claude, send via Amazon SES.
 * Version:     2.0.0
 * Author:      October Comms
 * Author URI:  https://octobercomms.com
 * License:     Proprietary
 * Text Domain: october-outreach
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'OO_VERSION', '2.0.0' );
define( 'OO_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'OO_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'OO_MASTER_LICENSE', 'OO-MASTER-OCTOBER-UNLIMITED' );

// Core
require_once OO_PLUGIN_DIR . 'includes/class-oo-database.php';
require_once OO_PLUGIN_DIR . 'includes/class-oo-license.php';

// Integrations
require_once OO_PLUGIN_DIR . 'includes/class-oo-claude.php';
require_once OO_PLUGIN_DIR . 'includes/class-oo-hunter.php';
require_once OO_PLUGIN_DIR . 'includes/class-oo-airtable.php';

// Admin
require_once OO_PLUGIN_DIR . 'admin/class-oo-admin.php';
require_once OO_PLUGIN_DIR . 'admin/class-oo-ajax.php';

register_activation_hook( __FILE__, array( 'OO_Database', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'OO_Database', 'deactivate' ) );

function oo_init() {
    if ( is_admin() ) {
        new OO_Admin();
        new OO_Ajax();
    }
}
add_action( 'plugins_loaded', 'oo_init' );

// WP Cron hook for email sequences (Stage 3)
add_action( 'oo_process_sequences', 'oo_process_sequences_handler' );
function oo_process_sequences_handler() {
    // Implemented in Stage 3
}
