<?php
/**
 * Pricing model + server-side package builder.
 *
 * Ported from the site's single source of truth. On the live platform the
 * PANEL is authoritative: after each turn the server recomputes the package
 * from the collected state and returns it, so the client only renders. Archie
 * never states a price in conversation — this does.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Pricing {

	public static function table() {
		$table = array(
			'services' => array(
				'planning'        => array( 'label' => 'Planning application drawings', 'A' => 950,  'B' => 1350, 'C' => 1850 ),
				'buildingcontrol' => array( 'label' => 'Building control drawings',     'A' => 850,  'B' => 1200, 'C' => 1650 ),
				'permitted'       => array( 'label' => 'Permitted development drawings','A' => 750,  'B' => 950,  'C' => 1250 ),
				'listed'          => array( 'label' => 'Listed building consent',       'A' => 1200, 'B' => 1600, 'C' => 2200 ),
				'concept'         => array( 'label' => 'Concept design + 3D visual',    'A' => 400,  'B' => 600,  'C' => 900 ),
			),
			'survey' => array(
				'A' => array( 'std' => 320, 'london' => 420 ),
				'B' => array( 'std' => 380, 'london' => 495 ),
				'C' => array( 'std' => 460, 'london' => 560 ),
			),
			'bands' => array(
				'A' => 'Band A · up to 50m²',
				'B' => 'Band B · 50–100m²',
				'C' => 'Band C · 100–150m²',
			),
			'redirect_fee_over'   => 3500,
			'revisions_included'  => 2,
			'delivery_days'       => '3–7 working days',
			'quote_validity_days' => 30,
		);
		/** Set the real figures / overrides here without touching code. */
		return apply_filters( 'yaa_pricing_table', $table );
	}

	public static function money( $n ) {
		return '£' . number_format_i18n( (int) $n );
	}

	/**
	 * Build the package from collected state.
	 *
	 * @param array $s Keys: service, band, london, listed, survey, structural,
	 *                 partyWall, concept.
	 * @return array { nodes:[{id,label,sub,price|null,removable,kind}], total, redirect, london }
	 */
	public static function build_package( array $s ) {
		$t     = self::table();
		$band  = ( isset( $s['band'] ) && 'over' === $s['band'] ) ? 'C' : ( isset( $s['band'] ) ? $s['band'] : 'B' );
		$nodes = array();
		$total = 0;

		$service = isset( $s['service'] ) ? $s['service'] : '';
		if ( $service && isset( $t['services'][ $service ] ) ) {
			$p      = (int) $t['services'][ $service ][ $band ];
			$total += $p;
			$nodes[] = array( 'id' => 'service', 'label' => $t['services'][ $service ]['label'], 'sub' => $t['bands'][ $band ], 'price' => $p, 'removable' => false );
		}
		if ( ! empty( $s['listed'] ) ) {
			$p      = (int) $t['services']['listed'][ $band ];
			$total += $p;
			$nodes[] = array( 'id' => 'listed', 'label' => 'Listed building consent', 'sub' => $t['bands'][ $band ], 'price' => $p, 'removable' => true );
		}
		if ( ! empty( $s['survey'] ) ) {
			$rate   = (int) $t['survey'][ $band ][ ! empty( $s['london'] ) ? 'london' : 'std' ];
			$total += $rate;
			$nodes[] = array( 'id' => 'survey', 'label' => 'Measured survey', 'sub' => ( ! empty( $s['london'] ) ? 'London rate' : 'Standard rate' ) . ' · ' . $t['bands'][ $band ], 'price' => $rate, 'removable' => true );
		}
		if ( ! empty( $s['concept'] ) ) {
			$p      = (int) $t['services']['concept'][ $band ];
			$total += $p;
			$nodes[] = array( 'id' => 'concept', 'label' => 'Concept design + 3D visual', 'sub' => 'Add-on · ' . $t['bands'][ $band ], 'price' => $p, 'removable' => true, 'kind' => 'addon' );
		}
		if ( ! empty( $s['structural'] ) ) {
			$nodes[] = array( 'id' => 'structural', 'label' => 'Structural engineer', 'sub' => 'Appointed directly by you', 'price' => null, 'removable' => true, 'kind' => 'consultant' );
		}
		if ( ! empty( $s['partyWall'] ) ) {
			$nodes[] = array( 'id' => 'partyWall', 'label' => 'Party wall surveyor', 'sub' => 'Appointed directly by you', 'price' => null, 'removable' => true, 'kind' => 'consultant' );
		}
		if ( ! empty( $s['london'] ) && ( ! empty( $s['survey'] ) || $service ) ) {
			$nodes[] = array( 'id' => 'london', 'label' => '✓ London pricing applied', 'sub' => '', 'price' => null, 'removable' => false, 'kind' => 'info' );
		}

		$redirect = ( isset( $s['band'] ) && 'over' === $s['band'] ) || $total > (int) $t['redirect_fee_over'] || ! empty( $s['ongoing'] );

		return array(
			'nodes'    => $nodes,
			'total'    => $total,
			'redirect' => (bool) $redirect,
			'london'   => ! empty( $s['london'] ),
			'meta'     => array(
				'delivery'      => $t['delivery_days'],
				'revisions'     => (int) $t['revisions_included'],
				'validityDays'  => (int) $t['quote_validity_days'],
			),
		);
	}

	/** The model localised to the front end (labels + bands for display). */
	public static function public_data() {
		$t = self::table();
		return array(
			'services'          => $t['services'],
			'bands'             => $t['bands'],
			'deliveryDays'      => $t['delivery_days'],
			'revisionsIncluded' => (int) $t['revisions_included'],
			'quoteValidityDays' => (int) $t['quote_validity_days'],
		);
	}
}
