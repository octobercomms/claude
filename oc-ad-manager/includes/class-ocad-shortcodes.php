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

		$format   = sanitize_key( $atts['format'] );
		$is_admin = current_user_can( 'manage_options' );

		if ( ! array_key_exists( $format, OCAD_FORMATS ) ) {
			return $is_admin ? "<!-- OCAD[$format]: unknown format -->" : '';
		}

		// Output a placeholder div for both hub and partner modes.
		// The frontend JS fetches the real ad via /wp-json/ocad/v1/render at runtime,
		// bypassing any page-level cache on either site.
		$fmt         = OCAD_FORMATS[ $format ];
		$extra_class = $atts['class'] ? ' ' . esc_attr( $atts['class'] ) : '';

		return sprintf(
			'<div class="ocad-ad ocad-ad--%1$s ocad-ad-slot%3$s" data-format="%1$s" '
			. 'style="display:inline-block;max-width:%2$dpx;min-height:%4$dpx;"></div>',
			esc_attr( $format ),   // 1
			(int) $fmt['width'],   // 2
			$extra_class,          // 3
			(int) $fmt['height']   // 4
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
		$mode = get_option( 'ocad_site_mode', 'hub' );
		$rows[] = array( 'Site mode', esc_html( $mode ) );

		// Partner-mode connectivity check.
		if ( $mode === 'partner' ) {
			$hub_url = get_option( 'ocad_hub_url', '' );
			$api_key = get_option( 'ocad_hub_api_key', '' );
			$rows[] = array( 'Hub URL', $hub_url ? esc_html( $hub_url ) : '✗ NOT SET' );
			$rows[] = array( 'API key', $api_key ? '✓ set (' . strlen( $api_key ) . ' chars)' : '✗ NOT SET' );

			if ( $hub_url && $api_key ) {
				$test = wp_remote_get(
					trailingslashit( $hub_url ) . 'wp-json/ocad/v1/ad?format=' . rawurlencode( $format ),
					array( 'headers' => array( 'X-OCAD-API-Key' => $api_key ), 'timeout' => 8 )
				);
				if ( is_wp_error( $test ) ) {
					$rows[] = array( 'Hub connection', '✗ WP_Error: ' . esc_html( $test->get_error_message() ) );
				} else {
					$code = wp_remote_retrieve_response_code( $test );
					$body = json_decode( wp_remote_retrieve_body( $test ), true );
					if ( $code === 200 && ! empty( $body['ad_id'] ) ) {
						$rows[] = array( 'Hub connection', '✓ OK — ad_id=' . (int) $body['ad_id'] );
					} elseif ( $code === 404 ) {
						$rows[] = array( 'Hub connection', '✓ Reachable — no active ad for this format on hub' );
					} else {
						$rows[] = array( 'Hub connection', '✗ HTTP ' . $code . ' — ' . esc_html( wp_remote_retrieve_body( $test ) ) );
					}
				}
			}
		}

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
