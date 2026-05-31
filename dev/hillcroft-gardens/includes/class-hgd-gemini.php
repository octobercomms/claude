<?php
/**
 * Google Gemini image-generation client.
 *
 * Thin wrapper around the generateContent endpoint used to produce photorealistic
 * concept renders from a text prompt (optionally anchored to reference images such
 * as the project sketch). Decoded image bytes are saved to the media library and
 * linked to the project as a 'render' asset. Cost is logged to the cost banner via
 * HGD_API_Usage.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Gemini {

	const ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
	const MAX_EDGE      = 1568; // longest side, px, before we downscale reference images.

	/** Default model if the setting is unset. */
	const DEFAULT_MODEL = 'gemini-2.5-flash-image';

	/** Is an API key configured? */
	public static function is_configured() {
		return '' !== trim( (string) HGD_Settings::get( 'gemini_api_key', '' ) );
	}

	/**
	 * Generate one image from a prompt, optionally anchored to reference images.
	 *
	 * @param string $prompt                  The image-generation prompt.
	 * @param array  $reference_attachment_ids Attachment ids to send as inline reference images.
	 * @param int    $project_id              Optional project association for cost logging.
	 * @return array|WP_Error array( 'bytes', 'mime' ) on success, or WP_Error.
	 */
	public static function generate_image( $prompt, $reference_attachment_ids = array(), $project_id = null ) {
		$key = trim( (string) HGD_Settings::get( 'gemini_api_key', '' ) );
		if ( '' === $key ) {
			return new WP_Error( 'hgd_gemini_no_key', __( 'No Gemini API key configured.', 'hillcroft-garden-designer' ) );
		}

		$model = trim( (string) HGD_Settings::get( 'gemini_image_model', self::DEFAULT_MODEL ) );
		if ( '' === $model ) {
			$model = self::DEFAULT_MODEL;
		}

		$parts = array(
			array( 'text' => (string) $prompt ),
		);
		foreach ( (array) $reference_attachment_ids as $att_id ) {
			$img = self::image_part_from_attachment( (int) $att_id );
			if ( $img ) {
				$parts[] = array(
					'inline_data' => array(
						'mime_type' => $img['mime'],
						'data'      => $img['data'],
					),
				);
			}
		}

		$body = array(
			'contents' => array(
				array(
					'role'  => 'user',
					'parts' => $parts,
				),
			),
		);

		$url = self::ENDPOINT_BASE . rawurlencode( $model ) . ':generateContent?key=' . rawurlencode( $key );

		$response = wp_remote_post( $url, array(
			'timeout' => 120,
			'headers' => array(
				'content-type' => 'application/json',
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
				$msg = sprintf( /* translators: %d HTTP code */ __( 'Gemini API returned HTTP %d.', 'hillcroft-garden-designer' ), $code );
			}
			return new WP_Error( 'hgd_gemini_http', $msg, array( 'status' => $code ) );
		}

		// Find the candidate part carrying inline image bytes.
		$found = null;
		if ( is_array( $data ) && ! empty( $data['candidates'] ) && is_array( $data['candidates'] ) ) {
			foreach ( $data['candidates'] as $candidate ) {
				if ( empty( $candidate['content']['parts'] ) || ! is_array( $candidate['content']['parts'] ) ) {
					continue;
				}
				foreach ( $candidate['content']['parts'] as $part ) {
					// The API uses inlineData (camelCase) in responses; accept inline_data too.
					$inline = null;
					if ( isset( $part['inlineData'] ) && is_array( $part['inlineData'] ) ) {
						$inline = $part['inlineData'];
					} elseif ( isset( $part['inline_data'] ) && is_array( $part['inline_data'] ) ) {
						$inline = $part['inline_data'];
					}
					if ( null === $inline ) {
						continue;
					}
					$b64 = isset( $inline['data'] ) ? (string) $inline['data'] : '';
					if ( '' === $b64 ) {
						continue;
					}
					$mime = isset( $inline['mimeType'] ) ? (string) $inline['mimeType']
						: ( isset( $inline['mime_type'] ) ? (string) $inline['mime_type'] : 'image/png' );
					$found = array( 'b64' => $b64, 'mime' => $mime );
					break 2;
				}
			}
		}

		if ( null === $found ) {
			// Surface a model text/refusal message if present.
			$msg = '';
			if ( is_array( $data ) && isset( $data['candidates'][0]['content']['parts'] ) ) {
				foreach ( $data['candidates'][0]['content']['parts'] as $part ) {
					if ( isset( $part['text'] ) && '' !== trim( (string) $part['text'] ) ) {
						$msg = (string) $part['text'];
						break;
					}
				}
			}
			if ( '' === $msg ) {
				$msg = __( 'Gemini returned no image. Try adjusting the render prompt.', 'hillcroft-garden-designer' );
			}
			return new WP_Error( 'hgd_gemini_no_image', $msg );
		}

		$bytes = base64_decode( $found['b64'], true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions
		if ( false === $bytes || '' === $bytes ) {
			return new WP_Error( 'hgd_gemini_decode', __( 'Could not decode the image returned by Gemini.', 'hillcroft-garden-designer' ) );
		}

		// Log cost in GBP for the banner.
		$rate     = (float) HGD_Settings::get( 'rate_gemini_per_image_usd', 0.04 );
		$usd2gbp  = (float) HGD_Settings::get( 'usd_to_gbp', 0.79 );
		$cost_gbp = $rate * $usd2gbp;
		HGD_API_Usage::log( 'gemini', 1, 'image', $cost_gbp, $project_id, array( 'model' => $model ) );

		return array(
			'bytes' => $bytes,
			'mime'  => $found['mime'],
		);
	}

	/**
	 * Save decoded image bytes to the uploads dir + media library.
	 *
	 * @param string $bytes        Raw image bytes.
	 * @param string $mime         Image MIME type.
	 * @param int    $project_id   Project association (for the filename hint).
	 * @param string $filename_hint Base name for the file.
	 * @return int|WP_Error Attachment id or WP_Error.
	 */
	public static function save_image_as_attachment( $bytes, $mime, $project_id, $filename_hint = 'concept' ) {
		require_once ABSPATH . 'wp-admin/includes/image.php';

		$ext_map = array(
			'image/png'  => 'png',
			'image/jpeg' => 'jpg',
			'image/jpg'  => 'jpg',
			'image/webp' => 'webp',
			'image/gif'  => 'gif',
		);
		$ext  = isset( $ext_map[ $mime ] ) ? $ext_map[ $mime ] : 'png';
		$hint = sanitize_file_name( (string) $filename_hint );
		if ( '' === $hint ) {
			$hint = 'concept';
		}
		$filename = sprintf( 'hgd-%s-%d-%d.%s', $hint, (int) $project_id, time(), $ext );

		$upload = wp_upload_bits( $filename, null, $bytes );
		if ( ! empty( $upload['error'] ) ) {
			return new WP_Error( 'hgd_gemini_upload', (string) $upload['error'] );
		}

		$attachment = array(
			'post_mime_type' => $mime,
			'post_title'     => sprintf( /* translators: %d project id */ __( 'Concept render (project #%d)', 'hillcroft-garden-designer' ), (int) $project_id ),
			'post_content'   => '',
			'post_status'    => 'inherit',
		);

		$att_id = wp_insert_attachment( $attachment, $upload['file'] );
		if ( is_wp_error( $att_id ) ) {
			return $att_id;
		}
		if ( ! $att_id ) {
			return new WP_Error( 'hgd_gemini_attach', __( 'Could not create the media attachment.', 'hillcroft-garden-designer' ) );
		}

		$meta = wp_generate_attachment_metadata( $att_id, $upload['file'] );
		wp_update_attachment_metadata( $att_id, $meta );

		return (int) $att_id;
	}

	/**
	 * Build a base64 image part from a media-library attachment.
	 *
	 * Mirrors HGD_Claude's downscale-to-MAX_EDGE approach to keep the payload small.
	 * Returns null on any failure.
	 *
	 * @param int $attachment_id
	 * @return array|null array( 'mime', 'data' )
	 */
	public static function image_part_from_attachment( $attachment_id ) {
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
				$ext   = pathinfo( $path, PATHINFO_EXTENSION );
				$tmp   = wp_tempnam( 'hgd-ref.' . ( $ext ? $ext : 'jpg' ) );
				$saved = $editor->save( $tmp );
				if ( ! is_wp_error( $saved ) && ! empty( $saved['path'] ) && file_exists( $saved['path'] ) ) {
					$read_path = $saved['path'];
					$temp_path = $saved['path'];
					if ( ! empty( $saved['mime-type'] ) ) {
						$mime = $saved['mime-type'];
					}
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

		if ( '' !== $temp_path && file_exists( $temp_path ) ) {
			@unlink( $temp_path ); // phpcs:ignore WordPress.PHP.NoSilencedErrors, WordPress.WP.AlternativeFunctions
		}

		if ( false === $bytes ) {
			return null;
		}

		return array(
			'mime' => $mime,
			'data' => base64_encode( $bytes ), // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions, WordPress.WP.AlternativeFunctions
		);
	}
}
