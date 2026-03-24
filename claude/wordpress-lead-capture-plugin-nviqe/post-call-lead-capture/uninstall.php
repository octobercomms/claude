<?php
/**
 * Uninstall script — runs when the plugin is deleted via wp-admin.
 * Removes the custom table and all plugin options.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

require_once plugin_dir_path( __FILE__ ) . 'includes/class-pclc-database.php';

PCLC_Database::drop_table();

delete_option( 'pclc_settings' );
delete_option( 'pclc_db_version' );
