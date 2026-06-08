<?php
/**
 * Activation / deactivation.
 *
 * No custom tables are needed in v1 — connection state and the rolling outbound
 * log both live in options. Activation simply seeds the version marker so future
 * upgrades have something to compare against.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OctoberMI_Activator {

	public static function activate() {
		if ( false === get_option( 'octobermi_version' ) ) {
			add_option( 'octobermi_version', OCTOBERMI_VERSION, '', false );
		} else {
			update_option( 'octobermi_version', OCTOBERMI_VERSION, false );
		}
	}

	public static function deactivate() {
		// Intentionally conservative: leave connection state intact so a brief
		// deactivate/reactivate does not require re-pairing. Full teardown lives
		// in uninstall.php.
	}
}
