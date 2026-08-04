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
		$to      = YAA_Settings::get( 'notify_email', get_option( 'admin_email' ) );
		$email   = (string) get_post_meta( $project_id, '_yaa_email', true );
		$name    = (string) get_post_meta( $project_id, '_yaa_name', true );
		$total   = YAA_Pricing::money( isset( $package['total'] ) ? $package['total'] : 0 );
		$link    = admin_url( 'post.php?post=' . (int) $project_id . '&action=edit' );
		$headers = array( 'Content-Type: text/plain; charset=UTF-8' );

		wp_mail( $to, 'New Archie project — ' . $total, "A project has been submitted.\n\nName: {$name}\nEmail: {$email}\nTotal: {$total}\n\nOpen: {$link}\n", $headers );

		if ( is_email( $email ) ) {
			$first = $name ? strtok( $name, ' ' ) : 'there';
			wp_mail( $email, 'Your Architect — your project', "Hi {$first},\n\nThanks for building your project with Your Architect. We'll prepare your drawings and send a watermarked preview — you only pay to release the full package.\n\n— Your Architect\n", $headers );
		}
	}

	/** Daily chase of incomplete-but-emailed projects. */
	public static function run() {
		$stale = get_posts(
			array(
				'post_type'      => YAA_Project::CPT,
				'post_status'    => 'any',
				'posts_per_page' => 50,
				'meta_query'     => array(
					array( 'key' => '_yaa_status', 'value' => array( 'draft', 'quoted' ), 'compare' => 'IN' ),
					array( 'key' => '_yaa_email', 'value' => '', 'compare' => '!=' ),
					array( 'key' => '_yaa_followed', 'compare' => 'NOT EXISTS' ),
				),
			)
		);
		foreach ( $stale as $p ) {
			$email = (string) get_post_meta( $p->ID, '_yaa_email', true );
			if ( ! is_email( $email ) ) {
				continue;
			}
			wp_mail( $email, 'Your Architect — pick up where you left off', "Your saved project is ready whenever you are — just head back and Archie will resume.\n\n— Your Architect\n", array( 'Content-Type: text/plain; charset=UTF-8' ) );
			update_post_meta( $p->ID, '_yaa_followed', current_time( 'mysql' ) );
		}
	}
}
