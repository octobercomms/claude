<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ADF_Shortcodes {

	public function register() {
		add_shortcode( 'adf_ad', array( $this, 'render_ad' ) );
	}

	/**
	 * Usage: [adf_ad format="mpu"]
	 *        [adf_ad format="leaderboard"]
	 *        [adf_ad format="skyscraper"]
	 */
	public function render_ad( $atts ) {
		$atts = shortcode_atts( array(
			'format' => 'mpu',
			'class'  => '',
		), $atts, 'adf_ad' );

		$format = sanitize_key( $atts['format'] );

		if ( ! array_key_exists( $format, ADF_FORMATS ) ) {
			return '';
		}

		// Partner mode: delegate entirely to hub via REST API.
		if ( get_option( 'adf_site_mode', 'hub' ) === 'partner' ) {
			return ADF_Partner::render_ad( $format );
		}

		$ad = ADF_Campaign::get_active_ad_for_format( $format );
		if ( ! $ad ) {
			return '';
		}

		// Log the impression server-side.
		ADF_Tracker::log_impression( $ad->campaign_id, $ad->ad_id );

		$fmt        = ADF_FORMATS[ $format ];
		$click_url  = add_query_arg( 'adf_click', $ad->ad_id, home_url( '/' ) );
		$extra_class = $atts['class'] ? ' ' . esc_attr( $atts['class'] ) : '';

		return sprintf(
			'<div class="adf-ad adf-ad--%1$s%5$s" style="display:inline-block;max-width:%2$dpx;">'
			. '<a href="%3$s" target="_blank" rel="noopener noreferrer nofollow">'
			. '<img src="%4$s" alt="%6$s" width="%2$d" height="%7$d" loading="lazy" style="display:block;max-width:100%;height:auto;" />'
			. '</a></div>',
			esc_attr( $format ),         // 1
			(int) $fmt['width'],         // 2
			esc_url( $click_url ),        // 3
			esc_url( $ad->image_url ),    // 4
			$extra_class,                // 5
			esc_attr( $ad->alt_text ?: $fmt['label'] . ' advertisement' ), // 6
			(int) $fmt['height']         // 7
		);
	}
}
