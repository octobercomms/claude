<?php
/**
 * Small bits of chrome cleanup that make the admin feel calmer.
 *
 * All of this is reversible and filterable. Nothing here removes functionality
 * for administrators beyond hiding visual noise.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class October_Admin_Cleanup {

	public function __construct() {
		add_filter( 'admin_footer_text', [ $this, 'footer_text' ] );
		add_filter( 'update_footer', [ $this, 'footer_version' ], 11 );
		add_action( 'wp_before_admin_bar_render', [ $this, 'trim_admin_bar' ] );
	}

	/**
	 * Replace "Thank you for creating with WordPress" with October branding.
	 */
	public function footer_text() {
		return sprintf(
			/* translators: %s: October Comms link */
			esc_html__( 'Managed by %s', 'october-admin-theme' ),
			'<a href="https://octobercomms.com" target="_blank" rel="noopener">October Comms</a>'
		);
	}

	/**
	 * Hide the WordPress version string in the footer for a cleaner look.
	 */
	public function footer_version() {
		return '';
	}

	/**
	 * Strip the WordPress logo menu from the top admin bar.
	 */
	public function trim_admin_bar() {
		global $wp_admin_bar;
		if ( $wp_admin_bar ) {
			$wp_admin_bar->remove_node( 'wp-logo' );
		}
	}
}
