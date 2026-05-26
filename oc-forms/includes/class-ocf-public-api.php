<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Read-only JSON API for external apps (e.g. the Platform reporting app).
 *
 * Auth: a static API key issued in Settings → nvelope Forms, sent as either
 *   X-OCF-Api-Key: <key>     (header, preferred)
 *   ?api_key=<key>           (query string, easier for curl/testing)
 *
 * Base path: /wp-json/ocf/v1/api/
 *
 * Endpoints (all GET, all JSON):
 *   /api/health
 *   /api/forms
 *   /api/forms/{id}
 *   /api/forms/{id}/stats?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   /api/forms/{id}/funnel?from=&to=
 *   /api/forms/{id}/timeseries?from=&to=
 *   /api/forms/{id}/submissions?from=&to=&status=partial|complete&limit=&offset=
 *   /api/submissions/{id}
 */
class OCF_Public_API {

	const NAMESPACE_API = 'ocf/v1';

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
	}

	public static function register_routes() {
		$auth = array( __CLASS__, 'check_auth' );

		register_rest_route( self::NAMESPACE_API, '/api/health', array(
			'methods'             => 'GET',
			'permission_callback' => $auth,
			'callback'            => array( __CLASS__, 'health' ),
		) );

		register_rest_route( self::NAMESPACE_API, '/api/forms', array(
			'methods'             => 'GET',
			'permission_callback' => $auth,
			'callback'            => array( __CLASS__, 'list_forms' ),
		) );

		register_rest_route( self::NAMESPACE_API, '/api/forms/(?P<id>\d+)', array(
			'methods'             => 'GET',
			'permission_callback' => $auth,
			'callback'            => array( __CLASS__, 'get_form' ),
		) );

		register_rest_route( self::NAMESPACE_API, '/api/forms/(?P<id>\d+)/stats', array(
			'methods'             => 'GET',
			'permission_callback' => $auth,
			'callback'            => array( __CLASS__, 'form_stats' ),
		) );

		register_rest_route( self::NAMESPACE_API, '/api/forms/(?P<id>\d+)/funnel', array(
			'methods'             => 'GET',
			'permission_callback' => $auth,
			'callback'            => array( __CLASS__, 'form_funnel' ),
		) );

		register_rest_route( self::NAMESPACE_API, '/api/forms/(?P<id>\d+)/timeseries', array(
			'methods'             => 'GET',
			'permission_callback' => $auth,
			'callback'            => array( __CLASS__, 'form_timeseries' ),
		) );

		register_rest_route( self::NAMESPACE_API, '/api/forms/(?P<id>\d+)/submissions', array(
			'methods'             => 'GET',
			'permission_callback' => $auth,
			'callback'            => array( __CLASS__, 'form_submissions' ),
		) );

		register_rest_route( self::NAMESPACE_API, '/api/submissions/(?P<id>\d+)', array(
			'methods'             => 'GET',
			'permission_callback' => $auth,
			'callback'            => array( __CLASS__, 'get_submission' ),
		) );
	}

	public static function check_auth( WP_REST_Request $req ) {
		$expected = trim( (string) get_option( 'ocf_api_key', '' ) );
		if ( ! $expected ) {
			return new WP_Error( 'ocf_no_api_key', 'External API is disabled. Set an API key in Settings → nvelope Forms.', array( 'status' => 403 ) );
		}
		$provided = $req->get_header( 'X-OCF-Api-Key' );
		if ( ! $provided ) {
			$provided = $req->get_header( 'X_OCF_Api_Key' );
		}
		if ( ! $provided ) {
			$provided = (string) $req->get_param( 'api_key' );
		}
		if ( ! is_string( $provided ) || ! hash_equals( $expected, trim( $provided ) ) ) {
			return new WP_Error( 'ocf_bad_api_key', 'Invalid API key.', array( 'status' => 401 ) );
		}
		return true;
	}

	public static function health() {
		return rest_ensure_response( array(
			'ok'           => true,
			'plugin'       => 'nvelope-forms',
			'version'      => OCF_VERSION,
			'db_version'   => get_option( 'ocf_db_version', '' ),
			'wp_version'   => get_bloginfo( 'version' ),
			'time'         => current_time( 'mysql' ),
			'time_utc'     => gmdate( 'Y-m-d H:i:s' ),
			'site_url'     => home_url(),
		) );
	}

	public static function list_forms( WP_REST_Request $req ) {
		$status = $req->get_param( 'status' ) ?: 'any';
		$posts = get_posts( array(
			'post_type'      => OCF_CPT,
			'posts_per_page' => 200,
			'post_status'    => $status === 'any' ? array( 'publish', 'draft' ) : sanitize_text_field( $status ),
			'orderby'        => 'date',
			'order'          => 'DESC',
		) );
		$out = array();
		foreach ( $posts as $p ) {
			$out[] = self::form_summary( $p );
		}
		return rest_ensure_response( array( 'forms' => $out, 'total' => count( $out ) ) );
	}

	public static function get_form( WP_REST_Request $req ) {
		$id = absint( $req['id'] );
		if ( ! OCF_CPT::exists( $id ) ) {
			return new WP_Error( 'ocf_not_found', 'Form not found', array( 'status' => 404 ) );
		}
		$post   = get_post( $id );
		$schema = OCF_Schema::get( $id );
		return rest_ensure_response( array_merge(
			self::form_summary( $post ),
			array(
				'schema' => $schema,
			)
		) );
	}

	public static function form_stats( WP_REST_Request $req ) {
		$id = absint( $req['id'] );
		if ( ! OCF_CPT::exists( $id ) ) {
			return new WP_Error( 'ocf_not_found', 'Form not found', array( 'status' => 404 ) );
		}
		$from = sanitize_text_field( $req->get_param( 'from' ) );
		$to   = sanitize_text_field( $req->get_param( 'to' ) );
		return rest_ensure_response( OCF_Analytics::form_stats( $id, $from, $to ) );
	}

	public static function form_funnel( WP_REST_Request $req ) {
		$id = absint( $req['id'] );
		if ( ! OCF_CPT::exists( $id ) ) {
			return new WP_Error( 'ocf_not_found', 'Form not found', array( 'status' => 404 ) );
		}
		$from = sanitize_text_field( $req->get_param( 'from' ) );
		$to   = sanitize_text_field( $req->get_param( 'to' ) );
		return rest_ensure_response( array( 'steps' => OCF_Analytics::funnel( $id, $from, $to ) ) );
	}

	public static function form_timeseries( WP_REST_Request $req ) {
		$id = absint( $req['id'] );
		if ( ! OCF_CPT::exists( $id ) ) {
			return new WP_Error( 'ocf_not_found', 'Form not found', array( 'status' => 404 ) );
		}
		$from = sanitize_text_field( $req->get_param( 'from' ) );
		$to   = sanitize_text_field( $req->get_param( 'to' ) );
		return rest_ensure_response( array( 'series' => OCF_Analytics::timeseries( $id, $from, $to ) ) );
	}

	public static function form_submissions( WP_REST_Request $req ) {
		$id = absint( $req['id'] );
		if ( ! OCF_CPT::exists( $id ) ) {
			return new WP_Error( 'ocf_not_found', 'Form not found', array( 'status' => 404 ) );
		}
		global $wpdb;
		$status = sanitize_text_field( $req->get_param( 'status' ) );
		$from   = sanitize_text_field( $req->get_param( 'from' ) );
		$to     = sanitize_text_field( $req->get_param( 'to' ) );
		$limit  = min( 500, max( 1, (int) ( $req->get_param( 'limit' ) ?: 50 ) ) );
		$offset = max( 0, (int) $req->get_param( 'offset' ) );

		$where = $wpdb->prepare( 'form_id = %d', $id );
		if ( $status && in_array( $status, array( 'partial', 'complete' ), true ) ) {
			$where .= $wpdb->prepare( ' AND status = %s', $status );
		}
		if ( $from || $to ) {
			list( $from_ts, $to_ts ) = OCF_Analytics::resolve_range( $from, $to );
			$where .= $wpdb->prepare( ' AND created_at BETWEEN %s AND %s', $from_ts, $to_ts );
		}

		$rows = $wpdb->get_results( $wpdb->prepare(
			'SELECT * FROM ' . OCF_Submission::table() . " WHERE {$where} ORDER BY id DESC LIMIT %d OFFSET %d",
			$limit, $offset
		), ARRAY_A );
		$total = (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . OCF_Submission::table() . " WHERE {$where}" );

		$out = array();
		foreach ( $rows as $r ) {
			$out[] = self::shape_submission( $r, false );
		}
		return rest_ensure_response( array(
			'submissions' => $out,
			'total'       => $total,
			'limit'       => $limit,
			'offset'      => $offset,
		) );
	}

	public static function get_submission( WP_REST_Request $req ) {
		$id = absint( $req['id'] );
		$row = OCF_Submission::find( $id );
		if ( ! $row ) {
			return new WP_Error( 'ocf_not_found', 'Submission not found', array( 'status' => 404 ) );
		}
		return rest_ensure_response( self::shape_submission( $row, true ) );
	}

	private static function form_summary( $post ) {
		$schema = OCF_Schema::get( $post->ID );
		return array(
			'id'         => (int) $post->ID,
			'title'      => $post->post_title,
			'status'     => $post->post_status,
			'created_at' => $post->post_date_gmt,
			'modified_at'=> $post->post_modified_gmt,
			'shortcode'  => '[nvelope_form id="' . (int) $post->ID . '"]',
			'step_count' => count( $schema['steps'] ?? array() ),
		);
	}

	private static function shape_submission( $row, $include_payload ) {
		$out = array(
			'id'             => (int) $row['id'],
			'form_id'        => (int) $row['form_id'],
			'status'         => $row['status'],
			'email'          => $row['email'],
			'step_reached'   => (int) ( $row['step_reached'] ?? 0 ),
			'seconds_active' => (int) ( $row['seconds_active'] ?? 0 ),
			'ip_address'     => $row['ip_address'],
			'user_agent'     => $row['user_agent'],
			'referrer'       => $row['referrer'],
			'created_at'     => $row['created_at'],
			'updated_at'     => $row['updated_at'],
			'completed_at'   => $row['completed_at'],
		);
		if ( $include_payload ) {
			$schema  = OCF_Schema::get( (int) $row['form_id'] );
			$answers = json_decode( $row['payload'], true ) ?: array();
			$labelled = array();
			foreach ( $schema['steps'] as $step ) {
				foreach ( $step['questions'] as $q ) {
					if ( ! OCF_Schema::type_is_storable( $q['type'] ) ) { continue; }
					if ( ! array_key_exists( $q['id'], $answers ) ) { continue; }
					$labelled[] = array(
						'question_id' => $q['id'],
						'label'       => wp_strip_all_tags( $q['label'] ?? '' ),
						'type'        => $q['type'],
						'value'       => $answers[ $q['id'] ],
					);
				}
			}
			$out['answers']       = $answers;
			$out['answers_table'] = $labelled;
			$out['files']         = OCF_Submission::uploads_for( (int) $row['id'] );
		}
		return $out;
	}
}
