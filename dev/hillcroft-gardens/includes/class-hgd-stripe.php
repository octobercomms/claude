<?php
/**
 * Thin Stripe REST client.
 *
 * Talks to https://api.stripe.com/v1 with the secret key as Bearer auth. Used to
 * collect the £200 consultation fee via a PaymentIntent + embedded Payment Element.
 * Mirrors the pattern in oc-ad-manager's OCAD_Stripe.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Stripe {

	const API_BASE = 'https://api.stripe.com/v1';

	private static function secret_key() {
		return (string) HGD_Settings::get( 'stripe_secret_key', '' );
	}

	public static function is_configured() {
		return '' !== self::secret_key();
	}

	/**
	 * Create a PaymentIntent.
	 *
	 * @param int    $amount_pence Amount in the currency's minor unit (pence).
	 * @param string $currency     ISO currency code.
	 * @param array  $metadata     Key/value metadata (strings).
	 * @return array|WP_Error Decoded PaymentIntent (incl. id + client_secret) or error.
	 */
	public static function create_payment_intent( $amount_pence, $currency = 'gbp', $metadata = array() ) {
		$secret = self::secret_key();
		if ( ! $secret ) {
			return new WP_Error( 'hgd_no_stripe', __( 'Stripe is not configured.', 'hillcroft-garden-designer' ) );
		}

		$body = array(
			'amount'                              => (int) $amount_pence,
			'currency'                            => strtolower( $currency ),
			'automatic_payment_methods[enabled]'  => 'true',
		);
		foreach ( $metadata as $k => $v ) {
			$body[ 'metadata[' . $k . ']' ] = (string) $v;
		}

		$response = wp_remote_post( self::API_BASE . '/payment_intents', array(
			'headers' => array(
				'Authorization' => 'Bearer ' . $secret,
				'Content-Type'  => 'application/x-www-form-urlencoded',
			),
			'body'    => $body,
			'timeout' => 20,
		) );

		return self::handle_response( $response );
	}

	/**
	 * Retrieve a PaymentIntent by id.
	 *
	 * @param string $id PaymentIntent id (pi_...).
	 * @return array|WP_Error
	 */
	public static function retrieve_payment_intent( $id ) {
		$secret = self::secret_key();
		if ( ! $secret ) {
			return new WP_Error( 'hgd_no_stripe', __( 'Stripe is not configured.', 'hillcroft-garden-designer' ) );
		}
		$id = sanitize_text_field( $id );
		if ( '' === $id ) {
			return new WP_Error( 'hgd_stripe_bad_id', __( 'Missing PaymentIntent id.', 'hillcroft-garden-designer' ) );
		}

		$response = wp_remote_get( self::API_BASE . '/payment_intents/' . rawurlencode( $id ), array(
			'headers' => array(
				'Authorization' => 'Bearer ' . $secret,
			),
			'timeout' => 20,
		) );

		return self::handle_response( $response );
	}

	// -------------------------------------------------------------------------
	// Billing (subscriptions) — Stripe handles recurring charges, SCA, retries
	// and dunning; we mirror successful invoices into WooCommerce for receipts.
	// -------------------------------------------------------------------------

	/**
	 * Low-level form-encoded request to the Stripe API.
	 *
	 * @param string $method GET|POST.
	 * @param string $path   Path under /v1 (e.g. "/customers").
	 * @param array  $body   Flat, already-bracket-encoded form fields.
	 * @return array|WP_Error Decoded JSON or error.
	 */
	private static function request( $method, $path, $body = array() ) {
		$secret = self::secret_key();
		if ( ! $secret ) {
			return new WP_Error( 'hgd_no_stripe', __( 'Stripe is not configured.', 'hillcroft-garden-designer' ) );
		}

		$args = array(
			'method'  => $method,
			'headers' => array(
				'Authorization' => 'Bearer ' . $secret,
				'Content-Type'  => 'application/x-www-form-urlencoded',
			),
			'timeout' => 25,
		);
		if ( 'GET' === $method ) {
			$url = self::API_BASE . $path . ( $body ? '?' . http_build_query( $body ) : '' );
		} else {
			$url          = self::API_BASE . $path;
			$args['body'] = $body;
		}

		return self::handle_response( wp_remote_request( $url, $args ) );
	}

	/**
	 * Create (or reuse) a Stripe Customer for a subscriber.
	 *
	 * @param string $email Customer email.
	 * @param string $name  Customer name.
	 * @param array  $meta  Metadata (strings).
	 * @return array|WP_Error Decoded Customer (incl. id) or error.
	 */
	public static function create_customer( $email, $name = '', $meta = array() ) {
		$body = array( 'email' => (string) $email );
		if ( '' !== (string) $name ) {
			$body['name'] = (string) $name;
		}
		foreach ( $meta as $k => $v ) {
			$body[ 'metadata[' . $k . ']' ] = (string) $v;
		}
		return self::request( 'POST', '/customers', $body );
	}

	/**
	 * Find or create a recurring Price for a plan and cache its id.
	 *
	 * Stripe Prices are immutable, so we key the cache on plan + amount +
	 * interval; changing a plan's price simply mints a new Price next time.
	 *
	 * @param string $plan_key Plan slug.
	 * @param string $label    Human label (used as the Product name).
	 * @param int    $pence    Monthly amount in pence.
	 * @param string $interval Billing interval (month|year).
	 * @param string $currency ISO currency.
	 * @return string|WP_Error Price id (price_…) or error.
	 */
	public static function ensure_price( $plan_key, $label, $pence, $interval = 'month', $currency = 'gbp' ) {
		$cache_key = $plan_key . ':' . (int) $pence . ':' . $interval . ':' . strtolower( $currency );
		$cache     = get_option( 'hgd_sub_price_ids', array() );
		if ( is_array( $cache ) && ! empty( $cache[ $cache_key ] ) ) {
			return (string) $cache[ $cache_key ];
		}

		$price = self::request( 'POST', '/prices', array(
			'unit_amount'         => (int) $pence,
			'currency'            => strtolower( $currency ),
			'recurring[interval]' => $interval,
			'product_data[name]'  => (string) $label,
			'metadata[plan_key]'  => (string) $plan_key,
		) );
		if ( is_wp_error( $price ) ) {
			return $price;
		}

		$id = isset( $price['id'] ) ? (string) $price['id'] : '';
		if ( '' === $id ) {
			return new WP_Error( 'hgd_stripe_no_price', __( 'Stripe did not return a price id.', 'hillcroft-garden-designer' ) );
		}
		if ( ! is_array( $cache ) ) {
			$cache = array();
		}
		$cache[ $cache_key ] = $id;
		update_option( 'hgd_sub_price_ids', $cache, false );
		return $id;
	}

	/**
	 * Create a hosted Checkout Session in subscription mode. Stripe collects the
	 * card, handles SCA, creates the subscription and charges the first invoice.
	 *
	 * @param array $args customer_id, price_id, success_url, cancel_url, metadata, email.
	 * @return array|WP_Error Decoded Session (incl. id + url) or error.
	 */
	public static function create_subscription_checkout( array $args ) {
		$body = array(
			'mode'                 => 'subscription',
			'line_items[0][price]' => (string) $args['price_id'],
			'line_items[0][quantity]' => 1,
			'success_url'          => (string) $args['success_url'],
			'cancel_url'           => (string) $args['cancel_url'],
		);
		if ( ! empty( $args['customer_id'] ) ) {
			$body['customer'] = (string) $args['customer_id'];
		} elseif ( ! empty( $args['email'] ) ) {
			$body['customer_email'] = (string) $args['email'];
		}
		foreach ( (array) ( isset( $args['metadata'] ) ? $args['metadata'] : array() ) as $k => $v ) {
			$body[ 'metadata[' . $k . ']' ]                        = (string) $v;
			$body[ 'subscription_data[metadata][' . $k . ']' ]     = (string) $v;
		}
		return self::request( 'POST', '/checkout/sessions', $body );
	}

	/**
	 * Create a Billing (Customer) Portal session, so the customer can manage
	 * their own subscription — update card, view invoices, cancel — on Stripe's
	 * hosted, self-service pages.
	 *
	 * Requires the Customer Portal to be activated once in the Stripe dashboard
	 * (Settings → Billing → Customer portal), in both test and live mode.
	 *
	 * @param string $customer_id Stripe Customer id (cus_…).
	 * @param string $return_url  Where Stripe returns the customer afterwards.
	 * @return array|WP_Error Decoded session (incl. url) or error.
	 */
	public static function create_billing_portal_session( $customer_id, $return_url ) {
		$customer_id = sanitize_text_field( (string) $customer_id );
		if ( '' === $customer_id ) {
			return new WP_Error( 'hgd_stripe_bad_id', __( 'Missing customer id.', 'hillcroft-garden-designer' ) );
		}
		return self::request( 'POST', '/billing_portal/sessions', array(
			'customer'   => $customer_id,
			'return_url' => (string) $return_url,
		) );
	}

	/** Retrieve a Subscription by id (sub_…). */
	public static function retrieve_subscription( $id ) {
		$id = sanitize_text_field( (string) $id );
		if ( '' === $id ) {
			return new WP_Error( 'hgd_stripe_bad_id', __( 'Missing subscription id.', 'hillcroft-garden-designer' ) );
		}
		return self::request( 'GET', '/subscriptions/' . rawurlencode( $id ) );
	}

	/**
	 * Cancel a Subscription.
	 *
	 * @param string $id          Subscription id.
	 * @param bool   $at_period_end Cancel at period end (true) or immediately (false).
	 * @return array|WP_Error
	 */
	public static function cancel_subscription( $id, $at_period_end = true ) {
		$id = sanitize_text_field( (string) $id );
		if ( '' === $id ) {
			return new WP_Error( 'hgd_stripe_bad_id', __( 'Missing subscription id.', 'hillcroft-garden-designer' ) );
		}
		if ( $at_period_end ) {
			return self::request( 'POST', '/subscriptions/' . rawurlencode( $id ), array( 'cancel_at_period_end' => 'true' ) );
		}
		return self::request( 'DELETE', '/subscriptions/' . rawurlencode( $id ) );
	}

	private static function handle_response( $response ) {
		if ( is_wp_error( $response ) ) {
			return $response;
		}
		$code = wp_remote_retrieve_response_code( $response );
		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( $code < 200 || $code >= 300 ) {
			$msg = isset( $data['error']['message'] ) ? $data['error']['message'] : sprintf( 'Stripe error (%d).', $code );
			return new WP_Error( 'hgd_stripe_error', $msg );
		}
		return is_array( $data ) ? $data : array();
	}

	/**
	 * Verify a Stripe webhook signature.
	 *
	 * Parses the Stripe-Signature header (t= timestamp, v1= signatures), recomputes
	 * the HMAC-SHA256 of "{t}.{payload}" with the webhook signing secret, and
	 * compares with hash_equals.
	 *
	 * @param string $payload    Raw request body.
	 * @param string $sig_header The Stripe-Signature header value.
	 * @param string $secret     The webhook signing secret (whsec_...).
	 * @return bool
	 */
	public static function verify_webhook( $payload, $sig_header, $secret ) {
		if ( ! $secret || ! $sig_header ) {
			return false;
		}

		$timestamp  = '';
		$signatures = array();
		foreach ( explode( ',', $sig_header ) as $part ) {
			$kv = explode( '=', $part, 2 );
			if ( count( $kv ) !== 2 ) {
				continue;
			}
			$key = trim( $kv[0] );
			$val = trim( $kv[1] );
			if ( 't' === $key ) {
				$timestamp = $val;
			} elseif ( 'v1' === $key ) {
				$signatures[] = $val;
			}
		}

		if ( '' === $timestamp || empty( $signatures ) ) {
			return false;
		}

		$expected = hash_hmac( 'sha256', $timestamp . '.' . $payload, $secret );
		foreach ( $signatures as $sig ) {
			if ( hash_equals( $expected, $sig ) ) {
				return true;
			}
		}
		return false;
	}
}
