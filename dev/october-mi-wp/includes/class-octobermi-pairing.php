<?php
/**
 * Pairing flow.
 *
 * The admin enters a 24-character pairing token issued by the platform. On
 * "Connect" the site makes ONE outbound, blocking POST to
 * /api/wp-connect/pair with the token; the platform responds with a
 * { client_id, refresh_secret, client_name? } pair. We store the client_id and
 * the (encrypted) refresh_secret and flip the UI to connected.
 *
 * The token is single-use and short-lived on the platform side; we never store
 * it after a successful exchange.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OctoberMI_Pairing {

	const TOKEN_LENGTH = 24;

	/** Basic shape check before we bother the network. */
	public static function looks_like_token( $token ) {
		$token = trim( (string) $token );
		return (bool) preg_match( '/^[A-Za-z0-9]{' . self::TOKEN_LENGTH . '}$/', $token );
	}

	/**
	 * Exchange the pairing token for connection credentials.
	 *
	 * @param string $token The 24-char pairing token.
	 * @return array { ok:bool, message:string }
	 */
	public static function connect( $token ) {
		$token = trim( (string) $token );

		if ( ! self::looks_like_token( $token ) ) {
			return array(
				'ok'      => false,
				'message' => __( 'That does not look like a valid pairing token. It should be 24 letters and numbers.', 'october-mi' ),
			);
		}

		$url  = OctoberMI_Client::endpoint( 'pair' );
		$body = wp_json_encode( array(
			'token'      => $token,
			'site_url'   => home_url(),
			'site_name'  => get_bloginfo( 'name' ),
			'wp_version' => get_bloginfo( 'version' ),
			'plugin_version' => OCTOBERMI_VERSION,
		) );

		$response = wp_remote_post( $url, array(
			'method'      => 'POST',
			'timeout'     => 20,
			'redirection' => 0,
			'headers'     => array(
				'Content-Type' => 'application/json',
				'Accept'       => 'application/json',
				'User-Agent'   => 'OctoberMI-WP/' . OCTOBERMI_VERSION,
			),
			'body'        => $body,
		) );

		if ( is_wp_error( $response ) ) {
			OctoberMI_Log::error( 'pairing', 'Transport error', array( 'error' => $response->get_error_message() ) );
			return array(
				'ok'      => false,
				'message' => sprintf(
					/* translators: %s: error message */
					__( 'Could not reach the platform: %s', 'october-mi' ),
					$response->get_error_message()
				),
			);
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$data = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( 200 !== $code || ! is_array( $data ) ) {
			$api_msg = is_array( $data ) && isset( $data['message'] ) ? (string) $data['message'] : '';
			OctoberMI_Log::error( 'pairing', 'Pairing rejected', array( 'status' => $code ) );
			return array(
				'ok'      => false,
				'message' => $api_msg
					? $api_msg
					: sprintf(
						/* translators: %d: HTTP status code */
						__( 'The platform rejected the pairing (HTTP %d). Check the token and try again.', 'october-mi' ),
						$code
					),
			);
		}

		if ( empty( $data['client_id'] ) || empty( $data['refresh_secret'] ) ) {
			return array(
				'ok'      => false,
				'message' => __( 'The platform did not return connection credentials. Please try again.', 'october-mi' ),
			);
		}

		OctoberMI_Settings::update( array(
			'client_id'      => sanitize_text_field( $data['client_id'] ),
			'refresh_secret' => (string) $data['refresh_secret'],
			'client_name'    => isset( $data['client_name'] ) ? sanitize_text_field( $data['client_name'] ) : '',
			'connected_at'   => time(),
		) );

		return array(
			'ok'      => true,
			'message' => __( 'Connected to the October Marketing Intelligence platform.', 'october-mi' ),
		);
	}
}
