<?php
/**
 * Activation / deactivation: create the custom tables and seed default settings.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Activator {

	public static function activate() {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		foreach ( HGD_DB::schema() as $sql ) {
			dbDelta( $sql );
		}

		update_option( 'hgd_db_version', HGD_DB::SCHEMA_VERSION );

		// Forms subsystem: create its tables + upload dir.
		if ( class_exists( 'HGDF_Activator' ) ) {
			HGDF_Activator::activate();
		}

		// Daily client follow-up reminders (the job itself is gated by a setting).
		if ( class_exists( 'HGD_Followups' ) ) {
			HGD_Followups::schedule();
		}

		// Seed defaults only on first install.
		HGD_Settings::seed_defaults();
	}

	public static function deactivate() {
		// Intentionally non-destructive: leave tables and settings in place so no
		// client data is lost on a deactivate/reactivate cycle. We do, however,
		// clear our scheduled cron event.
		if ( class_exists( 'HGD_Followups' ) ) {
			HGD_Followups::unschedule();
		}
	}
}
