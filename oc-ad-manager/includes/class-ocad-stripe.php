<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCAD_Stripe {

	private static function secret_key() {
		return get_option( 'ocad_stripe_secret_key', '' );
	}

	public static function create_session( $booking, $amount_cents, $line_item_name, $success_url, $cancel_url ) {
		$secret = self::secret_key();
		if ( ! $secret ) {
			return new WP_Error( 'ocad_no_stripe', 'Stripe not configured.' );
		}

		$body = array(
			'mode'                                                        => 'payment',
			'success_url'                                                 => $success_url,
			'cancel_url'                                                  => $cancel_url,
			'customer_email'                                              => $booking['email'],
			'line_items[0][price_data][currency]'                        => get_option( 'ocad_stripe_currency', 'usd' ),
			'line_items[0][price_data][unit_amount]'                     => (int) $amount_cents,
			'line_items[0][price_data][product_data][name]'              => $line_item_name,
			'line_items[0][price_data][product_data][description]'       => 'Ad campaign on Atlanta Design Festival',
			'line_items[0][quantity]'                                     => 1,
			'metadata[booking_id]'                                        => (int) $booking['id'],
			'payment_intent_data[metadata][booking_id]'                  => (int) $booking['id'],
		);

		$response = wp_remote_post( 'https://api.stripe.com/v1/checkout/sessions', array(
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

		$signed = $parts['t'] . '.' . $payload;
		$expected = hash_hmac( 'sha256', $signed, $secret );

		return hash_equals( $expected, $parts['v1'] );
	}
}
