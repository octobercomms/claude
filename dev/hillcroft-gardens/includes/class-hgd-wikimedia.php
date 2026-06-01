<?php
/**
 * Wikipedia / Wikimedia image fetcher — pulls a freely-licensed lead photo for a
 * plant by its botanical name and sideloads it into the media library.
 *
 * Wikimedia content is free to use (no API key, no cost). We still log a zero-cost
 * usage row for visibility in the cost banner / usage history.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Wikimedia {

	const API_ENDPOINT = 'https://en.wikipedia.org/w/api.php';

	/** A descriptive User-Agent is required by the Wikimedia API etiquette. */
	private static function user_agent() {
		return 'HillcroftGardenDesigner/' . HGD_VERSION . ' (WordPress plugin; ' . home_url( '/' ) . ')';
	}

	/**
	 * Find the lead image URL for a plant by botanical (or common) name.
	 *
	 * @param string $name Botanical name (or common name) to look up.
	 * @return string|WP_Error Image URL on success, WP_Error otherwise.
	 */
	public static function fetch_image_for( $name ) {
		$name = trim( (string) $name );
		if ( '' === $name ) {
			return new WP_Error( 'hgd_wikimedia_no_name', __( 'No name to look up.', 'hillcroft-garden-designer' ) );
		}

		// 1) Direct page-image lookup by title (follows redirects).
		$url = self::page_image_url( $name );
		if ( ! is_wp_error( $url ) ) {
			return $url;
		}

		// 2) Fallback: search for the most relevant page title, then look that up.
		$title = self::search_top_title( $name );
		if ( ! is_wp_error( $title ) && '' !== $title && 0 !== strcasecmp( $title, $name ) ) {
			$url = self::page_image_url( $title );
			if ( ! is_wp_error( $url ) ) {
				return $url;
			}
		}

		return new WP_Error( 'hgd_wikimedia_not_found', __( 'No freely-licensed photo found on Wikipedia for that name.', 'hillcroft-garden-designer' ) );
	}

	/** Query pageimages for one or more titles; return the first usable image URL. */
	private static function page_image_url( $title ) {
		$response = wp_remote_get(
			add_query_arg(
				array(
					'action'      => 'query',
					'format'      => 'json',
					'prop'        => 'pageimages',
					'piprop'      => 'original|thumbnail',
					'pithumbsize' => 800,
					'redirects'   => 1,
					'titles'      => $title,
				),
				self::API_ENDPOINT
			),
			array(
				'timeout' => 20,
				'headers' => array( 'User-Agent' => self::user_agent() ),
			)
		);

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $body ) || empty( $body['query']['pages'] ) || ! is_array( $body['query']['pages'] ) ) {
			return new WP_Error( 'hgd_wikimedia_not_found', __( 'No image found.', 'hillcroft-garden-designer' ) );
		}

		foreach ( $body['query']['pages'] as $page ) {
			if ( ! empty( $page['original']['source'] ) ) {
				return esc_url_raw( $page['original']['source'] );
			}
			if ( ! empty( $page['thumbnail']['source'] ) ) {
				return esc_url_raw( $page['thumbnail']['source'] );
			}
		}

		return new WP_Error( 'hgd_wikimedia_not_found', __( 'No image found.', 'hillcroft-garden-designer' ) );
	}

	/** Search Wikipedia and return the top matching page title (or WP_Error). */
	private static function search_top_title( $name ) {
		$response = wp_remote_get(
			add_query_arg(
				array(
					'action'   => 'query',
					'format'   => 'json',
					'list'     => 'search',
					'srsearch' => $name,
					'srlimit'  => 1,
				),
				self::API_ENDPOINT
			),
			array(
				'timeout' => 20,
				'headers' => array( 'User-Agent' => self::user_agent() ),
			)
		);

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $body ) || empty( $body['query']['search'][0]['title'] ) ) {
			return new WP_Error( 'hgd_wikimedia_not_found', __( 'No matching page found.', 'hillcroft-garden-designer' ) );
		}

		return (string) $body['query']['search'][0]['title'];
	}

	/**
	 * Sideload an image URL into the media library.
	 *
	 * @param string $image_url      Remote image URL.
	 * @param int    $plant_id       Plant id (for cost-log context).
	 * @param string $botanical_name Used as the attachment description / title.
	 * @return int|WP_Error Attachment id on success, WP_Error otherwise.
	 */
	public static function import_to_media( $image_url, $plant_id, $botanical_name ) {
		$image_url = trim( (string) $image_url );
		if ( '' === $image_url ) {
			return new WP_Error( 'hgd_wikimedia_no_url', __( 'No image URL to import.', 'hillcroft-garden-designer' ) );
		}

		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		$description = '' !== trim( (string) $botanical_name )
			? sprintf( __( '%s — photo via Wikipedia', 'hillcroft-garden-designer' ), trim( (string) $botanical_name ) )
			: __( 'Plant photo via Wikipedia', 'hillcroft-garden-designer' );

		$attachment_id = media_sideload_image( $image_url, 0, $description, 'id' );

		if ( is_wp_error( $attachment_id ) ) {
			return $attachment_id;
		}

		// Free content — log a zero-cost usage row for visibility.
		HGD_API_Usage::log( 'wikimedia', 1, 'image', 0, $plant_id ? (int) $plant_id : null, array( 'source' => $image_url ) );

		return (int) $attachment_id;
	}
}
