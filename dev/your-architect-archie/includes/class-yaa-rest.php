<?php
/**
 * REST endpoints for the Archie front end (namespace yaa/v1).
 *
 * The session is the cookie-tied project (never an exposed post ID). Write
 * endpoints are nonce-checked and rate-limited, and gated behind the daily
 * token cap so the Claude spend is bounded.
 *
 *   POST /start    → resume or greet: { messages, package, meta }
 *   POST /message  → one Archie turn: { message, package, redirect, done }
 *   POST /remove   → drop a package node: { package }
 *   POST /submit   → open/confirm the project: { ref, redirect, message, checkoutUrl }
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Rest {

	const NS = 'yaa/v1';

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
	}

	public static function routes() {
		$args = array( 'methods' => 'POST', 'permission_callback' => '__return_true' );
		register_rest_route( self::NS, '/start', $args + array( 'callback' => array( __CLASS__, 'start' ) ) );
		register_rest_route( self::NS, '/message', $args + array( 'callback' => array( __CLASS__, 'message' ) ) );
		register_rest_route( self::NS, '/remove', $args + array( 'callback' => array( __CLASS__, 'remove' ) ) );
		register_rest_route( self::NS, '/submit', $args + array( 'callback' => array( __CLASS__, 'submit' ) ) );
		register_rest_route( self::NS, '/reset', $args + array( 'callback' => array( __CLASS__, 'reset' ) ) );
	}

	/** Abandon the current project + drop the cookie so /start makes a fresh one. */
	public static function reset( $req ) {
		if ( ! self::check_nonce( $req ) ) {
			return new WP_REST_Response( array( 'error' => 'bad_nonce' ), 403 );
		}
		$id = YAA_Project::current( false );
		if ( $id ) {
			YAA_Project::set_status( $id, 'abandoned' );
		}
		setcookie( YAA_Project::COOKIE, '', array( 'expires' => time() - 3600, 'path' => '/', 'samesite' => 'Lax' ) );
		unset( $_COOKIE[ YAA_Project::COOKIE ] );
		return new WP_REST_Response( array( 'ok' => true ) );
	}

	private static function check_nonce( $req ) {
		$nonce = $req->get_header( 'x_yaa_nonce' );
		if ( ! $nonce ) {
			$nonce = $req->get_param( 'nonce' );
		}
		return (bool) wp_verify_nonce( $nonce, 'yaa_rest' );
	}

	private static function meta() {
		$t = YAA_Pricing::table();
		return array(
			'delivery'     => $t['delivery_days'],
			'revisions'    => (int) $t['revisions_included'],
			'validityDays' => (int) $t['quote_validity_days'],
		);
	}

	public static function start( $req ) {
		$id = YAA_Project::current( true );
		if ( ! $id ) {
			return new WP_REST_Response( array( 'error' => 'no_session' ), 500 );
		}
		$messages = YAA_Project::messages( $id );
		if ( empty( $messages ) ) {
			$open = YAA_Archie::opener( $id );
			return new WP_REST_Response(
				array( 'messages' => YAA_Project::messages( $id ), 'package' => $open['package'], 'meta' => self::meta(), 'configured' => YAA_Claude::is_configured() )
			);
		}
		return new WP_REST_Response(
			array( 'messages' => $messages, 'package' => YAA_Project::package( $id ), 'meta' => self::meta(), 'configured' => YAA_Claude::is_configured() )
		);
	}

	public static function message( $req ) {
		if ( ! self::check_nonce( $req ) ) {
			return new WP_REST_Response( array( 'error' => 'bad_nonce' ), 403 );
		}
		$id = YAA_Project::current( true );
		$session = isset( $_COOKIE[ YAA_Project::COOKIE ] ) ? sanitize_text_field( wp_unslash( $_COOKIE[ YAA_Project::COOKIE ] ) ) : (string) $id;

		if ( ! YAA_Rate_Limit::under_daily_cap() ) {
			return new WP_REST_Response( array( 'error' => 'busy', 'message' => __( 'Archie is taking a quick break — please try again shortly.', 'your-architect-archie' ) ), 429 );
		}
		if ( ! YAA_Rate_Limit::allow_turn( $session ) ) {
			return new WP_REST_Response( array( 'error' => 'slow_down', 'message' => __( 'One moment — you\'re going a little fast for me.', 'your-architect-archie' ) ), 429 );
		}

		$text   = (string) $req->get_param( 'text' );
		$result = YAA_Archie::turn( $id, $text );
		if ( is_wp_error( $result ) ) {
			return new WP_REST_Response( array( 'error' => $result->get_error_code(), 'message' => $result->get_error_message() ), 502 );
		}
		return new WP_REST_Response( $result );
	}

	public static function remove( $req ) {
		if ( ! self::check_nonce( $req ) ) {
			return new WP_REST_Response( array( 'error' => 'bad_nonce' ), 403 );
		}
		$id    = YAA_Project::current( true );
		$node  = sanitize_key( (string) $req->get_param( 'id' ) );
		$state = YAA_Project::state( $id );
		$map   = array( 'listed' => 'listed', 'survey' => 'survey', 'concept' => 'concept', 'structural' => 'structural', 'partyWall' => 'partyWall' );
		if ( isset( $map[ $node ] ) ) {
			$state[ $map[ $node ] ] = false;
		}
		$package = YAA_Pricing::build_package( $state );
		YAA_Project::set_state( $id, $state );
		YAA_Project::set_package( $id, $package );
		return new WP_REST_Response( array( 'package' => $package ) );
	}

	public static function submit( $req ) {
		if ( ! self::check_nonce( $req ) ) {
			return new WP_REST_Response( array( 'error' => 'bad_nonce' ), 403 );
		}
		$id      = YAA_Project::current( true );
		$package = YAA_Project::package( $id );
		$redirect = ! empty( $package['redirect'] );
		YAA_Project::set_status( $id, $redirect ? 'redirected' : 'submitted' );

		do_action( 'yaa_project_submitted', $id, $package );
		YAA_Followups::notify_submit( $id, $package );

		$ref     = 'YA-' . strtoupper( substr( wp_hash( (string) $id ), 0, 6 ) );
		$checkout = YAA_Stripe::checkout_url( $id, $package ); // null unless Stripe is configured.

		$message = $redirect
			? __( 'Thanks — this one is a better fit for a full commission with Tiam Architects, so I\'ve flagged it for a consultation.', 'your-architect-archie' )
			: __( 'Project saved. We\'ll prepare your drawings and send a watermarked preview — you only pay to release the full package.', 'your-architect-archie' );

		return new WP_REST_Response( array( 'ref' => $ref, 'redirect' => $redirect, 'message' => $message, 'checkoutUrl' => $checkout ) );
	}
}
