<?php
/**
 * Plugin Name: October Outreach, powered by Claude AI
 * Plugin URI:  https://octobercomms.com
 * Description: AI-powered email outreach platform. Find contacts, write personalised emails with Claude AI, send follow-up emails.
 * Version:     3.10.0
 * Author:      October Comms
 * Author URI:  https://octobercomms.com
 * License:     Proprietary
 * Text Domain: october-outreach
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'OO_VERSION', '3.10.0' );
define( 'OO_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'OO_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'OO_MASTER_LICENSE', 'OO-MASTER-OCTOBER-UNLIMITED' );

// Action Scheduler — bundled in vendor/action-scheduler/
require_once OO_PLUGIN_DIR . 'vendor/action-scheduler/action-scheduler.php';
define( 'OO_HAS_ACTION_SCHEDULER', true );

// Core
require_once OO_PLUGIN_DIR . 'includes/class-oo-database.php';
require_once OO_PLUGIN_DIR . 'includes/class-oo-license.php';
require_once OO_PLUGIN_DIR . 'includes/class-oo-dedup.php';
require_once OO_PLUGIN_DIR . 'includes/class-oo-analytics.php';
require_once OO_PLUGIN_DIR . 'includes/class-oo-portal.php';

// Integrations
require_once OO_PLUGIN_DIR . 'includes/class-oo-claude.php';
require_once OO_PLUGIN_DIR . 'includes/class-oo-hunter.php';
require_once OO_PLUGIN_DIR . 'includes/class-oo-icypeas.php';
require_once OO_PLUGIN_DIR . 'includes/class-oo-scraper.php';
require_once OO_PLUGIN_DIR . 'includes/class-oo-serper.php';
require_once OO_PLUGIN_DIR . 'includes/class-oo-airtable.php';
require_once OO_PLUGIN_DIR . 'includes/class-oo-mailer.php';

// Admin
require_once OO_PLUGIN_DIR . 'admin/class-oo-admin.php';
require_once OO_PLUGIN_DIR . 'admin/class-oo-ajax.php';

register_activation_hook( __FILE__, array( 'OO_Database', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'OO_Database', 'deactivate' ) );

function oo_init() {
    OO_Database::maybe_update();
    OO_Portal::init(); // public client portal (front-end, token-gated)
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
    global $wpdb;

    $campaign_id = intval( $campaign_id );
    if ( ! $campaign_id ) return;

    // 1. Get campaign record; bail if not active
    $campaign = $wpdb->get_row( $wpdb->prepare(
        "SELECT * FROM {$wpdb->prefix}oo_campaigns WHERE id = %d AND status = 'active'",
        $campaign_id
    ) );
    if ( ! $campaign ) return;

    // 2. Fetch up to 50 pending sends due now for this campaign,
    //    joining to exclude unsubscribed / bounced / do_not_contact contacts.
    $pending_sends = $wpdb->get_results( $wpdb->prepare(
        "SELECT s.*, seq.subject AS seq_subject, seq.body AS seq_body,
                seq.step_number, seq.delay_days,
                c.email, c.first_name, c.last_name, c.company
         FROM {$wpdb->prefix}oo_sends s
         JOIN {$wpdb->prefix}oo_contacts c  ON c.id = s.contact_id
         JOIN {$wpdb->prefix}oo_sequences seq ON seq.id = s.sequence_id
         JOIN {$wpdb->prefix}oo_campaigns cam ON cam.id = s.campaign_id
         WHERE s.campaign_id = %d
           AND s.status = 'pending'
           AND s.scheduled_at <= NOW()
           AND c.status NOT IN ('unsubscribed', 'bounced', 'do_not_contact')
         LIMIT 50",
        $campaign_id
    ) );

    // 4. Process each pending send
    $mailer = new OO_Mailer();

    foreach ( $pending_sends as $send ) {

        // 4a. Check if contact has already replied on this campaign — skip if so
        $replied = $wpdb->get_var( $wpdb->prepare(
            "SELECT id FROM {$wpdb->prefix}oo_sends
             WHERE campaign_id = %d AND contact_id = %d AND status = 'replied'
             LIMIT 1",
            $campaign_id,
            $send->contact_id
        ) );

        if ( $replied ) {
            $wpdb->update(
                $wpdb->prefix . 'oo_sends',
                array( 'status' => 'skipped' ),
                array( 'id' => $send->id )
            );
            continue;
        }

        // 4b. Personalise subject and body
        $replacements = array(
            '{{first_name}}' => $send->first_name,
            '{{last_name}}'  => $send->last_name,
            '{{company}}'    => $send->company,
        );

        $subject  = str_replace( array_keys( $replacements ), array_values( $replacements ), $send->seq_subject );
        $body_html = str_replace( array_keys( $replacements ), array_values( $replacements ), $send->seq_body );

        // 4c. Send via mailer
        $mail_result = $mailer->send(
            $send->email,
            trim( $send->first_name . ' ' . $send->last_name ),
            $campaign->from_email,
            $campaign->from_name,
            $campaign->reply_to ?: $campaign->from_email,
            $subject,
            $body_html
        );

        // 4d–4e. Update send record
        if ( is_wp_error( $mail_result ) ) {
            $wpdb->update(
                $wpdb->prefix . 'oo_sends',
                array( 'status' => 'failed' ),
                array( 'id' => $send->id )
            );
            continue;
        }

        $wpdb->update(
            $wpdb->prefix . 'oo_sends',
            array(
                'status'     => 'sent',
                'sent_at'    => current_time( 'mysql' ),
                'message_id' => $mail_result['message_id'] ?? '',
            ),
            array( 'id' => $send->id )
        );

        // 4f. Schedule next step in the sequence if one exists
        $next_step = $wpdb->get_row( $wpdb->prepare(
            "SELECT * FROM {$wpdb->prefix}oo_sequences
             WHERE campaign_id = %d AND step_number = %d AND status = 'active'
             LIMIT 1",
            $campaign_id,
            intval( $send->step_number ) + 1
        ) );

        if ( $next_step ) {
            // Only insert if a row for this campaign+contact+sequence doesn't already exist
            $already_queued = $wpdb->get_var( $wpdb->prepare(
                "SELECT id FROM {$wpdb->prefix}oo_sends
                 WHERE campaign_id = %d AND contact_id = %d AND sequence_id = %d
                 LIMIT 1",
                $campaign_id,
                $send->contact_id,
                $next_step->id
            ) );

            if ( ! $already_queued ) {
                $wpdb->insert(
                    $wpdb->prefix . 'oo_sends',
                    array(
                        'campaign_id'  => $campaign_id,
                        'contact_id'   => $send->contact_id,
                        'sequence_id'  => $next_step->id,
                        'status'       => 'pending',
                        'scheduled_at' => $wpdb->get_var( $wpdb->prepare(
                            "SELECT DATE_ADD(NOW(), INTERVAL %d DAY)",
                            intval( $next_step->delay_days )
                        ) ),
                    )
                );
            }
        }
    }

    // 5. If no pending sends remain, mark campaign complete and unschedule
    $any_pending = $wpdb->get_var( $wpdb->prepare(
        "SELECT COUNT(*) FROM {$wpdb->prefix}oo_sends
         WHERE campaign_id = %d AND status = 'pending'",
        $campaign_id
    ) );

    if ( ! intval( $any_pending ) ) {
        $wpdb->update(
            $wpdb->prefix . 'oo_campaigns',
            array( 'status' => 'complete' ),
            array( 'id' => $campaign_id )
        );
        oo_unschedule_sequence_processing( $campaign_id );
    }
}
