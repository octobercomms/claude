<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ADF_Tracker {

	public static function log_impression( $campaign_id, $ad_id ) {
		self::insert_record( $campaign_id, $ad_id, 'impression' );
	}

	public static function log_click( $campaign_id, $ad_id ) {
		self::insert_record( $campaign_id, $ad_id, 'click' );
	}

	public static function get_count( $campaign_id, $type ) {
		global $wpdb;
		$table = $wpdb->prefix . 'adf_tracking';
		return (int) $wpdb->get_var( $wpdb->prepare(
			"SELECT COUNT(*) FROM {$table} WHERE campaign_id = %d AND type = %s",
			$campaign_id, $type
		) );
	}

	public static function get_count_for_ad( $ad_id, $type ) {
		global $wpdb;
		$table = $wpdb->prefix . 'adf_tracking';
		return (int) $wpdb->get_var( $wpdb->prepare(
			"SELECT COUNT(*) FROM {$table} WHERE ad_id = %d AND type = %s",
			$ad_id, $type
		) );
	}

	private static function insert_record( $campaign_id, $ad_id, $type ) {
		// Skip bot traffic and WordPress admin/cron requests.
		if ( is_admin() || wp_doing_cron() || wp_doing_ajax() ) {
			return;
		}

		global $wpdb;
		$table = $wpdb->prefix . 'adf_tracking';

		$ip = self::get_client_ip();

		$wpdb->insert( $table, array(
			'campaign_id'      => absint( $campaign_id ),
			'ad_id'            => absint( $ad_id ),
			'type'             => $type,
			'ip_hash'          => $ip ? hash( 'sha256', $ip ) : null,
			'user_agent_hash'  => isset( $_SERVER['HTTP_USER_AGENT'] )
				? hash( 'sha256', sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ) )
				: null,
			'created_at'       => current_time( 'mysql' ),
		) );
	}

	private static function get_client_ip() {
		$headers = array( 'HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP', 'REMOTE_ADDR' );
		foreach ( $headers as $header ) {
			if ( ! empty( $_SERVER[ $header ] ) ) {
				$ip = sanitize_text_field( wp_unslash( $_SERVER[ $header ] ) );
				// X-Forwarded-For may contain a list; take the first.
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
