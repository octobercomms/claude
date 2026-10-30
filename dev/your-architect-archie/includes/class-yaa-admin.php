<?php
/**
 * Settings screen (under the Archie Projects menu).
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Admin {

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_post_yaa_save_settings', array( __CLASS__, 'save' ) );
		add_action( 'admin_post_yaa_test_update', array( __CLASS__, 'act_test_update' ) );
	}

	public static function menu() {
		add_submenu_page(
			YAA_Projects_Admin::SLUG,
			__( 'Archie Settings', 'your-architect-archie' ),
			__( 'Settings', 'your-architect-archie' ),
			'manage_options',
			'yaa-settings',
			array( __CLASS__, 'render' )
		);
	}

	public static function save() {
		if ( ! current_user_can( 'manage_options' ) || ! check_admin_referer( 'yaa_settings' ) ) {
			wp_die( 'Nope' );
		}
		$in = wp_unslash( $_POST );

		// Per-stage editable email templates (subject + body).
		$templates = array();
		if ( isset( $in['tpl'] ) && is_array( $in['tpl'] ) ) {
			foreach ( $in['tpl'] as $kind => $vals ) {
				$kind = sanitize_key( $kind );
				$subject = isset( $vals['subject'] ) ? sanitize_text_field( $vals['subject'] ) : '';
				$body    = isset( $vals['body'] ) ? sanitize_textarea_field( $vals['body'] ) : '';
				if ( '' !== $subject || '' !== $body ) {
					$templates[ $kind ] = array( 'subject' => $subject, 'body' => $body );
				}
			}
		}

		YAA_Settings::update(
			array(
				'claude_api_key'     => isset( $in['claude_api_key'] ) ? $in['claude_api_key'] : '',
				'claude_model'       => sanitize_text_field( $in['claude_model'] ?? '' ),
				'max_output_tokens'  => (int) ( $in['max_output_tokens'] ?? 700 ),
				'notify_email'       => sanitize_email( $in['notify_email'] ?? '' ),
				'notify_emails'      => sanitize_text_field( $in['notify_emails'] ?? '' ),
				'terms_url'          => esc_url_raw( $in['terms_url'] ?? '' ),
				'privacy_url'        => esc_url_raw( $in['privacy_url'] ?? '' ),
				'chat_url'           => esc_url_raw( $in['chat_url'] ?? '' ),
				'email_templates'    => $templates,
				'arb_no'             => sanitize_text_field( $in['arb_no'] ?? '' ),
				'company_no'         => sanitize_text_field( $in['company_no'] ?? '' ),
				'rate_limit_per_min' => (int) ( $in['rate_limit_per_min'] ?? 12 ),
				'daily_token_cap'    => (int) ( $in['daily_token_cap'] ?? 500000 ),
				'session_daily_cap'  => (int) ( $in['session_daily_cap'] ?? 60 ),
			'ai_price_in'        => (float) ( $in['ai_price_in'] ?? 3.0 ),
			'ai_price_out'       => (float) ( $in['ai_price_out'] ?? 15.0 ),
			'ai_price_currency'  => sanitize_text_field( $in['ai_price_currency'] ?? '$' ),
				'stripe_secret_key'     => isset( $in['stripe_secret_key'] ) ? $in['stripe_secret_key'] : '',
				'stripe_publishable'    => sanitize_text_field( $in['stripe_publishable'] ?? '' ),
				'stripe_webhook_secret' => isset( $in['stripe_webhook_secret'] ) ? $in['stripe_webhook_secret'] : '',
				'brevo_api_key'         => isset( $in['brevo_api_key'] ) ? $in['brevo_api_key'] : '',
				'smtp_enabled'          => empty( $in['smtp_enabled'] ) ? 0 : 1,
				'smtp_host'             => sanitize_text_field( $in['smtp_host'] ?? '' ),
				'smtp_port'             => (int) ( $in['smtp_port'] ?? 587 ),
				'smtp_secure'           => in_array( ( $in['smtp_secure'] ?? 'tls' ), array( 'tls', 'ssl', 'none' ), true ) ? ( $in['smtp_secure'] ?? 'tls' ) : 'tls',
				'smtp_auth'             => empty( $in['smtp_auth'] ) ? 0 : 1,
				'smtp_user'             => sanitize_text_field( $in['smtp_user'] ?? '' ),
				'smtp_pass'             => isset( $in['smtp_pass'] ) ? $in['smtp_pass'] : '',
				'github_repo'           => sanitize_text_field( $in['github_repo'] ?? 'octobercomms/claude' ),
				'github_token'          => isset( $in['github_token'] ) ? $in['github_token'] : '',
				'github_tag_prefix'     => sanitize_text_field( $in['github_tag_prefix'] ?? 'yaa-v' ),
				'email_from'            => sanitize_email( $in['email_from'] ?? '' ),
				'email_from_name'       => sanitize_text_field( $in['email_from_name'] ?? '' ),
				'portal_page_id'        => (int) ( $in['portal_page_id'] ?? 0 ),
				'historic_api_on'       => empty( $in['historic_api_on'] ) ? 0 : 1,
			)
		);
		$clear = ( isset( $in['clear_secrets'] ) && is_array( $in['clear_secrets'] ) ) ? array_map( 'sanitize_key', $in['clear_secrets'] ) : array();
		if ( $clear ) {
			YAA_Settings::clear_secrets( $clear );
		}
		wp_safe_redirect( add_query_arg( 'updated', '1', wp_get_referer() ) );
		exit;
	}

	/** Diagnose the GitHub self-updater connection and report back on the settings page. */
	public static function act_test_update() {
		if ( ! current_user_can( 'manage_options' ) || ! check_admin_referer( 'yaa_test_update' ) ) {
			wp_die( 'Nope' );
		}
		$repo  = YAA_Settings::get( 'github_repo', '' );
		$token = YAA_Settings::get( 'github_token', '' );
		$res   = array( 'ok' => false, 'message' => __( 'Save a GitHub token first.', 'your-architect-archie' ) );
		if ( $repo && $token && class_exists( 'YAA_Updater' ) ) {
			$updater = new YAA_Updater( YAA_BASENAME, YAA_VERSION, $repo, $token, YAA_Settings::get( 'github_tag_prefix', 'yaa-v' ) );
			$res     = $updater->diagnose();
		}
		set_transient( 'yaa_update_test_' . get_current_user_id(), $res, 120 );
		$ref = wp_get_referer();
		wp_safe_redirect( add_query_arg( 'update_test', ! empty( $res['ok'] ) ? '1' : '0', $ref ? $ref : admin_url( 'admin.php?page=yaa-settings' ) ) );
		exit;
	}

	public static function render() {
		$s = YAA_Settings::all();
		$secret_ph = function ( $key ) {
			return YAA_Settings::has_secret( $key ) ? '••••••••  (set — leave blank to keep)' : '';
		};
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Archie Settings', 'your-architect-archie' ); ?></h1>
			<?php if ( isset( $_GET['updated'] ) ) : ?><div class="notice notice-success"><p><?php esc_html_e( 'Saved.', 'your-architect-archie' ); ?></p></div><?php endif; ?>
			<?php
			if ( isset( $_GET['smtp_test'] ) ) :
				$tr  = get_transient( 'yaa_smtp_test_' . get_current_user_id() );
				$to  = $tr && false !== strpos( (string) $tr, '|' ) ? substr( (string) $tr, strpos( (string) $tr, '|' ) + 1 ) : '';
				if ( '1' === $_GET['smtp_test'] ) : ?>
					<div class="notice notice-success"><p><?php echo esc_html( sprintf( __( 'Test email sent to %s. Check it arrived (and which inbox tab it landed in).', 'your-architect-archie' ), $to ) ); ?></p></div>
				<?php else : ?>
					<div class="notice notice-error"><p><?php echo esc_html( sprintf( __( 'Test email to %s failed — WordPress/PHPMailer could not send it. Check the host, port, encryption and login below.', 'your-architect-archie' ), $to ) ); ?></p></div>
				<?php endif; ?>
			<?php endif; ?>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="yaa_save_settings">
				<?php wp_nonce_field( 'yaa_settings' ); ?>
				<table class="form-table" role="presentation">
					<tr><th><?php esc_html_e( 'Claude API key', 'your-architect-archie' ); ?></th><td><input type="password" name="claude_api_key" class="regular-text" autocomplete="off" placeholder="<?php echo esc_attr( $secret_ph( 'claude_api_key' ) ); ?>"><?php if ( YAA_Settings::has_secret( 'claude_api_key' ) ) : ?> <label style="margin-left:8px;white-space:nowrap"><input type="checkbox" name="clear_secrets[]" value="claude_api_key"> <?php esc_html_e( 'Clear this key', 'your-architect-archie' ); ?></label><?php endif; ?><p class="description"><?php esc_html_e( 'Stored encrypted. Server-side only — never sent to the browser.', 'your-architect-archie' ); ?></p></td></tr>
					<tr><th><?php esc_html_e( 'Model', 'your-architect-archie' ); ?></th><td><input type="text" name="claude_model" class="regular-text" value="<?php echo esc_attr( $s['claude_model'] ); ?>"></td></tr>
					<tr><th><?php esc_html_e( 'Max output tokens', 'your-architect-archie' ); ?></th><td><input type="number" name="max_output_tokens" value="<?php echo esc_attr( $s['max_output_tokens'] ); ?>"></td></tr>
					<tr><th><?php esc_html_e( 'Turns / min / session', 'your-architect-archie' ); ?></th><td><input type="number" name="rate_limit_per_min" value="<?php echo esc_attr( $s['rate_limit_per_min'] ); ?>"> <span class="description"><?php esc_html_e( 'Rate limit to protect your Claude bill.', 'your-architect-archie' ); ?></span></td></tr>
					<tr><th><?php esc_html_e( 'Daily token cap', 'your-architect-archie' ); ?></th><td><input type="number" name="daily_token_cap" value="<?php echo esc_attr( $s['daily_token_cap'] ); ?>"> <span class="description"><?php esc_html_e( 'Global Claude spend guard for the day. 0 = no cap. When reached, new quotes pause for everyone until UTC midnight.', 'your-architect-archie' ); ?></span></td></tr>
					<tr><th><?php esc_html_e( 'Per-device daily limit', 'your-architect-archie' ); ?></th><td><input type="number" name="session_daily_cap" value="<?php echo esc_attr( $s['session_daily_cap'] ); ?>"> <span class="description"><?php esc_html_e( 'Max AI turns one visitor can use per day, so no single person can drain the global cap. 0 = no per-device limit.', 'your-architect-archie' ); ?></span></td></tr>
					<tr><th><?php esc_html_e( 'AI price (for cost estimate)', 'your-architect-archie' ); ?></th><td>
						<input type="text" name="ai_price_currency" value="<?php echo esc_attr( isset( $s['ai_price_currency'] ) ? $s['ai_price_currency'] : '$' ); ?>" style="width:3em" aria-label="<?php esc_attr_e( 'Currency symbol', 'your-architect-archie' ); ?>">
						<input type="number" step="0.01" min="0" name="ai_price_in" value="<?php echo esc_attr( isset( $s['ai_price_in'] ) ? $s['ai_price_in'] : 3 ); ?>" style="width:7em"> <?php esc_html_e( '/M input', 'your-architect-archie' ); ?>
						&nbsp; <input type="number" step="0.01" min="0" name="ai_price_out" value="<?php echo esc_attr( isset( $s['ai_price_out'] ) ? $s['ai_price_out'] : 15 ); ?>" style="width:7em"> <?php esc_html_e( '/M output', 'your-architect-archie' ); ?>
						<br><span class="description"><?php esc_html_e( 'Your model\'s published price per million tokens. Used only for the estimated monthly cost on the Analytics dashboard.', 'your-architect-archie' ); ?></span>
					</td></tr>
					<tr><th><?php esc_html_e( 'Notification email', 'your-architect-archie' ); ?></th><td><input type="email" name="notify_email" class="regular-text" value="<?php echo esc_attr( $s['notify_email'] ); ?>"></td></tr>
					<tr><th><?php esc_html_e( 'Also notify (extra emails)', 'your-architect-archie' ); ?></th><td><input type="text" name="notify_emails" class="regular-text" value="<?php echo esc_attr( $s['notify_emails'] ); ?>" placeholder="lawrence@…, info@…"><p class="description"><?php esc_html_e( 'Comma-separated. New-project and revision-request notifications go to all of these as well.', 'your-architect-archie' ); ?></p></td></tr>
					<tr><th><?php esc_html_e( 'Terms of Service URL', 'your-architect-archie' ); ?></th><td><input type="url" name="terms_url" class="regular-text" value="<?php echo esc_attr( $s['terms_url'] ); ?>" placeholder="<?php echo esc_attr( home_url( '/terms-of-service/' ) ); ?>"><p class="description"><?php esc_html_e( 'Archie links here for refund/cancellation questions; also shown at submit.', 'your-architect-archie' ); ?></p></td></tr>
					<tr><th><?php esc_html_e( 'Privacy Policy URL', 'your-architect-archie' ); ?></th><td><input type="url" name="privacy_url" class="regular-text" value="<?php echo esc_attr( $s['privacy_url'] ); ?>" placeholder="<?php echo esc_attr( home_url( '/privacy-policy/' ) ); ?>"><p class="description"><?php esc_html_e( 'Shown in the consent notice at submit.', 'your-architect-archie' ); ?></p></td></tr>
					<tr><th><?php esc_html_e( 'Chat page URL', 'your-architect-archie' ); ?></th><td><input type="url" name="chat_url" class="regular-text" value="<?php echo esc_attr( isset( $s['chat_url'] ) ? $s['chat_url'] : '' ); ?>" placeholder="<?php echo esc_attr( home_url( '/' ) ); ?>"><p class="description"><?php esc_html_e( 'The page where the Archie chat lives. The “Finish & submit” button in the emailed quote links here (with a secure resume token). Leave blank to use the home page.', 'your-architect-archie' ); ?></p></td></tr>
					<tr><th><?php esc_html_e( 'ARB reg. no.', 'your-architect-archie' ); ?></th><td><input type="text" name="arb_no" value="<?php echo esc_attr( $s['arb_no'] ); ?>"></td></tr>
					<tr><th><?php esc_html_e( 'Company no.', 'your-architect-archie' ); ?></th><td><input type="text" name="company_no" value="<?php echo esc_attr( $s['company_no'] ); ?>"></td></tr>
					<tr><th><?php esc_html_e( 'Historic England API', 'your-architect-archie' ); ?></th><td><label><input type="checkbox" name="historic_api_on" value="1" <?php checked( $s['historic_api_on'], 1 ); ?>> <?php esc_html_e( 'Use the live listed-building lookup (else heuristic).', 'your-architect-archie' ); ?></label></td></tr>
					<tr><th><?php esc_html_e( 'Stripe secret key', 'your-architect-archie' ); ?></th><td><input type="password" name="stripe_secret_key" class="regular-text" autocomplete="off" placeholder="<?php echo esc_attr( $secret_ph( 'stripe_secret_key' ) ); ?>"><?php if ( YAA_Settings::has_secret( 'stripe_secret_key' ) ) : ?> <label style="margin-left:8px;white-space:nowrap"><input type="checkbox" name="clear_secrets[]" value="stripe_secret_key"> <?php esc_html_e( 'Clear this key', 'your-architect-archie' ); ?></label><?php endif; ?></td></tr>
					<tr><th><?php esc_html_e( 'Stripe publishable key', 'your-architect-archie' ); ?></th><td><input type="text" name="stripe_publishable" class="regular-text" value="<?php echo esc_attr( $s['stripe_publishable'] ); ?>"></td></tr>
					<tr><th><?php esc_html_e( 'Stripe webhook secret', 'your-architect-archie' ); ?></th><td><input type="password" name="stripe_webhook_secret" class="regular-text" autocomplete="off" placeholder="<?php echo esc_attr( $secret_ph( 'stripe_webhook_secret' ) ); ?>"><?php if ( YAA_Settings::has_secret( 'stripe_webhook_secret' ) ) : ?> <label style="margin-left:8px;white-space:nowrap"><input type="checkbox" name="clear_secrets[]" value="stripe_webhook_secret"> <?php esc_html_e( 'Clear this key', 'your-architect-archie' ); ?></label><?php endif; ?><p class="description"><?php echo esc_html( 'Endpoint: ' . rest_url( 'yaa/v1/stripe-webhook' ) ); ?></p></td></tr>
					<tr><th><?php esc_html_e( 'Brevo API key', 'your-architect-archie' ); ?></th><td><input type="password" name="brevo_api_key" class="regular-text" autocomplete="off" placeholder="<?php echo esc_attr( $secret_ph( 'brevo_api_key' ) ); ?>"><?php if ( YAA_Settings::has_secret( 'brevo_api_key' ) ) : ?> <label style="margin-left:8px;white-space:nowrap"><input type="checkbox" name="clear_secrets[]" value="brevo_api_key"> <?php esc_html_e( 'Clear this key', 'your-architect-archie' ); ?></label><?php endif; ?><p class="description"><?php esc_html_e( 'Only the staged approval / preview / receipt emails use this (via the Brevo API). Leave it blank to route everything through the SMTP relay below, which also gives those emails our own open/click tracking.', 'your-architect-archie' ); ?> <?php echo esc_html( 'Webhook: ' . rest_url( 'yaa/v1/brevo-webhook' ) ); ?></p></td></tr>
					<tr><th><?php esc_html_e( 'Email from address', 'your-architect-archie' ); ?></th><td><input type="email" name="email_from" class="regular-text" value="<?php echo esc_attr( $s['email_from'] ); ?>"><p class="description"><?php esc_html_e( 'The From address for every email Archie sends. Use a real mailbox on your sending domain (the one your SMTP relay logs in as), or it may be rejected.', 'your-architect-archie' ); ?></p></td></tr>
					<tr><th><?php esc_html_e( 'Email from name', 'your-architect-archie' ); ?></th><td><input type="text" name="email_from_name" class="regular-text" value="<?php echo esc_attr( $s['email_from_name'] ); ?>"></td></tr>
					<tr><th><?php esc_html_e( 'Client portal page', 'your-architect-archie' ); ?></th><td><?php wp_dropdown_pages( array( 'name' => 'portal_page_id', 'selected' => (int) $s['portal_page_id'], 'show_option_none' => __( '— auto —', 'your-architect-archie' ), 'option_none_value' => 0 ) ); ?><p class="description"><?php esc_html_e( 'Page containing the [archie_portal] shortcode (auto-created on activation).', 'your-architect-archie' ); ?></p></td></tr>
				</table>

				<h2><?php esc_html_e( 'Software updates', 'your-architect-archie' ); ?></h2>
				<p class="description"><?php esc_html_e( 'One-click plugin updates straight from the private repo — no more uploading zips. Paste a GitHub fine-grained token with "Contents: read" on the octobercomms/claude repo, Save, then use "Test update connection" below. New versions then appear under Dashboard → Updates like any other plugin.', 'your-architect-archie' ); ?></p>
				<?php
				if ( isset( $_GET['update_test'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification
					$ut = get_transient( 'yaa_update_test_' . get_current_user_id() );
					if ( is_array( $ut ) && ! empty( $ut['message'] ) ) :
						?><div class="notice <?php echo ! empty( $ut['ok'] ) ? 'notice-success' : 'notice-error'; ?>"><p><?php echo esc_html( $ut['message'] ); ?></p></div><?php
					endif;
				endif;
				?>
				<table class="form-table" role="presentation">
					<tr><th><?php esc_html_e( 'GitHub repo', 'your-architect-archie' ); ?></th><td><input type="text" name="github_repo" class="regular-text" value="<?php echo esc_attr( $s['github_repo'] ); ?>" placeholder="octobercomms/claude"></td></tr>
					<tr><th><?php esc_html_e( 'GitHub token', 'your-architect-archie' ); ?></th><td><input type="password" name="github_token" class="regular-text" autocomplete="off" placeholder="<?php echo esc_attr( $secret_ph( 'github_token' ) ); ?>"><?php if ( YAA_Settings::has_secret( 'github_token' ) ) : ?> <label style="margin-left:8px;white-space:nowrap"><input type="checkbox" name="clear_secrets[]" value="github_token"> <?php esc_html_e( 'Clear this key', 'your-architect-archie' ); ?></label><?php endif; ?><p class="description"><?php esc_html_e( 'Fine-grained token with Contents: read on this repo (Resource owner = octobercomms). Stored encrypted. Leave blank to keep the saved value.', 'your-architect-archie' ); ?></p></td></tr>
				</table>

				<h2><?php esc_html_e( 'Email delivery (SMTP)', 'your-architect-archie' ); ?></h2>
				<p class="description"><?php esc_html_e( 'Send all of Archie\'s mail through an authenticated SMTP relay instead of raw server mail, so quotes and summaries land reliably and pass SPF/DKIM. For Brevo\'s relay: host smtp-relay.brevo.com, port 587, STARTTLS, login = your Brevo SMTP user, password = your Brevo SMTP key. Save, then send a test below.', 'your-architect-archie' ); ?></p>
				<?php if ( YAA_SMTP::managed() ) : $sc = YAA_SMTP::creds(); ?>
					<div class="notice notice-info inline" style="margin:8px 0;padding:10px 12px"><p style="margin:0">
						<strong><?php esc_html_e( 'Credentials supplied by wp-config.php / environment.', 'your-architect-archie' ); ?></strong>
						<?php printf(
							/* translators: %s: where the SMTP key is coming from. */
							esc_html__( 'The relay key is being read from %s, not from the database, and the relay is active without ticking the box below. Any field also set as a constant/env var overrides what you enter here.', 'your-architect-archie' ),
							'constant' === $sc['pass_source'] ? esc_html__( 'a wp-config.php constant', 'your-architect-archie' ) : esc_html__( 'an environment variable', 'your-architect-archie' )
						); ?>
					</p></div>
				<?php endif; ?>
				<p class="description" style="margin-top:4px"><?php esc_html_e( 'Preferred for the key: add to wp-config.php so it is never stored in the database — define( \'YAA_SMTP_HOST\', \'smtp-relay.brevo.com\' ); define( \'YAA_SMTP_PORT\', 587 ); define( \'YAA_SMTP_SECURE\', \'tls\' ); define( \'YAA_SMTP_USER\', \'<your Brevo SMTP login>\' ); define( \'YAA_SMTP_PASS\', \'<your Brevo SMTP key>\' ); define( \'YAA_SMTP_FROM\', \'info@yourarchitect.uk\' );', 'your-architect-archie' ); ?></p>
				<table class="form-table" role="presentation">
					<tr><th><?php esc_html_e( 'Use SMTP relay', 'your-architect-archie' ); ?></th><td><label><input type="checkbox" name="smtp_enabled" value="1" <?php checked( (int) $s['smtp_enabled'], 1 ); ?>> <?php esc_html_e( 'Route every email through the relay below.', 'your-architect-archie' ); ?></label></td></tr>
					<tr><th><?php esc_html_e( 'SMTP host', 'your-architect-archie' ); ?></th><td><input type="text" name="smtp_host" class="regular-text" value="<?php echo esc_attr( $s['smtp_host'] ); ?>" placeholder="smtp-relay.brevo.com"></td></tr>
					<tr><th><?php esc_html_e( 'Port', 'your-architect-archie' ); ?></th><td><input type="number" name="smtp_port" value="<?php echo esc_attr( $s['smtp_port'] ); ?>" style="width:7em"></td></tr>
					<tr><th><?php esc_html_e( 'Encryption', 'your-architect-archie' ); ?></th><td><select name="smtp_secure">
						<option value="tls" <?php selected( $s['smtp_secure'], 'tls' ); ?>><?php esc_html_e( 'STARTTLS (port 587)', 'your-architect-archie' ); ?></option>
						<option value="ssl" <?php selected( $s['smtp_secure'], 'ssl' ); ?>><?php esc_html_e( 'SSL/TLS (port 465)', 'your-architect-archie' ); ?></option>
						<option value="none" <?php selected( $s['smtp_secure'], 'none' ); ?>><?php esc_html_e( 'None', 'your-architect-archie' ); ?></option>
					</select></td></tr>
					<tr><th><?php esc_html_e( 'Authenticate', 'your-architect-archie' ); ?></th><td><label><input type="checkbox" name="smtp_auth" value="1" <?php checked( (int) $s['smtp_auth'], 1 ); ?>> <?php esc_html_e( 'Log in with the username and password below (usually yes).', 'your-architect-archie' ); ?></label></td></tr>
					<tr><th><?php esc_html_e( 'SMTP username', 'your-architect-archie' ); ?></th><td><input type="text" name="smtp_user" class="regular-text" autocomplete="off" value="<?php echo esc_attr( $s['smtp_user'] ); ?>"></td></tr>
					<tr><th><?php esc_html_e( 'SMTP password / key', 'your-architect-archie' ); ?></th><td><input type="password" name="smtp_pass" class="regular-text" autocomplete="off" placeholder="<?php echo esc_attr( $secret_ph( 'smtp_pass' ) ); ?>"><?php if ( YAA_Settings::has_secret( 'smtp_pass' ) ) : ?> <label style="margin-left:8px;white-space:nowrap"><input type="checkbox" name="clear_secrets[]" value="smtp_pass"> <?php esc_html_e( 'Clear this key', 'your-architect-archie' ); ?></label><?php endif; ?><p class="description"><?php esc_html_e( 'Stored encrypted. Leave blank to keep the saved value. If YAA_SMTP_PASS is defined in wp-config.php (or the environment), that key is used instead and this field is ignored — the recommended way to keep the key out of the database.', 'your-architect-archie' ); ?></p></td></tr>
				</table>

				<h2><?php esc_html_e( 'Client email templates', 'your-architect-archie' ); ?></h2>
				<p class="description"><?php esc_html_e( 'The default wording for each step. You can still edit any email per-client before sending. Tokens: {first_name}, {ref}, {total}. Leave blank to use the built-in default.', 'your-architect-archie' ); ?></p>
				<table class="form-table" role="presentation">
					<?php
					$saved_tpl = is_array( $s['email_templates'] ) ? $s['email_templates'] : array();
					foreach ( YAA_Email::stages() as $kind => $stage ) :
						$sv  = isset( $saved_tpl[ $kind ] ) && is_array( $saved_tpl[ $kind ] ) ? $saved_tpl[ $kind ] : array();
						$sub = isset( $sv['subject'] ) && '' !== $sv['subject'] ? $sv['subject'] : $stage['subject'];
						$bod = isset( $sv['body'] ) && '' !== $sv['body'] ? $sv['body'] : $stage['body'];
						?>
						<tr>
							<th><?php echo esc_html( $stage['label'] ); ?></th>
							<td>
								<input type="text" name="tpl[<?php echo esc_attr( $kind ); ?>][subject]" class="large-text" value="<?php echo esc_attr( $sub ); ?>" style="margin-bottom:6px">
								<textarea name="tpl[<?php echo esc_attr( $kind ); ?>][body]" rows="6" class="large-text"><?php echo esc_textarea( $bod ); ?></textarea>
								<?php if ( ! empty( $stage['cta'] ) ) : ?><p class="description"><?php esc_html_e( 'The “view preview & pay securely” button is added automatically.', 'your-architect-archie' ); ?></p><?php endif; ?>
							</td>
						</tr>
					<?php endforeach; ?>
				</table>
				<?php submit_button(); ?>
			</form>
			<h2><?php esc_html_e( 'Test email delivery', 'your-architect-archie' ); ?></h2>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="yaa_smtp_test">
				<?php wp_nonce_field( 'yaa_smtp_test' ); ?>
				<input type="email" name="smtp_test_to" class="regular-text" placeholder="<?php echo esc_attr( wp_get_current_user()->user_email ); ?>">
				<button type="submit" class="button"><?php esc_html_e( 'Send test email', 'your-architect-archie' ); ?></button>
				<p class="description"><?php esc_html_e( 'Sends a test using the saved settings above. Save any changes first. Blank = send to your own admin address.', 'your-architect-archie' ); ?></p>
			</form>
			<h2><?php esc_html_e( 'Test update connection', 'your-architect-archie' ); ?></h2>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="yaa_test_update">
				<?php wp_nonce_field( 'yaa_test_update' ); ?>
				<button type="submit" class="button"><?php esc_html_e( 'Test update connection', 'your-architect-archie' ); ?></button>
				<p class="description"><?php esc_html_e( 'Checks the token can see this plugin\'s releases on GitHub. Save any changes first.', 'your-architect-archie' ); ?></p>
			</form>
			<p class="description"><?php esc_html_e( 'Embed Archie on any page with the [archie] shortcode or the "Archie" Elementor widget.', 'your-architect-archie' ); ?></p>
		</div>
		<?php
	}
}
