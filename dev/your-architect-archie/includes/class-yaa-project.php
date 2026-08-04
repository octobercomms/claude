<?php
/**
 * Project records — the "created silently from the first message" store.
 *
 * A project is a `yaa_project` post tied to a browser cookie (UUID). It holds
 * the conversation, the collected state, the current package (JSON), status and
 * contact details. Anonymous until an email is provided. Pricing is never gated
 * behind contact details — the record just lets a returning visitor resume.
 *
 * At launch volume a CPT + post meta is plenty; swap for a custom table later
 * (à la Hillcroft) if throughput demands it.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Project {

	const CPT    = 'yaa_project';
	const COOKIE = 'yaa_pid';

	public static function init() {
		add_action( 'init', array( __CLASS__, 'register_cpt' ) );
		add_action( 'add_meta_boxes', array( __CLASS__, 'meta_box' ) );
	}

	public static function register_cpt() {
		register_post_type(
			self::CPT,
			array(
				'labels'          => array(
					'name'          => __( 'Projects', 'your-architect-archie' ),
					'singular_name' => __( 'Project', 'your-architect-archie' ),
					'menu_name'     => __( 'Archie Projects', 'your-architect-archie' ),
				),
				'public'          => false,
				'show_ui'         => true,
				'show_in_menu'    => true,
				'menu_icon'       => 'dashicons-format-chat',
				'menu_position'   => 26,
				'capability_type' => 'post',
				'map_meta_cap'    => true,
				'supports'        => array( 'title' ),
				'rewrite'         => false,
			)
		);
	}

	/** Resolve the current project from the cookie, creating one if needed. */
	public static function current( $create = true ) {
		$uuid = isset( $_COOKIE[ self::COOKIE ] ) ? sanitize_text_field( wp_unslash( $_COOKIE[ self::COOKIE ] ) ) : '';
		if ( $uuid ) {
			$found = get_posts(
				array(
					'post_type'   => self::CPT,
					'post_status' => 'any',
					'meta_key'    => '_yaa_uuid',
					'meta_value'  => $uuid,
					'numberposts' => 1,
					'fields'      => 'ids',
				)
			);
			if ( ! empty( $found ) ) {
				return (int) $found[0];
			}
		}
		if ( ! $create ) {
			return 0;
		}
		if ( ! $uuid ) {
			$uuid = wp_generate_uuid4();
			// 180-day cookie; SameSite=Lax so it survives the return visit.
			setcookie( self::COOKIE, $uuid, array( 'expires' => time() + 180 * DAY_IN_SECONDS, 'path' => '/', 'samesite' => 'Lax', 'secure' => is_ssl(), 'httponly' => true ) );
			$_COOKIE[ self::COOKIE ] = $uuid;
		}
		$id = wp_insert_post(
			array(
				'post_type'   => self::CPT,
				'post_status' => 'draft',
				'post_title'  => __( 'Anonymous', 'your-architect-archie' ) . ' — ' . substr( $uuid, 0, 8 ),
			)
		);
		if ( $id && ! is_wp_error( $id ) ) {
			update_post_meta( $id, '_yaa_uuid', $uuid );
			update_post_meta( $id, '_yaa_status', 'draft' );
			update_post_meta( $id, '_yaa_created', current_time( 'mysql' ) );
			return (int) $id;
		}
		return 0;
	}

	public static function state( $id ) {
		$s = json_decode( (string) get_post_meta( $id, '_yaa_state', true ), true );
		return is_array( $s ) ? $s : array( 'band' => 'B' );
	}
	public static function set_state( $id, array $state ) {
		update_post_meta( $id, '_yaa_state', wp_json_encode( $state ) );
		update_post_meta( $id, '_yaa_updated', current_time( 'mysql' ) );
	}

	public static function messages( $id ) {
		$m = json_decode( (string) get_post_meta( $id, '_yaa_messages', true ), true );
		return is_array( $m ) ? $m : array();
	}
	public static function add_message( $id, $role, $text ) {
		$m   = self::messages( $id );
		$m[] = array( 'role' => ( 'assistant' === $role ? 'assistant' : 'user' ), 'text' => (string) $text );
		update_post_meta( $id, '_yaa_messages', wp_json_encode( $m ) );
	}

	public static function set_package( $id, array $package ) {
		update_post_meta( $id, '_yaa_package', wp_json_encode( $package ) );
		update_post_meta( $id, '_yaa_total', (int) ( isset( $package['total'] ) ? $package['total'] : 0 ) );
	}
	public static function package( $id ) {
		$p = json_decode( (string) get_post_meta( $id, '_yaa_package', true ), true );
		return is_array( $p ) ? $p : array( 'nodes' => array(), 'total' => 0 );
	}

	public static function set_contact( $id, $name, $email ) {
		$name  = sanitize_text_field( $name );
		$email = sanitize_email( $email );
		update_post_meta( $id, '_yaa_name', $name );
		update_post_meta( $id, '_yaa_email', $email );
		if ( $email ) {
			wp_update_post( array( 'ID' => $id, 'post_title' => ( $name ? $name : $email ) ) );
			update_post_meta( $id, '_yaa_anonymous', '0' );
		}
	}

	public static function set_status( $id, $status ) {
		update_post_meta( $id, '_yaa_status', sanitize_key( $status ) );
	}

	/** Read-only record view in wp-admin. */
	public static function meta_box() {
		add_meta_box( 'yaa_project_details', __( 'Project record', 'your-architect-archie' ), array( __CLASS__, 'render_meta_box' ), self::CPT, 'normal', 'high' );
	}
	public static function render_meta_box( $post ) {
		$state = self::state( $post->ID );
		$pkg   = self::package( $post->ID );
		echo '<p><strong>' . esc_html__( 'Status', 'your-architect-archie' ) . ':</strong> ' . esc_html( (string) get_post_meta( $post->ID, '_yaa_status', true ) ) . ' · <strong>' . esc_html__( 'Total', 'your-architect-archie' ) . ':</strong> ' . esc_html( YAA_Pricing::money( isset( $pkg['total'] ) ? $pkg['total'] : 0 ) ) . '</p>';
		echo '<p><strong>' . esc_html__( 'Email', 'your-architect-archie' ) . ':</strong> ' . esc_html( (string) get_post_meta( $post->ID, '_yaa_email', true ) ?: '—' ) . '</p>';
		echo '<p><strong>' . esc_html__( 'State', 'your-architect-archie' ) . ':</strong></p><pre style="white-space:pre-wrap;background:#f6f7f7;padding:10px;border-radius:6px">' . esc_html( wp_json_encode( $state, JSON_PRETTY_PRINT ) ) . '</pre>';
		echo '<p><strong>' . esc_html__( 'Conversation', 'your-architect-archie' ) . ':</strong></p>';
		foreach ( self::messages( $post->ID ) as $m ) {
			echo '<p style="margin:.2em 0"><em>' . esc_html( $m['role'] ) . ':</em> ' . esc_html( $m['text'] ) . '</p>';
		}
	}
}
