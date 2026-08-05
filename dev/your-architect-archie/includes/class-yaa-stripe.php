<?php
/**
 * Stripe payments — embedded Payment Element on the client portal.
 *
 * The portal creates a PaymentIntent for the project total (server-side, secret
 * key never leaves PHP) and hands the client_secret to Stripe.js, which renders
 * the Payment Element on the yourarchitect portal page next to the confirmed
 * project. A signature-verified webhook marks the project paid and unlocks the
 * drawings — the authoritative signal, independent of the browser redirect.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Stripe {

	const API = 'https://api.stripe.com/v1/';

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
	}

	public static function routes() {
		register_rest_route( 'yaa/v1', '/pay-intent', array(
			'methods'             => 'POST',
			'permission_callback' => '__return_true',
			'callback'            => array( __CLASS__, 'create_intent_route' ),
		) );
		register_rest_route( 'yaa/v1', '/stripe-webhook', array(
			'methods'             => 'POST',
			'permission_callback' => '__return_true',
			'callback'            => array( __CLASS__, 'webhook' ),
		) );
	}

	public static function is_configured() {
		return '' !== trim( (string) YAA_Settings::get( 'stripe_secret_key', '' ) )
			&& '' !== trim( (string) YAA_Settings::get( 'stripe_publishable', '' ) );
	}

	private static function request( $path, array $params, $method = 'POST' ) {
		$key = trim( (string) YAA_Settings::get( 'stripe_secret_key', '' ) );
		if ( '' === $key ) {
			return new WP_Error( 'yaa_stripe_key', 'Stripe not configured.' );
		}
		$args = array(
			'timeout' => 20,
			'method'  => $method,
			'headers' => array(
				'Authorization' => 'Bearer ' . $key,
				'Content-Type'  => 'application/x-www-form-urlencoded',
			),
			'body'    => http_build_query( $params ),
		);
		$res = wp_remote_request( self::API . $path, $args );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		$json = json_decode( wp_remote_retrieve_body( $res ), true );
		if ( (int) wp_remote_retrieve_response_code( $res ) >= 300 ) {
			$msg = isset( $json['error']['message'] ) ? $json['error']['message'] : 'Stripe error.';
			return new WP_Error( 'yaa_stripe_http', $msg );
		}
		return is_array( $json ) ? $json : array();
	}

	/** Create (once per call) a PaymentIntent for the project total. */
	public static function create_intent( $project ) {
		if ( ! self::is_configured() ) {
			return new WP_Error( 'yaa_stripe_off', 'Payments are not set up yet.' );
		}
		$amount = (int) $project->total * 100; // pennies.
		if ( $amount < 100 ) {
			return new WP_Error( 'yaa_stripe_amount', 'Nothing to pay on this project.' );
		}
		return self::request( 'payment_intents', array(
			'amount'                        => $amount,
			'currency'                      => (string) YAA_Settings::get( 'currency', 'gbp' ),
			'metadata[project_id]'          => (int) $project->id,
			'metadata[ref]'                 => (string) $project->ref,
			'automatic_payment_methods[enabled]' => 'true',
			'description'                   => 'Your Architect drawings' . ( $project->ref ? ' — ' . $project->ref : '' ),
		) );
	}

	/** Portal calls this with the token to get a client_secret. */
	public static function create_intent_route( $req ) {
		$project = YAA_Project::by_token( (string) $req->get_param( 'token' ) );
		if ( ! $project ) {
			return new WP_REST_Response( array( 'error' => 'not_found' ), 404 );
		}
		if ( $project->paid ) {
			return new WP_REST_Response( array( 'error' => 'already_paid' ), 409 );
		}
		$intent = self::create_intent( $project );
		if ( is_wp_error( $intent ) ) {
			return new WP_REST_Response( array( 'error' => $intent->get_error_message() ), 502 );
		}
		return new WP_REST_Response( array(
			'clientSecret' => $intent['client_secret'],
			'publishable'  => (string) YAA_Settings::get( 'stripe_publishable', '' ),
		) );
	}

	/** Signature-verified webhook: payment_intent.succeeded → mark paid. */
	public static function webhook( $req ) {
		$payload = $req->get_body();
		$secret  = trim( (string) YAA_Settings::get( 'stripe_webhook_secret', '' ) );
		$sig     = $req->get_header( 'stripe_signature' );

		if ( $secret && ! self::verify_signature( $payload, (string) $sig, $secret ) ) {
			return new WP_REST_Response( array( 'error' => 'bad_signature' ), 400 );
		}

		$event = json_decode( $payload, true );
		$type  = isset( $event['type'] ) ? $event['type'] : '';
		if ( 'payment_intent.succeeded' === $type ) {
			$obj = isset( $event['data']['object'] ) ? $event['data']['object'] : array();
			$pid = isset( $obj['metadata']['project_id'] ) ? (int) $obj['metadata']['project_id'] : 0;
			$amt = isset( $obj['amount_received'] ) ? (int) $obj['amount_received'] : ( isset( $obj['amount'] ) ? (int) $obj['amount'] : 0 );
			$intent_id = isset( $obj['id'] ) ? (string) $obj['id'] : '';
			if ( $pid ) {
				YAA_Project::mark_paid( $pid, $amt, $intent_id );
			}
		}
		return new WP_REST_Response( array( 'received' => true ) );
	}

	/** Verify the Stripe-Signature header (t=..,v1=..) with the webhook secret. */
	private static function verify_signature( $payload, $header, $secret ) {
		$parts = array();
		foreach ( explode( ',', $header ) as $piece ) {
			$kv = explode( '=', trim( $piece ), 2 );
			if ( 2 === count( $kv ) ) {
				$parts[ $kv[0] ][] = $kv[1];
			}
		}
		if ( empty( $parts['t'][0] ) || empty( $parts['v1'] ) ) {
			return false;
		}
		$signed   = $parts['t'][0] . '.' . $payload;
		$expected = hash_hmac( 'sha256', $signed, $secret );
		foreach ( $parts['v1'] as $candidate ) {
			if ( hash_equals( $expected, $candidate ) ) {
				// Reject events older than 5 minutes (replay protection).
				return ( abs( time() - (int) $parts['t'][0] ) <= 300 );
			}
		}
		return false;
	}
}
