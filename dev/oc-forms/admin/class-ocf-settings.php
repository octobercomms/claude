<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCF_Settings {

	public static function init() {
		add_action( 'admin_init', array( __CLASS__, 'register' ) );
		// Priority 1 so we redirect before any other plugin's admin_init
		// handler can flush output and break the redirect.
		add_action( 'admin_init', array( __CLASS__, 'dispatch_actions' ), 1 );
	}

	public static function register() {
		register_setting( 'ocf_settings', 'ocf_brevo_api_key',        array( 'sanitize_callback' => 'sanitize_text_field' ) );
		register_setting( 'ocf_settings', 'ocf_brevo_event_key',      array( 'sanitize_callback' => 'sanitize_text_field' ) );
		register_setting( 'ocf_settings', 'ocf_turnstile_site_key',   array( 'sanitize_callback' => 'sanitize_text_field' ) );
		register_setting( 'ocf_settings', 'ocf_turnstile_secret_key', array( 'sanitize_callback' => 'sanitize_text_field' ) );
		register_setting( 'ocf_settings', 'ocf_notify_email',         array( 'sanitize_callback' => 'sanitize_email' ) );
		register_setting( 'ocf_settings', 'ocf_from_name',            array( 'sanitize_callback' => 'sanitize_text_field' ) );
		register_setting( 'ocf_settings', 'ocf_from_email',           array( 'sanitize_callback' => 'sanitize_email' ) );
		register_setting( 'ocf_settings', 'ocf_ses_enabled',          array( 'sanitize_callback' => array( __CLASS__, 'sanitize_bool' ) ) );
		register_setting( 'ocf_settings', 'ocf_ses_region',           array( 'sanitize_callback' => 'sanitize_text_field' ) );
		register_setting( 'ocf_settings', 'ocf_ses_smtp_username',    array( 'sanitize_callback' => 'sanitize_text_field' ) );
		register_setting( 'ocf_settings', 'ocf_ses_smtp_password',    array( 'sanitize_callback' => 'sanitize_text_field' ) );
		register_setting( 'ocf_settings', 'ocf_ses_smtp_port',        array( 'sanitize_callback' => 'absint' ) );
		register_setting( 'ocf_settings', 'ocf_api_key',              array( 'sanitize_callback' => 'sanitize_text_field' ) );
	}

	public static function sanitize_bool( $v ) {
		return $v ? 1 : 0;
	}

	/**
	 * One central dispatcher for every plugin admin action. Triggers off
	 * a single `ocf_action` parameter (GET or POST). Fires early enough
	 * that no other plugin can flush output before our redirect.
	 */
	public static function dispatch_actions() {
		$action = isset( $_REQUEST['ocf_action'] ) ? sanitize_key( wp_unslash( $_REQUEST['ocf_action'] ) ) : '';
		if ( ! $action ) { return; }
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'Forbidden' );
		}

		switch ( $action ) {
			case 'regenerate_api_key':
				check_admin_referer( 'ocf_regenerate_api_key' );
				update_option( 'ocf_api_key', wp_generate_password( 48, false, false ) );
				self::redirect( admin_url( 'admin.php?page=oc-forms-settings&regenerated=1' ) );
				break;

			case 'send_test_email':
				check_admin_referer( 'ocf_send_test_email' );
				OCF_Mail::handle_test_email_inline();
				break;

			case 'duplicate_form':
				$source_id = absint( $_REQUEST['form_id'] ?? 0 );
				check_admin_referer( 'ocf_duplicate_form_' . $source_id );
				OCF_Admin::duplicate_form_inline( $source_id );
				break;

			case 'bulk_delete_submissions':
				check_admin_referer( 'ocf_bulk_delete_submissions' );
				OCF_Submissions_List::bulk_delete_inline();
				break;

			case 'delete_submission':
				$id = absint( $_REQUEST['id'] ?? 0 );
				check_admin_referer( 'ocf_delete_submission_' . $id );
				OCF_Submissions_List::single_delete_inline( $id );
				break;
		}
	}

	/**
	 * Redirect that survives the "headers already sent" case: some other
	 * plugins flush output early, which makes wp_safe_redirect a silent
	 * no-op. Fall back to a JS / meta-refresh.
	 */
	public static function redirect( $url ) {
		$url = wp_validate_redirect( $url, admin_url() );
		if ( ! headers_sent() ) {
			wp_safe_redirect( $url );
			exit;
		}
		printf(
			'<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=%1$s"><script>window.location.href=%2$s;</script><title>Redirecting…</title></head><body><p>Redirecting… <a href="%1$s">Continue</a>.</p></body></html>',
			esc_attr( $url ),
			wp_json_encode( $url )
		);
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
		$ses_enabled = (bool) get_option( 'ocf_ses_enabled', false );
		$ses_region  = get_option( 'ocf_ses_region', 'us-east-1' );
		$ses_user    = get_option( 'ocf_ses_smtp_username', '' );
		$ses_pass    = get_option( 'ocf_ses_smtp_password', '' );
		$ses_port    = (int) get_option( 'ocf_ses_smtp_port', 587 );
		$api_key     = get_option( 'ocf_api_key', '' );
		$api_base    = rest_url( OCF_Public_API::NAMESPACE_API . '/api/' );

		$test_status = isset( $_GET['test'] ) ? sanitize_text_field( $_GET['test'] ) : '';
		$test_err    = get_transient( 'ocf_test_mail_error' );
		if ( $test_status === 'fail' ) { delete_transient( 'ocf_test_mail_error' ); }
		?>
		<?php if ( ! empty( $_GET['regenerated'] ) ) : ?>
			<div class="notice notice-success is-dismissible"><p>API key regenerated. Update your external apps with the new key.</p></div>
		<?php endif; ?>
		<?php if ( $test_status === 'ok' ) : ?>
			<div class="notice notice-success is-dismissible"><p>Test email sent successfully.</p></div>
		<?php elseif ( $test_status === 'invalid' ) : ?>
			<div class="notice notice-error is-dismissible"><p>Enter a valid recipient email and try again.</p></div>
		<?php elseif ( $test_status === 'fail' ) : ?>
			<div class="notice notice-error is-dismissible"><p>Test email failed.<?php echo $test_err ? ' Reason: <code>' . esc_html( $test_err ) . '</code>' : ''; ?> Check your SES credentials, region, and that the From address is a verified SES identity.</p></div>
		<?php endif; ?>
		<div class="wrap">
			<h1>October Forms — Settings <span style="font-size: 13px; color: #6c7781; font-weight: normal;">v<?php echo esc_html( OCF_VERSION ); ?></span></h1>
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
							<p class="description">Used as the <code>From:</code> header on lead notification emails. Must be a verified SES identity (or a verified domain).</p>
						</td>
					</tr>
				</table>

				<h2 style="margin-top: 32px;">Amazon SES (SMTP)</h2>
				<p>Send all WordPress emails through Amazon SES — no separate SMTP plugin required. Use SES <em>SMTP credentials</em> (generated in SES → SMTP settings → Create SMTP credentials). These are different from regular AWS access keys.</p>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row">Enable SES</th>
						<td>
							<label><input type="checkbox" name="ocf_ses_enabled" value="1" <?php checked( $ses_enabled ); ?>> Route every <code>wp_mail()</code> call through Amazon SES.</label>
							<p class="description">When off, WordPress uses its default mail transport.</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="ocf_ses_region">SES region</label></th>
						<td>
							<input type="text" id="ocf_ses_region" name="ocf_ses_region" value="<?php echo esc_attr( $ses_region ); ?>" class="regular-text" placeholder="us-east-1">
							<p class="description">e.g. <code>us-east-1</code>, <code>eu-west-1</code>, <code>eu-west-2</code> (London), <code>ap-southeast-2</code> (Sydney). Match the region where your verified SES identity lives.</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="ocf_ses_smtp_username">SMTP username</label></th>
						<td>
							<input type="text" autocomplete="off" id="ocf_ses_smtp_username" name="ocf_ses_smtp_username" value="<?php echo esc_attr( $ses_user ); ?>" class="regular-text" placeholder="AKIA…">
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="ocf_ses_smtp_password">SMTP password</label></th>
						<td>
							<input type="password" autocomplete="new-password" id="ocf_ses_smtp_password" name="ocf_ses_smtp_password" value="<?php echo esc_attr( $ses_pass ); ?>" class="regular-text">
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="ocf_ses_smtp_port">SMTP port</label></th>
						<td>
							<input type="number" min="1" max="65535" id="ocf_ses_smtp_port" name="ocf_ses_smtp_port" value="<?php echo (int) $ses_port; ?>" class="small-text">
							<p class="description">587 (STARTTLS — recommended) or 465 (SSL).</p>
						</td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>

			<?php if ( $ses_enabled ) : ?>
			<h3>Send a test email</h3>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin.php?page=oc-forms-settings' ) ); ?>" style="display: flex; gap: 8px; align-items: center; max-width: 600px;">
				<input type="hidden" name="ocf_action" value="send_test_email">
				<?php wp_nonce_field( 'ocf_send_test_email' ); ?>
				<input type="email" name="to" placeholder="you@example.com" class="regular-text" required>
				<?php submit_button( 'Send test email', 'secondary', 'submit', false ); ?>
			</form>
			<p class="description">Saves and runs <code>wp_mail()</code> through your current SES config. Both the recipient and your From address must be verified identities in SES (unless your account is out of sandbox).</p>
			<?php endif; ?>

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
						<?php $regen_url = wp_nonce_url(
							admin_url( 'admin.php?page=oc-forms-settings&ocf_action=regenerate_api_key' ),
							'ocf_regenerate_api_key'
						); ?>
						<p style="margin-top: 8px;">
							<a class="button button-secondary" href="<?php echo esc_url( $regen_url ); ?>"
								<?php if ( $api_key ) : ?>onclick="return confirm('Regenerate the API key? The current one will be immediately invalidated.');"<?php endif; ?>>
								<?php echo $api_key ? 'Regenerate API key' : 'Generate API key'; ?>
							</a>
							<?php if ( $api_key ) : ?>
								<span class="description" style="margin-left: 8px;">Regenerating immediately invalidates the old key.</span>
							<?php endif; ?>
						</p>
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
