<?php
/**
 * Uninstall handler.
 *
 * Deliberately conservative: we remove only the plugin's options. Custom tables
 * (the plant catalogue and usage log) are LEFT IN PLACE so an accidental
 * delete/reinstall never destroys Donna's catalogue. Dropping data, if ever
 * wanted, should be an explicit, separate action.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'hgd_settings' );
delete_option( 'hgd_db_version' );
delete_option( 'hgd_secrets_encrypted' );
