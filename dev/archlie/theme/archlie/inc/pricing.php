<?php
/**
 * Archlie — pricing model (single source of truth).
 *
 * Confirmed indicative prices from Brief v3 §5. Tiam adjusts per actual
 * time-cost before launch. This table is localised to the front-end
 * (window.ARCHLIE_WP), which both the homepage price table and the
 * conversational package builder read — so PHP is the only place a number
 * is edited. Override at runtime with the `archlie_pricing_table` filter.
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
		'services' => array(
			'planning'        => array( 'label' => __( 'Planning application drawings', 'archlie' ), 'A' => 950,  'B' => 1350, 'C' => 1850, 'kind' => 'service' ),
			'buildingcontrol' => array( 'label' => __( 'Building control drawings', 'archlie' ),     'A' => 850,  'B' => 1200, 'C' => 1650, 'kind' => 'service' ),
			'permitted'       => array( 'label' => __( 'Permitted development drawings', 'archlie' ),'A' => 750,  'B' => 950,  'C' => 1250, 'kind' => 'service' ),
			'listed'          => array( 'label' => __( 'Listed building consent', 'archlie' ),       'A' => 1200, 'B' => 1600, 'C' => 2200, 'kind' => 'service' ),
			'concept'         => array( 'label' => __( 'Concept design + 3D visual', 'archlie' ),     'A' => 400,  'B' => 600,  'C' => 900,  'kind' => 'addon' ),
		),
		'survey' => array(
			'A' => array( 'std' => 320, 'london' => 420 ),
			'B' => array( 'std' => 380, 'london' => 495 ),
			'C' => array( 'std' => 460, 'london' => 560 ),
		),
		'bands' => array(
			'A' => __( 'Band A · up to 50m²', 'archlie' ),
			'B' => __( 'Band B · 50–100m²', 'archlie' ),
			'C' => __( 'Band C · 100–150m²', 'archlie' ),
		),
		'redirect'          => array( 'feeOver' => 3500, 'areaOverBand' => true ),
		'revisionsIncluded' => 2,
		'deliveryDays'      => __( '3–7 working days', 'archlie' ),
		'quoteValidityDays' => 30,
	);

	/** Filter the Archlie pricing model. */
	return apply_filters( 'archlie_pricing_table', $table );
}

/**
 * Format a GBP integer, e.g. 1350 => "£1,350".
 *
 * @param int $amount Whole pounds.
 * @return string
 */
function archlie_money( $amount ) {
	return '£' . number_format_i18n( (int) $amount );
}

/**
 * Cheapest-band "from" price for a service, formatted.
 *
 * @param string $service Service key.
 * @return string
 */
function archlie_price_from( $service ) {
	$t = archlie_pricing_table();
	if ( isset( $t['services'][ $service ] ) ) {
		$s = $t['services'][ $service ];
		return sprintf( /* translators: %s: price */ __( 'from %s', 'archlie' ), archlie_money( min( $s['A'], $s['B'], $s['C'] ) ) );
	}
	return __( 'By arrangement', 'archlie' );
}
