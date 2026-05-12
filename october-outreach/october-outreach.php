<?php
/**
 * Plugin Name: October Outreach
 * Plugin URI:  https://octobercomms.com
 * Description: AI-powered email outreach platform. Find contacts, write personalised emails with Claude, send via Amazon SES.
 * Version:     2.1.0
 * Author:      October Comms
 * Author URI:  https://octobercomms.com
 * License:     Proprietary
 * Text Domain: october-outreach
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'OO_VERSION', '2.1.0' );
define( 'OO_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'OO_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'OO_MASTER_LICENSE', 'OO-MASTER-OCTOBER-UNLIMITED' );

// Action Scheduler — bundled in vendor/action-scheduler/
require_once OO_PLUGIN_DIR . 'vendor/action-scheduler/action-scheduler.php';
define( 'OO_HAS_ACTION_SCHEDULER', true );

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

/**
 * Schedule a send batch via Action Scheduler (preferred) or WP Cron (fallback).
 * Called by wizard launch and Stage 3 sending engine.
 */
function oo_schedule_sequence_processing( $campaign_id ) {
    if ( OO_HAS_ACTION_SCHEDULER ) {
        if ( ! as_has_scheduled_action( 'oo_process_sequences', array( $campaign_id ) ) ) {
            as_schedule_recurring_action( time(), HOUR_IN_SECONDS, 'oo_process_sequences', array( $campaign_id ), 'october-outreach' );
        }
    } else {
        if ( ! wp_next_scheduled( 'oo_process_sequences', array( $campaign_id ) ) ) {
            wp_schedule_event( time(), 'hourly', 'oo_process_sequences', array( $campaign_id ) );
        }
    }
}

/**
 * Unschedule processing for a campaign (on pause or complete).
 */
function oo_unschedule_sequence_processing( $campaign_id ) {
    if ( OO_HAS_ACTION_SCHEDULER ) {
        as_unschedule_all_actions( 'oo_process_sequences', array( $campaign_id ), 'october-outreach' );
    } else {
        $timestamp = wp_next_scheduled( 'oo_process_sequences', array( $campaign_id ) );
        if ( $timestamp ) {
            wp_unschedule_event( $timestamp, 'oo_process_sequences', array( $campaign_id ) );
        }
    }
}

// Hook for Stage 3 sending engine
add_action( 'oo_process_sequences', 'oo_process_sequences_handler' );
function oo_process_sequences_handler( $campaign_id = 0 ) {
    // Implemented in Stage 3
}
