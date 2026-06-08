<?php
/**
 * Uninstall handler.
 *
 * Removes the plugin's options, including the stored connection credentials and
 * the rolling outbound log. No custom tables are created, so there is nothing
 * else to drop.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'octobermi_settings' );
delete_option( 'octobermi_outbound_log' );
delete_option( 'octobermi_version' );
