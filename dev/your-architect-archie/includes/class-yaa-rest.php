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
		register_rest_route( self::NS, '/upload', $args + array( 'callback' => array( __CLASS__, 'upload' ) ) );
		register_rest_route( self::NS, '/reset', $args + array( 'callback' => array( __CLASS__, 'reset' ) ) );
	}

	/** Client uploads a photo/sketch of the property — stored against the project. */
	public static function upload( $req ) {
		if ( ! self::check_nonce( $req ) ) {
			return new WP_REST_Response( array( 'error' => 'bad_nonce', 'message' => __( 'Your session expired — please refresh the page and try again.', 'your-architect-archie' ) ), 403 );
		}
		$id      = YAA_Project::current( true );
		$session = isset( $_COOKIE[ YAA_Project::COOKIE ] ) ? sanitize_text_field( wp_unslash( $_COOKIE[ YAA_Project::COOKIE ] ) ) : (string) $id;
		if ( ! YAA_Rate_Limit::allow_turn( $session ) ) {
			return new WP_REST_Response( array( 'error' => 'slow_down', 'message' => __( 'One moment — that came through very fast. Please try again.', 'your-architect-archie' ) ), 429 );
		}
		$mimes = array(
			'jpg|jpeg|jpe' => 'image/jpeg',
			'png'          => 'image/png',
			'gif'          => 'image/gif',
			'webp'         => 'image/webp',
			'heic'         => 'image/heic',
			'pdf'          => 'application/pdf',
		);
		$res = YAA_Files::store_uploaded( $id, 'file', 'client', __( 'Photo from client', 'your-architect-archie' ), '', $mimes );
		if ( is_wp_error( $res ) ) {
			return new WP_REST_Response( array( 'error' => $res->get_error_code(), 'message' => __( 'Sorry, I couldn\'t save that file — please try a JPG, PNG or PDF.', 'your-architect-archie' ) ), 400 );
		}
		return new WP_REST_Response( array( 'ok' => true, 'message' => __( 'Thanks — I\'ve saved that with your project. A photo really helps the team picture the space.', 'your-architect-archie' ) ) );
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
		// Return a FRESH nonce from this (uncached) REST call — the one localised
		// into the page can be stale behind a page cache (StackCache) or its header
		// stripped by a CDN, which is what surfaces as "something went wrong".
		$nonce    = wp_create_nonce( 'yaa_rest' );
		$messages = YAA_Project::messages( $id );
		if ( empty( $messages ) ) {
			$open = YAA_Archie::opener( $id );
			return new WP_REST_Response(
				array( 'messages' => YAA_Project::messages( $id ), 'package' => $open['package'], 'options' => $open['options'], 'meta' => self::meta(), 'nonce' => $nonce, 'configured' => YAA_Claude::is_configured() )
			);
		}
		return new WP_REST_Response(
			array( 'messages' => $messages, 'package' => YAA_Project::package( $id ), 'options' => array(), 'meta' => self::meta(), 'nonce' => $nonce, 'configured' => YAA_Claude::is_configured() )
		);
	}

	public static function message( $req ) {
		if ( ! self::check_nonce( $req ) ) {
			return new WP_REST_Response( array( 'error' => 'bad_nonce', 'message' => __( 'Your session expired — please refresh the page and try again.', 'your-architect-archie' ) ), 403 );
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
		$node  = sanitize_key( (string) $req->get_param( 'id' ) ); // sanitize_key lower-cases the id.
		$state = YAA_Project::state( $id );
		$map   = array( 'submission' => 'submitApp', 'concept3d' => 'concept', 'sitevisit' => 'siteVisit', 'survey' => 'survey', 'structural' => 'structural' );
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
		$id       = YAA_Project::current( true );
		$state    = YAA_Project::state( $id );
		$package  = YAA_Project::package( $id );
		$redirect = ! empty( $package['redirect'] );

		// We cannot open a project we have no way to reply to. If there's no email
		// yet, don't submit — ask for it in the chat and let the front end retry.
		if ( ! $redirect && empty( $state['email'] ) ) {
			$ask = __( 'Before I save this — what\'s the best email address to send your quote to? That\'s how our architects will get back to you.', 'your-architect-archie' );
			YAA_Project::add_message( $id, 'assistant', $ask );
			return new WP_REST_Response( array( 'needEmail' => true, 'message' => $ask ), 200 );
		}

		YAA_Project::set_status( $id, $redirect ? 'redirected' : 'submitted' );

		do_action( 'yaa_project_submitted', $id, $package );
		YAA_Followups::notify_submit( $id, $package );

		$ref = YAA_Project::make_ref( $id );

		// Payment is not taken at submit — Tiam approve the project first, then send
		// the client a secure portal link to pay. So no immediate checkout URL here.
		$message = $redirect
			? __( 'Thanks — this one is a better fit for a full commission with Tiam Architects, so I\'ve flagged it for a consultation.', 'your-architect-archie' )
			: __( 'Project saved. Our architects will review it and email you a secure link to confirm and pay — you only pay to release the full drawings.', 'your-architect-archie' );

		return new WP_REST_Response( array( 'ref' => $ref, 'redirect' => $redirect, 'message' => $message, 'checkoutUrl' => null ) );
	}
}
