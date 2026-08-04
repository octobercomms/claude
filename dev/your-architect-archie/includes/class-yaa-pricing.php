<?php
/**
 * Pricing model + server-side package builder.
 *
 * From Tiam's comments: TWO flat packages (not floor-area bands), a small set
 * of add-ons, and items sourced separately (survey, structural) with a quote to
 * follow. The PANEL is authoritative — after each turn the server recomputes the
 * package from the collected state and returns it; the client only renders.
 * Archie never states a price; this does.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Pricing {

	public static function table() {
		$table = array(
			'packages' => array(
				'planning'     => array( 'label' => 'Planning — full package', 'price' => 850 ),
				'buildingregs' => array( 'label' => 'Building Regs drawings',   'price' => 950 ),
			),
			'addons' => array(
				'submission' => array( 'label' => 'We submit & manage your planning application', 'price' => 80 ),
				'concept3d'  => array( 'label' => '3D concept visual (up to 2 revisions)',         'price' => 250 ),
				'siteVisit'  => array( 'label' => 'Site visit (London boroughs / within the M25)', 'price' => 350 ),
			),
			'separate'            => array( 'survey', 'structural' ),
			'revisions_included'  => 2,
			'delivery_days'       => 'within 7 days',
			'quote_validity_days' => 30,
			'riba_email'          => 'info@tiamarchitects.com',
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
	 * @param array $s Keys: package (planning|buildingregs|riba), submitApp,
	 *                 concept, siteVisit, survey, structural, london.
	 * @return array { nodes:[{id,label,sub,price|null,removable,kind}], total, redirect, london, meta }
	 */
	public static function build_package( array $s ) {
		$t       = self::table();
		$pkg     = isset( $s['package'] ) ? $s['package'] : '';
		$nodes   = array();
		$total   = 0;

		if ( 'planning' === $pkg ) {
			$total  += (int) $t['packages']['planning']['price'];
			$nodes[] = array( 'id' => 'service', 'label' => 'Planning — full package', 'sub' => '3D concept & submission-ready drawings included', 'price' => (int) $t['packages']['planning']['price'], 'removable' => false );
		} elseif ( 'buildingregs' === $pkg ) {
			$total  += (int) $t['packages']['buildingregs']['price'];
			$nodes[] = array( 'id' => 'service', 'label' => 'Building Regs drawings', 'sub' => 'Planning already approved', 'price' => (int) $t['packages']['buildingregs']['price'], 'removable' => false );
		}

		if ( 'planning' === $pkg && ! empty( $s['submitApp'] ) ) {
			$total  += (int) $t['addons']['submission']['price'];
			$nodes[] = array( 'id' => 'submission', 'label' => $t['addons']['submission']['label'], 'sub' => 'Add-on', 'price' => (int) $t['addons']['submission']['price'], 'removable' => true, 'kind' => 'addon' );
		}
		if ( 'buildingregs' === $pkg && ! empty( $s['concept'] ) ) {
			$total  += (int) $t['addons']['concept3d']['price'];
			$nodes[] = array( 'id' => 'concept3d', 'label' => $t['addons']['concept3d']['label'], 'sub' => 'Add-on', 'price' => (int) $t['addons']['concept3d']['price'], 'removable' => true, 'kind' => 'addon' );
		}
		if ( ! empty( $s['siteVisit'] ) && ! empty( $s['london'] ) && $pkg && 'riba' !== $pkg ) {
			$total  += (int) $t['addons']['siteVisit']['price'];
			$nodes[] = array( 'id' => 'siteVisit', 'label' => $t['addons']['siteVisit']['label'], 'sub' => 'Add-on', 'price' => (int) $t['addons']['siteVisit']['price'], 'removable' => true, 'kind' => 'addon' );
		}
		if ( ! empty( $s['survey'] ) ) {
			$nodes[] = array( 'id' => 'survey', 'label' => 'Measured survey', 'sub' => 'Sourced separately', 'price' => null, 'removable' => true, 'kind' => 'consultant' );
		}
		if ( ! empty( $s['structural'] ) ) {
			$nodes[] = array( 'id' => 'structural', 'label' => 'Structural engineer', 'sub' => 'Sourced separately', 'price' => null, 'removable' => true, 'kind' => 'consultant' );
		}
		if ( ! empty( $s['london'] ) && $pkg && 'riba' !== $pkg ) {
			$nodes[] = array( 'id' => 'london', 'label' => '✓ London project', 'sub' => '', 'price' => null, 'removable' => false, 'kind' => 'info' );
		}

		$redirect = ( 'riba' === $pkg );

		return array(
			'nodes'    => $nodes,
			'total'    => $total,
			'redirect' => (bool) $redirect,
			'london'   => ! empty( $s['london'] ),
			'meta'     => array(
				'delivery'     => $t['delivery_days'],
				'revisions'    => (int) $t['revisions_included'],
				'validityDays' => (int) $t['quote_validity_days'],
			),
		);
	}

	/** The model localised to the front end. */
	public static function public_data() {
		$t = self::table();
		return array(
			'packages'          => $t['packages'],
			'addons'            => $t['addons'],
			'deliveryDays'      => $t['delivery_days'],
			'revisionsIncluded' => (int) $t['revisions_included'],
			'quoteValidityDays' => (int) $t['quote_validity_days'],
			'ribaEmail'         => $t['riba_email'],
		);
	}
}
