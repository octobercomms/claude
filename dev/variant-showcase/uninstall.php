<?php
/**
 * Uninstall cleanup.
 *
 * Removes the per-product and per-variation meta this plugin stores. Product and
 * variation records themselves (and their attached media) are left untouched.
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

global $wpdb;

$meta_keys = [
	'_acvs_mode',
	'_acvs_single_variation',
	'_acvs_show_in_catalog',
	'_acvs_lifestyle_image_id',
];

$placeholders = implode( ', ', array_fill( 0, count( $meta_keys ), '%s' ) );

$wpdb->query(
	$wpdb->prepare(
		"DELETE FROM {$wpdb->postmeta} WHERE meta_key IN ( {$placeholders} )", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$meta_keys
	)
);
