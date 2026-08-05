<?php
/**
 * Publisher — places a generated article into WordPress as a real post.
 *
 * Security-critical: the model's HTML is NEVER trusted. It is run through wp_kses
 * with a tight article-only allow-list before it is stored, so a prompt-injected or
 * malformed response can't inject script/style/iframe/event handlers.
 *
 * Respects the brief's publish mode: 'draft' (the default — a named author reviews
 * before it goes live) or 'auto' (trusted auto-publish).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OctoberMI_Blog_Publisher {

	/**
	 * @param array $gen   Fields from OctoberMI_Blog_Writer::generate().
	 * @param array $brief The active brief.
	 * @return int|WP_Error New post id.
	 */
	public static function create_from_generated( array $gen, array $brief ) {
		$title = sanitize_text_field( (string) $gen['title'] );
		$body  = self::sanitize_body( (string) $gen['body_html'] );
		if ( '' === $title || '' === trim( wp_strip_all_tags( $body ) ) ) {
			return new WP_Error( 'octobermi_publish_empty', __( 'Generated content was empty after sanitisation.', 'october-mi' ) );
		}

		$status = ( isset( $brief['publish_mode'] ) && 'auto' === $brief['publish_mode'] ) ? 'publish' : 'draft';
		$author = self::resolve_author( $brief );

		$postarr = array(
			'post_title'   => $title,
			'post_content' => $body,
			'post_status'  => $status,
			'post_type'    => 'post',
			'post_author'  => $author,
		);
		if ( ! empty( $gen['excerpt'] ) ) {
			$postarr['post_excerpt'] = sanitize_text_field( (string) $gen['excerpt'] );
		}
		if ( ! empty( $gen['slug'] ) ) {
			$postarr['post_name'] = sanitize_title( (string) $gen['slug'] );
		}

		$post_id = wp_insert_post( $postarr, true );
		if ( is_wp_error( $post_id ) ) {
			return $post_id;
		}

		// Flags + metadata the schema layer and admin queue read.
		update_post_meta( $post_id, OctoberMI_Blog_Schema::META_GENERATED, 1 );

		if ( ! empty( $gen['meta_description'] ) ) {
			$desc = sanitize_text_field( (string) $gen['meta_description'] );
			update_post_meta( $post_id, OctoberMI_Blog_Schema::META_METADESC, $desc );
			// Best-effort compatibility with common SEO plugins.
			update_post_meta( $post_id, '_yoast_wpseo_metadesc', $desc );
			update_post_meta( $post_id, 'rank_math_description', $desc );
		}

		if ( ! empty( $gen['faq'] ) && is_array( $gen['faq'] ) ) {
			$faq = array();
			foreach ( $gen['faq'] as $qa ) {
				if ( empty( $qa['q'] ) || empty( $qa['a'] ) ) {
					continue;
				}
				$faq[] = array(
					'q' => sanitize_text_field( (string) $qa['q'] ),
					'a' => sanitize_text_field( (string) $qa['a'] ),
				);
			}
			if ( $faq ) {
				update_post_meta( $post_id, OctoberMI_Blog_Schema::META_FAQ, $faq );
			}
		}

		if ( ! empty( $gen['hero_image_prompt'] ) ) {
			update_post_meta( $post_id, '_octobermi_hero_prompt', sanitize_text_field( (string) $gen['hero_image_prompt'] ) );
		}

		if ( ! empty( $gen['tags'] ) && is_array( $gen['tags'] ) ) {
			$tags = array_slice( array_filter( array_map( 'sanitize_text_field', $gen['tags'] ) ), 0, 8 );
			if ( $tags ) {
				wp_set_post_tags( $post_id, $tags, false );
			}
		}

		return (int) $post_id;
	}

	/** Pick the byline: the brief's author, else the post's default fallback. */
	private static function resolve_author( array $brief ) {
		if ( ! empty( $brief['author_id'] ) && get_userdata( (int) $brief['author_id'] ) ) {
			return (int) $brief['author_id'];
		}
		$admins = get_users( array( 'role' => 'administrator', 'number' => 1, 'fields' => 'ID' ) );
		return ! empty( $admins ) ? (int) $admins[0] : 0;
	}

	/** Tight, article-only HTML allow-list. */
	private static function sanitize_body( $html ) {
		$allowed = array(
			'h2'         => array( 'id' => true ),
			'h3'         => array( 'id' => true ),
			'p'          => array(),
			'ul'         => array(),
			'ol'         => array(),
			'li'         => array(),
			'strong'     => array(),
			'em'         => array(),
			'a'          => array( 'href' => true, 'title' => true, 'rel' => true ),
			'blockquote' => array( 'cite' => true ),
			'table'      => array(),
			'thead'      => array(),
			'tbody'      => array(),
			'tr'         => array(),
			'th'         => array( 'scope' => true ),
			'td'         => array(),
			'br'         => array(),
		);
		return wp_kses( (string) $html, $allowed );
	}
}
