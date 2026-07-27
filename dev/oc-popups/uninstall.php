<?php
/**
 * Uninstall cleanup: remove plugin options and popup posts + their meta.
 * Runs only on real "Delete" of the plugin, never on deactivate.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

// Plugin settings + updater cache.
delete_option( 'ocpop_settings' );

global $wpdb;
$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_ocpop_updater_%' OR option_name LIKE '_transient_timeout_ocpop_updater_%'" );

// Popups (posts of the CPT) and their meta.
$popups = get_posts(
	array(
		'post_type'   => 'ocpop_popup',
		'post_status' => 'any',
		'numberposts' => -1,
		'fields'      => 'ids',
	)
);
foreach ( $popups as $popup_id ) {
	wp_delete_post( $popup_id, true );
}
