<?php
/**
 * Claude client — the single place the plugin talks to a model.
 *
 * Two backends, chosen automatically from Settings:
 *
 *   1. DIRECT (standalone / "use my own key"): the site calls the Anthropic API
 *      directly with a key stored — encrypted at rest — in this plugin. The key
 *      is read server-side only and is never sent to the browser or logged.
 *
 *   2. PROXIED (managed / "use an October-managed key"): the site NEVER holds a
 *      raw key. It signs a request with its pairing secret and the platform
 *      performs the model call on its behalf, returning normalised text. This is
 *      what makes managed keys revocable: October rotates the site's
 *      refresh_secret from its dashboard and every call from that site stops —
 *      no key was ever left on the client's server to keep spending.
 *
 * All calls are meant to run inside background jobs, never in a page request:
 * the timeouts here are long by web standards on purpose.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OctoberMI_Claude {

	const API_URL     = 'https://api.anthropic.com/v1/messages';
	const API_VERSION = '2023-06-01';

	/** Sensible model defaults; each can be overridden per call. */
	const MODEL_FAST   = 'claude-haiku-4-5-20251001'; // triage / cheap passes
	const MODEL_DRAFT  = 'claude-sonnet-5';           // drafting
	const MODEL_POLISH = 'claude-opus-5';             // final editorial polish

	/**
	 * Can we make a model call at all right now?
	 * True when a managed key is available (paired + platform key source), or a
	 * local key has been entered.
	 */
	public static function available() {
		if ( OctoberMI_Settings::is_managed_key() ) {
			return true;
		}
		return '' !== (string) OctoberMI_Settings::get( 'claude_api_key' );
	}

	/** Human label for which backend is active, for the admin UI. */
	public static function backend_label() {
		if ( OctoberMI_Settings::is_managed_key() ) {
			return __( 'October-managed key (via platform)', 'october-mi' );
		}
		if ( '' !== (string) OctoberMI_Settings::get( 'claude_api_key' ) ) {
			return __( 'Your own Claude API key', 'october-mi' );
		}
		return __( 'Not configured', 'october-mi' );
	}

	/**
	 * Run a completion.
	 *
	 * @param array $args {
	 *   @type string       $model       Model id (defaults to MODEL_DRAFT).
	 *   @type string       $system      Optional system prompt.
	 *   @type array        $messages    Anthropic-format messages array.
	 *   @type int          $max_tokens  Defaults to 4096.
	 *   @type float        $temperature Optional.
	 * }
	 * @return string|WP_Error Concatenated text, or WP_Error on failure.
	 */
	public static function complete( array $args ) {
		if ( OctoberMI_Settings::is_managed_key() ) {
			return self::complete_via_platform( $args );
		}
		return self::complete_direct( $args );
	}

	/** Convenience: a single user prompt. */
	public static function ask( $prompt, array $opts = array() ) {
		$opts['messages'] = array(
			array( 'role' => 'user', 'content' => (string) $prompt ),
		);
		return self::complete( $opts );
	}

	// =====================================================================
	// Backends
	// =====================================================================

	private static function build_body( array $args ) {
		$body = array(
			'model'      => ! empty( $args['model'] ) ? (string) $args['model'] : self::MODEL_DRAFT,
			'max_tokens' => isset( $args['max_tokens'] ) ? (int) $args['max_tokens'] : 4096,
			'messages'   => isset( $args['messages'] ) && is_array( $args['messages'] ) ? $args['messages'] : array(),
		);
		if ( ! empty( $args['system'] ) ) {
			$body['system'] = (string) $args['system'];
		}
		if ( isset( $args['temperature'] ) ) {
			$body['temperature'] = (float) $args['temperature'];
		}
		return $body;
	}

	private static function complete_direct( array $args ) {
		$key = (string) OctoberMI_Settings::get( 'claude_api_key' );
		if ( '' === $key ) {
			return new WP_Error( 'octobermi_no_key', __( 'No Claude API key is configured.', 'october-mi' ) );
		}

		$body = self::build_body( $args );
		$response = wp_remote_post( self::API_URL, array(
			'timeout' => 60,
			'headers' => array(
				'content-type'      => 'application/json',
				'x-api-key'         => $key,
				'anthropic-version' => self::API_VERSION,
			),
			'body'    => wp_json_encode( $body ),
		) );

		$text = self::parse_anthropic( $response );

		// Record token usage for the monthly cost estimate/cap.
		if ( ! is_wp_error( $text ) && ! is_wp_error( $response ) ) {
			$decoded = json_decode( wp_remote_retrieve_body( $response ), true );
			if ( is_array( $decoded ) && ! empty( $decoded['usage'] ) ) {
				OctoberMI_Usage::record(
					isset( $decoded['model'] ) ? $decoded['model'] : $body['model'],
					isset( $decoded['usage']['input_tokens'] ) ? (int) $decoded['usage']['input_tokens'] : 0,
					isset( $decoded['usage']['output_tokens'] ) ? (int) $decoded['usage']['output_tokens'] : 0
				);
			}
		}

		return $text;
	}

	private static function complete_via_platform( array $args ) {
		// The raw key never touches this site. Send the request spec; the
		// platform enforces its own model allow-list and holds the key.
		$response = OctoberMI_Client::send(
			'generate',
			array( 'request' => self::build_body( $args ) ),
			'ai.generate',
			array( 'blocking' => true, 'retries' => 1 )
		);

		if ( is_wp_error( $response ) ) {
			return $response;
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		$data = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( $code < 200 || $code >= 300 ) {
			$msg = ( is_array( $data ) && ! empty( $data['message'] ) )
				? $data['message']
				: __( 'The platform declined the generation request.', 'october-mi' );
			// 401/403/409 here means the pairing was revoked from the October side.
			if ( in_array( $code, array( 401, 403, 409 ), true ) ) {
				$msg = __( 'The platform connection was revoked. Re-pair the site or switch to your own Claude API key.', 'october-mi' );
			}
			return new WP_Error( 'octobermi_platform_generate', $msg );
		}

		return is_array( $data ) && isset( $data['text'] ) ? (string) $data['text'] : '';
	}

	/** Turn an Anthropic /v1/messages response into text or a WP_Error. */
	private static function parse_anthropic( $response ) {
		if ( is_wp_error( $response ) ) {
			return $response;
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		$data = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( $code < 200 || $code >= 300 ) {
			$msg = ( is_array( $data ) && isset( $data['error']['message'] ) )
				? $data['error']['message']
				/* translators: %d: HTTP status code. */
				: sprintf( __( 'Claude API error (HTTP %d).', 'october-mi' ), $code );
			return new WP_Error( 'octobermi_claude_http', $msg );
		}

		$text = '';
		if ( is_array( $data ) && ! empty( $data['content'] ) && is_array( $data['content'] ) ) {
			foreach ( $data['content'] as $block ) {
				if ( isset( $block['type'], $block['text'] ) && 'text' === $block['type'] ) {
					$text .= $block['text'];
				}
			}
		}
		return $text;
	}
}
