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
		$mode          = get_option( 'ocad_site_mode', 'hub' );
		$api_key       = get_option( 'ocad_api_key', '' );
		$hub_url       = get_option( 'ocad_hub_url', '' );
		$hub_api_key   = get_option( 'ocad_hub_api_key', '' );
		$partner_sites = get_option( 'ocad_partner_sites', array() );

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

					<table class="form-table">
						<tr>
							<th><?php esc_html_e( 'API Key', 'oc-ad-manager' ); ?></th>
							<td>
								<?php if ( $api_key ) : ?>
									<code class="ocad-api-key-display"><?php echo esc_html( $api_key ); ?></code>
									<button type="button" class="button button-small ocad-copy-key" style="margin-left:8px;">
										<?php esc_html_e( 'Copy', 'oc-ad-manager' ); ?>
									</button>
								<?php else : ?>
									<em><?php esc_html_e( 'No key generated yet. Save settings to generate one.', 'oc-ad-manager' ); ?></em>
								<?php endif; ?>
								<p class="description">
									<?php esc_html_e( 'Give this key to partner sites so they can pull ads. Keep it secret.', 'oc-ad-manager' ); ?>
								</p>
							</td>
						</tr>
						<?php if ( $api_key ) : ?>
						<tr>
							<th></th>
							<td>
								<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline;"
								      onsubmit="return confirm('<?php esc_attr_e( 'Regenerate key? Partner sites will need to update their key.', 'oc-ad-manager' ); ?>');">
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
							<th><?php esc_html_e( 'Partner Websites', 'oc-ad-manager' ); ?></th>
							<td>
								<p class="description">
									<?php esc_html_e( 'Record your partner sites here for reference. Install Ad Manager by October Communications on each site, set it to Partner mode, and paste this hub\'s URL and API key there.', 'oc-ad-manager' ); ?>
								</p>
								<ul class="ocad-partner-sites-list">
									<?php foreach ( $partner_sites as $idx => $site_url ) : ?>
									<li>
										<input type="url" name="ocad_partner_sites[<?php echo esc_attr( $idx ); ?>]"
										       class="regular-text" value="<?php echo esc_attr( $site_url ); ?>"
										       placeholder="https://partner-site.com">
										<button type="button" class="button ocad-remove-partner"><?php esc_html_e( 'Remove', 'oc-ad-manager' ); ?></button>
									</li>
									<?php endforeach; ?>
								</ul>
								<button type="button" class="button ocad-add-partner" style="margin-top:8px;">
									+ <?php esc_html_e( 'Add Partner Site', 'oc-ad-manager' ); ?>
								</button>
							</td>
						</tr>
					</table>

					<div style="background:#f0f6ff;border:1px solid #c3d8f7;padding:14px 18px;border-radius:4px;margin-top:10px;">
						<strong><?php esc_html_e( 'Setup instructions for partner sites:', 'oc-ad-manager' ); ?></strong>
						<ol style="margin:8px 0 0 20px;">
							<li><?php esc_html_e( 'Install Ad Manager by October Communications on the partner site.', 'oc-ad-manager' ); ?></li>
							<li><?php esc_html_e( 'Go to OC Ad Manager → Settings and set mode to "Partner".', 'oc-ad-manager' ); ?></li>
							<li>
								<?php esc_html_e( 'Enter this site\'s URL:', 'oc-ad-manager' ); ?>
								<code><?php echo esc_html( home_url( '/' ) ); ?></code>
							</li>
							<li><?php esc_html_e( 'Paste the API key above into the Hub API Key field.', 'oc-ad-manager' ); ?></li>
							<li><?php esc_html_e( 'Use the same shortcodes on the partner site — ads and stats all flow back here.', 'oc-ad-manager' ); ?></li>
						</ol>
					</div>
				</div>

				<!-- ── Partner settings ── -->
				<div class="ocad-settings-section ocad-partner-settings" <?php echo $mode !== 'partner' ? 'style="display:none;"' : ''; ?>>
					<h3><?php esc_html_e( 'Partner Settings', 'oc-ad-manager' ); ?></h3>
					<p><?php esc_html_e( 'This site will fetch and display ads from your Hub. All impressions and clicks are tracked on the Hub.', 'oc-ad-manager' ); ?></p>

					<table class="form-table">
						<tr>
							<th><label for="ocad_hub_url"><?php esc_html_e( 'Hub Site URL', 'oc-ad-manager' ); ?></label></th>
							<td>
								<input type="url" id="ocad_hub_url" name="ocad_hub_url" class="regular-text"
								       placeholder="https://atlantadesignfestival.com"
								       value="<?php echo esc_attr( $hub_url ); ?>">
								<p class="description"><?php esc_html_e( 'The URL of the Atlanta Design Festival (hub) WordPress site.', 'oc-ad-manager' ); ?></p>
							</td>
						</tr>
						<tr>
							<th><label for="ocad_hub_api_key"><?php esc_html_e( 'Hub API Key', 'oc-ad-manager' ); ?></label></th>
							<td>
								<input type="text" id="ocad_hub_api_key" name="ocad_hub_api_key" class="regular-text"
								       value="<?php echo esc_attr( $hub_api_key ); ?>">
								<p class="description"><?php esc_html_e( 'Copy this from OC Ad Manager → Settings on the Hub site.', 'oc-ad-manager' ); ?></p>
							</td>
						</tr>
						<tr>
							<th><?php esc_html_e( 'Cache Duration', 'oc-ad-manager' ); ?></th>
							<td>
								<p class="description"><?php esc_html_e( 'Ads are cached for 5 minutes to avoid excessive requests to the Hub. This is automatic and cannot be changed here.', 'oc-ad-manager' ); ?></p>
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

		// Partner sites list (hub mode).
		$raw_sites = isset( $_POST['ocad_partner_sites'] ) && is_array( $_POST['ocad_partner_sites'] )
			? $_POST['ocad_partner_sites']
			: array();
		$sites = array_values( array_filter( array_map( 'esc_url_raw', $raw_sites ) ) );
		update_option( 'ocad_partner_sites', $sites );

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
