<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCAD_Tracker {

	public static function log_impression( $campaign_id, $ad_id, $source_url = '' ) {
		self::insert_record( $campaign_id, $ad_id, 'impression', $source_url );
	}

	public static function log_click( $campaign_id, $ad_id, $source_url = '' ) {
		self::insert_record( $campaign_id, $ad_id, 'click', $source_url );
	}

	public static function get_count( $campaign_id, $type ) {
		global $wpdb;
		$table = $wpdb->prefix . 'ocad_tracking';
		return (int) $wpdb->get_var( $wpdb->prepare(
			"SELECT COUNT(*) FROM {$table} WHERE campaign_id = %d AND type = %s",
			$campaign_id, $type
		) );
	}

	public static function get_count_for_ad( $ad_id, $type ) {
		global $wpdb;
		$table = $wpdb->prefix . 'ocad_tracking';
		return (int) $wpdb->get_var( $wpdb->prepare(
			"SELECT COUNT(*) FROM {$table} WHERE ad_id = %d AND type = %s",
			$ad_id, $type
		) );
	}

	// Returns rows: source_url, cnt — grouped by domain for report.
	public static function get_impressions_by_source( $campaign_id ) {
		global $wpdb;
		$table = $wpdb->prefix . 'ocad_tracking';
		return $wpdb->get_results( $wpdb->prepare(
			"SELECT source_url, COUNT(*) as cnt
			 FROM {$table}
			 WHERE campaign_id = %d AND type = 'impression' AND source_url IS NOT NULL AND source_url != ''
			 GROUP BY source_url
			 ORDER BY cnt DESC
			 LIMIT 200",
			$campaign_id
		) );
	}

	// Returns rows: source_url, cnt — for clicks by page.
	public static function get_clicks_by_source( $campaign_id ) {
		global $wpdb;
		$table = $wpdb->prefix . 'ocad_tracking';
		return $wpdb->get_results( $wpdb->prepare(
			"SELECT source_url, COUNT(*) as cnt
			 FROM {$table}
			 WHERE campaign_id = %d AND type = 'click' AND source_url IS NOT NULL AND source_url != ''
			 GROUP BY source_url
			 ORDER BY cnt DESC
			 LIMIT 200",
			$campaign_id
		) );
	}

	// Returns the earliest and latest tracking dates for a campaign.
	public static function get_date_range( $campaign_id ) {
		global $wpdb;
		$table = $wpdb->prefix . 'ocad_tracking';
		return $wpdb->get_row( $wpdb->prepare(
			"SELECT MIN(created_at) as first_at, MAX(created_at) as last_at
			 FROM {$table} WHERE campaign_id = %d",
			$campaign_id
		) );
	}

	private static function insert_record( $campaign_id, $ad_id, $type, $source_url = '' ) {
		if ( is_admin() || wp_doing_cron() || wp_doing_ajax() ) {
			return;
		}

		global $wpdb;
		$table = $wpdb->prefix . 'ocad_tracking';

		$ip = self::get_client_ip();

		$wpdb->insert( $table, array(
			'campaign_id'     => absint( $campaign_id ),
			'ad_id'           => absint( $ad_id ),
			'type'            => $type,
			'ip_hash'         => $ip ? hash( 'sha256', $ip ) : null,
			'user_agent_hash' => isset( $_SERVER['HTTP_USER_AGENT'] )
				? hash( 'sha256', sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ) )
				: null,
			'source_url'      => $source_url ? esc_url_raw( substr( $source_url, 0, 500 ) ) : null,
			'created_at'      => current_time( 'mysql' ),
		) );
	}

	private static function get_client_ip() {
		$headers = array( 'HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP', 'REMOTE_ADDR' );
		foreach ( $headers as $header ) {
			if ( ! empty( $_SERVER[ $header ] ) ) {
				$ip = sanitize_text_field( wp_unslash( $_SERVER[ $header ] ) );
				$ip = explode( ',', $ip )[0];
				$ip = trim( $ip );
				if ( filter_var( $ip, FILTER_VALIDATE_IP ) ) {
					return $ip;
				}
			}
		}
		return null;
	}
}
