<?php
/**
 * Payments abstraction — Stripe for one-off / project / deposit (card), and
 * GoCardless for monthly retainers (Direct Debit). Each provider is reached over
 * its REST API with the stored key; both confirm via webhook. Invoice-on-request
 * is a manual record with no auto-collection.
 *
 * The plugin never stores card/bank details — only provider references.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCP_Payments {

	const NS = 'ocp/v1';

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
		add_action( 'admin_post_nopriv_ocp_pay', array( __CLASS__, 'handle_pay' ) );
		add_action( 'admin_post_ocp_pay', array( __CLASS__, 'handle_pay' ) );
	}

	public static function routes() {
		register_rest_route( self::NS, '/webhook/stripe', array(
			'methods'             => 'POST',
			'callback'            => array( __CLASS__, 'webhook_stripe' ),
			'permission_callback' => '__return_true',
		) );
		register_rest_route( self::NS, '/webhook/gocardless', array(
			'methods'             => 'POST',
			'callback'            => array( __CLASS__, 'webhook_gocardless' ),
			'permission_callback' => '__return_true',
		) );
	}

	public static function stripe_enabled() {
		return '' !== trim( (string) OCP_Settings::get( 'stripe_secret' ) );
	}

	public static function gocardless_enabled() {
		return '' !== trim( (string) OCP_Settings::get( 'gocardless_token' ) );
	}

	/** Record a payment row and return its id. */
	public static function record( $proposal_id, $provider, $kind, $amount, $currency, $status = 'pending', $external_id = '', $meta = array() ) {
		return OCP_Repo::insert( OCP_DB::payments_table(), array(
			'proposal_id' => (int) $proposal_id,
			'provider'    => $provider,
			'kind'        => $kind,
			'external_id' => (string) $external_id,
			'amount'      => (float) $amount,
			'currency'    => (string) $currency,
			'status'      => $status,
			'meta'        => $meta ? wp_json_encode( $meta ) : null,
		) );
	}

	public static function for_proposal( $proposal_id ) {
		global $wpdb;
		return OCP_Repo::all( OCP_DB::payments_table(), 'created_at DESC', $wpdb->prepare( 'proposal_id = %d', $proposal_id ) );
	}

	// --- Stripe one-off (Checkout Session) -----------------------------------

	/**
	 * Create a Stripe Checkout Session for a one-off amount and return its URL.
	 *
	 * @return string|WP_Error
	 */
	public static function stripe_checkout( array $p, $amount, $kind = 'oneoff' ) {
		$secret = OCP_Settings::get( 'stripe_secret' );
		if ( ! $secret ) {
			return new WP_Error( 'ocp_no_stripe', __( 'Stripe is not configured.', 'oc-proposals' ) );
		}
		$pay_id = self::record( $p['id'], 'stripe', $kind, $amount, $p['currency'], 'pending' );
		$body = array(
			'mode'                                 => 'payment',
			'success_url'                          => OCP_Proposal::url( $p['token'] ) . '&paid=1',
			'cancel_url'                           => OCP_Proposal::url( $p['token'] ),
			'client_reference_id'                  => (string) $pay_id,
			'line_items[0][quantity]'              => 1,
			'line_items[0][price_data][currency]'  => strtolower( $p['currency'] ),
			'line_items[0][price_data][unit_amount]' => (int) round( $amount * 100 ),
			'line_items[0][price_data][product_data][name]' => $p['client_name'] . ' — ' . OCP_Types::label( $p['type'] ),
			'metadata[proposal_id]'                => (string) $p['id'],
			'metadata[payment_id]'                 => (string) $pay_id,
		);
		$res = wp_remote_post( 'https://api.stripe.com/v1/checkout/sessions', array(
			'headers' => array( 'Authorization' => 'Bearer ' . $secret ),
			'body'    => $body,
			'timeout' => 25,
		) );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		$json = json_decode( wp_remote_retrieve_body( $res ), true );
		if ( empty( $json['url'] ) ) {
			return new WP_Error( 'ocp_stripe_failed', __( 'Could not start checkout.', 'oc-proposals' ) );
		}
		OCP_Repo::update( OCP_DB::payments_table(), $pay_id, array( 'external_id' => $json['id'] ?? '' ) );
		return $json['url'];
	}

	// --- GoCardless recurring (Billing Request Flow) -------------------------

	/**
	 * Start a GoCardless redirect flow to set up a Direct Debit mandate for the
	 * monthly retainer. Returns the authorisation URL.
	 *
	 * @return string|WP_Error
	 */
	public static function gocardless_flow( array $p ) {
		$token = OCP_Settings::get( 'gocardless_token' );
		if ( ! $token ) {
			return new WP_Error( 'ocp_no_gc', __( 'GoCardless is not configured.', 'oc-proposals' ) );
		}
		$pay_id = self::record( $p['id'], 'gocardless', 'subscription', 0, $p['currency'], 'pending' );
		$payload = array(
			'redirect_flows' => array(
				'description'           => $p['client_name'] . ' — monthly programme',
				'session_token'         => 'ocp_' . $p['token'],
				'success_redirect_url'  => OCP_Proposal::url( $p['token'] ) . '&mandate=1',
				'metadata'              => array( 'proposal_id' => (string) $p['id'], 'payment_id' => (string) $pay_id ),
			),
		);
		$res = wp_remote_post( 'https://api.gocardless.com/redirect_flows', array(
			'headers' => array(
				'Authorization'      => 'Bearer ' . $token,
				'GoCardless-Version' => '2015-07-06',
				'Content-Type'       => 'application/json',
			),
			'body'    => wp_json_encode( $payload ),
			'timeout' => 25,
		) );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		$json = json_decode( wp_remote_retrieve_body( $res ), true );
		$url  = $json['redirect_flows']['redirect_url'] ?? '';
		if ( ! $url ) {
			return new WP_Error( 'ocp_gc_failed', __( 'Could not start the Direct Debit setup.', 'oc-proposals' ) );
		}
		OCP_Repo::update( OCP_DB::payments_table(), $pay_id, array( 'external_id' => $json['redirect_flows']['id'] ?? '' ) );
		return $url;
	}

	// --- Client payment entrypoint (from the portal) -------------------------

	public static function handle_pay() {
		$token = preg_replace( '/[^A-Za-z0-9]/', '', (string) ( $_POST['token'] ?? '' ) );
		$p     = OCP_Proposal::get_by_token( $token );
		if ( ! $p || ! wp_verify_nonce( $_POST['_ocp_nonce'] ?? '', 'ocp_pay_' . $token ) ) {
			wp_die( esc_html__( 'Security check failed.', 'oc-proposals' ) );
		}
		$method = sanitize_key( wp_unslash( $_POST['method'] ?? '' ) );
		$t      = OCP_Proposal::totals( $p['id'] );

		if ( 'stripe' === $method ) {
			$amount = ( $t['by_cadence']['oneoff'] ?? 0 ) + ( $t['by_cadence']['project'] ?? 0 );
			$url    = self::stripe_checkout( $p, $amount, 'oneoff' );
		} elseif ( 'gocardless' === $method ) {
			$url = self::gocardless_flow( $p );
		} else {
			$url = new WP_Error( 'ocp_bad_method', __( 'Unknown payment method.', 'oc-proposals' ) );
		}

		if ( is_wp_error( $url ) ) {
			wp_die( esc_html( $url->get_error_message() ) );
		}
		wp_redirect( $url ); // External provider URL.
		exit;
	}

	// --- Webhooks ------------------------------------------------------------

	public static function webhook_stripe( $request ) {
		$data    = json_decode( $request->get_body(), true );
		$type    = $data['type'] ?? '';
		$object  = $data['data']['object'] ?? array();
		if ( 'checkout.session.completed' === $type ) {
			$pay_id = (int) ( $object['metadata']['payment_id'] ?? $object['client_reference_id'] ?? 0 );
			if ( $pay_id ) {
				OCP_Repo::update( OCP_DB::payments_table(), $pay_id, array( 'status' => 'paid' ) );
			}
		}
		return rest_ensure_response( array( 'received' => true ) );
	}

	public static function webhook_gocardless( $request ) {
		$data = json_decode( $request->get_body(), true );
		foreach ( (array) ( $data['events'] ?? array() ) as $event ) {
			$action = $event['action'] ?? '';
			$links  = $event['links'] ?? array();
			if ( in_array( $action, array( 'confirmed', 'active', 'created' ), true ) && ! empty( $links['mandate'] ) ) {
				// A mandate is live — mark the subscription record active.
				self::activate_mandate_by_flow( $links );
			}
			if ( 'paid' === $action && ! empty( $links['payment'] ) ) {
				// A collection succeeded.
				OCP_Subscription::record_collection( $links );
			}
		}
		return rest_ensure_response( array( 'received' => true ) );
	}

	private static function activate_mandate_by_flow( $links ) {
		// Best-effort: mark the most recent pending GoCardless subscription active.
		global $wpdb;
		$table = OCP_DB::payments_table();
		$row   = $wpdb->get_row( "SELECT * FROM {$table} WHERE provider='gocardless' AND kind='subscription' AND status='pending' ORDER BY id DESC LIMIT 1", ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL
		if ( $row ) {
			OCP_Repo::update( $table, $row['id'], array( 'status' => 'active', 'external_id' => $links['mandate'] ?? $row['external_id'] ) );
			OCP_Subscription::start( (int) $row['proposal_id'], $links['mandate'] ?? '' );
		}
	}
}
