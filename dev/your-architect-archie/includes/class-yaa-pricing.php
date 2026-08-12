<?php
/**
 * Pricing model + server-side package builder.
 *
 * The model is now a SERVICE MENU (not two fixed packages) and is fully
 * editable in the admin (Archie → Pricing & Services), stored in the
 * `yaa_pricing` option. Archie asks which service the homeowner needs, then
 * ADDS optional add-ons — the package is additive (nothing to "remove"). The
 * server recomputes the whole package from the collected state each turn and
 * returns it; the client only renders. Archie never states a price; this does.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Pricing {

	const OPTION = 'yaa_pricing';

	/**
	 * Editable defaults. Prices are the Tiam service menu (Aug 2026).
	 * A service with price === null and redirect => 1 is "priced on request"
	 * (Archie flags it for a consultation instead of quoting).
	 */
	public static function defaults() {
		return array(
			'services' => array(
				'preplanning'   => array( 'label' => 'Pre-planning application drawings', 'sub' => 'Test your idea with the council before a full application', 'price' => 450, 'enabled' => 1 ),
				'planning'      => array( 'label' => 'Full planning application / consent', 'sub' => 'Submission-ready planning drawings', 'price' => 690, 'enabled' => 1, 'submission' => 1 ),
				'buildingregs'  => array( 'label' => 'Building regulations drawings', 'sub' => 'The technical drawings your builder builds from', 'price' => 900, 'enabled' => 1 ),
				'listed'        => array( 'label' => 'Listed building consent', 'sub' => 'For listed / protected buildings', 'price' => 550, 'enabled' => 1 ),
				'permitted'     => array( 'label' => 'Permitted development / lawful development certificate', 'sub' => 'Confirm the work is lawful without a full application', 'price' => 450, 'enabled' => 1 ),
				'changeofuse'   => array( 'label' => 'Change of use (without construction)', 'sub' => '', 'price' => 450, 'enabled' => 1 ),
				'retrospective' => array( 'label' => 'Retrospective application', 'sub' => 'Regularise work already carried out', 'price' => 450, 'enabled' => 1 ),
				'newdwelling'   => array( 'label' => 'New dwelling(s)', 'sub' => 'From £950 — priced on request', 'price' => null, 'enabled' => 1, 'redirect' => 1 ),
			),
			'addons' => array(
				'submission' => array( 'label' => 'We submit & manage your planning application', 'price' => 100, 'enabled' => 1, 'service' => 'planning' ),
				'concept3d'  => array( 'label' => '3D visualisation (up to 2 revisions)', 'price' => 250, 'enabled' => 1 ),
				'siteVisit'  => array( 'label' => 'Site visit (London / within the M25)', 'price' => 350, 'enabled' => 1, 'london' => 1 ),
			),
			'meta' => array(
				'delivery'     => 'within 7 days',
				'revisions'    => 2,
				'validityDays' => 30,
				'ribaEmail'    => 'info@tiamarchitects.com',
				'phone'        => '+44 020 3771 2346',
				'bookingUrl'   => '',
			),
			// Editable canned replies Archie uses for specific moments.
			'answers' => array(
				'structuralUnsure' => 'No problem — we can confirm this with you in due course.',
				'surveyHelp'       => 'No problem — we\'ll help. We find a trusted independent local professional to carry out an accurate laser-measured survey, and we base your drawings on that. You approve their quote first and pay them directly.',
			),
		);
	}

	/** The live, editable table (saved config merged over defaults). */
	public static function table() {
		$saved = get_option( self::OPTION, array() );
		$table = is_array( $saved ) && $saved ? self::merge( self::defaults(), $saved ) : self::defaults();
		/** Programmatic override if ever needed. */
		return apply_filters( 'yaa_pricing_table', $table );
	}

	/** Persist an edited config. */
	public static function save( array $config ) {
		update_option( self::OPTION, $config, false );
	}

	/** Recursive merge that lets saved values win but keeps any new default keys. */
	private static function merge( array $base, array $over ) {
		foreach ( $over as $k => $v ) {
			if ( isset( $base[ $k ] ) && is_array( $base[ $k ] ) && is_array( $v ) ) {
				$base[ $k ] = self::merge( $base[ $k ], $v );
			} else {
				$base[ $k ] = $v;
			}
		}
		return $base;
	}

	public static function money( $n ) {
		return '£' . number_format_i18n( (int) $n );
	}

	/** Enabled services in order, for the front end + Archie's menu. */
	public static function services() {
		$out = array();
		foreach ( self::table()['services'] as $key => $svc ) {
			if ( ! empty( $svc['enabled'] ) ) {
				$out[ $key ] = $svc;
			}
		}
		return $out;
	}

	/**
	 * Build the package from collected state.
	 *
	 * @param array $s Keys: service (a services key), submitApp, concept,
	 *                 siteVisit, survey, structural, london.
	 * @return array { nodes:[{id,label,sub,price|null,removable,kind}], total, redirect, london, meta }
	 */
	public static function build_package( array $s ) {
		$t        = self::table();
		$services = $t['services'];
		$addons   = $t['addons'];
		$service  = isset( $s['service'] ) ? (string) $s['service'] : '';
		$nodes    = array();
		$total    = 0;
		$redirect = false;

		if ( $service && isset( $services[ $service ] ) && ! empty( $services[ $service ]['enabled'] ) ) {
			$svc      = $services[ $service ];
			$onRequest = ( ! empty( $svc['redirect'] ) || null === $svc['price'] || '' === $svc['price'] );
			if ( $onRequest ) {
				$redirect = ! empty( $svc['redirect'] );
				$nodes[]  = array( 'id' => 'service', 'label' => $svc['label'], 'sub' => isset( $svc['sub'] ) ? $svc['sub'] : '', 'price' => null, 'removable' => false, 'kind' => $redirect ? 'info' : 'consultant' );
			} else {
				$total  += (int) $svc['price'];
				$nodes[] = array( 'id' => 'service', 'label' => $svc['label'], 'sub' => isset( $svc['sub'] ) ? $svc['sub'] : '', 'price' => (int) $svc['price'], 'removable' => false );
			}
		}

		// Add-ons — additive: Archie asks, then adds. Never "select to remove".
		$submission_ok = isset( $addons['submission'] ) && ! empty( $addons['submission']['enabled'] )
			&& $service && isset( $services[ $service ]['submission'] ) && $services[ $service ]['submission'];
		if ( ! empty( $s['submitApp'] ) && $submission_ok ) {
			$total  += (int) $addons['submission']['price'];
			$nodes[] = array( 'id' => 'submission', 'label' => $addons['submission']['label'], 'sub' => 'Add-on', 'price' => (int) $addons['submission']['price'], 'removable' => false, 'kind' => 'addon' );
		}
		if ( ! empty( $s['concept'] ) && isset( $addons['concept3d'] ) && ! empty( $addons['concept3d']['enabled'] ) ) {
			$total  += (int) $addons['concept3d']['price'];
			$nodes[] = array( 'id' => 'concept3d', 'label' => $addons['concept3d']['label'], 'sub' => 'Add-on', 'price' => (int) $addons['concept3d']['price'], 'removable' => false, 'kind' => 'addon' );
		}
		if ( ! empty( $s['siteVisit'] ) && ! empty( $s['london'] ) && isset( $addons['siteVisit'] ) && ! empty( $addons['siteVisit']['enabled'] ) ) {
			$total  += (int) $addons['siteVisit']['price'];
			$nodes[] = array( 'id' => 'siteVisit', 'label' => $addons['siteVisit']['label'], 'sub' => 'Add-on', 'price' => (int) $addons['siteVisit']['price'], 'removable' => false, 'kind' => 'addon' );
		}

		// Sourced separately — never our fee.
		if ( ! empty( $s['survey'] ) ) {
			$nodes[] = array( 'id' => 'survey', 'label' => 'Measured survey', 'sub' => 'Sourced separately', 'price' => null, 'removable' => false, 'kind' => 'consultant' );
		}
		if ( ! empty( $s['structural'] ) ) {
			$nodes[] = array( 'id' => 'structural', 'label' => 'Structural engineer', 'sub' => 'Sourced separately', 'price' => null, 'removable' => false, 'kind' => 'consultant' );
		}
		if ( ! empty( $s['london'] ) ) {
			$nodes[] = array( 'id' => 'london', 'label' => '✓ London project', 'sub' => '', 'price' => null, 'removable' => false, 'kind' => 'info' );
		}

		return array(
			'nodes'    => $nodes,
			'total'    => $total,
			'redirect' => (bool) $redirect,
			'london'   => ! empty( $s['london'] ),
			'meta'     => array(
				'delivery'     => $t['meta']['delivery'],
				'revisions'    => (int) $t['meta']['revisions'],
				'validityDays' => (int) $t['meta']['validityDays'],
			),
		);
	}

	/** The model localised to the front end. */
	public static function public_data() {
		$t = self::table();
		return array(
			'services'          => self::services(),
			'addons'            => $t['addons'],
			'deliveryDays'      => $t['meta']['delivery'],
			'revisionsIncluded' => (int) $t['meta']['revisions'],
			'quoteValidityDays' => (int) $t['meta']['validityDays'],
			'ribaEmail'         => $t['meta']['ribaEmail'],
			'phone'             => $t['meta']['phone'],
			'bookingUrl'        => $t['meta']['bookingUrl'],
		);
	}
}
