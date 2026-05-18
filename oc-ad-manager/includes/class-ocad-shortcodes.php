<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCAD_Shortcodes {

	public function register() {
		add_shortcode( 'oc_ad', array( $this, 'render_ad' ) );
		add_shortcode( 'oc_ad_debug', array( $this, 'render_debug' ) );
	}

	/**
	 * Usage: [oc_ad format="mpu"]
	 *        [oc_ad format="leaderboard"]
	 *        [oc_ad format="skyscraper"]
	 */
	public function render_ad( $atts ) {
		try {
			return $this->do_render_ad( $atts );
		} catch ( \Throwable $e ) {
			if ( current_user_can( 'manage_options' ) ) {
				return '<!-- OC Ad Manager error: ' . esc_html( $e->getMessage() ) . ' -->';
			}
			return '';
		}
	}

	private function do_render_ad( $atts ) {
		$atts = shortcode_atts( array(
			'format' => 'mpu',
			'class'  => '',
		), $atts, 'oc_ad' );

		$format = sanitize_key( $atts['format'] );

		if ( ! array_key_exists( $format, OCAD_FORMATS ) ) {
			return '';
		}

		// Partner mode: delegate entirely to hub via REST API.
		if ( get_option( 'ocad_site_mode', 'hub' ) === 'partner' ) {
			return OCAD_Partner::render_ad( $format );
		}

		$ad = OCAD_Campaign::get_active_ad_for_format( $format );
		if ( ! $ad ) {
			return '';
		}

		OCAD_Tracker::log_impression( $ad->campaign_id, $ad->ad_id );

		$fmt        = OCAD_FORMATS[ $format ];
		$click_url  = add_query_arg( 'ocad_click', $ad->ad_id, home_url( '/' ) );
		$extra_class = $atts['class'] ? ' ' . esc_attr( $atts['class'] ) : '';

		return sprintf(
			'<div class="ocad-ad ocad-ad--%1$s%5$s" style="display:inline-block;max-width:%2$dpx;">'
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

	/**
	 * Admin-only diagnostic shortcode. Use [oc_ad_debug format="mpu"] on any page.
	 * Only visible when logged in as an administrator.
	 */
	public function render_debug( $atts ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			return '';
		}

		$atts   = shortcode_atts( array( 'format' => 'mpu' ), $atts );
		$format = sanitize_key( $atts['format'] );

		global $wpdb;
		$ct = $wpdb->prefix . 'ocad_campaigns';
		$at = $wpdb->prefix . 'ocad_ads';
		$tt = $wpdb->prefix . 'ocad_tracking';

		$rows = array();

		// Table existence.
		$rows[] = array( 'Campaigns table', $wpdb->get_var( "SHOW TABLES LIKE '{$ct}'" ) ? '✓ exists' : '✗ MISSING' );
		$rows[] = array( 'Ads table',       $wpdb->get_var( "SHOW TABLES LIKE '{$at}'" ) ? '✓ exists' : '✗ MISSING' );
		$rows[] = array( 'Tracking table',  $wpdb->get_var( "SHOW TABLES LIKE '{$tt}'" ) ? '✓ exists' : '✗ MISSING' );

		// Campaign counts.
		$rows[] = array( 'Total campaigns',  (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$ct}" ) );
		$rows[] = array( 'Active campaigns', (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$ct} WHERE status='active'" ) );

		// Ad counts.
		$rows[] = array( "Ads with format='{$format}'", (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$at} WHERE format=%s", $format ) ) );

		// Date filter check.
		$today = current_time( 'Y-m-d' );
		$rows[] = array( 'current_time (Y-m-d)', $today );
		$in_range = (int) $wpdb->get_var( $wpdb->prepare(
			"SELECT COUNT(*) FROM {$ct} WHERE status='active'
			AND (start_date IS NULL OR start_date <= %s)
			AND (end_date IS NULL OR end_date >= %s)",
			$today, $today
		) );
		$rows[] = array( 'Active campaigns in date range', $in_range );

		// Full rotation query result.
		$ad = OCAD_Campaign::get_active_ad_for_format( $format );
		if ( $ad ) {
			$rows[] = array( 'Rotation result', '✓ Ad found — image: ' . esc_html( $ad->image_url ) );
		} else {
			$rows[] = array( 'Rotation result', '✗ NULL — no eligible ad returned' );
			if ( $wpdb->last_error ) {
				$rows[] = array( 'DB last_error', esc_html( $wpdb->last_error ) );
			}
		}

		// Site mode.
		$rows[] = array( 'Site mode', esc_html( get_option( 'ocad_site_mode', 'hub' ) ) );

		$out = '<div style="background:#fff3cd;border:2px solid #ffc107;padding:12px 16px;margin:10px 0;font-family:monospace;font-size:12px;line-height:1.7;">';
		$out .= '<strong style="font-size:13px;">OC Ad Manager — Debug: format="' . esc_html( $format ) . '"</strong><br><br>';
		$out .= '<table style="border-collapse:collapse;width:100%;">';
		foreach ( $rows as $row ) {
			$out .= '<tr><td style="padding:2px 12px 2px 0;color:#555;white-space:nowrap;">' . esc_html( $row[0] ) . '</td>';
			$out .= '<td style="padding:2px 0;"><strong>' . $row[1] . '</strong></td></tr>';
		}
		$out .= '</table>';
		$out .= '<br><em>Remove this shortcode once the issue is resolved.</em>';
		$out .= '</div>';

		return $out;
	}
}
