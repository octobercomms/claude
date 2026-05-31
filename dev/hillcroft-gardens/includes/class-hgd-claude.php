<?php
/**
 * Anthropic Claude Messages API client.
 *
 * Thin wrapper around the Messages endpoint used for sketch-reading. Sends text
 * + image content blocks, parses the first text block out of the response, and
 * logs token spend to the cost banner via HGD_API_Usage.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Claude {

	const ENDPOINT  = 'https://api.anthropic.com/v1/messages';
	const API_VER   = '2023-06-01';
	const MAX_EDGE  = 1568; // longest side, px, before we downscale for payload size.

	/** Default model if the setting is unset. */
	const DEFAULT_MODEL = 'claude-sonnet-4-6';

	/** Is an API key configured? */
	public static function is_configured() {
		return '' !== trim( (string) HGD_Settings::get( 'claude_api_key', '' ) );
	}

	/**
	 * Send a single user message made of content blocks.
	 *
	 * @param array  $content_blocks Array of content-block arrays (text/image).
	 * @param string $system         System prompt.
	 * @param int    $max_tokens     Max output tokens.
	 * @param int    $project_id     Optional project association for cost logging.
	 * @return array|WP_Error array( 'text', 'input_tokens', 'output_tokens' ) or WP_Error.
	 */
	public static function message( array $content_blocks, $system = '', $max_tokens = 2000, $project_id = null ) {
		$key = trim( (string) HGD_Settings::get( 'claude_api_key', '' ) );
		if ( '' === $key ) {
			return new WP_Error( 'hgd_claude_no_key', __( 'No Claude API key configured.', 'hillcroft-garden-designer' ) );
		}

		$model = trim( (string) HGD_Settings::get( 'claude_model', self::DEFAULT_MODEL ) );
		if ( '' === $model ) {
			$model = self::DEFAULT_MODEL;
		}

		$body = array(
			'model'      => $model,
			'max_tokens' => (int) $max_tokens,
			'system'     => (string) $system,
			'messages'   => array(
				array(
					'role'    => 'user',
					'content' => array_values( $content_blocks ),
				),
			),
		);

		$response = wp_remote_post( self::ENDPOINT, array(
			'timeout' => 60,
			'headers' => array(
				'x-api-key'         => $key,
				'anthropic-version' => self::API_VER,
				'content-type'      => 'application/json',
			),
			'body'    => wp_json_encode( $body ),
		) );

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$raw  = wp_remote_retrieve_body( $response );
		$data = json_decode( $raw, true );

		if ( 200 !== $code ) {
			$msg = '';
			if ( is_array( $data ) && isset( $data['error']['message'] ) ) {
				$msg = $data['error']['message'];
			}
			if ( '' === $msg ) {
				$msg = sprintf( /* translators: %d HTTP code */ __( 'Claude API returned HTTP %d.', 'hillcroft-garden-designer' ), $code );
			}
			return new WP_Error( 'hgd_claude_http', $msg, array( 'status' => $code ) );
		}

		$text = '';
		if ( is_array( $data ) && isset( $data['content'][0]['text'] ) ) {
			$text = (string) $data['content'][0]['text'];
		}

		$in  = isset( $data['usage']['input_tokens'] ) ? (int) $data['usage']['input_tokens'] : 0;
		$out = isset( $data['usage']['output_tokens'] ) ? (int) $data['usage']['output_tokens'] : 0;

		// Log cost in GBP for the banner.
		$tokens   = $in + $out;
		$rate     = (float) HGD_Settings::get( 'rate_claude_per_mtok_usd', 15.0 );
		$usd2gbp  = (float) HGD_Settings::get( 'usd_to_gbp', 0.79 );
		$cost_usd = ( $tokens / 1000000 ) * $rate;
		$cost_gbp = $cost_usd * $usd2gbp;
		HGD_API_Usage::log( 'claude', $tokens, 'tokens', $cost_gbp, $project_id, array( 'in' => $in, 'out' => $out ) );

		return array(
			'text'          => $text,
			'input_tokens'  => $in,
			'output_tokens' => $out,
		);
	}

	/** Build a text content block. */
	public static function text_block( $text ) {
		return array(
			'type' => 'text',
			'text' => (string) $text,
		);
	}

	/**
	 * Build a base64 image content block from a media-library attachment.
	 *
	 * Downscales (to a temp copy) anything wider than MAX_EDGE to keep the payload
	 * small. Returns null on any failure.
	 *
	 * @param int $attachment_id
	 * @return array|null
	 */
	public static function image_block_from_attachment( $attachment_id ) {
		$attachment_id = (int) $attachment_id;
		$path          = get_attached_file( $attachment_id );
		if ( ! $path || ! file_exists( $path ) ) {
			return null;
		}

		$mime = get_post_mime_type( $attachment_id );
		if ( ! in_array( $mime, array( 'image/jpeg', 'image/png', 'image/webp', 'image/gif' ), true ) ) {
			return null;
		}

		$read_path = $path;
		$temp_path = '';

		// Downscale large images to a temp copy.
		$size = @getimagesize( $path ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
		if ( is_array( $size ) && isset( $size[0], $size[1] ) && max( (int) $size[0], (int) $size[1] ) > self::MAX_EDGE ) {
			$editor = wp_get_image_editor( $path );
			if ( ! is_wp_error( $editor ) ) {
				$editor->resize( self::MAX_EDGE, self::MAX_EDGE, false );
				$editor->set_quality( 82 );
				$ext  = pathinfo( $path, PATHINFO_EXTENSION );
				$tmp  = wp_tempnam( 'hgd-sketch.' . ( $ext ? $ext : 'jpg' ) );
				$saved = $editor->save( $tmp );
				if ( ! is_wp_error( $saved ) && ! empty( $saved['path'] ) && file_exists( $saved['path'] ) ) {
					$read_path = $saved['path'];
					$temp_path = $saved['path'];
					if ( ! empty( $saved['mime-type'] ) ) {
						$mime = $saved['mime-type'];
					}
					// wp_tempnam created a separate placeholder file; remove it if unused.
					if ( $tmp !== $saved['path'] && file_exists( $tmp ) ) {
						@unlink( $tmp ); // phpcs:ignore WordPress.PHP.NoSilencedErrors, WordPress.WP.AlternativeFunctions
					}
				} else {
					if ( file_exists( $tmp ) ) {
						@unlink( $tmp ); // phpcs:ignore WordPress.PHP.NoSilencedErrors, WordPress.WP.AlternativeFunctions
					}
				}
			}
		}

		$bytes = file_get_contents( $read_path ); // phpcs:ignore WordPress.WP.AlternativeFunctions

		// Clean up any temp copy.
		if ( '' !== $temp_path && file_exists( $temp_path ) ) {
			@unlink( $temp_path ); // phpcs:ignore WordPress.PHP.NoSilencedErrors, WordPress.WP.AlternativeFunctions
		}

		if ( false === $bytes ) {
			return null;
		}

		return array(
			'type'   => 'image',
			'source' => array(
				'type'       => 'base64',
				'media_type' => $mime,
				'data'       => base64_encode( $bytes ), // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions, WordPress.WP.AlternativeFunctions
			),
		);
	}
}
