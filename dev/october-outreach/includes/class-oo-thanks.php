<?php
/**
 * Thank-you auto-send ramp (graduated autonomy).
 *
 * Per-client `thank_stage` controls how far automation goes:
 *   - assist     : nothing auto-sends (the human drafts/sends on the Thank-yous
 *                  page) — the safe default.
 *   - supervised : auto-send only very high-confidence thank-yous; the rest wait
 *                  for a human.
 *   - auto       : auto-send confident thank-yous; only ambiguous ones wait.
 *
 * Claude scores each draft's confidence; a scheduled tick sends the ones that
 * clear the stage threshold, capped per run. Everything still respects the
 * no-repeat memory, a real journalist email, and a configured reply-to address.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class OO_Thanks {

    const MAX_PER_CLIENT_PER_RUN = 10;

    public static function init() {
        add_action( 'oo_pr_thanks_tick', array( __CLASS__, 'run_auto' ) );
        if ( defined( 'OO_HAS_ACTION_SCHEDULER' ) && OO_HAS_ACTION_SCHEDULER
            && function_exists( 'as_has_scheduled_action' )
            && ! as_has_scheduled_action( 'oo_pr_thanks_tick', array(), 'october-outreach' ) ) {
            as_schedule_recurring_action( time() + 2 * HOUR_IN_SECONDS, DAY_IN_SECONDS, 'oo_pr_thanks_tick', array(), 'october-outreach' );
        }
    }

    public static function stages() {
        return array(
            'assist'     => 'Assisted — I approve every send',
            'supervised' => 'Supervised — auto-send only very confident ones',
            'auto'       => 'Auto — send confident ones automatically',
        );
    }

    private static function threshold( $stage ) {
        if ( $stage === 'auto' )       return 0.70;
        if ( $stage === 'supervised' ) return 0.85;
        return 2.0; // assist → never auto-sends
    }

    /** Approve/edit/reject counts for a client (its coverage's thank-yous). */
    public static function track_record( $client_name ) {
        global $wpdb;
        $rows = $wpdb->get_results( $wpdb->prepare(
            "SELECT f.decision, COUNT(*) AS n
             FROM {$wpdb->prefix}oo_thank_feedback f
             JOIN {$wpdb->prefix}oo_editorial_log l ON l.id = f.editorial_log_id
             WHERE l.client = %s GROUP BY f.decision", $client_name
        ), ARRAY_A );
        $out = array( 'approved' => 0, 'edited' => 0, 'rejected' => 0, 'auto' => 0 );
        foreach ( $rows as $r ) { $out[ $r['decision'] ] = (int) $r['n']; }
        return $out;
    }

    /** Scheduled: auto-send confident thank-yous for opted-in clients. */
    public static function run_auto() {
        global $wpdb;
        $settings = get_option( 'oo_settings', array() );
        $from     = $settings['default_reply_to'] ?? '';
        if ( ! $from || ! is_email( $from ) ) return; // can't send without an identity

        $claude = new OO_Claude();
        if ( ! $claude->is_configured() ) return;

        $clients = $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}oo_clients WHERE thank_stage IN ('supervised','auto')" );
        foreach ( $clients as $client ) {
            $threshold = self::threshold( $client->thank_stage );

            $rows = $wpdb->get_results( $wpdb->prepare(
                "SELECT l.id, l.story_title, l.client, c.id AS contact_id, c.first_name, c.last_name, c.email,
                        o.name AS outlet
                 FROM {$wpdb->prefix}oo_editorial_log l
                 JOIN {$wpdb->prefix}oo_contacts c ON c.id = l.contact_id
                 LEFT JOIN {$wpdb->prefix}oo_outlets o ON o.id = l.outlet_id
                 WHERE l.client = %s AND l.status IN ('published','download')
                   AND c.email <> '' AND c.email NOT LIKE '%@import.local'
                   AND c.availability_status = 'active'
                   AND NOT EXISTS ( SELECT 1 FROM {$wpdb->prefix}oo_sent_thanks s WHERE s.editorial_log_id = l.id )
                   AND NOT EXISTS ( SELECT 1 FROM {$wpdb->prefix}oo_thank_feedback f WHERE f.editorial_log_id = l.id )
                 ORDER BY COALESCE(l.issue_date, l.created_at) DESC
                 LIMIT %d", $client->name, self::MAX_PER_CLIENT_PER_RUN
            ) );

            foreach ( $rows as $r ) {
                $name  = trim( $r->first_name . ' ' . $r->last_name );
                $prior = $wpdb->get_col( $wpdb->prepare(
                    "SELECT body_excerpt FROM {$wpdb->prefix}oo_sent_thanks WHERE contact_id = %d ORDER BY sent_at DESC LIMIT 5", $r->contact_id
                ) );
                $draft = $claude->write_thank_you( $name, $r->outlet, $r->story_title, $r->client, $prior );
                if ( is_wp_error( $draft ) ) continue;
                $conf = isset( $draft['confidence'] ) ? floatval( $draft['confidence'] ) : 0;
                if ( $conf < $threshold ) continue; // leave for the human queue

                self::deliver( $r->email, $name, $from, $draft, $r->id, $r->contact_id, $conf, 'auto' );
            }
        }
    }

    /** Send a thank-you and record it (no-repeat memory + feedback). */
    public static function deliver( $to, $name, $from, $draft, $entry_id, $contact_id, $confidence, $decision ) {
        global $wpdb;
        $subject = $draft['subject'] ?? 'Thank you';
        $body    = $draft['body'] ?? '';
        if ( $body === '' ) return false;
        $html = '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;line-height:1.6">' . nl2br( esc_html( $body ) ) . '</div>';

        $result = ( new OO_Mailer() )->send( $to, $name, $from, 'October Comms', $from, $subject, $html );
        if ( is_wp_error( $result ) ) return false;

        $wpdb->insert( $wpdb->prefix . 'oo_sent_thanks', array(
            'contact_id'       => $contact_id,
            'editorial_log_id' => $entry_id,
            'tone'             => sanitize_text_field( $draft['tone'] ?? '' ),
            'body_excerpt'     => mb_substr( $body, 0, 240 ),
            'confidence'       => $confidence,
        ) );
        $wpdb->insert( $wpdb->prefix . 'oo_thank_feedback', array(
            'editorial_log_id' => $entry_id,
            'contact_id'       => $contact_id,
            'claude_confidence'=> $confidence,
            'decision'         => $decision,
        ) );
        return true;
    }
}
