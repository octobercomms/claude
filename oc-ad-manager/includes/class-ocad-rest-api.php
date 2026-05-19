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

		register_rest_route( 'ocad/v1', '/book-intent', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'create_booking_intent' ),
			'permission_callback' => '__return_true',
		) );

		register_rest_route( 'ocad/v1', '/promo', array(
			'methods'             => 'GET',
			'callback'            => array( $this, 'check_promo' ),
			'permission_callback' => '__return_true',
			'args'                => array(
				'code' => array(
					'required'          => true,
					'sanitize_callback' => 'sanitize_text_field',
				),
			),
		) );

		register_rest_route( 'ocad/v1', '/stripe-webhook', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'stripe_webhook' ),
			'permission_callback' => '__return_true',
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

	public function create_booking_intent( WP_REST_Request $request ) {
		$nonce = $request->get_header( 'X-WP-Nonce' );
		if ( ! wp_verify_nonce( $nonce, 'wp_rest' ) ) {
			return new WP_Error( 'ocad_bad_nonce', 'Security check failed.', array( 'status' => 403 ) );
		}

		$campaign_name = sanitize_text_field( $request->get_param( 'campaign_name' ) );
		$email         = sanitize_email( $request->get_param( 'email' ) );
		$company       = sanitize_text_field( $request->get_param( 'company' ) );
		$dest_url      = esc_url_raw( $request->get_param( 'destination_url' ) );
		$start_date    = sanitize_text_field( $request->get_param( 'start_date' ) );
		$end_date      = sanitize_text_field( $request->get_param( 'end_date' ) );
		$package_name  = sanitize_text_field( $request->get_param( 'package_name' ) );
		$promo_code    = strtoupper( sanitize_text_field( $request->get_param( 'promo_code' ) ) );

		// Validate required fields.
		if ( ! $campaign_name || ! is_email( $email ) || ! $dest_url || ! $start_date || ! $end_date || ! $package_name ) {
			return new WP_Error( 'ocad_invalid', 'Please fill in all required fields.', array( 'status' => 400 ) );
		}

		// Validate dates.
		if ( $end_date <= $start_date ) {
			return new WP_Error( 'ocad_invalid_date', 'End date must be after start date.', array( 'status' => 400 ) );
		}

		// Resolve package.
		$packages = get_option( 'ocad_booking_packages', array() );
		$package  = null;
		foreach ( $packages as $pkg ) {
			if ( isset( $pkg['name'] ) && $pkg['name'] === $package_name ) {
				$package = $pkg;
				break;
			}
		}
		if ( ! $package ) {
			return new WP_Error( 'ocad_invalid_package', 'Invalid package selected.', array( 'status' => 400 ) );
		}

		$pkg_type     = $package['type'] ?? 'impressions';
		$pkg_quantity = (int) ( $package['quantity'] ?? 0 );
		$pkg_price    = (int) $package['price'];

		// Resolve promo code.
		$discount_pct = 0;
		if ( $promo_code ) {
			$promos = get_option( 'ocad_promo_codes', array() );
			if ( isset( $promos[ $promo_code ] ) ) {
				$discount_pct = (int) $promos[ $promo_code ];
			}
		}

		// Calculate price.
		$subtotal    = $pkg_price * 100;
		$discount    = (int) round( $subtotal * $discount_pct / 100 );
		$total_cents = max( 50, $subtotal - $discount );

		// Handle image uploads (at least one required).
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		$files        = $request->get_file_params();
		$allowed_mime = array(
			'jpg|jpeg|jpe' => 'image/jpeg',
			'png'          => 'image/png',
			'gif'          => 'image/gif',
			'webp'         => 'image/webp',
		);
		$format_keys  = array( 'mpu', 'leaderboard', 'skyscraper' );
		$attach_ids   = array();
		$has_image    = false;

		foreach ( $format_keys as $fk ) {
			$file = isset( $files[ 'image_' . $fk ] ) ? $files[ 'image_' . $fk ] : null;
			if ( ! $file || ! empty( $file['error'] ) || empty( $file['tmp_name'] ) ) {
				$attach_ids[ $fk ] = null;
				continue;
			}
			if ( $file['size'] > 5 * 1024 * 1024 ) {
				return new WP_Error( 'ocad_image_too_large', $fk . ' image must be under 5 MB.', array( 'status' => 400 ) );
			}
			$upload = wp_handle_upload( $file, array( 'test_form' => false, 'mimes' => $allowed_mime ) );
			if ( isset( $upload['error'] ) ) {
				return new WP_Error( 'ocad_upload_failed', $upload['error'], array( 'status' => 500 ) );
			}
			$att_id = wp_insert_attachment( array(
				'post_title'     => sanitize_file_name( $file['name'] ),
				'post_content'   => '',
				'post_status'    => 'inherit',
				'post_mime_type' => $upload['type'],
			), $upload['file'] );
			wp_update_attachment_metadata( $att_id, wp_generate_attachment_metadata( $att_id, $upload['file'] ) );
			$attach_ids[ $fk ] = $att_id;
			$has_image          = true;
		}

		if ( ! $has_image ) {
			return new WP_Error( 'ocad_no_image', 'Please upload at least one ad image.', array( 'status' => 400 ) );
		}

		// Insert booking.
		global $wpdb;
		$wpdb->insert( $wpdb->prefix . 'ocad_bookings', array(
			'campaign_name'           => $campaign_name,
			'name'                    => $company ?: $campaign_name,
			'email'                   => $email,
			'company'                 => $company,
			'format'                  => 'multi',
			'destination_url'         => $dest_url,
			'start_date'              => $start_date,
			'end_date'                => $end_date,
			'image_attachment_id'     => $attach_ids['mpu'],
			'image_attachment_id_lb'  => $attach_ids['leaderboard'],
			'image_attachment_id_sky' => $attach_ids['skyscraper'],
			'package_name'            => $package_name,
			'package_type'            => $pkg_type,
			'package_quantity'        => $pkg_quantity,
			'promo_code'              => $discount_pct > 0 ? $promo_code : null,
			'discount_pct'            => $discount_pct,
			'amount_cents'            => $total_cents,
			'status'                  => 'pending_payment',
		) );

		$booking_id = $wpdb->insert_id;

		// Create Stripe PaymentIntent.
		$currency = get_option( 'ocad_stripe_currency', 'usd' );
		$intent   = OCAD_Stripe::create_payment_intent( $total_cents, $currency, array(
			'booking_id' => $booking_id,
		) );

		if ( is_wp_error( $intent ) ) {
			// Roll back.
			$wpdb->delete( $wpdb->prefix . 'ocad_bookings', array( 'id' => $booking_id ) );
			foreach ( $attach_ids as $att_id ) {
				if ( $att_id ) wp_delete_attachment( $att_id, true );
			}
			return new WP_Error( 'ocad_stripe_failed', $intent->get_error_message(), array( 'status' => 502 ) );
		}

		$wpdb->update(
			$wpdb->prefix . 'ocad_bookings',
			array( 'stripe_payment_intent_id' => sanitize_text_field( $intent['id'] ) ),
			array( 'id' => $booking_id )
		);

		return rest_ensure_response( array( 'client_secret' => $intent['client_secret'] ) );
	}

	public function check_promo( WP_REST_Request $request ) {
		$code   = strtoupper( $request->get_param( 'code' ) );
		$promos = get_option( 'ocad_promo_codes', array() );

		if ( $code && isset( $promos[ $code ] ) ) {
			return rest_ensure_response( array( 'valid' => true, 'discount' => (int) $promos[ $code ] ) );
		}

		return rest_ensure_response( array( 'valid' => false, 'discount' => 0 ) );
	}

	public function stripe_webhook( WP_REST_Request $request ) {
		$payload    = $request->get_body();
		$sig_header = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';

		if ( ! OCAD_Stripe::verify_webhook( $payload, $sig_header ) ) {
			return new WP_Error( 'ocad_invalid_sig', 'Invalid signature.', array( 'status' => 400 ) );
		}

		$event = json_decode( $payload, true );
		if ( empty( $event['type'] ) ) {
			return rest_ensure_response( array( 'ok' => false ) );
		}

		if ( $event['type'] === 'payment_intent.succeeded' ) {
			$intent     = $event['data']['object'];
			$booking_id = (int) ( $intent['metadata']['booking_id'] ?? 0 );

			if ( $booking_id ) {
				global $wpdb;
				$booking = $wpdb->get_row( $wpdb->prepare(
					"SELECT * FROM {$wpdb->prefix}ocad_bookings WHERE id = %d AND status = 'pending_payment'",
					$booking_id
				) );

				if ( $booking ) {
					$wpdb->update(
						$wpdb->prefix . 'ocad_bookings',
						array( 'status' => 'paid' ),
						array( 'id' => $booking_id )
					);

					$fmt_label = 'Multi-format';
					$admin_url = admin_url( 'admin.php?page=ocad-bookings' );
					wp_mail(
						get_option( 'admin_email' ),
						'New ad booking received — ' . get_bloginfo( 'name' ),
						"A new ad booking has been paid and is ready to review.\n\n"
						. "Campaign: {$booking->campaign_name}\n"
						. "Advertiser: {$booking->email}\n"
						. "Package: {$booking->package_name}\n"
						. "Dates: {$booking->start_date} to {$booking->end_date}\n\n"
						. "Review it here: {$admin_url}"
					);
				}
			}
		}

		return rest_ensure_response( array( 'ok' => true ) );
	}
}
