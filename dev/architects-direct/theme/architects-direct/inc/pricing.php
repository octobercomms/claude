<?php
/**
 * Architects Direct — pricing model (single source of truth).
 *
 * Prices are INDICATIVE PLACEHOLDERS for demonstration. Per the brief (Section 3),
 * Tiam sets the real figures before launch, accounting for consultant revenue share.
 *
 * Edit the defaults here, or override at runtime with the `ad_pricing_table`
 * filter — nothing else in the theme hard-codes a price. The table is localised
 * to the calculator JS, so PHP is the only place you change a number.
 *
 * @package Architects_Direct
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Fixed price by service and floor-area band (GBP).
 *
 * @return array{
 *   services: array<string, array{label:string, A:int, B:int, C:int, from:int}>,
 *   bands: array<string, string>,
 *   redirect_over_band: string
 * }
 */
function ad_pricing_table() {
	$table = array(
		'services' => array(
			'planning' => array(
				'label' => __( 'Planning application', 'architects-direct' ),
				'A'     => 1200,
				'B'     => 1800,
				'C'     => 2400,
			),
			'buildingcontrol' => array(
				'label' => __( 'Building control / regs', 'architects-direct' ),
				'A'     => 900,
				'B'     => 1400,
				'C'     => 1900,
			),
			'permitted' => array(
				'label' => __( 'Permitted development', 'architects-direct' ),
				'A'     => 750,
				'B'     => 1100,
				'C'     => 1500,
			),
			'tender' => array(
				'label' => __( 'Tender drawings', 'architects-direct' ),
				'A'     => 1400,
				'B'     => 2000,
				'C'     => 2800,
			),
		),
		'bands' => array(
			'A'    => __( 'up to 50m² (Band A)', 'architects-direct' ),
			'B'    => __( '50–100m² (Band B)', 'architects-direct' ),
			'C'    => __( '100–150m² (Band C)', 'architects-direct' ),
			'over' => __( 'over 150m²', 'architects-direct' ),
		),
		// Any band above this (here: "over") redirects to Tiam. Kept as data so
		// the Phase 2 complexity-scoring logic can extend it.
		'redirect_over_band' => 'over',
	);

	// Add the "from" price (cheapest band) for each service, used by the
	// services grid and hero card.
	foreach ( $table['services'] as $key => $svc ) {
		$table['services'][ $key ]['from'] = min( $svc['A'], $svc['B'], $svc['C'] );
	}

	/**
	 * Filter the Architects Direct pricing table.
	 *
	 * @param array $table The full pricing table.
	 */
	return apply_filters( 'ad_pricing_table', $table );
}

/**
 * Format a GBP integer with thousands separators (no decimals).
 *
 * @param int $amount Amount in whole pounds.
 * @return string
 */
function ad_price( $amount ) {
	return '£' . number_format_i18n( (int) $amount );
}

/**
 * Convenience: the "from" (cheapest) price for a service, formatted.
 *
 * @param string $service Service key.
 * @return string
 */
function ad_price_from( $service ) {
	$table = ad_pricing_table();
	if ( isset( $table['services'][ $service ]['from'] ) ) {
		/* translators: %s: formatted price. */
		return sprintf( __( 'from %s', 'architects-direct' ), ad_price( $table['services'][ $service ]['from'] ) );
	}
	return __( 'Price on request', 'architects-direct' );
}
