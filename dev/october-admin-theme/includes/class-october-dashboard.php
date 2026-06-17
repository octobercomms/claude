<?php
/**
 * Dashboard tidy-up + a custom branded greeting.
 *
 * We remove only WordPress's own noise widgets (the news feed, "Quick Draft",
 * the PHP-version nag). We deliberately leave third-party widgets alone —
 * WooCommerce status, Site Kit and the like are exactly what the client wants
 * to see, and they own their own markup.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class October_Admin_Dashboard {

	public function __construct() {
		add_action( 'wp_dashboard_setup', [ $this, 'remove_core_widgets' ], 9999 );

		// Replace WordPress's default welcome panel with our own, and make sure
		// it shows for everyone (clients usually dismissed the default one).
		remove_action( 'welcome_panel', 'wp_welcome_panel' );
		add_action( 'welcome_panel', [ $this, 'render_welcome' ] );
		add_filter( 'show_welcome_panel', '__return_true' );
	}

	public function remove_core_widgets() {
		/**
		 * Core dashboard widget IDs to remove. Filterable so a site can keep or
		 * drop more. We intentionally do not touch plugin widgets.
		 */
		$remove = (array) apply_filters( 'october_admin_remove_dashboard_widgets', [
			'dashboard_primary'        => 'normal',   // WordPress Events & News
			'dashboard_quick_press'    => 'side',     // Quick Draft
			'dashboard_php_nag'        => 'normal',    // PHP update nag
			'dashboard_site_health'    => 'normal',   // Site Health (noisy for clients)
		] );

		foreach ( $remove as $widget_id => $context ) {
			remove_meta_box( $widget_id, 'dashboard', $context );
		}
	}

	/**
	 * A clean, Squarespace-style "Welcome, {name}" panel that we own end-to-end.
	 * Styling lives in admin-style.css under .oc-welcome.
	 */
	public function render_welcome() {
		$user = wp_get_current_user();
		$name = $user && $user->display_name ? $user->display_name : __( 'there', 'october-admin-theme' );
		$site = get_bloginfo( 'name' );
		?>
		<div class="oc-welcome">
			<h2 class="oc-welcome__title">
				<?php
				/* translators: %s: user's display name */
				printf( esc_html__( 'Welcome, %s', 'october-admin-theme' ), esc_html( $name ) );
				?>
			</h2>
			<p class="oc-welcome__sub">
				<?php
				/* translators: %s: site name */
				printf( esc_html__( 'You\'re managing %s. Everything you need is in the sidebar — the technical bits live under "Advanced".', 'october-admin-theme' ), esc_html( $site ) );
				?>
			</p>
			<div class="oc-welcome__actions">
				<a class="button button-primary" href="<?php echo esc_url( admin_url( 'edit.php?post_type=page' ) ); ?>"><?php esc_html_e( 'Edit pages', 'october-admin-theme' ); ?></a>
				<a class="button" href="<?php echo esc_url( admin_url( 'upload.php' ) ); ?>"><?php esc_html_e( 'Media library', 'october-admin-theme' ); ?></a>
				<a class="button" href="<?php echo esc_url( home_url( '/' ) ); ?>" target="_blank" rel="noopener"><?php esc_html_e( 'View site', 'october-admin-theme' ); ?></a>
			</div>
		</div>
		<?php
	}
}
