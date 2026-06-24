<?php
/**
 * Scheduled automation — a single daily job that:
 *   - expires proposals past their expiry date,
 *   - emails one follow-up for proposals sent but not accepted after N days,
 *   - emails the studio a monthly (and yearly) engagement report.
 *
 * All gated by Settings toggles; safe to run when keys/recipients are missing.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCP_Followups {

	const HOOK = 'ocp_daily_cron';

	public static function init() {
		add_action( self::HOOK, array( __CLASS__, 'run' ) );
		if ( ! wp_next_scheduled( self::HOOK ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', self::HOOK );
		}
	}

	public static function schedule() {
		if ( ! wp_next_scheduled( self::HOOK ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', self::HOOK );
		}
	}

	public static function unschedule() {
		$ts = wp_next_scheduled( self::HOOK );
		if ( $ts ) {
			wp_unschedule_event( $ts, self::HOOK );
		}
	}

	public static function run() {
		self::expire_overdue();
		if ( '1' === (string) OCP_Settings::get( 'followup_enabled', '1' ) ) {
			self::send_followups();
		}
		if ( '1' === (string) OCP_Settings::get( 'report_email_enabled', '1' ) ) {
			self::maybe_send_report();
		}
	}

	/** Flip sent/viewed proposals past their expiry to "expired". */
	private static function expire_overdue() {
		global $wpdb;
		$table = OCP_DB::proposals_table();
		$now   = current_time( 'mysql' );
		$rows  = $wpdb->get_results( $wpdb->prepare(
			"SELECT id FROM {$table} WHERE status IN ('sent','viewed') AND expires_at IS NOT NULL AND expires_at < %s",
			$now
		), ARRAY_A );
		foreach ( (array) $rows as $r ) {
			OCP_Proposal::update( (int) $r['id'], array( 'status' => 'expired' ) );
		}
	}

	/** One reminder per proposal, N days after sending, if still unaccepted. */
	private static function send_followups() {
		global $wpdb;
		$days  = max( 1, (int) OCP_Settings::get( 'followup_days', 4 ) );
		$table = OCP_DB::proposals_table();
		$cut   = gmdate( 'Y-m-d H:i:s', current_time( 'timestamp' ) - $days * DAY_IN_SECONDS );
		$rows  = $wpdb->get_results( $wpdb->prepare(
			"SELECT * FROM {$table} WHERE status IN ('sent','viewed') AND sent_at IS NOT NULL AND sent_at < %s",
			$cut
		), ARRAY_A );

		foreach ( (array) $rows as $p ) {
			// Skip if we've already followed up.
			if ( OCP_Proposal::get_section( $p['id'], 'followup' ) ) {
				continue;
			}
			$email = self::client_email( $p );
			if ( ! $email ) {
				continue;
			}
			$subject = sprintf( __( 'Following up on your proposal — %s', 'oc-proposals' ), get_bloginfo( 'name' ) );
			$body    = implode( "\n", array(
				sprintf( __( 'Hi %s,', 'oc-proposals' ), $p['client_name'] ),
				'',
				__( 'Just checking in on the proposal we shared — happy to walk through any part of it or answer questions.', 'oc-proposals' ),
				'',
				__( 'View it here:', 'oc-proposals' ) . ' ' . OCP_Proposal::url( $p['token'] ),
				'',
				__( 'Best wishes,', 'oc-proposals' ),
				OCP_Settings::get( 'company_name' ),
			) );
			wp_mail( $email, $subject, $body );
			OCP_Proposal::set_section( $p['id'], 'followup', array( 'body' => current_time( 'mysql' ) ) );
		}
	}

	/** Monthly report on the 1st; yearly on 1 Jan. Sent to the studio email. */
	private static function maybe_send_report() {
		$day   = (int) current_time( 'j' );
		$month = (int) current_time( 'n' );
		if ( 1 !== $day ) {
			return;
		}
		$to = OCP_Settings::get( 'company_email', get_option( 'admin_email' ) );
		if ( ! $to ) {
			return;
		}
		// Annual on Jan 1, else monthly.
		$annual  = ( 1 === $month );
		$summary = OCP_Analytics::summary( $annual ? 365 : 30 );
		$report  = OCP_Claude::enabled() ? OCP_Claude::engagement_report( $summary ) : '';
		$label   = $annual ? __( 'annual', 'oc-proposals' ) : __( 'monthly', 'oc-proposals' );

		$subject = sprintf( __( 'October Proposals — %s report', 'oc-proposals' ), $label );
		$lines   = array(
			sprintf( __( 'Proposal views: %d', 'oc-proposals' ), (int) $summary['views'] ),
			sprintf( __( 'Acceptances: %d', 'oc-proposals' ), (int) $summary['accepts'] ),
			sprintf( __( 'Accept rate: %s%%', 'oc-proposals' ), $summary['accept_rate'] ),
		);
		if ( $report ) {
			$lines[] = '';
			$lines[] = $report;
		}
		wp_mail( $to, $subject, implode( "\n", $lines ) );
	}

	/** Resolve a client email from the proposal (contacts field) or its lead. */
	private static function client_email( $p ) {
		$contact = trim( (string) $p['client_contacts'] );
		if ( is_email( $contact ) ) {
			return $contact;
		}
		if ( ! empty( $p['lead_id'] ) ) {
			$lead = OCP_Lead::get( (int) $p['lead_id'] );
			if ( $lead && is_email( $lead['email'] ) ) {
				return $lead['email'];
			}
		}
		return '';
	}
}
