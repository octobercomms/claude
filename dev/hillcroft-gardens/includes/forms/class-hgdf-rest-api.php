<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGDF_REST_API {

	const NAMESPACE = 'hgd-forms/v1';

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
	}

	public static function register_routes() {
		register_rest_route( self::NAMESPACE, '/view', array(
			'methods'             => 'POST',
			'permission_callback' => '__return_true',
			'callback'            => array( __CLASS__, 'view' ),
		) );
		register_rest_route( self::NAMESPACE, '/start', array(
			'methods'             => 'POST',
			'permission_callback' => '__return_true',
			'callback'            => array( __CLASS__, 'start' ),
		) );
		register_rest_route( self::NAMESPACE, '/save', array(
			'methods'             => 'POST',
			'permission_callback' => '__return_true',
			'callback'            => array( __CLASS__, 'save' ),
		) );
		register_rest_route( self::NAMESPACE, '/upload', array(
			'methods'             => 'POST',
			'permission_callback' => '__return_true',
			'callback'            => array( __CLASS__, 'upload' ),
		) );
		register_rest_route( self::NAMESPACE, '/submit', array(
			'methods'             => 'POST',
			'permission_callback' => '__return_true',
			'callback'            => array( __CLASS__, 'submit' ),
		) );
	}

	public static function view( WP_REST_Request $req ) {
		$form_id = self::get_form_or_error( $req->get_param( 'form_id' ) );
		if ( is_wp_error( $form_id ) ) { return $form_id; }
		$session = HGDF_Schema::clean_id( $req->get_param( 'session' ) );
		if ( ! $session ) {
			$session = HGDF_Analytics::visitor_session();
		}
		$id = HGDF_Analytics::record_view( $form_id, $session );
		return rest_ensure_response( array( 'ok' => true, 'view_id' => $id, 'session' => $session ) );
	}

	private static function get_form_or_error( $form_id ) {
		$form_id = absint( $form_id );
		if ( ! $form_id || ! HGDF_CPT::exists( $form_id ) ) {
			return new WP_Error( 'hgd_form_not_found', 'Form not found', array( 'status' => 404 ) );
		}
		if ( get_post_status( $form_id ) !== 'publish' ) {
			return new WP_Error( 'hgd_form_unpublished', 'Form not published', array( 'status' => 404 ) );
		}
		return $form_id;
	}

	public static function start( WP_REST_Request $req ) {
		$form_id = self::get_form_or_error( $req->get_param( 'form_id' ) );
		if ( is_wp_error( $form_id ) ) { return $form_id; }
		// Throttle submission-row creation per IP+form (storage/DB exhaustion).
		if ( ! HGDF_Spam::rate_limit_ok( $form_id . ':start', 15, 600 ) ) {
			return new WP_Error( 'hgd_form_rate_limited', 'Too many submissions', array( 'status' => 429 ) );
		}
		$session = HGDF_Schema::clean_id( $req->get_param( 'session' ) );
		if ( ! $session ) {
			$session = HGDF_Analytics::visitor_session();
		}
		$row = HGDF_Submission::create( $form_id, $session );
		HGDF_Analytics::link_view_to_submission( $session, $form_id, (int) $row['id'] );
		return rest_ensure_response( array(
			'token'   => $row['token'],
			'id'      => (int) $row['id'],
			'session' => $session,
		) );
	}

	public static function save( WP_REST_Request $req ) {
		$token = sanitize_text_field( $req->get_param( 'token' ) );
		$row   = HGDF_Submission::find_by_token( $token );
		if ( ! $row ) {
			return new WP_Error( 'hgd_form_invalid_token', 'Invalid submission token', array( 'status' => 400 ) );
		}
		if ( $row['status'] === 'complete' ) {
			return rest_ensure_response( array( 'ok' => true, 'already_complete' => true ) );
		}
		$answers = self::sanitize_answers( $req->get_param( 'answers' ), (int) $row['form_id'] );
		$email   = self::extract_email( $answers );
		HGDF_Submission::update_payload( (int) $row['id'], $answers, $email );

		// Track progression.
		$step_reached   = max( 0, (int) $req->get_param( 'step_reached' ) );
		$seconds_active = max( 0, min( 86400, (int) $req->get_param( 'seconds_active' ) ) );
		HGDF_Analytics::update_progress( (int) $row['id'], $step_reached, $seconds_active );

		return rest_ensure_response( array( 'ok' => true ) );
	}

	public static function upload( WP_REST_Request $req ) {
		$token = sanitize_text_field( $req->get_param( 'token' ) );
		$row   = HGDF_Submission::find_by_token( $token );
		if ( ! $row ) {
			return new WP_Error( 'hgd_form_invalid_token', 'Invalid submission token', array( 'status' => 400 ) );
		}
		// Throttle uploads per IP+form — each stores a file (≤max_size_mb), so an
		// unthrottled loop is a disk-exhaustion vector.
		if ( ! HGDF_Spam::rate_limit_ok( (int) $row['form_id'] . ':upload', 40, 600 ) ) {
			return new WP_Error( 'hgd_form_rate_limited', 'Too many uploads', array( 'status' => 429 ) );
		}
		$question_id = HGDF_Schema::clean_id( $req->get_param( 'question_id' ) );
		if ( ! $question_id ) {
			return new WP_Error( 'hgd_form_no_question', 'Missing question id', array( 'status' => 400 ) );
		}
		$schema   = HGDF_Schema::get( (int) $row['form_id'] );
		$question = HGDF_Schema::find_question( $schema, $question_id );
		if ( ! $question || $question['type'] !== 'file_upload' ) {
			return new WP_Error( 'hgd_form_bad_question', 'Question does not accept uploads', array( 'status' => 400 ) );
		}

		$files = $req->get_file_params();
		if ( empty( $files['file'] ) ) {
			return new WP_Error( 'hgd_form_no_file', 'No file uploaded', array( 'status' => 400 ) );
		}
		$file = $files['file'];
		if ( ! empty( $file['error'] ) ) {
			return new WP_Error( 'hgd_form_upload_error', 'Upload error: ' . (int) $file['error'], array( 'status' => 400 ) );
		}

		$max_mb = ! empty( $question['max_size_mb'] ) ? (int) $question['max_size_mb'] : 20;
		if ( (int) $file['size'] > $max_mb * 1024 * 1024 ) {
			return new WP_Error( 'hgd_form_too_large', 'File exceeds ' . $max_mb . 'MB', array( 'status' => 413 ) );
		}

		$allowed = ! empty( $question['accept'] ) ? array_map( 'trim', explode( ',', $question['accept'] ) ) : array();
		$ext     = strtolower( pathinfo( $file['name'], PATHINFO_EXTENSION ) );
		$mime    = self::detect_mime( $file['tmp_name'], $file['type'] );
		if ( $allowed && ! self::mime_allowed( $mime, $ext, $allowed ) ) {
			return new WP_Error( 'hgd_form_bad_type', 'File type not allowed', array( 'status' => 415 ) );
		}

		$base = self::ensure_submission_dir( (int) $row['form_id'], (int) $row['id'] );
		$safe_name = wp_unique_filename( $base['path'], wp_generate_password( 16, false, false ) . '.' . preg_replace( '/[^a-z0-9]/i', '', $ext ) );
		$dest = trailingslashit( $base['path'] ) . $safe_name;
		if ( ! move_uploaded_file( $file['tmp_name'], $dest ) ) {
			return new WP_Error( 'hgd_form_move_failed', 'Could not save file', array( 'status' => 500 ) );
		}
		@chmod( $dest, 0644 );

		$id = HGDF_Submission::record_upload( (int) $row['id'], $question_id, array(
			'filename'      => $safe_name,
			'original_name' => sanitize_file_name( $file['name'] ),
			'mime_type'     => $mime,
			'size_bytes'    => (int) $file['size'],
			'path'          => $dest,
			'url'           => trailingslashit( $base['url'] ) . $safe_name,
		) );

		return rest_ensure_response( array(
			'ok'    => true,
			'id'    => $id,
			'url'   => trailingslashit( $base['url'] ) . $safe_name,
			'name'  => sanitize_file_name( $file['name'] ),
			'size'  => (int) $file['size'],
		) );
	}

	public static function submit( WP_REST_Request $req ) {
		$token = sanitize_text_field( $req->get_param( 'token' ) );
		$row   = HGDF_Submission::find_by_token( $token );
		if ( ! $row ) {
			return new WP_Error( 'hgd_form_invalid_token', 'Invalid submission token', array( 'status' => 400 ) );
		}
		if ( $row['status'] === 'complete' ) {
			$schema_complete = HGDF_Schema::get( (int) $row['form_id'] );
			return rest_ensure_response( array(
				'ok'               => true,
				'already_complete' => true,
				'ending'           => self::shape_ending( $schema_complete['endings']['default'] ?? array() ),
			) );
		}
		$form_id = (int) $row['form_id'];
		$schema  = HGDF_Schema::get( $form_id );

		// Spam guards.
		if ( ! HGDF_Spam::rate_limit_ok( $form_id, $schema['spam']['rate_limit'] ?? 5 ) ) {
			return new WP_Error( 'hgd_form_rate_limited', 'Too many submissions', array( 'status' => 429 ) );
		}
		if ( ! empty( $schema['spam']['honeypot'] ) && ! HGDF_Spam::honeypot_ok( $req->get_params() ) ) {
			// Pretend success so bots don't probe.
			HGDF_Submission::mark_complete( (int) $row['id'] );
			return rest_ensure_response( array( 'ok' => true, 'ending' => 'default' ) );
		}
		if ( ! empty( $schema['spam']['turnstile'] ) && HGDF_Spam::turnstile_enabled() ) {
			$verify = HGDF_Spam::verify_turnstile( $req->get_param( 'turnstile_token' ) );
			if ( ! $verify['ok'] ) {
				return new WP_Error( 'hgd_form_turnstile', $verify['error'], array( 'status' => 400 ) );
			}
		}

		$answers = self::sanitize_answers( $req->get_param( 'answers' ), $form_id );
		$answers = HGDF_Logic::filter_visible( $schema, $answers );

		// Required-field check on visible questions.
		foreach ( $schema['steps'] as $step ) {
			if ( ! HGDF_Logic::evaluate( $step['show_if'] ?? array(), $answers ) ) { continue; }
			foreach ( $step['questions'] as $q ) {
				if ( ! HGDF_Schema::type_is_storable( $q['type'] ) ) { continue; }
				if ( ! HGDF_Logic::evaluate( $q['show_if'] ?? array(), $answers ) ) { continue; }
				if ( ! empty( $q['required'] ) ) {
					$v = $answers[ $q['id'] ] ?? null;
					$empty = $v === null || $v === '' || ( is_array( $v ) && count( $v ) === 0 );
					if ( $empty ) {
						return new WP_Error( 'hgd_form_required', sprintf( 'Required: %s', wp_strip_all_tags( $q['label'] ) ), array( 'status' => 400, 'question' => $q['id'] ) );
					}
				}
			}
		}

		$email = self::extract_email( $answers );
		HGDF_Submission::update_payload( (int) $row['id'], $answers, $email );

		// Final progression update before marking complete.
		$step_reached   = max( 0, (int) $req->get_param( 'step_reached' ) );
		$seconds_active = max( 0, min( 86400, (int) $req->get_param( 'seconds_active' ) ) );
		try {
			HGDF_Analytics::update_progress( (int) $row['id'], $step_reached, $seconds_active );
		} catch ( \Throwable $e ) {
			error_log( 'OCF: analytics update_progress threw: ' . $e->getMessage() );
		}

		HGDF_Submission::mark_complete( (int) $row['id'] );

		// Side-effects below MUST NOT 500 the response — the submission is
		// already saved and the user needs the ending screen / redirect.
		try {
			do_action( 'hgd_form_after_submit', (int) $row['id'], $form_id, $answers );
		} catch ( \Throwable $e ) {
			error_log( 'HGDF: hgd_form_after_submit hook threw: ' . $e->getMessage() );
		}
		try {
			self::notify_admin( $form_id, $row, $answers );
		} catch ( \Throwable $e ) {
			error_log( 'OCF: notify_admin threw: ' . $e->getMessage() );
		}

		return rest_ensure_response( array(
			'ok'     => true,
			'ending' => self::shape_ending( $schema['endings']['default'] ?? array() ),
		) );
	}

	private static function shape_ending( $ending ) {
		$ending = is_array( $ending ) ? $ending : array();
		return array(
			'heading'      => $ending['heading']      ?? 'Thanks!',
			'body'         => $ending['body']         ?? '',
			'cta_label'    => $ending['cta_label']    ?? '',
			'cta_url'      => $ending['cta_url']      ?? '',
			'redirect_url' => $ending['redirect_url'] ?? '',
		);
	}

	private static function sanitize_answers( $raw, $form_id ) {
		if ( ! is_array( $raw ) ) {
			return array();
		}
		$schema = HGDF_Schema::get( $form_id );
		$clean  = array();
		foreach ( $raw as $qid => $val ) {
			$qid = HGDF_Schema::clean_id( $qid );
			$q   = HGDF_Schema::find_question( $schema, $qid );
			if ( ! $q || ! HGDF_Schema::type_is_storable( $q['type'] ) ) {
				continue;
			}
			$clean[ $qid ] = self::sanitize_answer_value( $q, $val );
		}
		return $clean;
	}

	private static function sanitize_answer_value( $q, $val ) {
		switch ( $q['type'] ) {
			case 'email':
				return sanitize_email( (string) $val );
			case 'url':
				return esc_url_raw( (string) $val );
			case 'number':
				return is_numeric( $val ) ? $val + 0 : '';
			case 'long_text':
				return sanitize_textarea_field( (string) $val );
			case 'multi_choice':
			case 'image_cards_multi':
				return is_array( $val ) ? array_values( array_map( 'sanitize_text_field', $val ) ) : array();
			case 'address':
				$val = is_array( $val ) ? $val : array();
				return array(
					'line1'   => sanitize_text_field( $val['line1']   ?? '' ),
					'line2'   => sanitize_text_field( $val['line2']   ?? '' ),
					'city'    => sanitize_text_field( $val['city']    ?? '' ),
					'state'   => sanitize_text_field( $val['state']   ?? '' ),
					'zip'     => sanitize_text_field( $val['zip']     ?? '' ),
					'country' => sanitize_text_field( $val['country'] ?? '' ),
				);
			case 'file_upload':
				if ( ! is_array( $val ) ) { return array(); }
				$ids = array();
				foreach ( $val as $f ) {
					if ( is_array( $f ) && isset( $f['id'] ) ) {
						$ids[] = absint( $f['id'] );
					} elseif ( is_numeric( $f ) ) {
						$ids[] = absint( $f );
					}
				}
				return $ids;
			case 'grid':
				if ( ! is_array( $val ) ) { return array(); }
				$out = array();
				foreach ( $val as $row => $col ) {
					$out[ sanitize_text_field( $row ) ] = sanitize_text_field( $col );
				}
				return $out;
			default:
				return sanitize_text_field( (string) $val );
		}
	}

	private static function extract_email( $answers ) {
		foreach ( $answers as $v ) {
			if ( is_string( $v ) && is_email( $v ) ) {
				return $v;
			}
		}
		return null;
	}

	private static function ensure_submission_dir( $form_id, $submission_id ) {
		$upload = wp_upload_dir();
		$rel    = 'ocf/' . $form_id . '/' . $submission_id;
		$path   = trailingslashit( $upload['basedir'] ) . $rel;
		$url    = trailingslashit( $upload['baseurl'] ) . $rel;
		if ( ! file_exists( $path ) ) {
			wp_mkdir_p( $path );
		}
		return array( 'path' => $path, 'url' => $url );
	}

	private static function detect_mime( $tmp, $reported ) {
		if ( function_exists( 'finfo_open' ) ) {
			$fi = finfo_open( FILEINFO_MIME_TYPE );
			$m  = $fi ? finfo_file( $fi, $tmp ) : '';
			if ( $fi ) { finfo_close( $fi ); }
			if ( $m ) { return $m; }
		}
		return sanitize_text_field( $reported );
	}

	private static function mime_allowed( $mime, $ext, $allowed_tokens ) {
		$ext = strtolower( $ext );
		foreach ( $allowed_tokens as $token ) {
			$token = strtolower( ltrim( trim( $token ), '.' ) );
			if ( $token === $ext ) {
				return true;
			}
			if ( strpos( $token, '/' ) !== false && $token === strtolower( $mime ) ) {
				return true;
			}
			// Wildcards like image/*
			if ( substr( $token, -2 ) === '/*' && stripos( $mime, substr( $token, 0, -1 ) ) === 0 ) {
				return true;
			}
		}
		return false;
	}

	private static function notify_admin( $form_id, $row, $answers ) {
		$to = get_option( 'hgd_form_notify_email', get_option( 'admin_email' ) );
		if ( ! $to ) { return; }
		$schema = HGDF_Schema::get( $form_id );
		$title  = get_the_title( $form_id );

		// Lead email used for both the subject and the Reply-To header so a
		// reply from the inbox goes straight to the lead.
		$lead_email = '';
		foreach ( $answers as $v ) {
			if ( is_string( $v ) && is_email( $v ) ) { $lead_email = $v; break; }
		}
		if ( ! $lead_email && ! empty( $row['email'] ) ) {
			$lead_email = $row['email'];
		}

		$lines = array( 'New submission: ' . $title, '' );
		foreach ( $schema['steps'] as $step ) {
			foreach ( $step['questions'] as $q ) {
				if ( ! HGDF_Schema::type_is_storable( $q['type'] ) ) { continue; }
				$v = $answers[ $q['id'] ?? '' ] ?? null;
				if ( $v === null || $v === '' || $v === array() ) { continue; }
				$label = wp_strip_all_tags( $q['label'] );
				$value = is_array( $v ) ? wp_json_encode( $v ) : (string) $v;
				$lines[] = sprintf( '%s: %s', $label, $value );
			}
		}

		$subject = $lead_email
			? sprintf( '[%s] New lead — %s — %s', get_bloginfo( 'name' ), $title, $lead_email )
			: sprintf( '[%s] New lead — %s', get_bloginfo( 'name' ), $title );

		$headers = array();

		$from_name  = trim( (string) get_option( 'hgd_form_from_name', '' ) );
		$from_email = trim( (string) get_option( 'hgd_form_from_email', '' ) );
		if ( $from_email && is_email( $from_email ) ) {
			$display = $from_name !== '' ? $from_name : get_bloginfo( 'name' );
			$headers[] = sprintf( 'From: %s <%s>', $display, $from_email );
		}
		if ( $lead_email && is_email( $lead_email ) ) {
			$headers[] = sprintf( 'Reply-To: %s', $lead_email );
		}
		foreach ( (array) ( $schema['notifications']['cc'] ?? array() ) as $cc_addr ) {
			if ( is_email( $cc_addr ) ) {
				$headers[] = 'Cc: ' . $cc_addr;
			}
		}

		wp_mail( $to, $subject, implode( "\n", $lines ), $headers );
	}
}
