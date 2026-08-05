<?php
/**
 * Listed-building + conservation-area + London detection from an address.
 *
 * The live platform calls the Historic England Listed Buildings API (and a
 * conservation-area source) on address entry so protected status is known before
 * the user is asked — which lets Archie ask intelligent, plain-English follow-ups.
 * This scaffold ships a heuristic fallback (keyword/postcode) and a guarded hook
 * for the real call — enable it in Settings once the endpoint/format is wired.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Historic_England {

	/**
	 * @return array { london:bool, listed:bool, conservation:bool }
	 */
	public static function check( $address ) {
		$address = (string) $address;

		if ( YAA_Settings::get( 'historic_api_on', 0 ) ) {
			$api = self::api_lookup( $address );
			if ( is_array( $api ) ) {
				// Normalise so callers can always rely on all three keys.
				return array(
					'london'       => ! empty( $api['london'] ),
					'listed'       => ! empty( $api['listed'] ),
					'conservation' => ! empty( $api['conservation'] ),
				);
			}
		}

		// Heuristic fallback (also what the demo uses).
		$london       = (bool) ( preg_match( '/london/i', $address ) || preg_match( '/\b(e|ec|n|nw|se|sw|w|wc|br|cr|da|en|ha|ig|kt|rm|sm|tw|ub)\d/i', $address ) );
		$listed       = (bool) preg_match( '/roupell|listed|grade\s*(i|ii)/i', $address );
		$conservation = (bool) preg_match( '/conservation|roupell|bedford\s*park|\bmews\b|\bcrescent\b/i', $address );
		return array( 'london' => $london, 'listed' => $listed, 'conservation' => $conservation );
	}

	/**
	 * Real Historic England lookup — TODO: implement against the live endpoint
	 * and response shape, then flip `historic_api_on` in Settings.
	 *
	 * @return array|null
	 */
	private static function api_lookup( $address ) {
		/** Filterable so the integration can be dropped in without editing core. */
		return apply_filters( 'yaa_historic_england_lookup', null, $address );
	}
}
