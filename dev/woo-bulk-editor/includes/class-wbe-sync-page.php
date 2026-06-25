<?php
/**
 * "Sheets Sync" admin screen.
 *
 * Generates the shared API token, exposes the per-store settings, and renders
 * the ready-to-paste Google Apps Script (with this store's URL + token already
 * filled in).
 *
 * @package WooBulkEditor
 */

defined( 'ABSPATH' ) || exit;

class WBE_Sync_Page {

	const SLUG = 'woo-bulk-editor-sync';

	public function __construct() {
		add_action( 'admin_menu', [ $this, 'menu' ] );
		add_action( 'admin_post_wbe_sync_save', [ $this, 'handle_save' ] );
	}

	public function menu(): void {
		add_submenu_page(
			'woocommerce',
			__( 'Bulk Editor – Sheets Sync', 'woo-bulk-editor' ),
			__( 'Sheets Sync', 'woo-bulk-editor' ),
			'manage_woocommerce',
			self::SLUG,
			[ $this, 'render' ]
		);
	}

	public function handle_save(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'Forbidden', 'woo-bulk-editor' ) );
		}
		check_admin_referer( 'wbe_sync_save' );

		$action = sanitize_key( $_POST['wbe_action'] ?? '' );

		if ( $action === 'generate' ) {
			update_option( 'wbe_sync_token', wp_generate_password( 48, false ) );
		} elseif ( $action === 'revoke' ) {
			delete_option( 'wbe_sync_token' );
		}

		update_option( 'wbe_sync_stock_readonly', isset( $_POST['stock_readonly'] ) ? 1 : 0 );

		wp_safe_redirect( add_query_arg(
			[ 'page' => self::SLUG, 'updated' => 1 ],
			admin_url( 'admin.php' )
		) );
		exit;
	}

	public function render(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'You do not have permission to access this page.', 'woo-bulk-editor' ) );
		}

		$token    = (string) get_option( 'wbe_sync_token', '' );
		$stock_ro = (bool) get_option( 'wbe_sync_stock_readonly', 1 );
		$api_base = untrailingslashit( rest_url( WBE_REST::NS ) );
		$script   = $token !== '' ? $this->build_script( $api_base, $token ) : '';

		include WBE_PLUGIN_DIR . 'includes/sync-page-view.php';
	}

	/** Load the Apps Script template and inject this store's URL + token. */
	private function build_script( string $api_base, string $token ): string {
		$gs = (string) file_get_contents( WBE_PLUGIN_DIR . 'assets/google-apps-script.gs' );
		$gs = str_replace( '__API_BASE__', $api_base, $gs );
		$gs = str_replace( '__TOKEN__', $token, $gs );
		return $gs;
	}
}
