<?php
/**
 * Admin controller: the settings page under Tools, asset loading and the
 * connect / reset / clear-log / test-update form handlers.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OctoberMI_Admin {

	const CAP  = 'manage_options';
	const SLUG = 'october-mi';

	public function __construct() {
		add_action( 'admin_menu', array( $this, 'register_menu' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_assets' ) );
		add_action( 'admin_post_octobermi_connect', array( $this, 'handle_connect' ) );
		add_action( 'admin_post_octobermi_reset', array( $this, 'handle_reset' ) );
		add_action( 'admin_post_octobermi_test_update', array( $this, 'handle_test_update' ) );
		add_action( 'admin_post_octobermi_clear_log', array( $this, 'handle_clear_log' ) );
	}

	public function register_menu() {
		add_management_page(
			__( 'October Marketing Intelligence', 'october-mi' ),
			__( 'October Marketing Intelligence', 'october-mi' ),
			self::CAP,
			self::SLUG,
			array( $this, 'render_page' )
		);
	}

	public function enqueue_assets( $hook ) {
		if ( 'tools_page_' . self::SLUG !== $hook ) {
			return;
		}
		wp_enqueue_style(
			'octobermi-admin',
			OCTOBERMI_URL . 'admin/css/admin.css',
			array(),
			OCTOBERMI_VERSION
		);
	}

	// =====================================================================
	// Page
	// =====================================================================

	public function render_page() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( esc_html__( 'You do not have permission to view this page.', 'october-mi' ) );
		}

		$settings  = OctoberMI_Settings::all();
		$connected = OctoberMI_Settings::is_connected();
		$log       = OctoberMI_Log::outbound_log();
		$notice    = isset( $_GET['octobermi_notice'] ) ? sanitize_text_field( wp_unslash( $_GET['octobermi_notice'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$notice_ok = isset( $_GET['octobermi_ok'] ) ? (bool) (int) $_GET['octobermi_ok'] : true; // phpcs:ignore WordPress.Security.NonceVerification.Recommended

		require OCTOBERMI_PATH . 'admin/views/settings.php';
	}

	// =====================================================================
	// Handlers
	// =====================================================================

	private function verify( $action ) {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( esc_html__( 'You do not have permission to do that.', 'october-mi' ) );
		}
		check_admin_referer( $action );
	}

	private function redirect_back( $message, $ok = true ) {
		$url = add_query_arg(
			array(
				'page'             => self::SLUG,
				'octobermi_notice' => rawurlencode( $message ),
				'octobermi_ok'     => $ok ? '1' : '0',
			),
			admin_url( 'tools.php' )
		);
		wp_safe_redirect( $url );
		exit;
	}

	public function handle_connect() {
		$this->verify( 'octobermi_connect' );
		$token  = isset( $_POST['octobermi_token'] ) ? sanitize_text_field( wp_unslash( $_POST['octobermi_token'] ) ) : '';
		$result = OctoberMI_Pairing::connect( $token );
		$this->redirect_back( $result['message'], $result['ok'] );
	}

	public function handle_reset() {
		$this->verify( 'octobermi_reset' );
		OctoberMI_Settings::disconnect();
		OctoberMI_Log::clear_outbound();
		$this->redirect_back( __( 'Connection reset. The site is no longer paired.', 'october-mi' ), true );
	}

	public function handle_test_update() {
		$this->verify( 'octobermi_test_update' );
		$updater = new OctoberMI_Updater(
			OCTOBERMI_BASENAME,
			OCTOBERMI_VERSION,
			OCTOBERMI_PLATFORM_URL
		);
		$result = $updater->diagnose();
		$this->redirect_back( $result['message'], $result['ok'] );
	}

	public function handle_clear_log() {
		$this->verify( 'octobermi_clear_log' );
		OctoberMI_Log::clear_outbound();
		$this->redirect_back( __( 'Activity log cleared.', 'october-mi' ), true );
	}
}
