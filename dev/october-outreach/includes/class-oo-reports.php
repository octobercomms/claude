<?php
/**
 * Automated client coverage reports + "you've been featured" alerts.
 *
 * A daily Action Scheduler tick sends each client their weekly/monthly digest
 * when due; reports can also be sent on demand. Alerts fire when a single log
 * entry is moved to Published in the admin.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class OO_Reports {

    public static function init() {
        add_action( 'oo_pr_reports_tick', array( __CLASS__, 'run_due' ) );

        if ( defined( 'OO_HAS_ACTION_SCHEDULER' ) && OO_HAS_ACTION_SCHEDULER
            && function_exists( 'as_has_scheduled_action' )
            && ! as_has_scheduled_action( 'oo_pr_reports_tick', array(), 'october-outreach' ) ) {
            as_schedule_recurring_action( time() + HOUR_IN_SECONDS, DAY_IN_SECONDS, 'oo_pr_reports_tick', array(), 'october-outreach' );
        }
    }

    /** Window length (days) for a cadence. */
    private static function window_days( $cadence ) {
        return $cadence === 'monthly' ? 30 : 7;
    }

    /** Send any client reports that are due. Called by the daily tick. */
    public static function run_due() {
        global $wpdb;
        $clients = $wpdb->get_results(
            "SELECT * FROM {$wpdb->prefix}oo_clients WHERE report_cadence != 'off' AND alert_email != ''"
        );
        foreach ( $clients as $client ) {
            $window = self::window_days( $client->report_cadence );
            $due = ! $client->last_report_at
                || ( time() - strtotime( $client->last_report_at ) ) >= ( $window - 0.5 ) * DAY_IN_SECONDS;
            if ( $due ) {
                self::send_client_report( $client->id, false );
            }
        }
    }

    /**
     * Build and send a client's coverage report.
     *
     * @param bool $manual when true, sends a full snapshot even if nothing is
     *                     new (and ignores the "nothing new" skip).
     * @return true|WP_Error
     */
    public static function send_client_report( $client_id, $manual = false ) {
        global $wpdb;
        $client = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}oo_clients WHERE id = %d", $client_id ) );
        if ( ! $client ) return new WP_Error( 'no_client', 'Client not found.' );
        if ( ! $client->alert_email ) return new WP_Error( 'no_email', 'This client has no report email set.' );

        $from = self::from_identity();
        if ( ! $from ) return new WP_Error( 'no_sender', 'Set a Default Reply-To address in Settings to send reports.' );

        $cadence = $client->report_cadence === 'off' ? 'weekly' : $client->report_cadence;
        $window  = self::window_days( $cadence );
        $since   = $manual ? null : ( $client->last_report_at ?: gmdate( 'Y-m-d H:i:s', time() - $window * DAY_IN_SECONDS ) );

        $items = self::gather_published( $client->name, $since );
        if ( ! $manual && empty( $items ) ) {
            return new WP_Error( 'nothing_new', 'No new coverage this period.' );
        }

        $period_label = $manual ? 'to date' : ( $cadence === 'monthly' ? 'the past month' : 'the past week' );

        // Claude narrative (graceful fallback if unavailable).
        $summary = '';
        $claude  = new OO_Claude();
        if ( $claude->is_configured() ) {
            $res = $claude->write_coverage_report( $client->name, $items, $period_label );
            if ( ! is_wp_error( $res ) ) $summary = trim( $res );
        }
        if ( $summary === '' ) {
            $summary = count( $items ) . ' piece(s) of coverage to share for ' . $period_label . '.';
        }

        $subject = sprintf( '%s — press coverage (%s)', $client->name, $period_label );
        $body    = self::build_email( $client, $summary, $items );

        $mailer = new OO_Mailer();
        $result = $mailer->send( $client->alert_email, $client->name, $from['email'], $from['name'], $from['reply_to'], $subject, $body );
        if ( is_wp_error( $result ) ) return $result;

        $wpdb->update( $wpdb->prefix . 'oo_clients', array( 'last_report_at' => current_time( 'mysql' ) ), array( 'id' => $client->id ) );
        return true;
    }

    /**
     * Fire a "you've been featured" alert for a single newly-published entry.
     */
    public static function send_published_alert( $client_name, $row ) {
        global $wpdb;
        $client = $wpdb->get_row( $wpdb->prepare(
            "SELECT * FROM {$wpdb->prefix}oo_clients WHERE name = %s", $client_name
        ) );
        if ( ! $client || ! $client->alert_email ) return;
        $from = self::from_identity();
        if ( ! $from ) return;

        $outlet  = $row['outlet'] ?? '';
        $title   = $row['title'] ?? '';
        $url     = $row['url'] ?? '';
        $portal  = OO_Portal::portal_url( $client->token );

        $subject = '🎉 You\'ve been featured' . ( $outlet ? ' in ' . $outlet : '' );
        $body  = '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;line-height:1.6">';
        $body .= '<p>Good news — new coverage for <strong>' . esc_html( $client->name ) . '</strong>:</p>';
        $body .= '<p style="font-size:16px"><strong>' . esc_html( $outlet ) . '</strong>' . ( $title ? ' — ' . esc_html( $title ) : '' ) . '</p>';
        if ( $url )    $body .= '<p><a href="' . esc_url( $url ) . '">Read the piece →</a></p>';
        $body .= '<p><a href="' . esc_url( $portal ) . '">View all your coverage →</a></p>';
        $body .= '</div>';

        ( new OO_Mailer() )->send( $client->alert_email, $client->name, $from['email'], $from['name'], $from['reply_to'], $subject, $body );
    }

    private static function gather_published( $client_name, $since = null ) {
        global $wpdb;
        $sql  = "SELECT l.story_title, l.issue_date, l.story_url, o.name AS outlet, c.first_name, c.last_name
                 FROM {$wpdb->prefix}oo_editorial_log l
                 LEFT JOIN {$wpdb->prefix}oo_outlets o ON o.id = l.outlet_id
                 LEFT JOIN {$wpdb->prefix}oo_contacts c ON c.id = l.contact_id
                 WHERE l.client = %s AND l.status IN ('published','download')";
        $args = array( $client_name );
        if ( $since ) {
            $sql   .= " AND COALESCE(l.issue_date, l.created_at) >= %s";
            $args[] = $since;
        }
        $sql .= " ORDER BY COALESCE(l.issue_date, l.created_at) DESC";
        $rows = $wpdb->get_results( $wpdb->prepare( $sql, $args ) );

        $items = array();
        foreach ( $rows as $r ) {
            $items[] = array(
                'outlet'     => $r->outlet ?: '',
                'journalist' => trim( ( $r->first_name ?? '' ) . ' ' . ( $r->last_name ?? '' ) ),
                'title'      => $r->story_title ?: '',
                'date'       => $r->issue_date ? date( 'd M Y', strtotime( $r->issue_date ) ) : '',
                'url'        => $r->story_url ?: '',
            );
        }
        return $items;
    }

    private static function build_email( $client, $summary, $items ) {
        $portal = OO_Portal::portal_url( $client->token );
        $h  = '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;line-height:1.6;max-width:640px">';
        $h .= '<h2 style="margin:0 0 4px">' . esc_html( $client->name ) . '</h2>';
        $h .= '<p style="color:#6b7280;margin:0 0 16px">Press coverage update</p>';
        $h .= '<p>' . nl2br( esc_html( $summary ) ) . '</p>';
        if ( $items ) {
            $h .= '<ul style="padding-left:18px">';
            foreach ( $items as $it ) {
                $line = '<strong>' . esc_html( $it['outlet'] ) . '</strong>';
                if ( $it['title'] ) $line .= ' — ' . esc_html( $it['title'] );
                if ( $it['date'] )  $line .= ' <span style="color:#6b7280">(' . esc_html( $it['date'] ) . ')</span>';
                if ( $it['url'] )   $line = '<a href="' . esc_url( $it['url'] ) . '" style="color:#111">' . $line . '</a>';
                $h .= '<li style="margin-bottom:6px">' . $line . '</li>';
            }
            $h .= '</ul>';
        }
        $h .= '<p style="margin-top:18px"><a href="' . esc_url( $portal ) . '" style="background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">View your live coverage page →</a></p>';
        $h .= '</div>';
        return $h;
    }

    /** From/reply-to identity from settings, or null when unconfigured. */
    private static function from_identity() {
        $settings = get_option( 'oo_settings', array() );
        $email    = $settings['default_reply_to'] ?? '';
        if ( ! $email || ! is_email( $email ) ) return null;
        return array(
            'email'    => $email,
            'name'     => 'October Comms',
            'reply_to' => $email,
        );
    }
}
