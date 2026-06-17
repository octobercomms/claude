<?php
/**
 * Chrome cleanup — the bits that make the admin feel calm.
 *
 *  - The WordPress toolbar is stripped right back. In wp-admin it shows just a
 *    "View Site" link (plus the account menu, so logout still has a home). On
 *    the front end the toolbar is removed entirely and replaced with a small
 *    floating "Dashboard" link for logged-in users.
 *  - Footer branding swaps "Thank you for creating with WordPress" for October.
 *
 * All reversible and filterable. Nothing removes functionality beyond visual noise.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class October_Admin_Cleanup {

	public function __construct() {
		add_filter( 'admin_footer_text', [ $this, 'footer_text' ] );
		add_filter( 'update_footer', [ $this, 'footer_version' ], 11 );

		// The WordPress toolbar is removed entirely. In wp-admin it's hidden via
		// CSS (see admin-style.css) — "View Site" and "Log Out" live in the
		// sidebar instead. On the front end we drop it and show a floating
		// "Dashboard" link for logged-in users.
		add_filter( 'show_admin_bar', [ $this, 'hide_toolbar_on_front' ] );
		add_action( 'wp_footer', [ $this, 'render_front_dashboard_link' ] );
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
	 * Never show the WordPress toolbar on the front end.
	 */
	public function hide_toolbar_on_front( $show ) {
		return is_admin() ? $show : false;
	}

	/**
	 * A small, self-contained "Dashboard" link fixed to the corner of the front
	 * end for logged-in users. Inline CSS/SVG so there's no extra request.
	 */
	public function render_front_dashboard_link() {
		if ( ! is_user_logged_in() ) {
			return;
		}
		?>
		<a id="oc-view-dashboard" href="<?php echo esc_url( admin_url() ); ?>" aria-label="<?php esc_attr_e( 'Go to Dashboard', 'october-admin-theme' ); ?>">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
				<path d="M3 11.5 12 4l9 7.5M5 10v9h5v-5h4v5h5v-9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
			<span><?php esc_html_e( 'Dashboard', 'october-admin-theme' ); ?></span>
		</a>
		<style>
			#oc-view-dashboard{position:fixed;right:18px;bottom:18px;z-index:99999;display:inline-flex;align-items:center;gap:7px;
				padding:9px 14px;background:#000;color:#fff;font:600 13px/1 system-ui,-apple-system,"Segoe UI",sans-serif;
				text-decoration:none;border-radius:4px;box-shadow:0 2px 10px rgba(0,0,0,.18);transition:background .15s ease}
			#oc-view-dashboard:hover{background:#333;color:#fff}
			#oc-view-dashboard svg{display:block}
		</style>
		<?php
	}
}
