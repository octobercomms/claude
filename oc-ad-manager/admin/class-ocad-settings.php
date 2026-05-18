<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCAD_Settings {

	public function __construct() {
		add_action( 'admin_menu', array( $this, 'register_menu' ), 20 );
		add_action( 'admin_post_ocad_save_settings', array( $this, 'handle_save' ) );
		add_action( 'admin_post_ocad_regenerate_key', array( $this, 'handle_regenerate_key' ) );
	}

	public function register_menu() {
		add_submenu_page(
			'oc-ad-manager',
			__( 'Settings', 'oc-ad-manager' ),
			__( 'Settings', 'oc-ad-manager' ),
			'manage_options',
			'ocad-settings',
			array( $this, 'page_settings' )
		);
	}

	public function page_settings() {
		$mode        = get_option( 'ocad_site_mode', 'hub' );
		$api_key     = get_option( 'ocad_api_key', '' );
		$hub_url     = get_option( 'ocad_hub_url', '' );
		$hub_api_key = get_option( 'ocad_hub_api_key', '' );

		$message = '';
		if ( isset( $_GET['ocad_settings'] ) ) {
			$message = sanitize_key( $_GET['ocad_settings'] ) === 'saved' ? __( 'Settings saved.', 'oc-ad-manager' ) : '';
		}
		?>
		<div class="wrap ocad-wrap">
			<h1><?php esc_html_e( 'Ad Manager by October Communications – Settings', 'oc-ad-manager' ); ?></h1>
			<hr class="wp-header-end">

			<?php if ( $message ) : ?>
				<div class="notice notice-success is-dismissible"><p><?php echo esc_html( $message ); ?></p></div>
			<?php endif; ?>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="ocad_save_settings">
				<?php wp_nonce_field( 'ocad_save_settings' ); ?>

				<!-- ── Site Mode ── -->
				<div class="ocad-settings-section">
					<h3><?php esc_html_e( 'Site Mode', 'oc-ad-manager' ); ?></h3>
					<p><?php esc_html_e( 'Set this site as the central Hub (manages all campaigns), or as a Partner site (pulls ads from the Hub).', 'oc-ad-manager' ); ?></p>

					<div class="ocad-mode-selector">
						<label class="ocad-mode-option">
							<input type="radio" name="ocad_site_mode" value="hub" <?php checked( $mode, 'hub' ); ?>>
							<span><?php esc_html_e( 'Hub (primary)', 'oc-ad-manager' ); ?></span>
						</label>
						<label class="ocad-mode-option">
							<input type="radio" name="ocad_site_mode" value="partner" <?php checked( $mode, 'partner' ); ?>>
							<span><?php esc_html_e( 'Partner (pull from Hub)', 'oc-ad-manager' ); ?></span>
						</label>
					</div>
				</div>

				<!-- ── Hub settings ── -->
				<div class="ocad-settings-section ocad-hub-settings" <?php echo $mode !== 'hub' ? 'style="display:none;"' : ''; ?>>
					<h3><?php esc_html_e( 'Hub Settings', 'oc-ad-manager' ); ?></h3>
					<p><?php esc_html_e( 'This site manages all campaigns. Partner sites use the API key below to pull ads — no configuration needed here per partner site.', 'oc-ad-manager' ); ?></p>

					<table class="form-table">
						<tr>
							<th><?php esc_html_e( 'API Key', 'oc-ad-manager' ); ?></th>
							<td>
								<?php if ( $api_key ) : ?>
									<code class="ocad-api-key-display"><?php echo esc_html( $api_key ); ?></code>
									<button type="button" class="button button-small ocad-copy-key" style="margin-left:8px;">
										<?php esc_html_e( 'Copy', 'oc-ad-manager' ); ?>
									</button>
									<p class="description">
										<?php esc_html_e( 'Paste this key into the Hub API Key field on each partner site. One key works for all partner sites.', 'oc-ad-manager' ); ?>
									</p>
								<?php else : ?>
									<em><?php esc_html_e( 'No key generated yet. Save settings to generate one.', 'oc-ad-manager' ); ?></em>
								<?php endif; ?>
							</td>
						</tr>
						<?php if ( $api_key ) : ?>
						<tr>
							<th></th>
							<td>
								<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline;"
								      onsubmit="return confirm('<?php esc_attr_e( 'Regenerate key? All partner sites will stop working until you update their key.', 'oc-ad-manager' ); ?>');">
									<input type="hidden" name="action" value="ocad_regenerate_key">
									<?php wp_nonce_field( 'ocad_regenerate_key' ); ?>
									<button type="submit" class="button">
										<?php esc_html_e( 'Regenerate API Key', 'oc-ad-manager' ); ?>
									</button>
								</form>
							</td>
						</tr>
						<?php endif; ?>
							<tr>
								<th><label for="ocad_partner_sites_notes"><?php esc_html_e( 'Partner Sites', 'oc-ad-manager' ); ?></label></th>
								<td>
									<textarea id="ocad_partner_sites_notes" name="ocad_partner_sites_notes"
									          rows="4" class="large-text"
									          placeholder="https://architecturetours.us&#10;https://ma-designishuman.com&#10;https://staging.atlantadesignfestival.net"
									><?php echo esc_textarea( get_option( 'ocad_partner_sites_notes', '' ) ); ?></textarea>
									<p class="description"><?php esc_html_e( 'Your own record of which sites use this key — one URL per line. No functional effect; useful when you regenerate the key and need to know which sites to update.', 'oc-ad-manager' ); ?></p>
								</td>
							</tr>
						</table>

					<div style="background:#f0f6ff;border:1px solid #c3d8f7;padding:14px 18px;border-radius:4px;margin-top:16px;">
						<strong><?php esc_html_e( 'Setting up a partner site:', 'oc-ad-manager' ); ?></strong>
						<ol style="margin:8px 0 0 20px;">
							<li><?php esc_html_e( 'Install Ad Manager by October Communications on the partner site.', 'oc-ad-manager' ); ?></li>
							<li><?php esc_html_e( 'Go to Ad Manager → Settings on that site and choose "Partner" mode.', 'oc-ad-manager' ); ?></li>
							<li>
								<?php esc_html_e( 'Enter this site\'s URL:', 'oc-ad-manager' ); ?>
								<code><?php echo esc_html( home_url( '/' ) ); ?></code>
							</li>
							<li><?php esc_html_e( 'Paste the API key above into the Hub API Key field and save.', 'oc-ad-manager' ); ?></li>
							<li><?php esc_html_e( 'Place the same shortcodes on the partner site. Impressions and clicks report back here automatically.', 'oc-ad-manager' ); ?></li>
						</ol>
					</div>
				</div>

				<!-- ── Partner settings ── -->
				<div class="ocad-settings-section ocad-partner-settings" <?php echo $mode !== 'partner' ? 'style="display:none;"' : ''; ?>>
					<h3><?php esc_html_e( 'Partner Settings', 'oc-ad-manager' ); ?></h3>
					<p><?php esc_html_e( 'This site pulls ads from the Hub. All impressions and clicks are tracked on the Hub site — nothing to manage here.', 'oc-ad-manager' ); ?></p>

					<table class="form-table">
						<tr>
							<th><label for="ocad_hub_url"><?php esc_html_e( 'Hub Site URL', 'oc-ad-manager' ); ?></label></th>
							<td>
								<input type="url" id="ocad_hub_url" name="ocad_hub_url" class="regular-text"
								       placeholder="https://atlantadesignfestival.net"
								       value="<?php echo esc_attr( $hub_url ); ?>">
							</td>
						</tr>
						<tr>
							<th><label for="ocad_hub_api_key"><?php esc_html_e( 'Hub API Key', 'oc-ad-manager' ); ?></label></th>
							<td>
								<input type="text" id="ocad_hub_api_key" name="ocad_hub_api_key" class="regular-text"
								       value="<?php echo esc_attr( $hub_api_key ); ?>">
								<p class="description"><?php esc_html_e( 'Copy this from Ad Manager → Settings on the Hub site.', 'oc-ad-manager' ); ?></p>
							</td>
						</tr>
					</table>
				</div>

				<?php submit_button( __( 'Save Settings', 'oc-ad-manager' ) ); ?>
			</form>
		</div>
		<?php
	}

	public function handle_save() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Permission denied.', 'oc-ad-manager' ) );
		}

		check_admin_referer( 'ocad_save_settings' );

		$mode = sanitize_key( $_POST['ocad_site_mode'] ?? 'hub' );
		update_option( 'ocad_site_mode', in_array( $mode, array( 'hub', 'partner' ), true ) ? $mode : 'hub' );

		// Generate API key on first save if in hub mode.
		if ( $mode === 'hub' && ! get_option( 'ocad_api_key' ) ) {
			update_option( 'ocad_api_key', self::generate_api_key() );
		}

		// Partner sites notes (free-text, hub mode).
		update_option( 'ocad_partner_sites_notes', sanitize_textarea_field( wp_unslash( $_POST['ocad_partner_sites_notes'] ?? '' ) ) );

		// Partner mode settings.
		update_option( 'ocad_hub_url', esc_url_raw( wp_unslash( $_POST['ocad_hub_url'] ?? '' ) ) );
		update_option( 'ocad_hub_api_key', sanitize_text_field( wp_unslash( $_POST['ocad_hub_api_key'] ?? '' ) ) );

		wp_safe_redirect( add_query_arg(
			array( 'page' => 'ocad-settings', 'ocad_settings' => 'saved' ),
			admin_url( 'admin.php' )
		) );
		exit;
	}

	public function handle_regenerate_key() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Permission denied.', 'oc-ad-manager' ) );
		}

		check_admin_referer( 'ocad_regenerate_key' );
		update_option( 'ocad_api_key', self::generate_api_key() );

		wp_safe_redirect( add_query_arg(
			array( 'page' => 'ocad-settings', 'ocad_settings' => 'saved' ),
			admin_url( 'admin.php' )
		) );
		exit;
	}

	public static function generate_api_key() {
		return bin2hex( random_bytes( 24 ) );
	}
}
