<?php
/**
 * Activation / deactivation / in-place upgrade.
 *
 * Tables are created on activation and re-checked whenever SCHEMA_VERSION moves,
 * so a self-update (which does not fire the activation hook) still migrates.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCP_Activator {

	const VERSION_OPTION = 'ocp_db_version';

	public static function activate() {
		self::install_schema();
		OCP_Settings::seed_defaults();
		if ( class_exists( 'OCP_Followups' ) ) {
			OCP_Followups::schedule();
		}
	}

	public static function deactivate() {
		// Non-destructive: keep all data on deactivate/reactivate, but clear cron.
		if ( class_exists( 'OCP_Followups' ) ) {
			OCP_Followups::unschedule();
		}
	}

	/**
	 * Re-run dbDelta if the installed schema version is behind. Called on every
	 * load (cheap — a single option read short-circuits when up to date).
	 */
	public static function maybe_upgrade() {
		if ( get_option( self::VERSION_OPTION ) === OCP_DB::SCHEMA_VERSION ) {
			return;
		}
		self::install_schema();
		OCP_Settings::seed_defaults();
	}

	private static function install_schema() {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		foreach ( OCP_DB::schema() as $sql ) {
			dbDelta( $sql );
		}
		update_option( self::VERSION_OPTION, OCP_DB::SCHEMA_VERSION );
	}
}
