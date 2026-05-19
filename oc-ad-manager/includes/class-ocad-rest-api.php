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

		register_rest_route( 'ocad/v1', '/book', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'create_booking' ),
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

	public function create_booking( WP_REST_Request $request ) {
		// Basic nonce check.
		$nonce = $request->get_header( 'X-WP-Nonce' );
		if ( ! wp_verify_nonce( $nonce, 'wp_rest' ) ) {
			return new WP_Error( 'ocad_bad_nonce', 'Security check failed.', array( 'status' => 403 ) );
		}

		$name        = sanitize_text_field( $request->get_param( 'name' ) );
		$email       = sanitize_email( $request->get_param( 'email' ) );
		$company     = sanitize_text_field( $request->get_param( 'company' ) );
		$phone       = sanitize_text_field( $request->get_param( 'phone' ) );
		$format      = sanitize_key( $request->get_param( 'format' ) );
		$dest_url    = esc_url_raw( $request->get_param( 'destination_url' ) );
		$start_date  = sanitize_text_field( $request->get_param( 'start_date' ) );
		$weeks       = max( 1, (int) $request->get_param( 'weeks' ) );
		$promo_code  = strtoupper( sanitize_text_field( $request->get_param( 'promo_code' ) ) );

		// Validate required fields.
		if ( ! $name || ! is_email( $email ) || ! array_key_exists( $format, OCAD_FORMATS ) || ! $dest_url || ! $start_date ) {
			return new WP_Error( 'ocad_invalid', 'Please fill in all required fields.', array( 'status' => 400 ) );
		}

		// Validate date.
		if ( ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $start_date ) || $start_date < date( 'Y-m-d' ) ) {
			return new WP_Error( 'ocad_invalid_date', 'Please select a valid future start date.', array( 'status' => 400 ) );
		}

		// Handle image upload.
		$files = $request->get_file_params();
		$image = isset( $files['image'] ) ? $files['image'] : null;

		if ( ! $image || ! empty( $image['error'] ) || empty( $image['tmp_name'] ) ) {
			return new WP_Error( 'ocad_no_image', 'Please upload an ad image.', array( 'status' => 400 ) );
		}

		// Check MIME type.
		$allowed_types = array( 'image/jpeg', 'image/png', 'image/gif', 'image/webp' );
		$finfo = finfo_open( FILEINFO_MIME_TYPE );
		$mime  = finfo_file( $finfo, $image['tmp_name'] );
		finfo_close( $finfo );

		if ( ! in_array( $mime, $allowed_types, true ) ) {
			return new WP_Error( 'ocad_bad_image', 'Image must be JPG, PNG, GIF or WebP.', array( 'status' => 400 ) );
		}

		// Check size (5 MB).
		if ( $image['size'] > 5 * 1024 * 1024 ) {
			return new WP_Error( 'ocad_image_too_large', 'Image must be under 5 MB.', array( 'status' => 400 ) );
		}

		// Upload to WP media library.
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		$upload = wp_handle_upload( $image, array( 'test_form' => false, 'mimes' => array(
			'jpg|jpeg|jpe' => 'image/jpeg',
			'png'          => 'image/png',
			'gif'          => 'image/gif',
			'webp'         => 'image/webp',
		) ) );

		if ( isset( $upload['error'] ) ) {
			return new WP_Error( 'ocad_upload_failed', $upload['error'], array( 'status' => 500 ) );
		}

		$attachment_id = wp_insert_attachment( array(
			'post_title'     => sanitize_file_name( $image['name'] ),
			'post_content'   => '',
			'post_status'    => 'inherit',
			'post_mime_type' => $upload['type'],
		), $upload['file'] );

		$meta = wp_generate_attachment_metadata( $attachment_id, $upload['file'] );
		wp_update_attachment_metadata( $attachment_id, $meta );

		// Resolve promo code.
		$discount_pct = 0;
		if ( $promo_code ) {
			$promos = get_option( 'ocad_promo_codes', array() );
			if ( isset( $promos[ $promo_code ] ) ) {
				$discount_pct = (int) $promos[ $promo_code ];
			}
		}

		// Calculate price.
		$price_key    = 'ocad_price_' . $format;
		$price_per_wk = (int) get_option( $price_key, 0 );
		$subtotal     = $price_per_wk * $weeks * 100; // in cents
		$discount     = (int) round( $subtotal * $discount_pct / 100 );
		$total_cents  = max( 0, $subtotal - $discount );

		if ( $total_cents < 50 ) {
			return new WP_Error( 'ocad_price_error', 'Pricing not configured. Please contact us.', array( 'status' => 400 ) );
		}

		// Insert booking.
		global $wpdb;
		$wpdb->insert( $wpdb->prefix . 'ocad_bookings', array(
			'name'                => $name,
			'email'               => $email,
			'company'             => $company,
			'phone'               => $phone,
			'format'              => $format,
			'destination_url'     => $dest_url,
			'start_date'          => $start_date,
			'weeks'               => $weeks,
			'image_attachment_id' => $attachment_id,
			'promo_code'          => $discount_pct > 0 ? $promo_code : null,
			'discount_pct'        => $discount_pct,
			'amount_cents'        => $total_cents,
			'status'              => 'pending_payment',
		) );

		$booking_id = $wpdb->insert_id;

		// Create Stripe Checkout Session.
		$current_url  = isset( $_SERVER['HTTP_REFERER'] ) ? esc_url_raw( wp_unslash( $_SERVER['HTTP_REFERER'] ) ) : home_url( '/' );
		$success_url  = add_query_arg( 'ocad_booking', 'success', $current_url );
		$cancel_url   = add_query_arg( 'ocad_booking', 'cancelled', $current_url );

		$fmt_label    = OCAD_FORMATS[ $format ]['label'];
		$line_item    = $fmt_label . ' Ad — ' . $weeks . ( $weeks === 1 ? ' week' : ' weeks' );

		$session = OCAD_Stripe::create_session(
			array( 'id' => $booking_id, 'email' => $email ),
			$total_cents,
			$line_item,
			$success_url,
			$cancel_url
		);

		if ( is_wp_error( $session ) ) {
			// Roll back booking and attachment on Stripe failure.
			$wpdb->delete( $wpdb->prefix . 'ocad_bookings', array( 'id' => $booking_id ) );
			wp_delete_attachment( $attachment_id, true );
			return new WP_Error( 'ocad_stripe_failed', $session->get_error_message(), array( 'status' => 502 ) );
		}

		// Store session ID.
		$wpdb->update( $wpdb->prefix . 'ocad_bookings',
			array( 'stripe_session_id' => sanitize_text_field( $session['id'] ) ),
			array( 'id' => $booking_id )
		);

		return rest_ensure_response( array( 'session_url' => $session['url'] ) );
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

		if ( $event['type'] === 'checkout.session.completed' ) {
			$session    = $event['data']['object'];
			$booking_id = (int) ( $session['metadata']['booking_id'] ?? 0 );

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

					// Notify admin.
					$fmt       = OCAD_FORMATS[ $booking->format ] ?? array( 'label' => $booking->format );
					$admin_url = admin_url( 'admin.php?page=ocad-bookings' );
					wp_mail(
						get_option( 'admin_email' ),
						'New ad booking received — ' . get_bloginfo( 'name' ),
						"A new ad booking has been paid and is ready to review.\n\n"
						. "Advertiser: {$booking->name} ({$booking->email})\n"
						. "Format: {$fmt['label']}\n"
						. "Duration: {$booking->weeks} week(s) from {$booking->start_date}\n\n"
						. "Review it here: {$admin_url}"
					);
				}
			}
		}

		return rest_ensure_response( array( 'ok' => true ) );
	}
}
