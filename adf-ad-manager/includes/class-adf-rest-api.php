<?php
/**
 * REST API endpoints — used by partner sites to fetch ads and report impressions.
 *
 * Hub endpoints:
 *   GET  /wp-json/adf/v1/ad?format=mpu         → returns active ad JSON
 *   POST /wp-json/adf/v1/impression             → log an impression from a partner
 *
 * Authentication: X-ADF-API-Key header or ?api_key= query param.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ADF_REST_API {

	public function __construct() {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes() {
		register_rest_route( 'adf/v1', '/ad', array(
			'methods'             => 'GET',
			'callback'            => array( $this, 'get_ad' ),
			'permission_callback' => array( $this, 'check_api_key' ),
			'args'                => array(
				'format' => array(
					'required'          => true,
					'sanitize_callback' => 'sanitize_key',
					'validate_callback' => function ( $value ) {
						return array_key_exists( $value, ADF_FORMATS );
					},
				),
			),
		) );

		register_rest_route( 'adf/v1', '/impression', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'log_impression' ),
			'permission_callback' => array( $this, 'check_api_key' ),
			'args'                => array(
				'ad_id'      => array( 'required' => true, 'sanitize_callback' => 'absint' ),
				'campaign_id'=> array( 'required' => true, 'sanitize_callback' => 'absint' ),
			),
		) );
	}

	public function check_api_key( WP_REST_Request $request ) {
		// Only hub sites expose this API.
		if ( get_option( 'adf_site_mode', 'hub' ) !== 'hub' ) {
			return new WP_Error( 'adf_not_hub', 'This site is not an ADF hub.', array( 'status' => 403 ) );
		}

		$stored_key = get_option( 'adf_api_key', '' );
		if ( ! $stored_key ) {
			return new WP_Error( 'adf_no_key', 'API key not configured.', array( 'status' => 403 ) );
		}

		$provided = $request->get_header( 'X-ADF-API-Key' )
			?: sanitize_text_field( $request->get_param( 'api_key' ) );

		if ( ! hash_equals( $stored_key, (string) $provided ) ) {
			return new WP_Error( 'adf_invalid_key', 'Invalid API key.', array( 'status' => 401 ) );
		}

		return true;
	}

	public function get_ad( WP_REST_Request $request ) {
		$format = $request->get_param( 'format' );
		$ad     = ADF_Campaign::get_active_ad_for_format( $format );

		if ( ! $ad ) {
			return new WP_Error( 'adf_no_ad', 'No active ad for this format.', array( 'status' => 404 ) );
		}

		$fmt = ADF_FORMATS[ $format ];

		// Click URL points back to this hub so clicks are tracked here.
		$click_url = add_query_arg( 'adf_click', $ad->ad_id, home_url( '/' ) );

		// Impression endpoint on this hub so partners can report back.
		$impression_url = rest_url( 'adf/v1/impression' );

		return rest_ensure_response( array(
			'ad_id'          => (int) $ad->ad_id,
			'campaign_id'    => (int) $ad->campaign_id,
			'format'         => $format,
			'image_url'      => $ad->image_url,
			'alt_text'       => $ad->alt_text ?: $fmt['label'] . ' advertisement',
			'click_url'      => $click_url,
			'impression_url' => $impression_url,
			'width'          => $fmt['width'],
			'height'         => $fmt['height'],
		) );
	}

	public function log_impression( WP_REST_Request $request ) {
		$ad_id      = $request->get_param( 'ad_id' );
		$campaign_id = $request->get_param( 'campaign_id' );

		// Verify the ad actually belongs to the campaign.
		$ad = ADF_Campaign::get_ad( $ad_id );
		if ( ! $ad || (int) $ad->campaign_id !== $campaign_id ) {
			return new WP_Error( 'adf_invalid', 'Invalid ad or campaign.', array( 'status' => 400 ) );
		}

		// Log with the remote IP from the partner site request (passed in header if available).
		global $wpdb;
		$table = $wpdb->prefix . 'adf_tracking';

		$remote_ip = sanitize_text_field( $request->get_header( 'X-Forwarded-IP' ) ?: '' );

		$wpdb->insert( $table, array(
			'campaign_id'     => $campaign_id,
			'ad_id'           => $ad_id,
			'type'            => 'impression',
			'ip_hash'         => $remote_ip ? hash( 'sha256', $remote_ip ) : null,
			'user_agent_hash' => null,
			'created_at'      => current_time( 'mysql' ),
		) );

		return rest_ensure_response( array( 'logged' => true ) );
	}
}
