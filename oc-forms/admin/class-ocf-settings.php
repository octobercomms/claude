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
		?>
		<div class="wrap">
			<h1>nvelope Forms — Settings</h1>
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
							<p class="description">Where new submissions are emailed. Leave blank for the site admin email.</p>
						</td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>
		</div>
		<?php
	}
}
