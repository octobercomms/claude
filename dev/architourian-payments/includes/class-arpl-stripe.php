<?php
/**
 * Thin Stripe REST client built on wp_remote_* — no SDK / Composer dependency.
 *
 * Only the few endpoints we need:
 *   - create a one-off Price (with an inline Product) for an arbitrary amount,
 *   - create a Payment Link pointing at that Price,
 *   - list Checkout Sessions for a Payment Link to learn whether it was paid,
 *   - deactivate a Payment Link once it's been paid.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ARPL_Stripe {

	const API_BASE = 'https://api.stripe.com/v1/';

	/** @var string Secret key (sk_test_… or sk_live_…). */
	private $secret;

	public function __construct( $secret_key ) {
		$this->secret = trim( (string) $secret_key );
	}

	public function has_key() {
		return '' !== $this->secret;
	}

	/**
	 * Create a one-time price with an inline product, then a payment link for it.
	 *
	 * @param int    $amount   Amount in the currency's minor unit (e.g. pence).
	 * @param string $currency 3-letter ISO code, lowercase.
	 * @param string $customer Customer name (shown in the product name & metadata).
	 * @param string $note     Free-text note (product description & metadata).
	 * @return array|WP_Error  [ 'link_id' => …, 'price_id' => …, 'url' => … ]
	 */
	public function create_payment_link( $amount, $currency, $customer, $note ) {
		$product_name = $customer ? sprintf( 'Tour balance — %s', $customer ) : 'Tour balance';

		$price = $this->post( 'prices', [
			'unit_amount'        => $amount,
			'currency'           => $currency,
			'product_data[name]' => $this->clip( $product_name, 250 ),
		] );
		if ( is_wp_error( $price ) ) {
			return $price;
		}

		$params = [
			'line_items[0][price]'                            => $price['id'],
			'line_items[0][quantity]'                         => 1,
			'metadata[customer]'                              => $this->clip( $customer, 450 ),
			'metadata[note]'                                  => $this->clip( $note, 450 ),
			'after_completion[type]'                          => 'hosted_confirmation',
			'after_completion[hosted_confirmation][custom_message]' =>
				'Thank you — your payment has been received. Architourian will be in touch.',
		];

		$link = $this->post( 'payment_links', $params );
		if ( is_wp_error( $link ) ) {
			return $link;
		}

		return [
			'link_id'  => $link['id'],
			'price_id' => $price['id'],
			'url'      => isset( $link['url'] ) ? $link['url'] : '',
		];
	}

	/**
	 * Look up payment status for a payment link by inspecting its checkout sessions.
	 *
	 * @return array|WP_Error [ 'paid' => bool, 'amount_paid' => int|null, 'paid_at' => int|null ]
	 */
	public function get_link_status( $link_id ) {
		$sessions = $this->get( 'checkout/sessions', [
			'payment_link' => $link_id,
			'limit'        => 25,
		] );
		if ( is_wp_error( $sessions ) ) {
			return $sessions;
		}

		$result = [ 'paid' => false, 'amount_paid' => null, 'paid_at' => null ];
		if ( empty( $sessions['data'] ) || ! is_array( $sessions['data'] ) ) {
			return $result;
		}

		foreach ( $sessions['data'] as $session ) {
			$paid = isset( $session['payment_status'] ) && 'paid' === $session['payment_status'];
			// Treat fully-discounted / zero "no_payment_required" completes as paid too.
			$complete = isset( $session['status'] ) && 'complete' === $session['status'];
			if ( $paid || ( $complete && isset( $session['payment_status'] ) && 'no_payment_required' === $session['payment_status'] ) ) {
				$result['paid']        = true;
				$result['amount_paid'] = isset( $session['amount_total'] ) ? (int) $session['amount_total'] : null;
				$result['paid_at']     = isset( $session['created'] ) ? (int) $session['created'] : null;
				break;
			}
		}
		return $result;
	}

	/**
	 * Activate / deactivate a payment link.
	 */
	public function set_link_active( $link_id, $active ) {
		return $this->post( 'payment_links/' . rawurlencode( $link_id ), [
			'active' => $active ? 'true' : 'false',
		] );
	}

	// ---- low-level helpers -------------------------------------------------

	private function post( $endpoint, array $params ) {
		return $this->request( 'POST', $endpoint, $params );
	}

	private function get( $endpoint, array $params = [] ) {
		$url = $endpoint;
		if ( $params ) {
			$url .= '?' . http_build_query( $params );
		}
		return $this->request( 'GET', $url );
	}

	private function request( $method, $endpoint, array $body = [] ) {
		if ( ! $this->has_key() ) {
			return new WP_Error( 'arpl_no_key', 'No Stripe secret key configured. Add it under Payment Links → Settings.' );
		}

		$args = [
			'method'  => $method,
			'timeout' => 30,
			'headers' => [
				'Authorization' => 'Bearer ' . $this->secret,
				'Content-Type'  => 'application/x-www-form-urlencoded',
			],
		];
		if ( 'POST' === $method && $body ) {
			// http_build_query keeps Stripe's bracketed-array syntax intact.
			$args['body'] = http_build_query( $body );
		}

		$response = wp_remote_request( self::API_BASE . $endpoint, $args );

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$data = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( $code < 200 || $code >= 300 ) {
			$message = isset( $data['error']['message'] )
				? $data['error']['message']
				: sprintf( 'Stripe returned HTTP %d.', $code );
			return new WP_Error( 'arpl_stripe_error', $message, [ 'status' => $code ] );
		}

		return is_array( $data ) ? $data : [];
	}

	private function clip( $str, $len ) {
		$str = (string) $str;
		return strlen( $str ) > $len ? substr( $str, 0, $len ) : $str;
	}
}
