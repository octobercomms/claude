<?php
/**
 * Uninstall — only runs on explicit "Delete" from the Plugins screen.
 *
 * Intentionally conservative: remove our settings option and schema-version
 * marker, but LEAVE the data tables in place so an accidental delete does not
 * destroy proposals, signed acceptances or CRM history. Drop tables by hand if
 * a full wipe is genuinely wanted.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'ocp_settings' );
delete_option( 'ocp_db_version' );
