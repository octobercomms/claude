<?php
/**
 * Scheduler — the "autopilot".
 *
 * When automatic generation is enabled in the brief, a recurring WP-Cron event
 * fires on the chosen cadence (weekly / every two weeks / monthly) and queues a
 * generate job. Each post still lands as a draft for review unless the brief opts
 * into trusted auto-publish, so "autopilot" means hands-off up to the draft.
 *
 * Scheduling is opt-in (a checkbox in the brief) so no site ever starts spending
 * on the API by surprise.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OctoberMI_Blog_Scheduler {

	const HOOK = 'octobermi_blog_scheduled_run';

	public static function init() {
		add_filter( 'cron_schedules', array( __CLASS__, 'add_schedules' ) ); // phpcs:ignore WordPress.WP.CronInterval
		add_action( self::HOOK, array( __CLASS__, 'run' ) );
	}

	/** Custom intervals WordPress doesn't ship. */
	public static function add_schedules( $schedules ) {
		$schedules['octobermi_weekly']   = array( 'interval' => WEEK_IN_SECONDS,      'display' => __( 'Once weekly (October)', 'october-mi' ) );
		$schedules['octobermi_biweekly'] = array( 'interval' => 2 * WEEK_IN_SECONDS,  'display' => __( 'Every two weeks (October)', 'october-mi' ) );
		$schedules['octobermi_monthly']  = array( 'interval' => 30 * DAY_IN_SECONDS,  'display' => __( 'Monthly (October)', 'october-mi' ) );
		return $schedules;
	}

	private static function schedule_key( $cadence ) {
		switch ( $cadence ) {
			case 'monthly':
				return 'octobermi_monthly';
			case 'biweekly':
				return 'octobermi_biweekly';
			case 'weekly':
			default:
				return 'octobermi_weekly';
		}
	}

	/** Timestamp of the next scheduled run, or 0 if none. */
	public static function next_run() {
		return (int) wp_next_scheduled( self::HOOK );
	}

	/**
	 * Clear any existing schedule and, if autopilot is on and the module is
	 * enabled, schedule the next run. Call after the brief is saved and when the
	 * module is toggled.
	 */
	public static function reschedule() {
		self::clear();

		$brief = OctoberMI_Blog_Module::brief();
		if ( empty( $brief['autopilot'] ) || ! OctoberMI_Settings::is_module_enabled( 'blog' ) ) {
			return;
		}

		// Ensure our custom recurrences exist in THIS request — reschedule() can
		// run from the module-enable request, before boot()'s filter is added,
		// and wp_schedule_event() rejects an unknown recurrence.
		add_filter( 'cron_schedules', array( __CLASS__, 'add_schedules' ) ); // phpcs:ignore WordPress.WP.CronInterval

		$key   = self::schedule_key( $brief['cadence'] );
		$every = self::add_schedules( array() )[ $key ]['interval'];
		wp_schedule_event( time() + $every, $key, self::HOOK );
	}

	public static function clear() {
		$ts = wp_next_scheduled( self::HOOK );
		while ( $ts ) {
			wp_unschedule_event( $ts, self::HOOK );
			$ts = wp_next_scheduled( self::HOOK );
		}
	}

	/** Cron entry point: queue one generation run. */
	public static function run() {
		if ( ! OctoberMI_Settings::is_module_enabled( 'blog' ) ) {
			return;
		}
		// Respect the engine state and the monthly cost cap — autopilot must
		// never overspend.
		if ( '' !== OctoberMI_Blog_Module::generation_blocked() ) {
			OctoberMI_Log::error( 'blog.schedule', 'Skipped scheduled run', array( 'reason' => OctoberMI_Blog_Module::generation_blocked() ) );
			return;
		}
		OctoberMI_Jobs::enqueue( OctoberMI_Blog_Module::GENERATE_JOB, array( 'topic' => '', 'source' => 'schedule' ) );
	}
}
