<?php
/**
 * Outbound transport — the single place that signs and sends to the platform.
 *
 * Why outbound only: web application firewalls (Cloudflare, Sucuri, etc.)
 * challenge inbound requests to the WP/WooCommerce REST API and often return an
 * HTML 401 the platform can't parse. Server-initiated egress is never
 * challenged, so this plugin reverses the direction: the site pushes to the
 * platform's /api/wp-connect/* endpoints.
 *
 * Signature contract (verified platform-side):
 *   - Body is JSON.
 *   - X-Signature: hex HMAC-SHA256 of the exact raw body, keyed with the
 *     refresh_secret.
 *   - X-Timestamp: Unix seconds at send time (lets the platform reject replays).
 *   - X-OMI-Client: the client_id issued at pairing.
 *
 * Sends are non-blocking by default (fire-and-forget) so a hook never slows a
 * checkout or a save. A small blocking retry is available for calls whose
 * result we need to read (e.g. pairing).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OctoberMI_Client {

	/** Build the absolute URL for a wp-connect endpoint. */
	public static function endpoint( $path ) {
		return rtrim( OCTOBERMI_PLATFORM_URL, '/' ) . '/api/wp-connect/' . ltrim( $path, '/' );
	}

	/**
	 * Sign and POST a payload to a wp-connect endpoint.
	 *
	 * Records every attempt in the rolling outbound log and notes the sync.
	 *
	 * @param string $endpoint Short endpoint name, e.g. 'orders'.
	 * @param array  $payload  Associative array; JSON-encoded for the body.
	 * @param string $event    Event label for the log, e.g. 'order.placed'.
	 * @param array  $opts     { blocking?:bool, retries?:int }
	 * @return array|WP_Error  The wp_remote_post response, or WP_Error.
	 */
	public static function send( $endpoint, array $payload, $event = '', $opts = array() ) {
		$settings = OctoberMI_Settings::all();
		if ( empty( $settings['client_id'] ) || empty( $settings['refresh_secret'] ) ) {
			return new WP_Error( 'octobermi_not_connected', __( 'The site is not paired with the platform.', 'october-mi' ) );
		}

		$blocking = ! empty( $opts['blocking'] );
		$retries  = isset( $opts['retries'] ) ? max( 0, (int) $opts['retries'] ) : ( $blocking ? 1 : 0 );
		// Callers whose payload is a model call (which runs in a background job)
		// can request a long timeout; default keeps hooks snappy.
		$timeout  = isset( $opts['timeout'] ) ? max( 1, (int) $opts['timeout'] ) : ( $blocking ? 15 : 5 );

		// Envelope shared by every push, so the platform always has context.
		$payload = array_merge( array(
			'client_id' => $settings['client_id'],
			'site_url'  => home_url(),
			'sent_at'   => time(),
		), $payload );

		$body      = wp_json_encode( $payload );
		$timestamp = (string) time();
		$signature = hash_hmac( 'sha256', $body, $settings['refresh_secret'] );

		$args = array(
			'method'      => 'POST',
			'timeout'     => $timeout,
			'blocking'    => $blocking,
			'redirection' => 0,
			'headers'     => array(
				'Content-Type'  => 'application/json',
				'Accept'        => 'application/json',
				'X-Signature'   => $signature,
				'X-Timestamp'   => $timestamp,
				'X-OMI-Client'  => $settings['client_id'],
				'X-OMI-Version' => OCTOBERMI_VERSION,
				'User-Agent'    => 'OctoberMI-WP/' . OCTOBERMI_VERSION,
			),
			'body'        => $body,
		);

		$url      = self::endpoint( $endpoint );
		$response = null;

		for ( $attempt = 0; $attempt <= $retries; $attempt++ ) {
			$response = wp_remote_post( $url, $args );

			// Non-blocking: WP returns immediately and we can't inspect the
			// result — treat a non-WP_Error return as dispatched.
			if ( ! $blocking ) {
				$ok = ! is_wp_error( $response );
				OctoberMI_Log::record_outbound(
					$endpoint,
					$event,
					0,
					$ok,
					$ok ? 'dispatched (non-blocking)' : $response->get_error_message()
				);
				OctoberMI_Settings::note_sync();
				return $response;
			}

			$code = is_wp_error( $response ) ? 0 : (int) wp_remote_retrieve_response_code( $response );
			$ok   = ! is_wp_error( $response ) && $code >= 200 && $code < 300;

			if ( $ok || $attempt === $retries ) {
				$note = is_wp_error( $response ) ? $response->get_error_message() : '';
				OctoberMI_Log::record_outbound( $endpoint, $event, $code, $ok, $note );
				OctoberMI_Settings::note_sync();
				if ( ! $ok && ! is_wp_error( $response ) ) {
					OctoberMI_Log::error( 'push.' . $endpoint, 'Non-2xx response', array( 'status' => $code, 'event' => $event ) );
				}
				return $response;
			}

			// Backoff before the next blocking retry.
			usleep( 300000 * ( $attempt + 1 ) );
		}

		return $response;
	}
}
