<?php
/**
 * Partner-mode shortcode: fetches ads from the hub site via REST API.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCAD_Partner {

	private static function get_hub_url() {
		return trailingslashit( get_option( 'ocad_hub_url', '' ) );
	}

	private static function get_api_key() {
		return get_option( 'ocad_hub_api_key', '' );
	}

	public static function render_ad( $format, $source_url = '' ) {
		if ( ! array_key_exists( $format, OCAD_FORMATS ) ) {
			return '';
		}

		$hub_url = self::get_hub_url();
		$api_key = self::get_api_key();

		if ( ! $hub_url || ! $api_key ) {
			return '';
		}

		// Cache per-format for 5 minutes to avoid hammering the hub.
		$cache_key = 'ocad_partner_ad_' . $format;
		$ad        = get_transient( $cache_key );

		if ( false === $ad ) {
			$api_url = $hub_url . 'wp-json/ocad/v1/ad?format=' . rawurlencode( $format );
			if ( $source_url ) {
				$api_url .= '&source=' . rawurlencode( $source_url );
			}

			$response = wp_remote_get( $api_url, array(
				'headers' => array( 'X-OCAD-API-Key' => $api_key ),
				'timeout' => 5,
			) );

			if ( is_wp_error( $response ) || wp_remote_retrieve_response_code( $response ) !== 200 ) {
				set_transient( $cache_key, 'none', 60 );
				return '';
			}

			$body = json_decode( wp_remote_retrieve_body( $response ), true );
			if ( empty( $body['ad_id'] ) ) {
				set_transient( $cache_key, 'none', 60 );
				return '';
			}

			$ad = $body;
			set_transient( $cache_key, $ad, 5 * MINUTE_IN_SECONDS );
		}

		if ( 'none' === $ad || empty( $ad['ad_id'] ) ) {
			return '';
		}

		$fmt = OCAD_FORMATS[ $format ];

		// Append the partner page URL so the hub can record it when the click redirect fires.
		$click_url = $ad['click_url'];
		if ( $source_url ) {
			$click_url .= ( strpos( $click_url, '?' ) !== false ? '&' : '?' )
				. 'page=' . rawurlencode( $source_url );
		}

		// Note: %% is required to produce a literal % inside sprintf.
		return sprintf(
			'<div class="ocad-ad ocad-ad--%1$s" style="display:inline-block;max-width:%2$dpx;">'
			. '<a href="%3$s" target="_blank" rel="noopener noreferrer nofollow">'
			. '<img src="%4$s" alt="%5$s" width="%2$d" height="%6$d" loading="lazy" style="display:block;max-width:100%%;height:auto;" />'
			. '</a></div>',
			esc_attr( $format ),
			(int) $fmt['width'],
			esc_url( $click_url ),
			esc_url( $ad['image_url'] ),
			esc_attr( $ad['alt_text'] ),
			(int) $fmt['height']
		);
	}
}
