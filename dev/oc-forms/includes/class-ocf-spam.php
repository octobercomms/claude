<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCF_Spam {

	public static function init() {}

	public static function turnstile_site_key() {
		return trim( (string) get_option( 'ocf_turnstile_site_key', '' ) );
	}

	public static function turnstile_secret_key() {
		return trim( (string) get_option( 'ocf_turnstile_secret_key', '' ) );
	}

	public static function turnstile_enabled() {
		return self::turnstile_site_key() !== '' && self::turnstile_secret_key() !== '';
	}

	/**
	 * @return array{ok:bool, error:string}
	 */
	public static function verify_turnstile( $token ) {
		if ( ! self::turnstile_enabled() ) {
			return array( 'ok' => true, 'error' => '' );
		}
		if ( empty( $token ) ) {
			return array( 'ok' => false, 'error' => 'Missing Turnstile token' );
		}
		$res = wp_remote_post( 'https://challenges.cloudflare.com/turnstile/v0/siteverify', array(
			'timeout' => 10,
			'body'    => array(
				'secret'   => self::turnstile_secret_key(),
				'response' => $token,
				'remoteip' => OCF_Submission::client_ip(),
			),
		) );
		if ( is_wp_error( $res ) ) {
			return array( 'ok' => false, 'error' => $res->get_error_message() );
		}
		$data = json_decode( wp_remote_retrieve_body( $res ), true );
		if ( ! empty( $data['success'] ) ) {
			return array( 'ok' => true, 'error' => '' );
		}
		return array( 'ok' => false, 'error' => 'Turnstile rejected' );
	}

	/**
	 * Lightweight IP rate limiter using a transient bucket per minute.
	 * Allows N submissions per 10 minutes per IP.
	 */
	public static function rate_limit_ok( $form_id, $max_per_window = 5, $window_seconds = 600 ) {
		$ip = OCF_Submission::client_ip();
		if ( ! $ip ) {
			return true;
		}
		$key = 'ocf_rl_' . md5( $form_id . '|' . $ip );
		$current = (int) get_transient( $key );
		if ( $current >= $max_per_window ) {
			return false;
		}
		set_transient( $key, $current + 1, $window_seconds );
		return true;
	}

	public static function honeypot_ok( $request_data ) {
		// Bot fills the honeypot; humans don't.
		return empty( $request_data['ocf_hp'] ) && empty( $request_data['ocf_hp_email'] );
	}
}
