<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class PCLC_Scheduler {

	const HOOK_FOLLOWUP_1 = 'pclc_send_followup_1';
	const HOOK_FOLLOWUP_2 = 'pclc_send_followup_2';

	public static function init() {
		add_action( self::HOOK_FOLLOWUP_1, array( __CLASS__, 'fire_followup_1' ) );
		add_action( self::HOOK_FOLLOWUP_2, array( __CLASS__, 'fire_followup_2' ) );
	}

	public static function schedule_followups( $contact_id ) {
		$delay_1 = (int) PCLC_Settings::get( 'followup_1_delay', 28 );
		$delay_2 = (int) PCLC_Settings::get( 'followup_2_delay', 180 );

		$time_1 = time() + ( $delay_1 * DAY_IN_SECONDS );
		$time_2 = $time_1 + ( $delay_2 * DAY_IN_SECONDS );

		wp_schedule_single_event( $time_1, self::HOOK_FOLLOWUP_1, array( $contact_id ) );
		wp_schedule_single_event( $time_2, self::HOOK_FOLLOWUP_2, array( $contact_id ) );
	}

	public static function fire_followup_1( $contact_id ) {
		$contact = PCLC_Database::get_contact( $contact_id );

		if ( ! $contact || 'deleted' === $contact->status ) {
			return;
		}

		$result = PCLC_Email::send_architect_followup( $contact_id, 1 );

		if ( ! is_wp_error( $result ) ) {
			PCLC_Database::mark_followup_sent( $contact_id, 1 );
		}
	}

	public static function fire_followup_2( $contact_id ) {
		$contact = PCLC_Database::get_contact( $contact_id );

		if ( ! $contact || 'deleted' === $contact->status ) {
			return;
		}

		// Only fire second follow-up if neither the chase nor cold email was already sent.
		if ( $contact->chase_email_sent || $contact->cold_email_sent ) {
			return;
		}

		$result = PCLC_Email::send_architect_followup( $contact_id, 2 );

		if ( ! is_wp_error( $result ) ) {
			PCLC_Database::mark_followup_sent( $contact_id, 2 );
		}
	}

	public static function clear_all_cron() {
		// Remove scheduled events on deactivation.
		$hooks = array( self::HOOK_FOLLOWUP_1, self::HOOK_FOLLOWUP_2 );
		foreach ( $hooks as $hook ) {
			$timestamp = wp_next_scheduled( $hook );
			while ( $timestamp ) {
				wp_unschedule_event( $timestamp, $hook );
				$timestamp = wp_next_scheduled( $hook );
			}
		}
	}
}
