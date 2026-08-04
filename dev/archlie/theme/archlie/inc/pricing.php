<?php
/**
 * Archlie — pricing model (single source of truth).
 *
 * From Tiam's comments: two flat packages (not floor-area bands), a small set
 * of add-ons, and items sourced separately (survey, structural). Localised to
 * the front-end (window.ARCHLIE_WP) and mirrored by assets/js/pricing.js.
 * Override at runtime with the `archlie_pricing_table` filter.
 *
 * @package Archlie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The full pricing model.
 *
 * @return array
 */
function archlie_pricing_table() {
	$table = array(
		'packages' => array(
			'planning'     => array( 'label' => __( 'Planning — full package', 'archlie' ), 'price' => 850 ),
			'buildingregs' => array( 'label' => __( 'Building Regs drawings', 'archlie' ),   'price' => 950 ),
		),
		'addons' => array(
			'submission' => array( 'label' => __( 'We submit & manage your planning application', 'archlie' ), 'price' => 80 ),
			'concept3d'  => array( 'label' => __( '3D concept visual (up to 2 revisions)', 'archlie' ),        'price' => 250 ),
			'siteVisit'  => array( 'label' => __( 'Site visit (London boroughs / within the M25)', 'archlie' ), 'price' => 350 ),
		),
		'separate'          => array( 'survey', 'structural' ),
		'revisionsIncluded' => 2,
		'deliveryDays'      => __( 'within 7 days', 'archlie' ),
		'quoteValidityDays' => 30,
		'ribaEmail'         => 'info@tiamarchitects.com',
	);

	/** Filter the Archlie pricing model. */
	return apply_filters( 'archlie_pricing_table', $table );
}

/**
 * Format a GBP integer, e.g. 850 => "£850".
 *
 * @param int $amount Whole pounds.
 * @return string
 */
function archlie_money( $amount ) {
	return '£' . number_format_i18n( (int) $amount );
}

/**
 * A package's flat price, formatted.
 *
 * @param string $package Package key (planning|buildingregs).
 * @return string
 */
function archlie_package_price( $package ) {
	$t = archlie_pricing_table();
	if ( isset( $t['packages'][ $package ] ) ) {
		return archlie_money( $t['packages'][ $package ]['price'] );
	}
	return __( 'By arrangement', 'archlie' );
}
