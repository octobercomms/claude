<?php
/**
 * Uninstall — remove settings. Project records (yaa_project posts) are left in
 * place so a reinstall keeps history; delete them manually if you want them gone.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'yaa_settings' );
wp_clear_scheduled_hook( 'yaa_followups_daily' );
