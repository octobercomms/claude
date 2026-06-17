<?php
/**
 * Asset loading for the October Admin Theme.
 *
 * Performance notes — this is the whole "is it fast?" answer:
 *   - One CSS file + one JS file. Nothing else. No build step, no framework.
 *   - Typography uses the OS system-font stack by default, so there is ZERO
 *     web-font network request. (Set the OCTOBER_ADMIN_FONT_URL constant to a
 *     self-hosted .woff2 if you want a consistent custom face later — we then
 *     preload it. We never @import Google Fonts: that blocks render.)
 *   - Files are cache-busted by filemtime in dev and by version in prod, so the
 *     browser caches aggressively and only re-fetches when we actually change them.
 *   - Assets only enqueue inside wp-admin, never on the front end.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class October_Admin_Assets {

	public function __construct() {
		add_action( 'admin_enqueue_scripts', [ $this, 'enqueue_admin' ] );
		add_action( 'login_enqueue_scripts', [ $this, 'enqueue_login' ] );
		add_filter( 'admin_body_class', [ $this, 'add_body_class' ] );
	}

	/**
	 * Version string for an asset: file mtime when SCRIPT_DEBUG is on (so we
	 * always see the latest during development), otherwise the plugin version.
	 */
	private function ver( $relative_path ) {
		if ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) {
			$file = OCTOBER_THEME_PATH . $relative_path;
			if ( file_exists( $file ) ) {
				return (string) filemtime( $file );
			}
		}
		return OCTOBER_THEME_VERSION;
	}

	public function enqueue_admin() {
		wp_enqueue_style(
			'october-admin-theme',
			OCTOBER_THEME_URL . 'assets/admin-style.css',
			[],
			$this->ver( 'assets/admin-style.css' )
		);

		wp_enqueue_script(
			'october-admin-theme',
			OCTOBER_THEME_URL . 'assets/admin-script.js',
			[],
			$this->ver( 'assets/admin-script.js' ),
			true
		);

		// Real hrefs for the sidebar's View Site / Log Out links (set in JS).
		wp_localize_script( 'october-admin-theme', 'octoberAdmin', [
			'homeUrl'   => home_url( '/' ),
			'logoutUrl' => wp_logout_url(),
		] );

		$this->maybe_preload_font();
	}

	public function enqueue_login() {
		wp_enqueue_style(
			'october-login-theme',
			OCTOBER_THEME_URL . 'assets/login-style.css',
			[],
			$this->ver( 'assets/login-style.css' )
		);
	}

	/**
	 * Force every admin page to carry our hook class. The font stack and the
	 * skin are scoped to this so we never touch the front end.
	 */
	public function add_body_class( $classes ) {
		return trim( $classes . ' october-theme' );
	}

	/**
	 * Optional: if a site defines a self-hosted font URL, preload it (no FOUT,
	 * no third-party request). Left off by default — system fonts are instant.
	 */
	private function maybe_preload_font() {
		if ( ! defined( 'OCTOBER_ADMIN_FONT_URL' ) || ! OCTOBER_ADMIN_FONT_URL ) {
			return;
		}
		add_action( 'admin_head', function () {
			printf(
				'<link rel="preload" as="font" type="font/woff2" href="%s" crossorigin>' . "\n",
				esc_url( OCTOBER_ADMIN_FONT_URL )
			);
		} );
	}
}
