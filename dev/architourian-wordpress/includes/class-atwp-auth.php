<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ATWP_Auth {

	private static $permission_levels = array(
		'read'  => 1,
		'write' => 2,
		'admin' => 3,
	);

	public static function init() {
		add_action( 'wp_ajax_atwp_generate_key', array( __CLASS__, 'ajax_generate_key' ) );
		add_action( 'wp_ajax_atwp_delete_key', array( __CLASS__, 'ajax_delete_key' ) );
	}

	public static function generate_api_key() {
		return 'atwp_' . bin2hex( random_bytes( 16 ) );
	}

	public static function hash_key( $key ) {
		return hash( 'sha256', $key );
	}

	public static function validate_request( $request ) {
		$key = '';

		$auth_header = $request->get_header( 'X-Architourian-Key' );
		if ( ! empty( $auth_header ) ) {
			$key = sanitize_text_field( $auth_header );
		}

		if ( empty( $key ) ) {
			$bearer = $request->get_header( 'Authorization' );
			if ( ! empty( $bearer ) && 0 === stripos( $bearer, 'Bearer ' ) ) {
				$key = sanitize_text_field( substr( $bearer, 7 ) );
			}
		}

		if ( empty( $key ) ) {
			return new WP_Error(
				'atwp_missing_key',
				__( 'API key is required. Pass it via X-Architourian-Key header or Authorization: Bearer <key>.', 'architourian-wordpress' ),
				array( 'status' => 401 )
			);
		}

		$require_https = get_option( 'atwp_require_https', false );
		if ( $require_https && ! is_ssl() ) {
			return new WP_Error(
				'atwp_https_required',
				__( 'HTTPS is required for API access.', 'architourian-wordpress' ),
				array( 'status' => 403 )
			);
		}

		$ip_allowlist = get_option( 'atwp_ip_allowlist', '' );
		if ( ! empty( $ip_allowlist ) ) {
			$allowed = array_filter( array_map( 'trim', explode( "\n", $ip_allowlist ) ) );
			$client_ip = self::get_client_ip();
			if ( ! empty( $allowed ) && ! in_array( $client_ip, $allowed, true ) ) {
				return new WP_Error(
					'atwp_ip_blocked',
					__( 'Your IP address is not in the allowlist.', 'architourian-wordpress' ),
					array( 'status' => 403 )
				);
			}
		}

		$rate_check = self::check_rate_limit( $key );
		if ( is_wp_error( $rate_check ) ) {
			return $rate_check;
		}

		$key_hash = self::hash_key( $key );
		$keys     = get_option( 'atwp_api_keys', array() );
		$matched  = null;

		foreach ( $keys as &$stored ) {
			if ( hash_equals( $stored['key_hash'], $key_hash ) ) {
				$matched = &$stored;
				break;
			}
		}
		unset( $stored );

		if ( null === $matched ) {
			return new WP_Error(
				'atwp_invalid_key',
				__( 'Invalid API key.', 'architourian-wordpress' ),
				array( 'status' => 401 )
			);
		}

		$matched['last_used_at'] = current_time( 'mysql' );
		update_option( 'atwp_api_keys', $keys );

		$request->set_param( '_atwp_key_id', $matched['id'] );
		$request->set_param( '_atwp_key_permissions', $matched['permissions'] );

		return true;
	}

	public static function check_permission( $request, $required_level ) {
		$auth = self::validate_request( $request );
		if ( is_wp_error( $auth ) ) {
			return $auth;
		}

		$key_level = $request->get_param( '_atwp_key_permissions' );
		if ( ! $key_level ) {
			$key_level = 'read';
		}

		$key_num      = isset( self::$permission_levels[ $key_level ] ) ? self::$permission_levels[ $key_level ] : 0;
		$required_num = isset( self::$permission_levels[ $required_level ] ) ? self::$permission_levels[ $required_level ] : 99;

		if ( $key_num < $required_num ) {
			return new WP_Error(
				'atwp_insufficient_permissions',
				sprintf(
					/* translators: %s: required permission level */
					__( 'This API key requires "%s" permission for this operation.', 'architourian-wordpress' ),
					$required_level
				),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	public static function log_request( $key_id, $endpoint, $method, $summary, $response_code ) {
		global $wpdb;

		$table = $wpdb->prefix . 'atwp_audit_log';

		$wpdb->insert(
			$table,
			array(
				'api_key_id'      => sanitize_text_field( $key_id ),
				'endpoint'        => sanitize_text_field( $endpoint ),
				'method'          => sanitize_text_field( $method ),
				'request_summary' => sanitize_textarea_field( $summary ),
				'response_code'   => intval( $response_code ),
				'ip_address'      => self::get_client_ip(),
				'created_at'      => current_time( 'mysql' ),
			),
			array( '%s', '%s', '%s', '%s', '%d', '%s', '%s' )
		);
	}

	private static function check_rate_limit( $key ) {
		$hash       = substr( self::hash_key( $key ), 0, 16 );
		$transient  = 'atwp_rate_' . $hash;
		$count      = (int) get_transient( $transient );
		$limit      = 60;

		if ( $count >= $limit ) {
			return new WP_Error(
				'atwp_rate_limited',
				__( 'Rate limit exceeded. Maximum 60 requests per minute.', 'architourian-wordpress' ),
				array( 'status' => 429 )
			);
		}

		set_transient( $transient, $count + 1, MINUTE_IN_SECONDS );
		return true;
	}

	private static function get_client_ip() {
		$headers = array( 'HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP', 'REMOTE_ADDR' );
		foreach ( $headers as $header ) {
			if ( ! empty( $_SERVER[ $header ] ) ) {
				$ip = sanitize_text_field( wp_unslash( $_SERVER[ $header ] ) );
				if ( false !== strpos( $ip, ',' ) ) {
					$ip = trim( explode( ',', $ip )[0] );
				}
				if ( filter_var( $ip, FILTER_VALIDATE_IP ) ) {
					return $ip;
				}
			}
		}
		return '0.0.0.0';
	}

	public static function ajax_generate_key() {
		check_ajax_referer( 'atwp_admin_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( __( 'Insufficient permissions.', 'architourian-wordpress' ) );
		}

		$name        = sanitize_text_field( wp_unslash( $_POST['key_name'] ?? '' ) );
		$permissions = sanitize_text_field( wp_unslash( $_POST['key_permissions'] ?? 'read' ) );

		if ( empty( $name ) ) {
			wp_send_json_error( __( 'Key name is required.', 'architourian-wordpress' ) );
		}

		if ( ! isset( self::$permission_levels[ $permissions ] ) ) {
			$permissions = 'read';
		}

		$raw_key  = self::generate_api_key();
		$key_hash = self::hash_key( $raw_key );
		$key_id   = substr( $key_hash, 0, 12 );

		$keys   = get_option( 'atwp_api_keys', array() );
		$keys[] = array(
			'id'          => $key_id,
			'name'        => $name,
			'key_hash'    => $key_hash,
			'permissions' => $permissions,
			'created_at'  => current_time( 'mysql' ),
			'last_used_at' => '',
		);
		update_option( 'atwp_api_keys', $keys );

		wp_send_json_success( array(
			'key'  => $raw_key,
			'id'   => $key_id,
			'name' => $name,
		) );
	}

	public static function ajax_delete_key() {
		check_ajax_referer( 'atwp_admin_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( __( 'Insufficient permissions.', 'architourian-wordpress' ) );
		}

		$key_id = sanitize_text_field( wp_unslash( $_POST['key_id'] ?? '' ) );
		if ( empty( $key_id ) ) {
			wp_send_json_error( __( 'Key ID is required.', 'architourian-wordpress' ) );
		}

		$keys = get_option( 'atwp_api_keys', array() );
		$keys = array_filter( $keys, function( $k ) use ( $key_id ) {
			return $k['id'] !== $key_id;
		} );
		update_option( 'atwp_api_keys', array_values( $keys ) );

		wp_send_json_success();
	}
}
