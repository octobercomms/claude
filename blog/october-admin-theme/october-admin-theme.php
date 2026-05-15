<?php
/**
 * Plugin Name: October Admin Theme
 * Plugin URI:  https://octobercomms.com
 * Description: Redesigns the WordPress admin with a clean, modern aesthetic — warm cream backgrounds, dark sidebar, orange accents, and refined typography inspired by Claude.
 * Version:     1.0.0
 * Author:      October Comms
 * Author URI:  https://octobercomms.com
 * License:     GPL-2.0-or-later
 * Text Domain: october-admin-theme
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'OCTOBER_THEME_VERSION', '1.0.0' );
define( 'OCTOBER_THEME_URL', plugin_dir_url( __FILE__ ) );
define( 'OCTOBER_THEME_PATH', plugin_dir_path( __FILE__ ) );

class October_Admin_Theme {

	public function __construct() {
		add_action( 'admin_enqueue_scripts', [ $this, 'enqueue_assets' ] );
		add_action( 'login_enqueue_scripts', [ $this, 'enqueue_login_assets' ] );
		add_action( 'admin_head', [ $this, 'inject_color_scheme' ] );
		add_filter( 'admin_body_class', [ $this, 'add_body_class' ] );

		// Remove WordPress default colour scheme picker influence
		add_action( 'admin_init', [ $this, 'set_colour_scheme' ] );
	}

	public function set_colour_scheme() {
		// Override any per-user colour scheme so ours always wins
		add_filter( 'get_user_option_admin_color', fn() => 'october' );
	}

	public function enqueue_assets() {
		wp_enqueue_style(
			'october-admin-theme',
			OCTOBER_THEME_URL . 'assets/admin-style.css',
			[ 'wp-admin' ],
			OCTOBER_THEME_VERSION
		);

		wp_enqueue_script(
			'october-admin-theme',
			OCTOBER_THEME_URL . 'assets/admin-script.js',
			[],
			OCTOBER_THEME_VERSION,
			true
		);
	}

	public function enqueue_login_assets() {
		wp_enqueue_style(
			'october-login-theme',
			OCTOBER_THEME_URL . 'assets/login-style.css',
			[],
			OCTOBER_THEME_VERSION
		);
	}

	public function inject_color_scheme() {
		// Register a custom colour scheme so the admin colour picker stays consistent
		wp_admin_css_color(
			'october',
			__( 'October', 'october-admin-theme' ),
			OCTOBER_THEME_URL . 'assets/admin-style.css',
			[ '#1c1814', '#2d2520', '#d4763b', '#f5f0eb' ]
		);
	}

	public function add_body_class( $classes ) {
		return $classes . ' october-theme claude-theme';
	}
}

new October_Admin_Theme();
