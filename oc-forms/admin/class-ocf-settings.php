<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCF_Settings {

	public static function init() {
		add_action( 'admin_init', array( __CLASS__, 'register' ) );
	}

	public static function register() {
		register_setting( 'ocf_settings', 'ocf_brevo_api_key',        array( 'sanitize_callback' => 'sanitize_text_field' ) );
		register_setting( 'ocf_settings', 'ocf_brevo_event_key',      array( 'sanitize_callback' => 'sanitize_text_field' ) );
		register_setting( 'ocf_settings', 'ocf_turnstile_site_key',   array( 'sanitize_callback' => 'sanitize_text_field' ) );
		register_setting( 'ocf_settings', 'ocf_turnstile_secret_key', array( 'sanitize_callback' => 'sanitize_text_field' ) );
		register_setting( 'ocf_settings', 'ocf_notify_email',         array( 'sanitize_callback' => 'sanitize_email' ) );
		register_setting( 'ocf_settings', 'ocf_from_name',            array( 'sanitize_callback' => 'sanitize_text_field' ) );
		register_setting( 'ocf_settings', 'ocf_from_email',           array( 'sanitize_callback' => 'sanitize_email' ) );
		register_setting( 'ocf_settings', 'ocf_api_key',              array( 'sanitize_callback' => 'sanitize_text_field' ) );

		add_action( 'admin_post_ocf_regenerate_api_key', array( __CLASS__, 'regenerate_api_key' ) );
	}

	public static function regenerate_api_key() {
		if ( ! current_user_can( 'manage_options' ) ) { wp_die( 'Forbidden' ); }
		check_admin_referer( 'ocf_regenerate_api_key' );
		update_option( 'ocf_api_key', wp_generate_password( 48, false, false ) );
		wp_safe_redirect( admin_url( 'admin.php?page=oc-forms-settings&regenerated=1' ) );
		exit;
	}

	public static function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$brevo_key   = get_option( 'ocf_brevo_api_key', '' );
		$brevo_event = get_option( 'ocf_brevo_event_key', '' );
		$ts_site     = get_option( 'ocf_turnstile_site_key', '' );
		$ts_secret   = get_option( 'ocf_turnstile_secret_key', '' );
		$notify      = get_option( 'ocf_notify_email', get_option( 'admin_email' ) );
		$from_name   = get_option( 'ocf_from_name', get_bloginfo( 'name' ) );
		$from_email  = get_option( 'ocf_from_email', get_option( 'admin_email' ) );
		$api_key     = get_option( 'ocf_api_key', '' );
		$api_base    = rest_url( OCF_Public_API::NAMESPACE_API . '/api/' );
		?>
		<?php if ( ! empty( $_GET['regenerated'] ) ) : ?>
			<div class="notice notice-success is-dismissible"><p>API key regenerated. Update your external apps with the new key.</p></div>
		<?php endif; ?>
		<div class="wrap">
			<h1>October Forms — Settings</h1>
			<form method="post" action="options.php">
				<?php settings_fields( 'ocf_settings' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="ocf_brevo_api_key">Brevo API key (v3)</label></th>
						<td>
							<input type="password" autocomplete="off" id="ocf_brevo_api_key" name="ocf_brevo_api_key" value="<?php echo esc_attr( $brevo_key ); ?>" class="regular-text">
							<p class="description">Used for contact upsert. Get from Brevo → SMTP &amp; API → API keys.</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="ocf_brevo_event_key">Brevo Marketing Automation key</label></th>
						<td>
							<input type="password" autocomplete="off" id="ocf_brevo_event_key" name="ocf_brevo_event_key" value="<?php echo esc_attr( $brevo_event ); ?>" class="regular-text">
							<p class="description">For "track event" calls. Get from Brevo → Automation → Settings → Tracker code. Leave blank to reuse the API key above (most setups).</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="ocf_turnstile_site_key">Cloudflare Turnstile site key</label></th>
						<td>
							<input type="text" id="ocf_turnstile_site_key" name="ocf_turnstile_site_key" value="<?php echo esc_attr( $ts_site ); ?>" class="regular-text">
							<p class="description">Optional. Free anti-bot challenge. Get from Cloudflare → Turnstile.</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="ocf_turnstile_secret_key">Cloudflare Turnstile secret key</label></th>
						<td>
							<input type="password" autocomplete="off" id="ocf_turnstile_secret_key" name="ocf_turnstile_secret_key" value="<?php echo esc_attr( $ts_secret ); ?>" class="regular-text">
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="ocf_notify_email">Notification email</label></th>
						<td>
							<input type="email" id="ocf_notify_email" name="ocf_notify_email" value="<?php echo esc_attr( $notify ); ?>" class="regular-text">
							<p class="description">Where new submissions are emailed. Leave blank for the site admin email. Per-form CC addresses can be added in each form's <em>Notifications</em> tab.</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="ocf_from_name">Email from name</label></th>
						<td>
							<input type="text" id="ocf_from_name" name="ocf_from_name" value="<?php echo esc_attr( $from_name ); ?>" class="regular-text" placeholder="<?php echo esc_attr( get_bloginfo( 'name' ) ); ?>">
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="ocf_from_email">Email from address</label></th>
						<td>
							<input type="email" id="ocf_from_email" name="ocf_from_email" value="<?php echo esc_attr( $from_email ); ?>" class="regular-text" placeholder="<?php echo esc_attr( get_option( 'admin_email' ) ); ?>">
							<p class="description">Used as the <code>From:</code> header on lead notification emails. The domain must be verified in your SMTP provider (e.g. Amazon SES) — set up SES via an SMTP plugin such as WP Mail SMTP, then this <code>From</code> will route through it automatically.</p>
						</td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>

			<hr style="margin: 32px 0;">
			<h2>External API</h2>
			<p>Read-only JSON API for external apps (e.g. the Platform reporting dashboard). Authenticate with the key below via the <code>X-OCF-Api-Key</code> header or <code>?api_key=…</code> query string.</p>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row">API base URL</th>
					<td><code><?php echo esc_html( $api_base ); ?></code></td>
				</tr>
				<tr>
					<th scope="row"><label for="ocf_api_key">API key</label></th>
					<td>
						<input type="text" readonly id="ocf_api_key_view" value="<?php echo esc_attr( $api_key ); ?>" class="large-text code" onfocus="this.select()" placeholder="(none — generate one below)">
						<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="margin-top: 8px;">
							<input type="hidden" name="action" value="ocf_regenerate_api_key">
							<?php wp_nonce_field( 'ocf_regenerate_api_key' ); ?>
							<?php submit_button( $api_key ? 'Regenerate API key' : 'Generate API key', 'secondary', 'submit', false ); ?>
							<?php if ( $api_key ) : ?>
								<span class="description" style="margin-left: 8px;">Regenerating immediately invalidates the old key.</span>
							<?php endif; ?>
						</form>
					</td>
				</tr>
			</table>
			<?php if ( $api_key ) : ?>
			<h3>Endpoints</h3>
			<ul style="list-style: disc; margin-left: 24px;">
				<li><code>GET <?php echo esc_html( $api_base ); ?>health</code></li>
				<li><code>GET <?php echo esc_html( $api_base ); ?>forms</code></li>
				<li><code>GET <?php echo esc_html( $api_base ); ?>forms/{id}</code></li>
				<li><code>GET <?php echo esc_html( $api_base ); ?>forms/{id}/stats?from=YYYY-MM-DD&amp;to=YYYY-MM-DD</code></li>
				<li><code>GET <?php echo esc_html( $api_base ); ?>forms/{id}/funnel?from=&amp;to=</code></li>
				<li><code>GET <?php echo esc_html( $api_base ); ?>forms/{id}/timeseries?from=&amp;to=</code></li>
				<li><code>GET <?php echo esc_html( $api_base ); ?>forms/{id}/submissions?from=&amp;to=&amp;status=&amp;limit=50&amp;offset=0</code></li>
				<li><code>GET <?php echo esc_html( $api_base ); ?>submissions/{id}</code></li>
			</ul>
			<h3>Example</h3>
			<pre style="background: #f0f0f1; padding: 12px; overflow: auto;">curl -H "X-OCF-Api-Key: <?php echo esc_html( $api_key ); ?>" \
  "<?php echo esc_url( $api_base ); ?>forms"</pre>
			<?php endif; ?>
		</div>
		<?php
	}
}
