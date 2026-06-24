<?php
/**
 * Admin: menu, asset loading, and the settings form handler.
 *
 * Feature screens (Proposals wizard, CRM, Library) are registered here as stubs
 * and filled in by later feature PRs.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCP_Admin {

	const MENU = 'oc-proposals';
	const CAP  = 'manage_options';

	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_action( 'admin_menu', array( $this, 'menu' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'assets' ) );
		add_action( 'admin_post_ocp_save_settings', array( $this, 'save_settings' ) );
		add_action( 'admin_post_ocp_save_terms', array( $this, 'save_terms' ) );
	}

	public function menu() {
		add_menu_page(
			__( 'October Proposals', 'oc-proposals' ),
			__( 'Proposals', 'oc-proposals' ),
			self::CAP,
			self::MENU,
			array( $this, 'render_dashboard' ),
			'dashicons-media-document',
			31
		);
		add_submenu_page( self::MENU, __( 'Dashboard', 'oc-proposals' ), __( 'Dashboard', 'oc-proposals' ), self::CAP, self::MENU, array( $this, 'render_dashboard' ) );
		add_submenu_page( self::MENU, __( 'Proposals', 'oc-proposals' ), __( 'Proposals', 'oc-proposals' ), self::CAP, OCP_Admin_Proposals::PAGE, array( 'OCP_Admin_Proposals', 'render' ) );
		add_submenu_page( self::MENU, __( 'Pipeline', 'oc-proposals' ), __( 'Pipeline', 'oc-proposals' ), self::CAP, OCP_Admin_CRM::PAGE, array( 'OCP_Admin_CRM', 'render' ) );
		add_submenu_page( self::MENU, __( 'Library', 'oc-proposals' ), __( 'Library', 'oc-proposals' ), self::CAP, OCP_Admin_Library::PAGE, array( 'OCP_Admin_Library', 'render' ) );
		add_submenu_page( self::MENU, __( 'Analytics', 'oc-proposals' ), __( 'Analytics', 'oc-proposals' ), self::CAP, 'ocp-analytics', array( 'OCP_Analytics', 'render' ) );
		add_submenu_page( self::MENU, __( 'Terms', 'oc-proposals' ), __( 'Terms', 'oc-proposals' ), self::CAP, 'ocp-terms', array( $this, 'render_terms' ) );
		add_submenu_page( self::MENU, __( 'Settings', 'oc-proposals' ), __( 'Settings', 'oc-proposals' ), self::CAP, 'ocp-settings', array( $this, 'render_settings' ) );
	}

	public function assets( $hook ) {
		if ( false === strpos( (string) $hook, self::MENU ) && false === strpos( (string) $hook, 'ocp-' ) ) {
			return;
		}
		wp_enqueue_style( 'ocp-admin', OCP_URL . 'assets/css/admin.css', array(), OCP_VERSION );
		// Inject the live design tokens so the admin previews on-brand.
		wp_add_inline_style( 'ocp-admin', OCP_Settings::css_root() );

		// Discovery-chat JS on the proposal wizard's Content step.
		$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		$step = isset( $_GET['step'] ) ? sanitize_key( wp_unslash( $_GET['step'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		if ( OCP_Admin_Proposals::PAGE === $page && 'content' === $step ) {
			wp_enqueue_script( 'ocp-admin-content', OCP_URL . 'assets/js/admin-content.js', array(), OCP_VERSION, true );
		}
	}

	public function render_dashboard() {
		require OCP_PATH . 'admin/views/dashboard.php';
	}

	public function render_settings() {
		require OCP_PATH . 'admin/views/settings.php';
	}

	public function render_terms() {
		$current = OCP_Terms::current();
		echo '<div class="wrap ocp-wrap"><h1 class="ocp-h1">' . esc_html__( 'Terms & Conditions', 'oc-proposals' ) . '</h1>';
		echo '<p class="ocp-lede">' . esc_html__( 'Paste your standard T&Cs. Each change creates a new version; proposals snapshot the version current when they are sent, so edits never change what a client already signed.', 'oc-proposals' ) . '</p>';
		if ( ! empty( $_GET['saved'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			echo '<div class="notice notice-success is-dismissible"><p>' . esc_html__( 'Terms saved.', 'oc-proposals' ) . '</p></div>';
		}
		if ( $current ) {
			/* translators: %s version number */
			echo '<p class="ocp-muted">' . esc_html( sprintf( __( 'Current version: %s', 'oc-proposals' ), $current['version'] ) ) . '</p>';
		}
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" style="max-width:860px">';
		echo '<input type="hidden" name="action" value="ocp_save_terms" />';
		wp_nonce_field( 'ocp_save_terms' );
		wp_editor( $current['body'] ?? '', 'ocp_terms_body', array( 'textarea_name' => 'terms_body', 'textarea_rows' => 20 ) );
		submit_button( __( 'Save terms', 'oc-proposals' ) );
		echo '</form></div>';
	}

	public function save_terms() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( esc_html__( 'Not allowed.', 'oc-proposals' ) );
		}
		check_admin_referer( 'ocp_save_terms' );
		OCP_Terms::save_body( wp_unslash( $_POST['terms_body'] ?? '' ) );
		wp_safe_redirect( add_query_arg( array( 'page' => 'ocp-terms', 'saved' => 1 ), admin_url( 'admin.php' ) ) );
		exit;
	}

	public function save_settings() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( esc_html__( 'Not allowed.', 'oc-proposals' ) );
		}
		check_admin_referer( 'ocp_save_settings' );

		$fields = array_keys( OCP_Settings::defaults() );
		$values = array();
		foreach ( $fields as $key ) {
			if ( ! isset( $_POST[ $key ] ) ) {
				continue;
			}
			$raw = wp_unslash( $_POST[ $key ] );
			// vat_rate is numeric; everything else is a short text/URL/colour token.
			$values[ $key ] = ( 'vat_rate' === $key ) ? (string) floatval( $raw ) : sanitize_text_field( $raw );
		}
		OCP_Settings::update( $values );

		wp_safe_redirect( add_query_arg(
			array( 'page' => 'ocp-settings', 'updated' => '1' ),
			admin_url( 'admin.php' )
		) );
		exit;
	}
}
