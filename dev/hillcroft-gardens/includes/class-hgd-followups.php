<?php
/**
 * Follow-up automation.
 *
 * A once-daily WP-Cron job that sends gentle, client-facing reminder emails:
 *   - lead nudge        — an enquiry with no consultation booked after N days
 *   - proposal reminder — a sent/viewed proposal still unanswered after N days
 *   - proposal expiring — a sent/viewed proposal whose expiry is within N days
 *
 * Each reminder is sent at most once per record (tracked in the hgd_followups
 * log), so the job is safe to run every day. The whole feature is opt-in
 * (off until enabled in Settings) and each reminder type can be toggled.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Followups {

	const CRON_HOOK = 'hgd_daily_followups';

	public static function init() {
		add_action( self::CRON_HOOK, array( __CLASS__, 'run' ) );
	}

	/** Ensure the daily event is scheduled (called from the activator). */
	public static function schedule() {
		if ( ! wp_next_scheduled( self::CRON_HOOK ) ) {
			// Start tomorrow ~08:00 site time so reminders land in the morning.
			$tz    = wp_timezone();
			$first = ( new DateTimeImmutable( 'tomorrow 08:00', $tz ) )->getTimestamp();
			wp_schedule_event( $first, 'daily', self::CRON_HOOK );
		}
	}

	/** Clear the scheduled event (called from the deactivator). */
	public static function unschedule() {
		$ts = wp_next_scheduled( self::CRON_HOOK );
		if ( $ts ) {
			wp_unschedule_event( $ts, self::CRON_HOOK );
		}
	}

	/** The daily run. Honours the master toggle + per-type toggles. */
	public static function run() {
		if ( ! (int) HGD_Settings::get( 'followups_enabled', 0 ) ) {
			return;
		}
		if ( (int) HGD_Settings::get( 'followup_lead_enabled', 1 ) ) {
			self::lead_nudges();
		}
		if ( (int) HGD_Settings::get( 'followup_proposal_enabled', 1 ) ) {
			self::proposal_reminders();
		}
		if ( (int) HGD_Settings::get( 'followup_expiring_enabled', 1 ) ) {
			self::proposal_expiring();
		}
	}

	// -------------------------------------------------------------------------
	// Reminder types
	// -------------------------------------------------------------------------

	/** Enquiries/leads with no paid consultation after N days. */
	private static function lead_nudges() {
		global $wpdb;
		$days     = max( 1, (int) HGD_Settings::get( 'followup_lead_days', 3 ) );
		$projects = HGD_DB::projects_table();
		$bookings = HGD_DB::bookings_table();
		$cutoff   = self::days_ago( $days );

		// Leads/enquiries older than the cutoff, with a linked client, and with
		// no paid booking for the project.
		$rows = $wpdb->get_results( $wpdb->prepare(
			"SELECT p.* FROM {$projects} p
			 WHERE p.status IN ('lead','enquiry')
			   AND p.client_id IS NOT NULL
			   AND p.created_at <= %s
			   AND NOT EXISTS (
			       SELECT 1 FROM {$bookings} b
			       WHERE b.project_id = p.id AND b.status = 'paid'
			   )",
			$cutoff
		), ARRAY_A ) ?: array();

		foreach ( $rows as $project ) {
			if ( self::already_sent( 'project', (int) $project['id'], 'lead_nudge' ) ) {
				continue;
			}
			$client = HGD_Client::get( (int) $project['client_id'] );
			if ( ! $client || empty( $client['email'] ) ) {
				continue;
			}
			self::send_lead_nudge( $client );
			self::log_sent( 'project', (int) $project['id'], 'lead_nudge', (string) $client['email'] );
		}
	}

	/** Sent/viewed proposals still unanswered after N days (and not expired). */
	private static function proposal_reminders() {
		global $wpdb;
		$days      = max( 1, (int) HGD_Settings::get( 'followup_proposal_days', 5 ) );
		$proposals = HGD_DB::proposals_table();
		$cutoff    = self::days_ago( $days );

		$rows = $wpdb->get_results( $wpdb->prepare(
			"SELECT * FROM {$proposals}
			 WHERE status IN ('sent','viewed')
			   AND sent_at IS NOT NULL
			   AND sent_at <= %s",
			$cutoff
		), ARRAY_A ) ?: array();

		foreach ( $rows as $proposal ) {
			if ( HGD_Proposal::is_expired( $proposal ) ) {
				continue;
			}
			if ( self::already_sent( 'proposal', (int) $proposal['id'], 'proposal_reminder' ) ) {
				continue;
			}
			$email = self::proposal_email( $proposal );
			if ( '' === $email ) {
				continue;
			}
			self::send_proposal_reminder( $proposal, $email, false );
			self::log_sent( 'proposal', (int) $proposal['id'], 'proposal_reminder', $email );
		}
	}

	/** Sent/viewed proposals whose expiry falls within N days — a final nudge. */
	private static function proposal_expiring() {
		global $wpdb;
		$days      = max( 1, (int) HGD_Settings::get( 'followup_expiring_days', 3 ) );
		$proposals = HGD_DB::proposals_table();
		$now       = current_time( 'mysql' );
		$window    = self::days_ahead( $days );

		$rows = $wpdb->get_results( $wpdb->prepare(
			"SELECT * FROM {$proposals}
			 WHERE status IN ('sent','viewed')
			   AND expires_at IS NOT NULL
			   AND expires_at > %s
			   AND expires_at <= %s",
			$now,
			$window
		), ARRAY_A ) ?: array();

		foreach ( $rows as $proposal ) {
			if ( self::already_sent( 'proposal', (int) $proposal['id'], 'proposal_expiring' ) ) {
				continue;
			}
			$email = self::proposal_email( $proposal );
			if ( '' === $email ) {
				continue;
			}
			self::send_proposal_reminder( $proposal, $email, true );
			self::log_sent( 'proposal', (int) $proposal['id'], 'proposal_expiring', $email );
		}
	}

	// -------------------------------------------------------------------------
	// Emails
	// -------------------------------------------------------------------------

	private static function send_lead_nudge( array $client ) {
		$site    = wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES );
		$name    = trim( (string) $client['first_name'] . ' ' . (string) $client['last_name'] );
		$book    = (string) HGD_Settings::get( 'booking_page_url', '' );
		$book    = '' !== $book ? $book : home_url( '/' );

		$subject = sprintf( __( 'Still thinking about your garden? — %s', 'hillcroft-garden-designer' ), $site );
		$body    = ( '' !== $name ? sprintf( __( 'Hi %s,', 'hillcroft-garden-designer' ), $name ) : __( 'Hello,', 'hillcroft-garden-designer' ) ) . "\n\n";
		$body   .= __( 'Thanks again for your enquiry. Whenever you\'re ready, we\'d love to help bring your garden to life — the next step is a design consultation, and you can book a time that suits you here:', 'hillcroft-garden-designer' ) . "\n\n";
		$body   .= $book . "\n\n";
		$body   .= __( 'If you have any questions first, just reply to this email.', 'hillcroft-garden-designer' ) . "\n\n";
		$body   .= $site . "\n";

		self::mail( (string) $client['email'], $subject, $body );
	}

	private static function send_proposal_reminder( array $proposal, $email, $expiring ) {
		$site    = wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES );
		$url     = HGD_Proposal::portal_url( $proposal );
		$client  = self::proposal_client( $proposal );
		$name    = $client ? trim( (string) $client['first_name'] . ' ' . (string) $client['last_name'] ) : '';

		if ( $expiring ) {
			$expires = ! empty( $proposal['expires_at'] ) ? mysql2date( get_option( 'date_format' ), $proposal['expires_at'] ) : '';
			$subject = sprintf( __( 'Your %s proposal expires soon', 'hillcroft-garden-designer' ), $site );
			$intro   = '' !== $expires
				? sprintf( __( 'Just a friendly reminder that your garden proposal is available to review until %s.', 'hillcroft-garden-designer' ), $expires )
				: __( 'Just a friendly reminder that your garden proposal is still available to review.', 'hillcroft-garden-designer' );
		} else {
			$subject = sprintf( __( 'Your garden proposal from %s', 'hillcroft-garden-designer' ), $site );
			$intro   = __( 'We wanted to check you\'d had a chance to look over your garden proposal.', 'hillcroft-garden-designer' );
		}

		$body  = ( '' !== $name ? sprintf( __( 'Hi %s,', 'hillcroft-garden-designer' ), $name ) : __( 'Hello,', 'hillcroft-garden-designer' ) ) . "\n\n";
		$body .= $intro . "\n\n";
		$body .= __( 'You can view it, ask questions or accept it here:', 'hillcroft-garden-designer' ) . "\n\n";
		$body .= $url . "\n\n";
		$body .= __( 'If anything needs tweaking, just reply and we\'ll be glad to help.', 'hillcroft-garden-designer' ) . "\n\n";
		$body .= $site . "\n";

		self::mail( $email, $subject, $body );
	}

	private static function mail( $to, $subject, $body ) {
		wp_mail( $to, $subject, $body, array( 'Content-Type: text/plain; charset=UTF-8' ) );
	}

	// -------------------------------------------------------------------------
	// Helpers
	// -------------------------------------------------------------------------

	/** The client record behind a proposal (via its project), or null. */
	private static function proposal_client( array $proposal ) {
		if ( empty( $proposal['project_id'] ) ) {
			return null;
		}
		$project = HGD_Project::get( (int) $proposal['project_id'] );
		if ( ! $project || empty( $project['client_id'] ) ) {
			return null;
		}
		return HGD_Client::get( (int) $project['client_id'] );
	}

	/** A proposal's client email, or '' if none. */
	private static function proposal_email( array $proposal ) {
		$client = self::proposal_client( $proposal );
		return ( $client && ! empty( $client['email'] ) ) ? (string) $client['email'] : '';
	}

	private static function already_sent( $type, $id, $kind ) {
		global $wpdb;
		$table = HGD_DB::followups_table();
		return (bool) $wpdb->get_var( $wpdb->prepare(
			"SELECT id FROM {$table} WHERE entity_type = %s AND entity_id = %d AND kind = %s LIMIT 1",
			$type,
			(int) $id,
			$kind
		) );
	}

	private static function log_sent( $type, $id, $kind, $email ) {
		global $wpdb;
		$wpdb->insert( HGD_DB::followups_table(), array(
			'entity_type' => sanitize_text_field( $type ),
			'entity_id'   => (int) $id,
			'kind'        => sanitize_text_field( $kind ),
			'email'       => sanitize_email( $email ),
			'sent_at'     => current_time( 'mysql' ),
		) );
	}

	private static function days_ago( $days ) {
		return gmdate( 'Y-m-d H:i:s', strtotime( current_time( 'mysql' ) . ' -' . (int) $days . ' days' ) );
	}

	private static function days_ahead( $days ) {
		return gmdate( 'Y-m-d H:i:s', strtotime( current_time( 'mysql' ) . ' +' . (int) $days . ' days' ) );
	}
}
