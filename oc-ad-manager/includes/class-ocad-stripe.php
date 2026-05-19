<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCAD_Stripe {

	private static function secret_key() {
		return get_option( 'ocad_stripe_secret_key', '' );
	}

	public static function create_payment_intent( $amount_cents, $currency, $metadata = array() ) {
		$secret = self::secret_key();
		if ( ! $secret ) {
			return new WP_Error( 'ocad_no_stripe', 'Stripe not configured.' );
		}

		$body = array(
			'amount'   => (int) $amount_cents,
			'currency' => strtolower( $currency ),
		);
		foreach ( $metadata as $k => $v ) {
			$body[ 'metadata[' . $k . ']' ] = $v;
		}

		$response = wp_remote_post( 'https://api.stripe.com/v1/payment_intents', array(
			'headers' => array(
				'Authorization' => 'Bearer ' . $secret,
				'Content-Type'  => 'application/x-www-form-urlencoded',
			),
			'body'    => $body,
			'timeout' => 20,
		) );

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$code = wp_remote_retrieve_response_code( $response );
		$data = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( $code !== 200 ) {
			$msg = isset( $data['error']['message'] ) ? $data['error']['message'] : 'Stripe error (' . $code . ').';
			return new WP_Error( 'ocad_stripe_error', $msg );
		}

		return $data;
	}

	public static function verify_webhook( $payload, $sig_header ) {
		$secret = get_option( 'ocad_stripe_webhook_secret', '' );
		if ( ! $secret || ! $sig_header ) {
			return false;
		}

		$parts = array();
		foreach ( explode( ',', $sig_header ) as $part ) {
			$kv = explode( '=', $part, 2 );
			if ( count( $kv ) === 2 ) {
				$parts[ trim( $kv[0] ) ] = trim( $kv[1] );
			}
		}

		if ( empty( $parts['t'] ) || empty( $parts['v1'] ) ) {
			return false;
		}

		$expected = hash_hmac( 'sha256', $parts['t'] . '.' . $payload, $secret );
		return hash_equals( $expected, $parts['v1'] );
	}
}
