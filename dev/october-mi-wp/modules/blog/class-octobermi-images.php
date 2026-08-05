<?php
/**
 * Hero images — library first, generate as backup.
 *
 * For each generated post we try to give it a bespoke, relevant hero image:
 *
 *   1. LIBRARY MATCH (preferred, free): score the site's existing media library
 *      against the article and pick the best fit. If the engine is available it
 *      also asks Claude to choose the strongest match (or reject them all), so
 *      "find the best one" is a judgement, not just keyword overlap.
 *   2. GENERATE (backup): if nothing in the library fits and a Gemini image key
 *      is configured, generate a bespoke hero from the article's art-direction
 *      prompt, sideload it into the media library with alt text, and use it.
 *
 * Best-effort: any failure is logged and the post simply keeps no featured image
 * — it never fails the generation job.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OctoberMI_Blog_Images {

	const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';

	/** Default Gemini image model (filterable — confirm against your account). */
	public static function gemini_model() {
		return apply_filters( 'octobermi_gemini_image_model', 'gemini-2.5-flash-image' );
	}

	/**
	 * Attach a hero image to a freshly generated post.
	 *
	 * @param int   $post_id
	 * @param array $gen The generated article fields (title, tags, hero_image_prompt…).
	 */
	public static function attach_hero( $post_id, array $gen ) {
		$mode = OctoberMI_Settings::get( 'hero_images', 'library_generate' );
		if ( 'off' === $mode ) {
			return;
		}
		if ( has_post_thumbnail( $post_id ) ) {
			return; // respect an image the author already set
		}

		// 1) Try the media library.
		$attach_id = self::find_library_match( $post_id, $gen );
		if ( $attach_id ) {
			set_post_thumbnail( $post_id, $attach_id );
			return;
		}

		// 2) Generate as a backup — via the platform when integrated (OMI holds
		// the image key, e.g. fal.ai), else with the site's own Gemini key.
		if ( 'library_generate' !== $mode ) {
			return;
		}
		$prompt = ! empty( $gen['hero_image_prompt'] ) ? (string) $gen['hero_image_prompt'] : (string) get_the_title( $post_id );
		$generated = OctoberMI_Settings::is_integrated()
			? self::generate_via_platform( $prompt, $post_id, $gen )
			: self::generate_gemini( $prompt, $post_id, $gen );

		if ( is_wp_error( $generated ) ) {
			OctoberMI_Log::error( 'blog.hero', 'Hero image generation failed', array( 'message' => $generated->get_error_message() ) );
			return;
		}
		if ( $generated ) {
			set_post_thumbnail( $post_id, $generated );
		}
	}

	// =====================================================================
	// Platform-managed generation (integrated mode)
	// =====================================================================

	/**
	 * Ask the platform to generate a hero (OMI holds the image key, e.g. fal.ai)
	 * and sideload the result. Accepts either inline base64 or an image URL.
	 * Returns attachment id, 0 to skip, or WP_Error.
	 */
	private static function generate_via_platform( $prompt, $post_id, array $gen ) {
		$response = OctoberMI_Client::send(
			'image',
			array( 'prompt' => 'Editorial hero image, no text or logos in the image. ' . $prompt, 'post_title' => get_the_title( $post_id ) ),
			'ai.image',
			array( 'blocking' => true, 'retries' => 1, 'timeout' => 120 )
		);
		if ( is_wp_error( $response ) ) {
			return $response;
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( $code < 200 || $code >= 300 ) {
			// 404 = platform hasn't shipped the image endpoint yet; skip quietly.
			if ( 404 === $code ) {
				return 0;
			}
			$msg = ( is_array( $data ) && ! empty( $data['message'] ) ) ? $data['message'] : 'Platform image HTTP ' . $code;
			return new WP_Error( 'octobermi_platform_image', $msg );
		}
		if ( ! is_array( $data ) ) {
			return 0;
		}

		// Inline base64?
		foreach ( array( 'image_base64', 'b64', 'data' ) as $k ) {
			if ( ! empty( $data[ $k ] ) && is_string( $data[ $k ] ) ) {
				$raw = base64_decode( $data[ $k ], true );
				if ( false !== $raw && '' !== $raw ) {
					$mime = ! empty( $data['mime'] ) ? $data['mime'] : 'image/png';
					return self::sideload( $raw, $mime, $post_id, $gen );
				}
			}
		}
		// Or a URL to fetch.
		foreach ( array( 'image_url', 'url' ) as $k ) {
			if ( ! empty( $data[ $k ] ) && is_string( $data[ $k ] ) ) {
				$img = wp_remote_get( $data[ $k ], array( 'timeout' => 60 ) );
				if ( is_wp_error( $img ) ) {
					return $img;
				}
				$bytes = wp_remote_retrieve_body( $img );
				if ( '' !== $bytes ) {
					$mime = wp_remote_retrieve_header( $img, 'content-type' );
					return self::sideload( $bytes, $mime ? $mime : 'image/png', $post_id, $gen );
				}
			}
		}
		return 0;
	}

	// =====================================================================
	// Library match
	// =====================================================================

	private static function find_library_match( $post_id, array $gen ) {
		$keywords = self::keywords( $post_id, $gen );
		if ( empty( $keywords ) ) {
			return 0;
		}

		$attachments = get_posts( array(
			'post_type'        => 'attachment',
			'post_mime_type'   => 'image',
			'post_status'      => 'inherit',
			'numberposts'      => 40,
			'orderby'          => 'date',
			'order'            => 'DESC',
			'suppress_filters' => false,
		) );
		if ( empty( $attachments ) ) {
			return 0;
		}

		// Score each by keyword overlap across title/alt/caption/filename.
		$scored = array();
		foreach ( $attachments as $att ) {
			$hay = strtolower( implode( ' ', array(
				$att->post_title,
				(string) get_post_meta( $att->ID, '_wp_attachment_image_alt', true ),
				$att->post_excerpt,
				wp_basename( (string) get_attached_file( $att->ID ) ),
			) ) );
			$score = 0;
			foreach ( $keywords as $kw ) {
				if ( false !== strpos( $hay, $kw ) ) {
					$score++;
				}
			}
			if ( $score > 0 ) {
				$scored[] = array( 'id' => $att->ID, 'score' => $score, 'title' => $att->post_title, 'file' => wp_basename( (string) get_attached_file( $att->ID ) ) );
			}
		}
		if ( empty( $scored ) ) {
			return 0;
		}
		usort( $scored, function ( $a, $b ) {
			return $b['score'] - $a['score'];
		} );
		$top = array_slice( $scored, 0, 6 );

		// Let Claude make the final call among the top candidates (or reject).
		if ( OctoberMI_Claude::available() ) {
			$choice = self::claude_pick( $post_id, $gen, $top );
			if ( null !== $choice ) {
				return $choice; // 0 means "none suitable"
			}
		}

		// Fallback: take the top-scored candidate if it's a confident match.
		return $top[0]['score'] >= 2 ? (int) $top[0]['id'] : 0;
	}

	/** Ask Claude to choose the best candidate or reject them all. */
	private static function claude_pick( $post_id, array $gen, array $candidates ) {
		$lines = array();
		foreach ( $candidates as $i => $c ) {
			$lines[] = ( $i + 1 ) . '. ' . $c['title'] . ' [' . $c['file'] . ']';
		}
		$prompt = "Article title: \"" . get_the_title( $post_id ) . "\"\n"
			. ( ! empty( $gen['hero_image_prompt'] ) ? 'Ideal hero: ' . $gen['hero_image_prompt'] . "\n" : '' )
			. "Candidate library images:\n" . implode( "\n", $lines ) . "\n\n"
			. "Which single image best fits as this article's hero? Reply with ONLY the number, or 0 if none is a good, relevant fit.";

		$resp = OctoberMI_Claude::complete( array(
			'model'      => OctoberMI_Claude::MODEL_FAST,
			'max_tokens' => 8,
			'messages'   => array( array( 'role' => 'user', 'content' => $prompt ) ),
		) );
		if ( is_wp_error( $resp ) ) {
			return null; // fall back to scoring
		}
		if ( ! preg_match( '/\d+/', (string) $resp, $m ) ) {
			return null;
		}
		$n = (int) $m[0];
		if ( $n <= 0 || $n > count( $candidates ) ) {
			return 0; // rejected all
		}
		return (int) $candidates[ $n - 1 ]['id'];
	}

	private static function keywords( $post_id, array $gen ) {
		$text = strtolower( get_the_title( $post_id ) . ' ' );
		if ( ! empty( $gen['tags'] ) && is_array( $gen['tags'] ) ) {
			$text .= strtolower( implode( ' ', $gen['tags'] ) ) . ' ';
		}
		$stop = array( 'the', 'and', 'for', 'with', 'your', 'that', 'this', 'from', 'how', 'what', 'why', 'are', 'you', 'our', 'can', 'has', 'into', 'when', 'will', 'guide', 'best', 'tips' );
		$words = preg_split( '/[^a-z0-9]+/', $text, -1, PREG_SPLIT_NO_EMPTY );
		$out = array();
		foreach ( (array) $words as $w ) {
			if ( strlen( $w ) > 3 && ! in_array( $w, $stop, true ) ) {
				$out[ $w ] = true;
			}
		}
		return array_keys( $out );
	}

	// =====================================================================
	// Gemini generation
	// =====================================================================

	private static function generate_gemini( $prompt, $post_id, array $gen ) {
		$key = (string) OctoberMI_Settings::get( 'gemini_api_key' );
		if ( '' === $key ) {
			return 0; // not configured — silently skip
		}

		$url  = self::GEMINI_ENDPOINT . rawurlencode( self::gemini_model() ) . ':generateContent?key=' . rawurlencode( $key );
		$body = array(
			'contents' => array( array( 'parts' => array( array( 'text' => 'Editorial hero image, no text or logos in the image. ' . $prompt ) ) ) ),
			'generationConfig' => array( 'responseModalities' => array( 'IMAGE' ) ),
		);

		$response = wp_remote_post( $url, array(
			'timeout' => 120,
			'headers' => array( 'content-type' => 'application/json' ),
			'body'    => wp_json_encode( $body ),
		) );
		if ( is_wp_error( $response ) ) {
			return $response;
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( $code < 200 || $code >= 300 ) {
			$msg = ( is_array( $data ) && isset( $data['error']['message'] ) ) ? $data['error']['message'] : 'Gemini HTTP ' . $code;
			return new WP_Error( 'octobermi_gemini_http', $msg );
		}

		list( $bytes, $mime ) = self::extract_inline_image( $data );
		if ( '' === $bytes ) {
			return new WP_Error( 'octobermi_gemini_noimage', __( 'Gemini returned no image data.', 'october-mi' ) );
		}

		return self::sideload( $bytes, $mime, $post_id, $gen );
	}

	/** Find the first inline image part in a Gemini response. */
	private static function extract_inline_image( $data ) {
		if ( empty( $data['candidates'] ) || ! is_array( $data['candidates'] ) ) {
			return array( '', '' );
		}
		foreach ( $data['candidates'] as $cand ) {
			if ( empty( $cand['content']['parts'] ) ) {
				continue;
			}
			foreach ( $cand['content']['parts'] as $part ) {
				if ( ! empty( $part['inlineData']['data'] ) ) {
					$mime = isset( $part['inlineData']['mimeType'] ) ? $part['inlineData']['mimeType'] : 'image/png';
					$raw  = base64_decode( $part['inlineData']['data'], true );
					if ( false !== $raw && '' !== $raw ) {
						return array( $raw, $mime );
					}
				}
			}
		}
		return array( '', '' );
	}

	/** Write image bytes into the media library and return the attachment id. */
	private static function sideload( $bytes, $mime, $post_id, array $gen ) {
		$ext  = ( false !== strpos( $mime, 'jpeg' ) ) ? 'jpg' : ( ( false !== strpos( $mime, 'webp' ) ) ? 'webp' : 'png' );
		$slug = sanitize_title( get_the_title( $post_id ) );
		$name = ( $slug ? $slug : 'hero' ) . '-hero.' . $ext;

		$upload = wp_upload_bits( $name, null, $bytes );
		if ( ! empty( $upload['error'] ) ) {
			return new WP_Error( 'octobermi_upload', $upload['error'] );
		}

		$filetype   = wp_check_filetype( $upload['file'], null );
		$attachment = array(
			'post_mime_type' => $filetype['type'] ? $filetype['type'] : $mime,
			'post_title'     => get_the_title( $post_id ),
			'post_content'   => '',
			'post_status'    => 'inherit',
		);
		$attach_id = wp_insert_attachment( $attachment, $upload['file'], $post_id );
		if ( is_wp_error( $attach_id ) || ! $attach_id ) {
			return is_wp_error( $attach_id ) ? $attach_id : new WP_Error( 'octobermi_attach', 'insert_attachment failed' );
		}

		require_once ABSPATH . 'wp-admin/includes/image.php';
		$meta = wp_generate_attachment_metadata( $attach_id, $upload['file'] );
		wp_update_attachment_metadata( $attach_id, $meta );

		// Contextual alt text (why it's here), keyed to the article.
		$alt = get_the_title( $post_id );
		update_post_meta( $attach_id, '_wp_attachment_image_alt', sanitize_text_field( $alt ) );

		return (int) $attach_id;
	}
}
