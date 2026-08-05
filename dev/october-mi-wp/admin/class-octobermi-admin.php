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
		add_action( 'admin_post_octobermi_save_settings', array( $this, 'handle_save_settings' ) );
		add_action( 'admin_post_octobermi_test_update', array( $this, 'handle_test_update' ) );
		add_action( 'admin_post_octobermi_clear_log', array( $this, 'handle_clear_log' ) );
	}

	public function register_menu() {
		// Top-level umbrella menu. Enabled modules hang their own submenus off
		// this same slug (see each module's boot()), so the left nav grows only
		// with what's switched on.
		add_menu_page(
			__( 'October Marketing Platform', 'october-mi' ),
			__( 'October Marketing', 'october-mi' ),
			self::CAP,
			self::SLUG,
			array( $this, 'render_page' ),
			'dashicons-chart-line',
			58
		);
		add_submenu_page(
			self::SLUG,
			__( 'Settings', 'october-mi' ),
			__( 'Settings', 'october-mi' ),
			self::CAP,
			self::SLUG,
			array( $this, 'render_page' )
		);
	}

	public function enqueue_assets( $hook ) {
		// Load only on our own screens (top-level page + any module submenu),
		// never site-wide. All our pages carry a page=october-mi… query var.
		$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( 0 !== strpos( $page, 'october-mi' ) ) {
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
			admin_url( 'admin.php' )
		);
		wp_safe_redirect( $url );
		exit;
	}

	/**
	 * Save the modules, connection toggle, key source and (optionally) a new
	 * Claude API key. The key field is write-only: a masked placeholder is shown
	 * and only a real, non-masked submission overwrites the stored secret.
	 */
	public function handle_save_settings() {
		$this->verify( 'octobermi_save_settings' );

		$available = array_keys( OctoberMI_Modules::all() );
		$submitted = ( isset( $_POST['octobermi_modules'] ) && is_array( $_POST['octobermi_modules'] ) )
			? array_map( 'sanitize_key', wp_unslash( $_POST['octobermi_modules'] ) )
			: array();
		$enabled = array_values( array_intersect( $available, $submitted ) );

		$connect_enabled = ! empty( $_POST['octobermi_connect_enabled'] );
		$key_source      = ( isset( $_POST['octobermi_key_source'] ) && 'platform' === $_POST['octobermi_key_source'] )
			? 'platform' : 'client';

		$cost_cap = isset( $_POST['octobermi_cost_cap'] ) ? (float) wp_unslash( $_POST['octobermi_cost_cap'] ) : 0;

		$hero_modes = array( 'off', 'library', 'library_generate' );
		$hero_mode  = ( isset( $_POST['octobermi_hero_images'] ) && in_array( $_POST['octobermi_hero_images'], $hero_modes, true ) )
			? sanitize_key( $_POST['octobermi_hero_images'] ) : 'library_generate';

		$changes = array(
			'enabled_modules'  => $enabled,
			'connect_enabled'  => $connect_enabled,
			'key_source'       => $key_source,
			'monthly_cost_cap' => max( 0, $cost_cap ),
			'hero_images'      => $hero_mode,
		);

		// Write-only Gemini image key (same masking rule as the Claude key).
		if ( isset( $_POST['octobermi_gemini_key'] ) ) {
			$gk = trim( (string) wp_unslash( $_POST['octobermi_gemini_key'] ) );
			if ( '' === $gk ) {
				if ( ! empty( $_POST['octobermi_gemini_key_clear'] ) ) {
					$changes['gemini_api_key'] = '';
				}
			} elseif ( false === strpos( $gk, "\xe2\x80\xa2" ) ) {
				$changes['gemini_api_key'] = sanitize_text_field( $gk );
			}
		}

		// Write-only key: ignore the mask, accept a real value, allow clearing.
		if ( isset( $_POST['octobermi_claude_key'] ) ) {
			$key = trim( (string) wp_unslash( $_POST['octobermi_claude_key'] ) );
			if ( '' === $key ) {
				if ( ! empty( $_POST['octobermi_claude_key_clear'] ) ) {
					$changes['claude_api_key'] = '';
				}
			} elseif ( false === strpos( $key, "\xe2\x80\xa2" ) ) { // not the • mask
				$changes['claude_api_key'] = sanitize_text_field( $key );
			}
		}

		$before = OctoberMI_Settings::enabled_modules();
		OctoberMI_Settings::update( $changes );

		// Fire one-time activation for modules switched on in this save.
		foreach ( array_diff( $enabled, $before ) as $newly_on ) {
			$module = OctoberMI_Modules::get( $newly_on );
			if ( $module ) {
				$module->activate();
			}
		}
		// And teardown for modules switched off.
		foreach ( array_diff( $before, $enabled ) as $newly_off ) {
			$module = OctoberMI_Modules::get( $newly_off );
			if ( $module ) {
				$module->deactivate();
			}
		}

		$this->redirect_back( __( 'Settings saved.', 'october-mi' ), true );
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
