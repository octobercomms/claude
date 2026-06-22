<?php
/**
 * Public tracking endpoints for emailed payment links.
 *
 * Two unauthenticated routes, keyed by each link's unguessable token:
 *   - ?arpl_open=<token>  → logs an "opened" event, returns a 1×1 pixel.
 *   - ?arpl_go=<token>    → logs a "clicked" event, redirects to the Stripe link.
 *
 * Recipients aren't logged in, so these must be public; the random token is the
 * only thing that identifies a link, and nothing sensitive is exposed (the pixel
 * is blank and the redirect lands on Stripe's own hosted page).
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ARPL_Track {

	public static function init() {
		add_action( 'init', [ __CLASS__, 'maybe_handle' ] );
	}

	/** Tracking-pixel URL for a token. */
	public static function open_url( $token ) {
		return add_query_arg( 'arpl_open', rawurlencode( $token ), home_url( '/' ) );
	}

	/** Tracked redirect URL (used as the email's Pay button) for a token. */
	public static function go_url( $token ) {
		return add_query_arg( 'arpl_go', rawurlencode( $token ), home_url( '/' ) );
	}

	public static function maybe_handle() {
		if ( isset( $_GET['arpl_open'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			self::handle_open( sanitize_text_field( wp_unslash( $_GET['arpl_open'] ) ) );
		}
		if ( isset( $_GET['arpl_go'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			self::handle_go( sanitize_text_field( wp_unslash( $_GET['arpl_go'] ) ) );
		}
	}

	private static function handle_open( $token ) {
		$row = ARPL_Store::get_by_token( $token );
		if ( $row ) {
			// Dedupe rapid re-loads / image proxies within a short window.
			$guard = 'arpl_open_' . md5( $token );
			if ( false === get_transient( $guard ) ) {
				set_transient( $guard, 1, 2 * MINUTE_IN_SECONDS );
				ARPL_Store::log_event( $row->id, 'opened', self::client_meta() );
			}
		}
		self::output_pixel();
	}

	private static function handle_go( $token ) {
		$row = ARPL_Store::get_by_token( $token );
		if ( ! $row ) {
			wp_safe_redirect( home_url( '/' ) );
			exit;
		}
		ARPL_Store::log_event( $row->id, 'clicked', self::client_meta() );

		$dest = $row->url ? $row->url : home_url( '/' );
		// Stripe's buy.stripe.com host isn't on WP's safe-redirect allowlist.
		add_filter( 'allowed_redirect_hosts', [ __CLASS__, 'allow_stripe_host' ] );
		wp_safe_redirect( $dest, 302 );
		exit;
	}

	public static function allow_stripe_host( $hosts ) {
		$hosts[] = 'buy.stripe.com';
		$hosts[] = 'checkout.stripe.com';
		return $hosts;
	}

	private static function output_pixel() {
		nocache_headers();
		header( 'Content-Type: image/gif' );
		// 1×1 transparent GIF.
		echo base64_decode( 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' ); // phpcs:ignore
		exit;
	}

	private static function client_meta() {
		$ua = isset( $_SERVER['HTTP_USER_AGENT'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ) : '';
		return substr( $ua, 0, 200 );
	}
}
