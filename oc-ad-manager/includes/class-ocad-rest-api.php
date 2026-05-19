<?php
/**
 * REST API endpoints.
 *
 * Hub endpoints:
 *   GET  /wp-json/ocad/v1/ad?format=mpu&source=URL  → returns active ad JSON (API key required)
 *   GET  /wp-json/ocad/v1/render?format=mpu&source=URL  → returns ad HTML for frontend JS
 *   GET  /wp-json/ocad/v1/track-click?id=N&page=URL  → logs a click
 *   POST /wp-json/ocad/v1/impression  → (legacy) log impression from partner
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCAD_REST_API {

	public function __construct() {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes() {
		register_rest_route( 'ocad/v1', '/ad', array(
			'methods'             => 'GET',
			'callback'            => array( $this, 'get_ad' ),
			'permission_callback' => array( $this, 'check_api_key' ),
			'args'                => array(
				'format' => array(
					'required'          => true,
					'sanitize_callback' => 'sanitize_key',
					'validate_callback' => function ( $value ) {
						return array_key_exists( $value, OCAD_FORMATS );
					},
				),
				'source' => array(
					'required'          => false,
					'sanitize_callback' => 'sanitize_text_field',
				),
			),
		) );

		register_rest_route( 'ocad/v1', '/render', array(
			'methods'             => 'GET',
			'callback'            => array( $this, 'render_ad_html' ),
			'permission_callback' => '__return_true',
			'args'                => array(
				'format' => array(
					'required'          => true,
					'sanitize_callback' => 'sanitize_key',
					'validate_callback' => function ( $value ) {
						return array_key_exists( $value, OCAD_FORMATS );
					},
				),
				'source' => array(
					'required'          => false,
					'sanitize_callback' => 'sanitize_text_field',
				),
			),
		) );

		register_rest_route( 'ocad/v1', '/track-click', array(
			'methods'             => 'GET',
			'callback'            => array( $this, 'track_click' ),
			'permission_callback' => '__return_true',
			'args'                => array(
				'id' => array(
					'required'          => true,
					'sanitize_callback' => 'absint',
				),
				'page' => array(
					'required'          => false,
					'sanitize_callback' => 'sanitize_text_field',
				),
			),
		) );

		register_rest_route( 'ocad/v1', '/impression', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'log_impression' ),
			'permission_callback' => array( $this, 'check_api_key' ),
			'args'                => array(
				'ad_id'       => array( 'required' => true, 'sanitize_callback' => 'absint' ),
				'campaign_id' => array( 'required' => true, 'sanitize_callback' => 'absint' ),
			),
		) );
	}

	public function check_api_key( WP_REST_Request $request ) {
		if ( get_option( 'ocad_site_mode', 'hub' ) !== 'hub' ) {
			return new WP_Error( 'ocad_not_hub', 'This site is not configured as an Ad Manager hub.', array( 'status' => 403 ) );
		}

		$stored_key = get_option( 'ocad_api_key', '' );
		if ( ! $stored_key ) {
			return new WP_Error( 'ocad_no_key', 'API key not configured.', array( 'status' => 403 ) );
		}

		$provided = $request->get_header( 'X-OCAD-API-Key' )
			?: sanitize_text_field( $request->get_param( 'api_key' ) );

		if ( ! hash_equals( $stored_key, (string) $provided ) ) {
			return new WP_Error( 'ocad_invalid_key', 'Invalid API key.', array( 'status' => 401 ) );
		}

		return true;
	}

	public function get_ad( WP_REST_Request $request ) {
		$format     = $request->get_param( 'format' );
		$source_url = (string) $request->get_param( 'source' );
		$ad         = OCAD_Campaign::get_active_ad_for_format( $format );

		if ( ! $ad ) {
			return new WP_Error( 'ocad_no_ad', 'No active ad for this format.', array( 'status' => 404 ) );
		}

		$fmt = OCAD_FORMATS[ $format ];

		// Log impression — each call from a partner represents a fresh ad display (5-min cache window).
		OCAD_Tracker::log_impression( $ad->campaign_id, $ad->ad_id, $source_url );

		// Record partner domain so it appears in Settings > Partner Sites.
		if ( $source_url ) {
			$domain = wp_parse_url( $source_url, PHP_URL_HOST );
			if ( $domain ) {
				$known = get_option( 'ocad_known_partners', array() );
				if ( ! in_array( $domain, $known, true ) ) {
					$known[] = sanitize_text_field( $domain );
					update_option( 'ocad_known_partners', $known );
				}
			}
		}

		$click_url = add_query_arg( 'ocad_click', $ad->ad_id, home_url( '/' ) );

		return rest_ensure_response( array(
			'ad_id'       => (int) $ad->ad_id,
			'campaign_id' => (int) $ad->campaign_id,
			'format'      => $format,
			'image_url'   => $ad->image_url,
			'alt_text'    => $ad->alt_text ?: $fmt['label'] . ' advertisement',
			'click_url'   => $click_url,
			'width'       => $fmt['width'],
			'height'      => $fmt['height'],
		) );
	}

	public function render_ad_html( WP_REST_Request $request ) {
		try {
			return $this->do_render_ad_html( $request );
		} catch ( \Throwable $e ) {
			$response = rest_ensure_response( array( 'html' => '' ) );
			$response->header( 'Cache-Control', 'no-store' );
			return $response;
		}
	}

	private function do_render_ad_html( WP_REST_Request $request ) {
		$format     = $request->get_param( 'format' );
		$source_url = (string) $request->get_param( 'source' );
		$mode       = get_option( 'ocad_site_mode', 'hub' );

		if ( $mode === 'partner' ) {
			$html     = OCAD_Partner::render_ad( $format, $source_url );
			$response = rest_ensure_response( array( 'html' => (string) $html ) );
		} else {
			$ad = OCAD_Campaign::get_active_ad_for_format( $format );

			if ( ! $ad ) {
				$response = rest_ensure_response( array( 'html' => '' ) );
			} else {
				OCAD_Tracker::log_impression( $ad->campaign_id, $ad->ad_id, $source_url );

				$fmt       = OCAD_FORMATS[ $format ];
				$track_url = rest_url( 'ocad/v1/track-click?id=' . (int) $ad->ad_id );

				$html = sprintf(
					'<a href="%1$s" data-ocad-track="%6$s" target="_blank" rel="noopener noreferrer nofollow">'
					. '<img src="%2$s" alt="%3$s" width="%4$d" height="%5$d" style="display:block;max-width:100%%;" />'
					. '</a>',
					esc_url( $ad->url ),
					esc_url( $ad->image_url ),
					esc_attr( $ad->alt_text ?: $fmt['label'] . ' advertisement' ),
					(int) $fmt['width'],
					(int) $fmt['height'],
					esc_url( $track_url )
				);

				$response = rest_ensure_response( array( 'html' => $html ) );
			}
		}

		$response->header( 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0' );
		$response->header( 'Pragma', 'no-cache' );
		return $response;
	}

	public function track_click( WP_REST_Request $request ) {
		$ad_id      = $request->get_param( 'id' );
		$source_url = (string) $request->get_param( 'page' );
		$ad         = OCAD_Campaign::get_ad( $ad_id );

		if ( $ad ) {
			OCAD_Tracker::log_click( $ad->campaign_id, $ad_id, $source_url );
		}

		$response = rest_ensure_response( array( 'logged' => (bool) $ad ) );
		$response->header( 'Cache-Control', 'no-store' );
		return $response;
	}

	public function log_impression( WP_REST_Request $request ) {
		$ad_id       = $request->get_param( 'ad_id' );
		$campaign_id = $request->get_param( 'campaign_id' );

		$ad = OCAD_Campaign::get_ad( $ad_id );
		if ( ! $ad || (int) $ad->campaign_id !== $campaign_id ) {
			return new WP_Error( 'ocad_invalid', 'Invalid ad or campaign.', array( 'status' => 400 ) );
		}

		OCAD_Tracker::log_impression( $campaign_id, $ad_id );
		return rest_ensure_response( array( 'logged' => true ) );
	}
}
