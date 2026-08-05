<?php
/**
 * Notifications + partial-submission follow-ups.
 *
 * notify_submit() emails the studio (and the client, if we have an address) when
 * a project is submitted. A daily cron chases projects that captured an email
 * but never submitted. Mail should go via an SMTP/API plugin on shared hosting.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Followups {

	const HOOK = 'yaa_followups_daily';

	public static function init() {
		add_action( self::HOOK, array( __CLASS__, 'run' ) );
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

	/** Studio + client emails on submit. */
	public static function notify_submit( $project_id, array $package ) {
		$row     = YAA_Project::get( $project_id );
		$to      = YAA_Settings::get( 'notify_email', get_option( 'admin_email' ) );
		$email   = $row ? (string) $row->email : '';
		$name    = $row ? (string) $row->name : '';
		$total   = YAA_Pricing::money( isset( $package['total'] ) ? $package['total'] : 0 );
		$link    = admin_url( 'admin.php?page=yaa-projects&project=' . (int) $project_id );
		$headers = array( 'Content-Type: text/plain; charset=UTF-8' );

		wp_mail( $to, 'New Archie project — ' . $total, "A project has been submitted.\n\nName: {$name}\nEmail: {$email}\nTotal: {$total}\n\nOpen: {$link}\n", $headers );

		if ( is_email( $email ) ) {
			$first = $name ? strtok( $name, ' ' ) : 'there';
			wp_mail( $email, 'Your Architect — your project', "Hi {$first},\n\nThanks for building your project with Your Architect. We'll prepare your drawings and send a watermarked preview — you only pay to release the full package.\n\n— Your Architect\n", $headers );
		}
	}

	/** Daily chase of incomplete-but-emailed projects (those still in the started pool). */
	public static function run() {
		global $wpdb;
		$projects = YAA_DB::projects_table();
		$events   = YAA_DB::events_table();
		$rows     = $wpdb->get_results( // phpcs:ignore WordPress.DB
			"SELECT p.* FROM {$projects} p
			 WHERE p.status IN ('partial','quoted')
			   AND p.email IS NOT NULL AND p.email <> ''
			   AND NOT EXISTS ( SELECT 1 FROM {$events} e WHERE e.project_id = p.id AND e.type = 'followup_sent' )
			 ORDER BY p.updated ASC
			 LIMIT 50"
		);
		foreach ( (array) $rows as $p ) {
			$email = (string) $p->email;
			if ( ! is_email( $email ) ) {
				continue;
			}
			wp_mail( $email, 'Your Architect — pick up where you left off', "Your saved project is ready whenever you are — just head back and Archie will resume.\n\n— Your Architect\n", array( 'Content-Type: text/plain; charset=UTF-8' ) );
			YAA_Project::log_event( (int) $p->id, 'followup_sent' );
		}
	}
}
