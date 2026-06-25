<?php
/**
 * "Sheets Sync" admin screen.
 *
 * Generates the shared API token, exposes the per-store settings, and renders
 * the ready-to-paste Google Apps Script (with this store's URL + token already
 * filled in).
 *
 * @package OctBulkEditor
 */

defined( 'ABSPATH' ) || exit;

class OCTWBE_Sync_Page {

	const SLUG = 'oct-bulk-editor-sync';

	public function __construct() {
		add_action( 'admin_menu', [ $this, 'menu' ] );
		add_action( 'admin_post_octwbe_sync_save', [ $this, 'handle_save' ] );
	}

	public function menu(): void {
		add_submenu_page(
			'woocommerce',
			__( 'Bulk Editor – Sheets Sync', 'oct-bulk-editor' ),
			__( 'Sheets Sync', 'oct-bulk-editor' ),
			'manage_woocommerce',
			self::SLUG,
			[ $this, 'render' ]
		);
	}

	public function handle_save(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'Forbidden', 'oct-bulk-editor' ) );
		}
		check_admin_referer( 'octwbe_sync_save' );

		$action = sanitize_key( $_POST['octwbe_action'] ?? '' );

		if ( $action === 'generate' ) {
			update_option( 'octwbe_sync_token', wp_generate_password( 48, false ) );
		} elseif ( $action === 'revoke' ) {
			delete_option( 'octwbe_sync_token' );
		}

		update_option( 'octwbe_sync_stock_readonly', isset( $_POST['stock_readonly'] ) ? 1 : 0 );

		// Auto-update GitHub token (fine-grained, Contents: read on the repo).
		if ( isset( $_POST['github_token'] ) ) {
			$gh = trim( (string) wp_unslash( $_POST['github_token'] ) );
			if ( $gh === '' ) {
				delete_option( 'octwbe_github_token' );
			} else {
				update_option( 'octwbe_github_token', sanitize_text_field( $gh ) );
			}
		}

		$args = [ 'page' => self::SLUG, 'updated' => 1 ];

		// "Test connection" runs the updater's diagnostic and reports the result.
		if ( $action === 'test_update' ) {
			$token = (string) get_option( 'octwbe_github_token', '' );
			$repo  = (string) get_option( 'octwbe_github_repo', 'octobercomms/claude' );
			require_once OCTWBE_PLUGIN_DIR . 'includes/class-octwbe-updater.php';
			$updater = new OCTWBE_Updater( OCTWBE_BASENAME, OCTWBE_VERSION, $repo, $token, 'octwbe-v' );
			$result  = $updater->diagnose();
			set_transient( 'octwbe_update_test', $result, 60 );
			$args['tested'] = 1;
		}

		wp_safe_redirect( add_query_arg( $args, admin_url( 'admin.php' ) ) );
		exit;
	}

	public function render(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'You do not have permission to access this page.', 'oct-bulk-editor' ) );
		}

		$token        = (string) get_option( 'octwbe_sync_token', '' );
		$stock_ro     = (bool) get_option( 'octwbe_sync_stock_readonly', 1 );
		$api_base     = untrailingslashit( rest_url( OCTWBE_REST::NS ) );
		$script       = $token !== '' ? $this->build_script( $api_base, $token ) : '';
		$github_token = (string) get_option( 'octwbe_github_token', '' );
		$update_test  = get_transient( 'octwbe_update_test' );
		delete_transient( 'octwbe_update_test' );

		include OCTWBE_PLUGIN_DIR . 'includes/sync-page-view.php';
	}

	/** Load the Apps Script template and inject this store's URL + token. */
	private function build_script( string $api_base, string $token ): string {
		$gs = (string) file_get_contents( OCTWBE_PLUGIN_DIR . 'assets/google-apps-script.gs' );
		$gs = str_replace( '__API_BASE__', $api_base, $gs );
		$gs = str_replace( '__TOKEN__', $token, $gs );
		return $gs;
	}
}
