<?php
/**
 * Inbound REST route — publish a draft from the platform.
 *
 * The platform occasionally needs to push content the other way (e.g. a blog
 * post drafted in October). Rather than have it authenticate against the
 * standard wp/v2/posts route (which WAFs and application passwords complicate),
 * we expose a single, narrowly-scoped route:
 *
 *     POST /wp-json/october-mi/v1/draft
 *
 * Authentication: a bearer token in the Authorization header that must match
 * the stored refresh_secret (compared with hash_equals). The route only ever
 * creates a *draft* — nothing is published live without a human in wp-admin —
 * so even a leaked secret cannot push live content.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OctoberMI_REST {

	const NAMESPACE = 'october-mi/v1';

	public static function register_routes() {
		register_rest_route( self::NAMESPACE, '/draft', array(
			'methods'             => 'POST',
			'callback'            => array( __CLASS__, 'create_draft' ),
			'permission_callback' => array( __CLASS__, 'authorise' ),
			'args'                => array(
				'title'   => array( 'required' => true, 'type' => 'string' ),
				'content' => array( 'required' => false, 'type' => 'string' ),
				'excerpt' => array( 'required' => false, 'type' => 'string' ),
				'type'    => array( 'required' => false, 'type' => 'string' ),
			),
		) );
	}

	/**
	 * Verify the bearer token against the stored refresh_secret. The site must
	 * be paired for any inbound call to be accepted.
	 */
	public static function authorise( WP_REST_Request $request ) {
		if ( ! OctoberMI_Settings::is_connected() ) {
			return new WP_Error( 'octobermi_not_connected', __( 'Site is not paired.', 'october-mi' ), array( 'status' => 403 ) );
		}

		$header = (string) $request->get_header( 'authorization' );
		$token  = '';
		if ( 0 === stripos( $header, 'Bearer ' ) ) {
			$token = trim( substr( $header, 7 ) );
		}

		$secret = (string) OctoberMI_Settings::get( 'refresh_secret' );
		if ( '' === $token || '' === $secret || ! hash_equals( $secret, $token ) ) {
			OctoberMI_Log::warning( 'rest.draft', 'Rejected inbound draft (bad bearer)' );
			return new WP_Error( 'octobermi_forbidden', __( 'Invalid credentials.', 'october-mi' ), array( 'status' => 401 ) );
		}

		return true;
	}

	/**
	 * Create a draft post from the platform payload, bypassing wp/v2/posts.
	 */
	public static function create_draft( WP_REST_Request $request ) {
		$title   = sanitize_text_field( (string) $request->get_param( 'title' ) );
		$content = (string) $request->get_param( 'content' );
		$excerpt = sanitize_textarea_field( (string) $request->get_param( 'excerpt' ) );
		$type    = sanitize_key( (string) $request->get_param( 'type' ) );

		if ( '' === $title ) {
			return new WP_Error( 'octobermi_missing_title', __( 'A title is required.', 'october-mi' ), array( 'status' => 400 ) );
		}

		$post_type = ( $type && post_type_exists( $type ) ) ? $type : 'post';

		$post_id = wp_insert_post( array(
			'post_title'   => $title,
			'post_content' => wp_kses_post( $content ),
			'post_excerpt' => $excerpt,
			'post_status'  => 'draft',
			'post_type'    => $post_type,
		), true );

		if ( is_wp_error( $post_id ) ) {
			OctoberMI_Log::error( 'rest.draft', 'wp_insert_post failed', array( 'error' => $post_id->get_error_message() ) );
			return new WP_Error( 'octobermi_insert_failed', $post_id->get_error_message(), array( 'status' => 500 ) );
		}

		// Mark provenance so a site owner can see this came from the platform.
		update_post_meta( $post_id, '_octobermi_source', 'platform' );

		return new WP_REST_Response( array(
			'ok'        => true,
			'post_id'   => $post_id,
			'edit_link' => get_edit_post_link( $post_id, 'raw' ),
			'status'    => 'draft',
		), 201 );
	}
}
