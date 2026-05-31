<?php
/**
 * Google Calendar integration (personal-Gmail OAuth).
 *
 * Optional. When a refresh token is connected, the booking flow checks free/busy
 * to hide clashing slots and writes a calendar event on payment. Every method
 * degrades gracefully (returns empty/false) when not connected or on any error —
 * booking always works without Google.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Google_Calendar {

	const TOKEN_URL     = 'https://oauth2.googleapis.com/token';
	const AUTH_URL      = 'https://accounts.google.com/o/oauth2/v2/auth';
	const CAL_BASE      = 'https://www.googleapis.com/calendar/v3';
	const TOKEN_TRANS   = 'hgd_google_access_token';

	private static function client_id() {
		return (string) HGD_Settings::get( 'google_client_id', '' );
	}

	private static function client_secret() {
		return (string) HGD_Settings::get( 'google_client_secret', '' );
	}

	private static function refresh_token() {
		return (string) HGD_Settings::get( 'google_refresh_token', '' );
	}

	public static function calendar_id() {
		$id = (string) HGD_Settings::get( 'google_calendar_id', 'primary' );
		return '' !== $id ? $id : 'primary';
	}

	public static function redirect_uri() {
		return admin_url( 'admin.php?page=hgd-settings&hgd_google_oauth=callback' );
	}

	public static function is_connected() {
		return '' !== self::refresh_token() && '' !== self::client_id() && '' !== self::client_secret();
	}

	/** URL the admin clicks to grant calendar access. */
	public static function auth_url() {
		$params = array(
			'client_id'     => self::client_id(),
			'redirect_uri'  => self::redirect_uri(),
			'response_type' => 'code',
			'scope'         => 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly',
			'access_type'   => 'offline',
			'prompt'        => 'consent',
			'include_granted_scopes' => 'true',
		);
		return self::AUTH_URL . '?' . http_build_query( $params );
	}

	/**
	 * Exchange an OAuth authorization code for tokens; store the refresh token.
	 *
	 * @return true|WP_Error
	 */
	public static function exchange_code( $code ) {
		$code = trim( (string) $code );
		if ( '' === $code ) {
			return new WP_Error( 'hgd_google_no_code', __( 'No authorization code.', 'hillcroft-garden-designer' ) );
		}
		if ( '' === self::client_id() || '' === self::client_secret() ) {
			return new WP_Error( 'hgd_google_no_client', __( 'Set the Google client id and secret first.', 'hillcroft-garden-designer' ) );
		}

		$response = wp_remote_post( self::TOKEN_URL, array(
			'body'    => array(
				'code'          => $code,
				'client_id'     => self::client_id(),
				'client_secret' => self::client_secret(),
				'redirect_uri'  => self::redirect_uri(),
				'grant_type'    => 'authorization_code',
			),
			'timeout' => 20,
		) );

		if ( is_wp_error( $response ) ) {
			return $response;
		}
		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( empty( $data['refresh_token'] ) ) {
			$msg = isset( $data['error_description'] ) ? $data['error_description'] : __( 'Google did not return a refresh token. Try disconnecting and reconnecting.', 'hillcroft-garden-designer' );
			return new WP_Error( 'hgd_google_no_refresh', $msg );
		}

		HGD_Settings::save( array( 'google_refresh_token' => sanitize_text_field( $data['refresh_token'] ) ) );

		if ( ! empty( $data['access_token'] ) ) {
			$ttl = isset( $data['expires_in'] ) ? max( 60, (int) $data['expires_in'] - 120 ) : 3000;
			set_transient( self::TOKEN_TRANS, sanitize_text_field( $data['access_token'] ), $ttl );
		}

		return true;
	}

	/** Short-lived access token (cached in a transient ~50 min). Returns '' on failure. */
	public static function access_token() {
		if ( ! self::is_connected() ) {
			return '';
		}
		$cached = get_transient( self::TOKEN_TRANS );
		if ( $cached ) {
			return $cached;
		}

		$response = wp_remote_post( self::TOKEN_URL, array(
			'body'    => array(
				'client_id'     => self::client_id(),
				'client_secret' => self::client_secret(),
				'refresh_token' => self::refresh_token(),
				'grant_type'    => 'refresh_token',
			),
			'timeout' => 20,
		) );

		if ( is_wp_error( $response ) ) {
			return '';
		}
		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( empty( $data['access_token'] ) ) {
			return '';
		}

		$token = sanitize_text_field( $data['access_token'] );
		$ttl   = isset( $data['expires_in'] ) ? max( 60, (int) $data['expires_in'] - 120 ) : 3000;
		set_transient( self::TOKEN_TRANS, $token, $ttl );
		return $token;
	}

	/**
	 * Free/busy intervals on the configured calendar between two ISO-8601 instants.
	 *
	 * @return array List of array{ start: string, end: string } (RFC3339). Empty on failure.
	 */
	public static function freebusy( $from_iso, $to_iso ) {
		$token = self::access_token();
		if ( ! $token ) {
			return array();
		}

		$response = wp_remote_post( self::CAL_BASE . '/freeBusy', array(
			'headers' => array(
				'Authorization' => 'Bearer ' . $token,
				'Content-Type'  => 'application/json',
			),
			'body'    => wp_json_encode( array(
				'timeMin' => $from_iso,
				'timeMax' => $to_iso,
				'items'   => array( array( 'id' => self::calendar_id() ) ),
			) ),
			'timeout' => 20,
		) );

		if ( is_wp_error( $response ) ) {
			return array();
		}
		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		$cal  = self::calendar_id();
		if ( isset( $data['calendars'][ $cal ]['busy'] ) && is_array( $data['calendars'][ $cal ]['busy'] ) ) {
			return $data['calendars'][ $cal ]['busy'];
		}
		return array();
	}

	/**
	 * Create a calendar event. Returns the event id, or false on failure.
	 *
	 * @param string $start_iso RFC3339 start.
	 * @param string $end_iso   RFC3339 end.
	 */
	public static function create_event( $summary, $description, $start_iso, $end_iso, $attendee_email = '' ) {
		$token = self::access_token();
		if ( ! $token ) {
			return false;
		}

		$tz    = wp_timezone_string();
		$event = array(
			'summary'     => (string) $summary,
			'description' => (string) $description,
			'start'       => array( 'dateTime' => $start_iso, 'timeZone' => $tz ),
			'end'         => array( 'dateTime' => $end_iso, 'timeZone' => $tz ),
		);
		if ( $attendee_email && is_email( $attendee_email ) ) {
			$event['attendees'] = array( array( 'email' => $attendee_email ) );
		}

		$response = wp_remote_post( self::CAL_BASE . '/calendars/' . rawurlencode( self::calendar_id() ) . '/events', array(
			'headers' => array(
				'Authorization' => 'Bearer ' . $token,
				'Content-Type'  => 'application/json',
			),
			'body'    => wp_json_encode( $event ),
			'timeout' => 20,
		) );

		if ( is_wp_error( $response ) ) {
			return false;
		}
		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		return ! empty( $data['id'] ) ? sanitize_text_field( $data['id'] ) : false;
	}

	/** Forget the stored refresh token + cached access token. */
	public static function disconnect() {
		delete_transient( self::TOKEN_TRANS );
		// Bypass the secret-keep behaviour of Settings::save by writing directly.
		$all = HGD_Settings::all();
		$all['google_refresh_token'] = '';
		update_option( HGD_Settings::OPTION, $all );
	}
}
