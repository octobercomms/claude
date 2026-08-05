<?php
/**
 * Uninstall handler.
 *
 * Removes the plugin's options, the background-jobs table, and any scheduled
 * autopilot event. Generated posts are deliberately left untouched — they are
 * real published/draft content the site owns.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

// Options (connection, settings, activity, jobs schema marker, usage, and the
// Blog module's brief / context pack / content plan).
$options = array(
	'octobermi_settings',
	'octobermi_outbound_log',
	'octobermi_version',
	'octobermi_jobs_db_version',
	'octobermi_usage',
	'octobermi_blog_brief',
	'octobermi_blog_context_pack',
	'octobermi_blog_plan',
);
foreach ( $options as $option ) {
	delete_option( $option );
}

// Drop the background-jobs table.
global $wpdb;
$table = $wpdb->prefix . 'octobermi_jobs';
$wpdb->query( "DROP TABLE IF EXISTS {$table}" ); // phpcs:ignore WordPress.DB

// Clear any scheduled autopilot run.
$ts = wp_next_scheduled( 'octobermi_blog_scheduled_run' );
while ( $ts ) {
	wp_unschedule_event( $ts, 'octobermi_blog_scheduled_run' );
	$ts = wp_next_scheduled( 'octobermi_blog_scheduled_run' );
}
