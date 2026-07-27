<?php
/**
 * Minimal, privacy-friendly tracking: per-popup impression and CTA-click
 * counters, incremented via a public REST endpoint. No personal data stored.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCPOP_Analytics {

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
	}

	public static function routes() {
		register_rest_route(
			'october-popups/v1',
			'/track',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'track' ),
				'permission_callback' => '__return_true', // Public: anonymous visitors trigger popups.
				'args'                => array(
					'id'    => array( 'required' => true ),
					'event' => array( 'required' => true ),
				),
			)
		);
	}

	public static function track( $request ) {
		$id    = absint( $request->get_param( 'id' ) );
		$event = sanitize_key( $request->get_param( 'event' ) );

		if ( ! $id || get_post_type( $id ) !== OCPOP_CPT ) {
			return new WP_REST_Response( array( 'ok' => false ), 400 );
		}

		$map = array(
			'view'       => '_ocpop_views',
			'conversion' => '_ocpop_conversions',
			'close'      => '_ocpop_closes',
		);
		if ( ! isset( $map[ $event ] ) ) {
			return new WP_REST_Response( array( 'ok' => false ), 400 );
		}

		$meta_key = $map[ $event ];
		$current  = (int) get_post_meta( $id, $meta_key, true );
		update_post_meta( $id, $meta_key, $current + 1 );

		return new WP_REST_Response( array( 'ok' => true ), 200 );
	}
}
