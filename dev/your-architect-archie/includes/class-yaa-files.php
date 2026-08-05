<?php
/**
 * Project files — client uploads, Tiam drawings, and third-party documents.
 *
 * Drawings are gated: until the project is paid, the portal only ever gets a
 * server-generated blurred + watermarked PREVIEW (images) or a locked placeholder
 * (PDFs). Originals are streamed through a token-checked endpoint that refuses
 * gated drawings until payment clears — the raw file URL is never handed out.
 *
 * NOTE (production hardening): for a public launch, store originals outside the
 * web root (or behind a deny-all rule) so a guessed wp-content URL can't bypass
 * the gate. On this dev build the access endpoint is the control.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Files {

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
		add_action( 'admin_post_yaa_files_upload', array( __CLASS__, 'handle_upload' ) );
		add_action( 'admin_post_yaa_files_delete', array( __CLASS__, 'handle_delete' ) );
	}

	public static function routes() {
		register_rest_route( 'yaa/v1', '/file', array(
			'methods'             => 'GET',
			'permission_callback' => '__return_true',
			'callback'            => array( __CLASS__, 'download' ),
		) );
	}

	// ---- Store ----
	public static function for_project( $project_id, $kind = null ) {
		global $wpdb;
		$t = YAA_DB::files_table();
		if ( $kind ) {
			return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$t} WHERE project_id = %d AND kind = %s ORDER BY id ASC", (int) $project_id, $kind ) ); // phpcs:ignore WordPress.DB
		}
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$t} WHERE project_id = %d ORDER BY id ASC", (int) $project_id ) ); // phpcs:ignore WordPress.DB
	}
	public static function get( $id ) {
		global $wpdb;
		$t = YAA_DB::files_table();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t} WHERE id = %d", (int) $id ) ); // phpcs:ignore WordPress.DB
	}

	public static function add( $project_id, $attachment_id, $kind, $label = '', $source = '' ) {
		global $wpdb;
		$path = get_attached_file( $attachment_id );
		$wpdb->insert( YAA_DB::files_table(), array(
			'project_id'    => (int) $project_id,
			'kind'          => sanitize_key( $kind ),
			'label'         => sanitize_text_field( $label ),
			'source'        => sanitize_text_field( $source ),
			'attachment_id' => (int) $attachment_id,
			'mime'          => (string) get_post_mime_type( $attachment_id ),
			'size'          => $path && file_exists( $path ) ? (int) filesize( $path ) : 0,
			'gated'         => ( 'drawing' === $kind ) ? 1 : 0,
			'created'       => current_time( 'mysql' ),
		), array( '%d', '%s', '%s', '%s', '%d', '%s', '%d', '%d', '%s' ) ); // phpcs:ignore WordPress.DB
		return (int) $wpdb->insert_id;
	}

	// ---- Admin upload / delete ----
	public static function handle_upload() {
		if ( ! current_user_can( 'manage_options' ) || ! check_admin_referer( 'yaa_files' ) ) {
			wp_die( 'Nope' );
		}
		$project_id = (int) ( $_POST['project_id'] ?? 0 );
		$kind       = sanitize_key( $_POST['kind'] ?? 'drawing' );
		$label      = sanitize_text_field( wp_unslash( $_POST['label'] ?? '' ) );
		$source     = sanitize_text_field( wp_unslash( $_POST['source'] ?? '' ) );

		if ( $project_id && ! empty( $_FILES['file']['name'] ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
			require_once ABSPATH . 'wp-admin/includes/media.php';
			require_once ABSPATH . 'wp-admin/includes/image.php';
			$attachment_id = media_handle_upload( 'file', 0 );
			if ( ! is_wp_error( $attachment_id ) ) {
				self::add( $project_id, $attachment_id, $kind, $label, $source );
				YAA_Project::log_event( $project_id, 'file_uploaded', array( 'kind' => $kind ) );
			}
		}
		wp_safe_redirect( add_query_arg( array( 'page' => YAA_Projects_Admin::SLUG, 'project' => $project_id ), admin_url( 'admin.php' ) ) . '#files' );
		exit;
	}

	public static function handle_delete() {
		if ( ! current_user_can( 'manage_options' ) || ! check_admin_referer( 'yaa_files' ) ) {
			wp_die( 'Nope' );
		}
		$id  = (int) ( $_POST['file_id'] ?? 0 );
		$pid = (int) ( $_POST['project_id'] ?? 0 );
		$f   = self::get( $id );
		if ( $f ) {
			if ( $f->attachment_id ) {
				wp_delete_attachment( (int) $f->attachment_id, true );
			}
			self::delete_preview( $f );
			global $wpdb;
			$wpdb->delete( YAA_DB::files_table(), array( 'id' => $id ), array( '%d' ) ); // phpcs:ignore WordPress.DB
		}
		wp_safe_redirect( add_query_arg( array( 'page' => YAA_Projects_Admin::SLUG, 'project' => $pid ), admin_url( 'admin.php' ) ) . '#files' );
		exit;
	}

	// ---- Gated download (originals) ----
	public static function download_url( $file, $token ) {
		return add_query_arg( array( 'f' => (int) $file->id, 'token' => $token ), rest_url( 'yaa/v1/file' ) );
	}

	public static function download( $req ) {
		$file    = self::get( (int) $req->get_param( 'f' ) );
		$project = YAA_Project::by_token( (string) $req->get_param( 'token' ) );
		if ( ! $file || ! $project || (int) $file->project_id !== (int) $project->id ) {
			return new WP_REST_Response( array( 'error' => 'not_found' ), 404 );
		}
		if ( 'drawing' === $file->kind && $file->gated && ! $project->paid ) {
			return new WP_REST_Response( array( 'error' => 'locked' ), 402 );
		}
		$path = get_attached_file( (int) $file->attachment_id );
		if ( ! $path || ! file_exists( $path ) ) {
			return new WP_REST_Response( array( 'error' => 'missing' ), 404 );
		}
		nocache_headers();
		header( 'Content-Type: ' . ( $file->mime ? $file->mime : 'application/octet-stream' ) );
		header( 'Content-Disposition: inline; filename="' . basename( $path ) . '"' );
		header( 'Content-Length: ' . filesize( $path ) );
		readfile( $path ); // phpcs:ignore
		exit;
	}

	// ---- Blurred + watermarked preview (safe to expose) ----
	private static function preview_dir() {
		$up = wp_upload_dir();
		$dir = trailingslashit( $up['basedir'] ) . 'yaa-previews';
		if ( ! file_exists( $dir ) ) {
			wp_mkdir_p( $dir );
		}
		return array( $dir, trailingslashit( $up['baseurl'] ) . 'yaa-previews' );
	}

	public static function preview_url( $file ) {
		list( $dir, $url ) = self::preview_dir();
		$out  = $dir . '/prev-' . (int) $file->id . '.jpg';
		$ourl = $url . '/prev-' . (int) $file->id . '.jpg';
		if ( ! file_exists( $out ) ) {
			if ( ! self::make_preview( $file, $out ) ) {
				return YAA_URL . 'assets/archie-icon.svg'; // graceful fallback.
			}
		}
		return $ourl;
	}

	private static function delete_preview( $file ) {
		list( $dir ) = self::preview_dir();
		$out = $dir . '/prev-' . (int) $file->id . '.jpg';
		if ( file_exists( $out ) ) {
			@unlink( $out ); // phpcs:ignore
		}
	}

	/** Downscale, heavily blur, and stamp a watermark — GD. Images only. */
	private static function make_preview( $file, $out ) {
		if ( ! function_exists( 'imagecreatetruecolor' ) ) {
			return false;
		}
		$path = get_attached_file( (int) $file->attachment_id );
		if ( ! $path || ! file_exists( $path ) || 0 !== strpos( (string) $file->mime, 'image/' ) ) {
			return false;
		}
		$src = self::load_image( $path, $file->mime );
		if ( ! $src ) {
			return false;
		}
		$w = imagesx( $src );
		$h = imagesy( $src );
		// Downscale to obscure detail, then upscale back (adds mush), then blur hard.
		$small = imagecreatetruecolor( max( 1, (int) ( $w / 12 ) ), max( 1, (int) ( $h / 12 ) ) );
		imagecopyresampled( $small, $src, 0, 0, 0, 0, imagesx( $small ), imagesy( $small ), $w, $h );
		$blur = imagecreatetruecolor( $w, $h );
		imagecopyresampled( $blur, $small, 0, 0, 0, 0, $w, $h, imagesx( $small ), imagesy( $small ) );
		for ( $i = 0; $i < 12; $i++ ) {
			imagefilter( $blur, IMG_FILTER_GAUSSIAN_BLUR );
		}
		imagefilter( $blur, IMG_FILTER_BRIGHTNESS, 20 );
		// Watermark.
		$white = imagecolorallocatealpha( $blur, 255, 255, 255, 40 );
		$tile  = 'PREVIEW · PAY TO UNLOCK  ';
		for ( $y = 20; $y < $h; $y += 60 ) {
			for ( $x = 10; $x < $w; $x += 260 ) {
				imagestring( $blur, 5, $x, $y, $tile, $white );
			}
		}
		$ok = imagejpeg( $blur, $out, 72 );
		imagedestroy( $src );
		imagedestroy( $small );
		imagedestroy( $blur );
		return (bool) $ok;
	}

	private static function load_image( $path, $mime ) {
		switch ( $mime ) {
			case 'image/jpeg':
				return @imagecreatefromjpeg( $path ); // phpcs:ignore
			case 'image/png':
				return @imagecreatefrompng( $path ); // phpcs:ignore
			case 'image/gif':
				return @imagecreatefromgif( $path ); // phpcs:ignore
			case 'image/webp':
				return function_exists( 'imagecreatefromwebp' ) ? @imagecreatefromwebp( $path ) : false; // phpcs:ignore
		}
		return false;
	}
}
