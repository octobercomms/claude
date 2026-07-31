<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCF_Submission {

	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'ocf_submissions';
	}

	public static function uploads_table() {
		global $wpdb;
		return $wpdb->prefix . 'ocf_uploads';
	}

	public static function events_table() {
		global $wpdb;
		return $wpdb->prefix . 'ocf_events';
	}

	public static function find_by_token( $token ) {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::table() . ' WHERE token = %s LIMIT 1', $token ), ARRAY_A );
		return $row ?: null;
	}

	public static function find( $id ) {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::table() . ' WHERE id = %d LIMIT 1', $id ), ARRAY_A );
		return $row ?: null;
	}

	public static function create( $form_id, $session_hash = '' ) {
		global $wpdb;
		$now   = current_time( 'mysql' );
		$token = wp_generate_password( 32, false, false );
		$wpdb->insert( self::table(), array(
			'form_id'      => $form_id,
			'token'        => $token,
			'status'       => 'partial',
			'payload'      => wp_json_encode( array() ),
			'meta'         => wp_json_encode( array() ),
			'ip_address'   => self::client_ip(),
			'user_agent'   => substr( $_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255 ),
			'referrer'     => esc_url_raw( $_SERVER['HTTP_REFERER'] ?? '' ),
			'session_hash' => substr( preg_replace( '/[^a-zA-Z0-9_-]/', '', (string) $session_hash ), 0, 64 ),
			'created_at'   => $now,
			'updated_at'   => $now,
		) );
		return self::find( $wpdb->insert_id );
	}

	public static function update_payload( $submission_id, $answers, $email = null ) {
		global $wpdb;
		$update = array(
			'payload'    => wp_json_encode( $answers ),
			'updated_at' => current_time( 'mysql' ),
		);
		if ( $email ) {
			$update['email'] = sanitize_email( $email );
		}
		$wpdb->update( self::table(), $update, array( 'id' => $submission_id ) );
	}

	/**
	 * Read the JSON `meta` blob for a submission (AI transcript, collected
	 * state, etc.). Always returns an array.
	 */
	public static function get_meta( $submission_id ) {
		$row = self::find( $submission_id );
		if ( ! $row ) {
			return array();
		}
		$meta = json_decode( (string) ( $row['meta'] ?? '' ), true );
		return is_array( $meta ) ? $meta : array();
	}

	/**
	 * Overwrite the JSON `meta` blob for a submission.
	 */
	public static function save_meta( $submission_id, $meta ) {
		global $wpdb;
		$wpdb->update( self::table(), array(
			'meta'       => wp_json_encode( is_array( $meta ) ? $meta : array() ),
			'updated_at' => current_time( 'mysql' ),
		), array( 'id' => $submission_id ) );
	}

	public static function mark_complete( $submission_id ) {
		global $wpdb;
		$wpdb->update( self::table(), array(
			'status'       => 'complete',
			'completed_at' => current_time( 'mysql' ),
			'updated_at'   => current_time( 'mysql' ),
		), array( 'id' => $submission_id ) );
	}

	public static function list_for_form( $form_id, $args = array() ) {
		global $wpdb;
		$args   = wp_parse_args( $args, array( 'status' => '', 'limit' => 50, 'offset' => 0 ) );
		$where  = $wpdb->prepare( 'form_id = %d', $form_id );
		if ( $args['status'] ) {
			$where .= $wpdb->prepare( ' AND status = %s', $args['status'] );
		}
		$sql = 'SELECT * FROM ' . self::table() . " WHERE {$where} ORDER BY id DESC LIMIT %d OFFSET %d";
		return $wpdb->get_results( $wpdb->prepare( $sql, $args['limit'], $args['offset'] ), ARRAY_A );
	}

	public static function count_for_form( $form_id, $status = '' ) {
		global $wpdb;
		if ( $status ) {
			return (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::table() . ' WHERE form_id = %d AND status = %s', $form_id, $status ) );
		}
		return (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::table() . ' WHERE form_id = %d', $form_id ) );
	}

	public static function uploads_for( $submission_id ) {
		global $wpdb;
		return $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::uploads_table() . ' WHERE submission_id = %d ORDER BY id ASC', $submission_id ), ARRAY_A );
	}

	public static function record_upload( $submission_id, $question_id, $file_info ) {
		global $wpdb;
		$wpdb->insert( self::uploads_table(), array(
			'submission_id' => $submission_id,
			'question_id'   => $question_id,
			'filename'      => $file_info['filename'],
			'original_name' => $file_info['original_name'],
			'mime_type'     => $file_info['mime_type'],
			'size_bytes'    => $file_info['size_bytes'],
			'path'          => $file_info['path'],
			'url'           => $file_info['url'],
			'created_at'    => current_time( 'mysql' ),
		) );
		return $wpdb->insert_id;
	}

	public static function client_ip() {
		$candidates = array( 'HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR' );
		foreach ( $candidates as $key ) {
			if ( ! empty( $_SERVER[ $key ] ) ) {
				$ip = trim( explode( ',', $_SERVER[ $key ] )[0] );
				if ( filter_var( $ip, FILTER_VALIDATE_IP ) ) {
					return $ip;
				}
			}
		}
		return '';
	}

	public static function record_event( $submission_id, $type, $payload, $status = 'pending' ) {
		global $wpdb;
		$now = current_time( 'mysql' );
		$wpdb->insert( self::events_table(), array(
			'submission_id'   => $submission_id,
			'event_type'      => $type,
			'status'          => $status,
			'payload'         => wp_json_encode( $payload ),
			'attempts'        => 0,
			'next_attempt_at' => $now,
			'created_at'      => $now,
			'updated_at'      => $now,
		) );
		return $wpdb->insert_id;
	}

	public static function update_event( $event_id, $status, $response, $attempts ) {
		global $wpdb;
		$next = current_time( 'mysql' );
		if ( $status === 'pending' ) {
			$delay = min( 3600, 60 * pow( 2, $attempts ) );
			$next  = gmdate( 'Y-m-d H:i:s', time() + $delay );
		}
		$wpdb->update( self::events_table(), array(
			'status'          => $status,
			'response'        => is_array( $response ) ? wp_json_encode( $response ) : (string) $response,
			'attempts'        => $attempts,
			'next_attempt_at' => $next,
			'updated_at'      => current_time( 'mysql' ),
		), array( 'id' => $event_id ) );
	}

	public static function pending_events( $limit = 25 ) {
		global $wpdb;
		return $wpdb->get_results( $wpdb->prepare(
			'SELECT * FROM ' . self::events_table() . " WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= %s) ORDER BY id ASC LIMIT %d",
			current_time( 'mysql' ),
			$limit
		), ARRAY_A );
	}

	/**
	 * Delete a submission and everything attached to it: uploaded files
	 * on disk, upload rows, queued/retried events, and the submission
	 * row itself. Returns true if the submission row existed.
	 */
	public static function delete( $submission_id ) {
		global $wpdb;
		$submission_id = (int) $submission_id;
		if ( ! $submission_id ) { return false; }
		$row = self::find( $submission_id );
		if ( ! $row ) { return false; }

		// Delete each uploaded file from disk.
		$uploads = self::uploads_for( $submission_id );
		foreach ( $uploads as $u ) {
			if ( ! empty( $u['path'] ) && file_exists( $u['path'] ) ) {
				@unlink( $u['path'] );
			}
		}
		// Best-effort: remove the per-submission upload folder.
		$upload = wp_upload_dir();
		$dir    = trailingslashit( $upload['basedir'] ) . 'ocf/' . (int) $row['form_id'] . '/' . $submission_id;
		if ( is_dir( $dir ) ) {
			@rmdir( $dir );
		}

		$wpdb->delete( self::uploads_table(), array( 'submission_id' => $submission_id ) );
		$wpdb->delete( self::events_table(),  array( 'submission_id' => $submission_id ) );
		$wpdb->delete( self::table(),         array( 'id'            => $submission_id ) );
		return true;
	}
}
