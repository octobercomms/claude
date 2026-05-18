<?php
/**
 * Partner-mode shortcode: fetches ads from the hub site via REST API.
 * Impressions are also reported back to the hub so all stats stay centralised.
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

	public static function render_ad( $format ) {
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
			$response = wp_remote_get( $hub_url . 'wp-json/ocad/v1/ad?format=' . rawurlencode( $format ), array(
				'headers' => array( 'X-OCAD-API-Key' => $api_key ),
				'timeout' => 5,
			) );

			if ( is_wp_error( $response ) || wp_remote_retrieve_response_code( $response ) !== 200 ) {
				// Cache negative result for 60 s to avoid hammering a failing hub.
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

		// Report impression back to the hub asynchronously (non-blocking).
		if ( ! empty( $ad['impression_url'] ) ) {
			$visitor_ip = sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ?? '' ) );
			wp_remote_post( $ad['impression_url'], array(
				'blocking' => false,
				'timeout'  => 3,
				'headers'  => array(
					'X-OCAD-API-Key'  => $api_key,
					'X-Forwarded-IP' => $visitor_ip,
					'Content-Type'   => 'application/json',
				),
				'body' => wp_json_encode( array(
					'ad_id'      => $ad['ad_id'],
					'campaign_id'=> $ad['campaign_id'],
				) ),
			) );
		}

		$fmt = OCAD_FORMATS[ $format ];

		return sprintf(
			'<div class="ocad-ad ocad-ad--%1$s" style="display:inline-block;max-width:%2$dpx;">'
			. '<a href="%3$s" target="_blank" rel="noopener noreferrer nofollow">'
			. '<img src="%4$s" alt="%5$s" width="%2$d" height="%6$d" loading="lazy" style="display:block;max-width:100%;height:auto;" />'
			. '</a></div>',
			esc_attr( $format ),
			(int) $fmt['width'],
			esc_url( $ad['click_url'] ),
			esc_url( $ad['image_url'] ),
			esc_attr( $ad['alt_text'] ),
			(int) $fmt['height']
		);
	}
}
