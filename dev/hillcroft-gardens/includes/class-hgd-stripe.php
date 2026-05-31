<?php
/**
 * Thin Stripe REST client.
 *
 * Talks to https://api.stripe.com/v1 with the secret key as Bearer auth. Used to
 * collect the £200 consultation fee via a PaymentIntent + embedded Payment Element.
 * Mirrors the pattern in oc-ad-manager's OCAD_Stripe.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Stripe {

	const API_BASE = 'https://api.stripe.com/v1';

	private static function secret_key() {
		return (string) HGD_Settings::get( 'stripe_secret_key', '' );
	}

	public static function is_configured() {
		return '' !== self::secret_key();
	}

	/**
	 * Create a PaymentIntent.
	 *
	 * @param int    $amount_pence Amount in the currency's minor unit (pence).
	 * @param string $currency     ISO currency code.
	 * @param array  $metadata     Key/value metadata (strings).
	 * @return array|WP_Error Decoded PaymentIntent (incl. id + client_secret) or error.
	 */
	public static function create_payment_intent( $amount_pence, $currency = 'gbp', $metadata = array() ) {
		$secret = self::secret_key();
		if ( ! $secret ) {
			return new WP_Error( 'hgd_no_stripe', __( 'Stripe is not configured.', 'hillcroft-garden-designer' ) );
		}

		$body = array(
			'amount'                              => (int) $amount_pence,
			'currency'                            => strtolower( $currency ),
			'automatic_payment_methods[enabled]'  => 'true',
		);
		foreach ( $metadata as $k => $v ) {
			$body[ 'metadata[' . $k . ']' ] = (string) $v;
		}

		$response = wp_remote_post( self::API_BASE . '/payment_intents', array(
			'headers' => array(
				'Authorization' => 'Bearer ' . $secret,
				'Content-Type'  => 'application/x-www-form-urlencoded',
			),
			'body'    => $body,
			'timeout' => 20,
		) );

		return self::handle_response( $response );
	}

	/**
	 * Retrieve a PaymentIntent by id.
	 *
	 * @param string $id PaymentIntent id (pi_...).
	 * @return array|WP_Error
	 */
	public static function retrieve_payment_intent( $id ) {
		$secret = self::secret_key();
		if ( ! $secret ) {
			return new WP_Error( 'hgd_no_stripe', __( 'Stripe is not configured.', 'hillcroft-garden-designer' ) );
		}
		$id = sanitize_text_field( $id );
		if ( '' === $id ) {
			return new WP_Error( 'hgd_stripe_bad_id', __( 'Missing PaymentIntent id.', 'hillcroft-garden-designer' ) );
		}

		$response = wp_remote_get( self::API_BASE . '/payment_intents/' . rawurlencode( $id ), array(
			'headers' => array(
				'Authorization' => 'Bearer ' . $secret,
			),
			'timeout' => 20,
		) );

		return self::handle_response( $response );
	}

	private static function handle_response( $response ) {
		if ( is_wp_error( $response ) ) {
			return $response;
		}
		$code = wp_remote_retrieve_response_code( $response );
		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( $code < 200 || $code >= 300 ) {
			$msg = isset( $data['error']['message'] ) ? $data['error']['message'] : sprintf( 'Stripe error (%d).', $code );
			return new WP_Error( 'hgd_stripe_error', $msg );
		}
		return is_array( $data ) ? $data : array();
	}

	/**
	 * Verify a Stripe webhook signature.
	 *
	 * Parses the Stripe-Signature header (t= timestamp, v1= signatures), recomputes
	 * the HMAC-SHA256 of "{t}.{payload}" with the webhook signing secret, and
	 * compares with hash_equals.
	 *
	 * @param string $payload    Raw request body.
	 * @param string $sig_header The Stripe-Signature header value.
	 * @param string $secret     The webhook signing secret (whsec_...).
	 * @return bool
	 */
	public static function verify_webhook( $payload, $sig_header, $secret ) {
		if ( ! $secret || ! $sig_header ) {
			return false;
		}

		$timestamp  = '';
		$signatures = array();
		foreach ( explode( ',', $sig_header ) as $part ) {
			$kv = explode( '=', $part, 2 );
			if ( count( $kv ) !== 2 ) {
				continue;
			}
			$key = trim( $kv[0] );
			$val = trim( $kv[1] );
			if ( 't' === $key ) {
				$timestamp = $val;
			} elseif ( 'v1' === $key ) {
				$signatures[] = $val;
			}
		}

		if ( '' === $timestamp || empty( $signatures ) ) {
			return false;
		}

		$expected = hash_hmac( 'sha256', $timestamp . '.' . $payload, $secret );
		foreach ( $signatures as $sig ) {
			if ( hash_equals( $expected, $sig ) ) {
				return true;
			}
		}
		return false;
	}
}
