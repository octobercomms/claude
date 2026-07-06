<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCF_REST_API {

	const NAMESPACE = 'ocf/v1';

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
		register_rest_route( self::NAMESPACE, '/admin/brevo-attributes', array(
			'methods'             => 'GET',
			'permission_callback' => function () { return current_user_can( 'manage_options' ); },
			'callback'            => array( __CLASS__, 'admin_brevo_attributes' ),
		) );
	}

	public static function admin_brevo_attributes( WP_REST_Request $req ) {
		$force = ! empty( $req->get_param( 'refresh' ) );
		$attrs = OCF_Brevo::list_attributes( $force );
		if ( is_wp_error( $attrs ) ) {
			return new WP_Error( $attrs->get_error_code(), $attrs->get_error_message(), array( 'status' => 502 ) );
		}
		return rest_ensure_response( array( 'attributes' => $attrs ) );
	}

	public static function view( WP_REST_Request $req ) {
		$form_id = self::get_form_or_error( $req->get_param( 'form_id' ) );
		if ( is_wp_error( $form_id ) ) { return $form_id; }
		$session = OCF_Schema::clean_id( $req->get_param( 'session' ) );
		if ( ! $session ) {
			$session = OCF_Analytics::visitor_session();
		}
		$id = OCF_Analytics::record_view( $form_id, $session );
		return rest_ensure_response( array( 'ok' => true, 'view_id' => $id, 'session' => $session ) );
	}

	private static function get_form_or_error( $form_id ) {
		$form_id = absint( $form_id );
		if ( ! $form_id || ! OCF_CPT::exists( $form_id ) ) {
			return new WP_Error( 'ocf_form_not_found', 'Form not found', array( 'status' => 404 ) );
		}
		if ( get_post_status( $form_id ) !== 'publish' ) {
			return new WP_Error( 'ocf_form_unpublished', 'Form not published', array( 'status' => 404 ) );
		}
		return $form_id;
	}

	public static function start( WP_REST_Request $req ) {
		$form_id = self::get_form_or_error( $req->get_param( 'form_id' ) );
		if ( is_wp_error( $form_id ) ) { return $form_id; }
		$session = OCF_Schema::clean_id( $req->get_param( 'session' ) );
		if ( ! $session ) {
			$session = OCF_Analytics::visitor_session();
		}
		$row = OCF_Submission::create( $form_id, $session );
		OCF_Analytics::link_view_to_submission( $session, $form_id, (int) $row['id'] );
		return rest_ensure_response( array(
			'token'   => $row['token'],
			'id'      => (int) $row['id'],
			'session' => $session,
		) );
	}

	public static function save( WP_REST_Request $req ) {
		$token = sanitize_text_field( $req->get_param( 'token' ) );
		$row   = OCF_Submission::find_by_token( $token );
		if ( ! $row ) {
			return new WP_Error( 'ocf_invalid_token', 'Invalid submission token', array( 'status' => 400 ) );
		}
		if ( $row['status'] === 'complete' ) {
			return rest_ensure_response( array( 'ok' => true, 'already_complete' => true ) );
		}
		$answers = self::sanitize_answers( $req->get_param( 'answers' ), (int) $row['form_id'] );
		$email   = self::extract_email( $answers );
		OCF_Submission::update_payload( (int) $row['id'], $answers, $email );

		// Track progression.
		$step_reached   = max( 0, (int) $req->get_param( 'step_reached' ) );
		$seconds_active = max( 0, min( 86400, (int) $req->get_param( 'seconds_active' ) ) );
		OCF_Analytics::update_progress( (int) $row['id'], $step_reached, $seconds_active );

		return rest_ensure_response( array( 'ok' => true ) );
	}

	public static function upload( WP_REST_Request $req ) {
		$token = sanitize_text_field( $req->get_param( 'token' ) );
		$row   = OCF_Submission::find_by_token( $token );
		if ( ! $row ) {
			return new WP_Error( 'ocf_invalid_token', 'Invalid submission token', array( 'status' => 400 ) );
		}
		$question_id = OCF_Schema::clean_id( $req->get_param( 'question_id' ) );
		if ( ! $question_id ) {
			return new WP_Error( 'ocf_no_question', 'Missing question id', array( 'status' => 400 ) );
		}
		$schema   = OCF_Schema::get( (int) $row['form_id'] );
		$question = OCF_Schema::find_question( $schema, $question_id );
		if ( ! $question || $question['type'] !== 'file_upload' ) {
			return new WP_Error( 'ocf_bad_question', 'Question does not accept uploads', array( 'status' => 400 ) );
		}

		$files = $req->get_file_params();
		if ( empty( $files['file'] ) ) {
			return new WP_Error( 'ocf_no_file', 'No file uploaded', array( 'status' => 400 ) );
		}
		$file = $files['file'];
		if ( ! empty( $file['error'] ) ) {
			return new WP_Error( 'ocf_upload_error', 'Upload error: ' . (int) $file['error'], array( 'status' => 400 ) );
		}

		$max_mb = ! empty( $question['max_size_mb'] ) ? (int) $question['max_size_mb'] : 20;
		if ( (int) $file['size'] > $max_mb * 1024 * 1024 ) {
			return new WP_Error( 'ocf_too_large', 'File exceeds ' . $max_mb . 'MB', array( 'status' => 413 ) );
		}

		$allowed = ! empty( $question['accept'] ) ? array_map( 'trim', explode( ',', $question['accept'] ) ) : array();
		$ext     = strtolower( pathinfo( $file['name'], PATHINFO_EXTENSION ) );
		$mime    = self::detect_mime( $file['tmp_name'], $file['type'] );
		if ( $allowed && ! self::mime_allowed( $mime, $ext, $allowed ) ) {
			return new WP_Error( 'ocf_bad_type', 'File type not allowed', array( 'status' => 415 ) );
		}

		$base = self::ensure_submission_dir( (int) $row['form_id'], (int) $row['id'] );
		$safe_name = wp_unique_filename( $base['path'], wp_generate_password( 16, false, false ) . '.' . preg_replace( '/[^a-z0-9]/i', '', $ext ) );
		$dest = trailingslashit( $base['path'] ) . $safe_name;
		if ( ! move_uploaded_file( $file['tmp_name'], $dest ) ) {
			return new WP_Error( 'ocf_move_failed', 'Could not save file', array( 'status' => 500 ) );
		}
		@chmod( $dest, 0644 );

		$id = OCF_Submission::record_upload( (int) $row['id'], $question_id, array(
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
		$row   = OCF_Submission::find_by_token( $token );
		if ( ! $row ) {
			return new WP_Error( 'ocf_invalid_token', 'Invalid submission token', array( 'status' => 400 ) );
		}
		if ( $row['status'] === 'complete' ) {
			$schema_complete = OCF_Schema::get( (int) $row['form_id'] );
			return rest_ensure_response( array(
				'ok'               => true,
				'already_complete' => true,
				'ending'           => self::shape_ending( $schema_complete['endings']['default'] ?? array() ),
			) );
		}
		$form_id = (int) $row['form_id'];
		$schema  = OCF_Schema::get( $form_id );

		// Spam guards.
		if ( ! OCF_Spam::rate_limit_ok( $form_id, $schema['spam']['rate_limit'] ?? 5 ) ) {
			return new WP_Error( 'ocf_rate_limited', 'Too many submissions', array( 'status' => 429 ) );
		}
		if ( ! empty( $schema['spam']['honeypot'] ) && ! OCF_Spam::honeypot_ok( $req->get_params() ) ) {
			// Pretend success so bots don't probe.
			OCF_Submission::mark_complete( (int) $row['id'] );
			return rest_ensure_response( array( 'ok' => true, 'ending' => 'default' ) );
		}
		if ( ! empty( $schema['spam']['turnstile'] ) && OCF_Spam::turnstile_enabled() ) {
			$verify = OCF_Spam::verify_turnstile( $req->get_param( 'turnstile_token' ) );
			if ( ! $verify['ok'] ) {
				return new WP_Error( 'ocf_turnstile', $verify['error'], array( 'status' => 400 ) );
			}
		}

		$answers = self::sanitize_answers( $req->get_param( 'answers' ), $form_id );
		$answers = OCF_Logic::filter_visible( $schema, $answers );

		// Required-field check on visible questions.
		foreach ( $schema['steps'] as $step ) {
			if ( ! OCF_Logic::evaluate( $step['show_if'] ?? array(), $answers ) ) { continue; }
			foreach ( $step['questions'] as $q ) {
				if ( ! OCF_Schema::type_is_storable( $q['type'] ) ) { continue; }
				if ( ! OCF_Logic::evaluate( $q['show_if'] ?? array(), $answers ) ) { continue; }
				if ( ! empty( $q['required'] ) ) {
					$v = $answers[ $q['id'] ] ?? null;
					$empty = $v === null || $v === '' || ( is_array( $v ) && count( $v ) === 0 );
					if ( $empty ) {
						return new WP_Error( 'ocf_required', sprintf( 'Required: %s', wp_strip_all_tags( $q['label'] ) ), array( 'status' => 400, 'question' => $q['id'] ) );
					}
				}
			}
		}

		$email = self::extract_email( $answers );
		OCF_Submission::update_payload( (int) $row['id'], $answers, $email );

		// Final progression update before marking complete.
		$step_reached   = max( 0, (int) $req->get_param( 'step_reached' ) );
		$seconds_active = max( 0, min( 86400, (int) $req->get_param( 'seconds_active' ) ) );
		try {
			OCF_Analytics::update_progress( (int) $row['id'], $step_reached, $seconds_active );
		} catch ( \Throwable $e ) {
			error_log( 'OCF: analytics update_progress threw: ' . $e->getMessage() );
		}

		OCF_Submission::mark_complete( (int) $row['id'] );

		// Side-effects below MUST NOT 500 the response — the submission is
		// already saved and the user needs the ending screen / redirect.
		try {
			do_action( 'ocf_after_submit', (int) $row['id'], $form_id, $answers );
		} catch ( \Throwable $e ) {
			error_log( 'OCF: ocf_after_submit hook threw: ' . $e->getMessage() );
		}
		try {
			OCF_Brevo::dispatch( (int) $row['id'], $form_id, $answers );
		} catch ( \Throwable $e ) {
			error_log( 'OCF: Brevo dispatch threw: ' . $e->getMessage() );
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
		$schema = OCF_Schema::get( $form_id );
		$clean  = array();
		foreach ( $raw as $qid => $val ) {
			$qid = OCF_Schema::clean_id( $qid );
			$q   = OCF_Schema::find_question( $schema, $qid );
			if ( ! $q || ! OCF_Schema::type_is_storable( $q['type'] ) ) {
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

	/**
	 * Delegates the styled HTML + subject templating to OCF_Lead_Email, then
	 * sends via wp_mail() with the right From/Reply-To/Cc headers.
	 */
	public static function notify_admin( $form_id, $row, $answers ) {
		$to = get_option( 'ocf_notify_email', get_option( 'admin_email' ) );
		if ( ! $to ) { return; }
		$schema = OCF_Schema::get( $form_id );
		$email  = OCF_Lead_Email::build( $form_id, $row, $answers );

		$headers = array( 'Content-Type: text/html; charset=UTF-8' );

		$from_name  = trim( (string) get_option( 'ocf_from_name', '' ) );
		$from_email = trim( (string) get_option( 'ocf_from_email', '' ) );
		if ( $from_email !== '' && is_email( $from_email ) ) {
			$display = $from_name !== '' ? $from_name : get_bloginfo( 'name' );
			$headers[] = sprintf( 'From: %s <%s>', $display, $from_email );
		}
		if ( ! empty( $email['lead_email'] ) && is_email( $email['lead_email'] ) ) {
			$headers[] = 'Reply-To: ' . $email['lead_email'];
		}
		foreach ( (array) ( $schema['notifications']['cc'] ?? array() ) as $cc_addr ) {
			if ( is_email( $cc_addr ) ) {
				$headers[] = 'Cc: ' . $cc_addr;
			}
		}

		return wp_mail( $to, $email['subject'], $email['html'], $headers );
	}
}
