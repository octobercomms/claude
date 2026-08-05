<?php
/**
 * Usage & cost tracking + the spend guard.
 *
 * Records token usage from direct Anthropic calls and accumulates an ESTIMATED
 * monthly cost, so a site can set a hard monthly cap that blocks further
 * generation before it overspends. (In managed/connected mode the platform holds
 * the key and enforces its own caps, so this guard applies to the own-key path.)
 *
 * Prices are estimates and filterable via 'octobermi_model_prices' — set real
 * rates there. The cap is a safety rail, not billing.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OctoberMI_Usage {

	const OPTION = 'octobermi_usage';

	/** Estimated USD per 1M tokens: [input, output]. Filterable. */
	public static function prices() {
		return apply_filters( 'octobermi_model_prices', array(
			'claude-opus-5'             => array( 'in' => 15.0, 'out' => 75.0 ),
			'claude-sonnet-5'           => array( 'in' => 3.0,  'out' => 15.0 ),
			'claude-haiku-4-5-20251001' => array( 'in' => 1.0,  'out' => 5.0 ),
		) );
	}

	private static function month_key() {
		return gmdate( 'Y-m' );
	}

	public static function record( $model, $input_tokens, $output_tokens ) {
		$prices = self::prices();
		$rate   = isset( $prices[ $model ] ) ? $prices[ $model ] : array( 'in' => 3.0, 'out' => 15.0 );
		$cost   = ( $input_tokens / 1000000 ) * $rate['in'] + ( $output_tokens / 1000000 ) * $rate['out'];

		$all = get_option( self::OPTION, array() );
		if ( ! is_array( $all ) ) {
			$all = array();
		}
		$m = self::month_key();
		if ( empty( $all[ $m ] ) ) {
			$all[ $m ] = array( 'input' => 0, 'output' => 0, 'cost' => 0.0, 'calls' => 0 );
		}
		$all[ $m ]['input']  += (int) $input_tokens;
		$all[ $m ]['output'] += (int) $output_tokens;
		$all[ $m ]['cost']   += $cost;
		$all[ $m ]['calls']  += 1;

		// Keep only the last 12 months.
		if ( count( $all ) > 12 ) {
			ksort( $all );
			$all = array_slice( $all, -12, null, true );
		}
		update_option( self::OPTION, $all, false );
	}

	/** This month's totals. */
	public static function this_month() {
		$all = get_option( self::OPTION, array() );
		$m   = self::month_key();
		return ( is_array( $all ) && isset( $all[ $m ] ) )
			? $all[ $m ]
			: array( 'input' => 0, 'output' => 0, 'cost' => 0.0, 'calls' => 0 );
	}

	public static function month_cost() {
		$t = self::this_month();
		return (float) $t['cost'];
	}

	/** True when a monthly cap is set and this month's estimate has hit it. */
	public static function over_cap() {
		$cap = (float) OctoberMI_Settings::get( 'monthly_cost_cap', 0 );
		if ( $cap <= 0 ) {
			return false; // no cap
		}
		return self::month_cost() >= $cap;
	}
}
