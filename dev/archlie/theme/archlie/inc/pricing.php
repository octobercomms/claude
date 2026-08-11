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
 * The live service menu shown on the site.
 *
 * Prefers the Archie plugin's editable config (`yaa_pricing` option) so the
 * marketing page always matches what Tiam set in Archie → Pricing & Services.
 * Falls back to the built-in menu (same Aug-2026 figures) when the plugin's
 * option isn't present.
 *
 * @return array { services:[key=>{label,sub,price|null}], addons:[key=>{label,price}], meta:{...} }
 */
function archlie_service_menu() {
	$opt = get_option( 'yaa_pricing' );
	if ( is_array( $opt ) && ! empty( $opt['services'] ) && is_array( $opt['services'] ) ) {
		$services = array();
		foreach ( $opt['services'] as $key => $svc ) {
			if ( ! empty( $svc['enabled'] ) ) {
				$services[ $key ] = $svc;
			}
		}
		$addons = array();
		if ( ! empty( $opt['addons'] ) && is_array( $opt['addons'] ) ) {
			foreach ( $opt['addons'] as $key => $add ) {
				if ( ! empty( $add['enabled'] ) ) {
					$addons[ $key ] = $add;
				}
			}
		}
		return array(
			'services' => $services,
			'addons'   => $addons,
			'meta'     => isset( $opt['meta'] ) ? $opt['meta'] : array(),
		);
	}
	return archlie_service_menu_fallback();
}

/** Built-in menu (used when the Archie plugin isn't active). */
function archlie_service_menu_fallback() {
	return array(
		'services' => array(
			'preplanning'   => array( 'label' => __( 'Pre-planning application drawings', 'archlie' ), 'sub' => __( 'Test your idea with the council before a full application', 'archlie' ), 'price' => 450 ),
			'planning'      => array( 'label' => __( 'Full planning application / consent', 'archlie' ), 'sub' => __( 'Submission-ready planning drawings', 'archlie' ), 'price' => 690 ),
			'buildingregs'  => array( 'label' => __( 'Building regulations drawings', 'archlie' ), 'sub' => __( 'The technical drawings your builder builds from', 'archlie' ), 'price' => 900 ),
			'listed'        => array( 'label' => __( 'Listed building consent', 'archlie' ), 'sub' => __( 'For listed / protected buildings', 'archlie' ), 'price' => 550 ),
			'permitted'     => array( 'label' => __( 'Permitted development / lawful development certificate', 'archlie' ), 'sub' => __( 'Confirm the work is lawful without a full application', 'archlie' ), 'price' => 450 ),
			'changeofuse'   => array( 'label' => __( 'Change of use (without construction)', 'archlie' ), 'sub' => '', 'price' => 450 ),
			'retrospective' => array( 'label' => __( 'Retrospective application', 'archlie' ), 'sub' => __( 'Regularise work already carried out', 'archlie' ), 'price' => 450 ),
			'newdwelling'   => array( 'label' => __( 'New dwelling(s)', 'archlie' ), 'sub' => __( 'From £950 — priced on request', 'archlie' ), 'price' => null ),
		),
		'addons' => array(
			'submission' => array( 'label' => __( 'We submit & manage your planning application', 'archlie' ), 'price' => 100 ),
			'concept3d'  => array( 'label' => __( '3D visualisation (up to 2 revisions)', 'archlie' ), 'price' => 250 ),
			'siteVisit'  => array( 'label' => __( 'Site visit (London / within the M25)', 'archlie' ), 'price' => 350 ),
		),
		'meta' => array( 'delivery' => __( 'within 7 days', 'archlie' ), 'revisions' => 2, 'validityDays' => 30, 'ribaEmail' => 'info@tiamarchitects.com', 'phone' => '+44 020 3771 2346', 'bookingUrl' => '' ),
	);
}

/** A service price, formatted — blank/null means priced on request. */
function archlie_service_price( $price ) {
	if ( null === $price || '' === $price ) {
		return __( 'Priced on request', 'archlie' );
	}
	return archlie_money( (int) $price );
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
