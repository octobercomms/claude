<?php
/**
 * Plugin settings, stored in a single wp_option. Secret fields are encrypted
 * at rest via YAA_Crypto and never returned to the browser.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Settings {

	const OPTION = 'yaa_settings';

	/** Keys whose values are encrypted at rest. */
	const SECRETS = array( 'claude_api_key', 'stripe_secret_key' );

	public static function defaults() {
		return array(
			'claude_api_key'     => '',
			'claude_model'       => 'claude-sonnet-4-6',
			'max_output_tokens'  => 700,
			'notify_email'       => get_option( 'admin_email' ),
			'arb_no'             => '',
			'company_no'         => '',
			'rate_limit_per_min' => 12,   // Archie turns per session per minute.
			'daily_token_cap'    => 500000, // soft cap; hard-stop new turns beyond it.
			'stripe_secret_key'  => '',
			'stripe_publishable' => '',
			'historic_api_on'    => 0,
		);
	}

	public static function all() {
		$saved = get_option( self::OPTION, array() );
		$out   = wp_parse_args( is_array( $saved ) ? $saved : array(), self::defaults() );
		foreach ( self::SECRETS as $k ) {
			$out[ $k ] = YAA_Crypto::decrypt( isset( $out[ $k ] ) ? $out[ $k ] : '' );
		}
		return $out;
	}

	public static function get( $key, $default = null ) {
		$all = self::all();
		return array_key_exists( $key, $all ) ? $all[ $key ] : $default;
	}

	/**
	 * Save a set of values (merged). Secret fields are encrypted; a blank secret
	 * leaves the stored value untouched (so you don't have to re-enter it).
	 */
	public static function update( array $values ) {
		$raw = get_option( self::OPTION, array() );
		$raw = is_array( $raw ) ? $raw : array();
		foreach ( $values as $k => $v ) {
			if ( in_array( $k, self::SECRETS, true ) ) {
				if ( '' === trim( (string) $v ) ) {
					continue; // keep existing secret.
				}
				$raw[ $k ] = YAA_Crypto::encrypt( trim( (string) $v ) );
			} else {
				$raw[ $k ] = $v;
			}
		}
		update_option( self::OPTION, $raw, false );
	}

	/** Whether a secret is set (without exposing it). */
	public static function has_secret( $key ) {
		$raw = get_option( self::OPTION, array() );
		return ! empty( $raw[ $key ] );
	}
}
