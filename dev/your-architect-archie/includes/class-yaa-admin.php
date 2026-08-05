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
		YAA_Settings::update(
			array(
				'claude_api_key'     => isset( $in['claude_api_key'] ) ? $in['claude_api_key'] : '',
				'claude_model'       => sanitize_text_field( $in['claude_model'] ?? '' ),
				'max_output_tokens'  => (int) ( $in['max_output_tokens'] ?? 700 ),
				'notify_email'       => sanitize_email( $in['notify_email'] ?? '' ),
				'arb_no'             => sanitize_text_field( $in['arb_no'] ?? '' ),
				'company_no'         => sanitize_text_field( $in['company_no'] ?? '' ),
				'rate_limit_per_min' => (int) ( $in['rate_limit_per_min'] ?? 12 ),
				'daily_token_cap'    => (int) ( $in['daily_token_cap'] ?? 500000 ),
				'stripe_secret_key'     => isset( $in['stripe_secret_key'] ) ? $in['stripe_secret_key'] : '',
				'stripe_publishable'    => sanitize_text_field( $in['stripe_publishable'] ?? '' ),
				'stripe_webhook_secret' => isset( $in['stripe_webhook_secret'] ) ? $in['stripe_webhook_secret'] : '',
				'brevo_api_key'         => isset( $in['brevo_api_key'] ) ? $in['brevo_api_key'] : '',
				'email_from'            => sanitize_email( $in['email_from'] ?? '' ),
				'email_from_name'       => sanitize_text_field( $in['email_from_name'] ?? '' ),
				'portal_page_id'        => (int) ( $in['portal_page_id'] ?? 0 ),
				'historic_api_on'       => empty( $in['historic_api_on'] ) ? 0 : 1,
			)
		);
		wp_safe_redirect( add_query_arg( 'updated', '1', wp_get_referer() ) );
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
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="yaa_save_settings">
				<?php wp_nonce_field( 'yaa_settings' ); ?>
				<table class="form-table" role="presentation">
					<tr><th><?php esc_html_e( 'Claude API key', 'your-architect-archie' ); ?></th><td><input type="password" name="claude_api_key" class="regular-text" autocomplete="off" placeholder="<?php echo esc_attr( $secret_ph( 'claude_api_key' ) ); ?>"><p class="description"><?php esc_html_e( 'Stored encrypted. Server-side only — never sent to the browser.', 'your-architect-archie' ); ?></p></td></tr>
					<tr><th><?php esc_html_e( 'Model', 'your-architect-archie' ); ?></th><td><input type="text" name="claude_model" class="regular-text" value="<?php echo esc_attr( $s['claude_model'] ); ?>"></td></tr>
					<tr><th><?php esc_html_e( 'Max output tokens', 'your-architect-archie' ); ?></th><td><input type="number" name="max_output_tokens" value="<?php echo esc_attr( $s['max_output_tokens'] ); ?>"></td></tr>
					<tr><th><?php esc_html_e( 'Turns / min / session', 'your-architect-archie' ); ?></th><td><input type="number" name="rate_limit_per_min" value="<?php echo esc_attr( $s['rate_limit_per_min'] ); ?>"> <span class="description"><?php esc_html_e( 'Rate limit to protect your Claude bill.', 'your-architect-archie' ); ?></span></td></tr>
					<tr><th><?php esc_html_e( 'Daily token cap', 'your-architect-archie' ); ?></th><td><input type="number" name="daily_token_cap" value="<?php echo esc_attr( $s['daily_token_cap'] ); ?>"></td></tr>
					<tr><th><?php esc_html_e( 'Notification email', 'your-architect-archie' ); ?></th><td><input type="email" name="notify_email" class="regular-text" value="<?php echo esc_attr( $s['notify_email'] ); ?>"></td></tr>
					<tr><th><?php esc_html_e( 'ARB reg. no.', 'your-architect-archie' ); ?></th><td><input type="text" name="arb_no" value="<?php echo esc_attr( $s['arb_no'] ); ?>"></td></tr>
					<tr><th><?php esc_html_e( 'Company no.', 'your-architect-archie' ); ?></th><td><input type="text" name="company_no" value="<?php echo esc_attr( $s['company_no'] ); ?>"></td></tr>
					<tr><th><?php esc_html_e( 'Historic England API', 'your-architect-archie' ); ?></th><td><label><input type="checkbox" name="historic_api_on" value="1" <?php checked( $s['historic_api_on'], 1 ); ?>> <?php esc_html_e( 'Use the live listed-building lookup (else heuristic).', 'your-architect-archie' ); ?></label></td></tr>
					<tr><th><?php esc_html_e( 'Stripe secret key', 'your-architect-archie' ); ?></th><td><input type="password" name="stripe_secret_key" class="regular-text" autocomplete="off" placeholder="<?php echo esc_attr( $secret_ph( 'stripe_secret_key' ) ); ?>"></td></tr>
					<tr><th><?php esc_html_e( 'Stripe publishable key', 'your-architect-archie' ); ?></th><td><input type="text" name="stripe_publishable" class="regular-text" value="<?php echo esc_attr( $s['stripe_publishable'] ); ?>"></td></tr>
					<tr><th><?php esc_html_e( 'Stripe webhook secret', 'your-architect-archie' ); ?></th><td><input type="password" name="stripe_webhook_secret" class="regular-text" autocomplete="off" placeholder="<?php echo esc_attr( $secret_ph( 'stripe_webhook_secret' ) ); ?>"><p class="description"><?php echo esc_html( 'Endpoint: ' . rest_url( 'yaa/v1/stripe-webhook' ) ); ?></p></td></tr>
					<tr><th><?php esc_html_e( 'Brevo API key', 'your-architect-archie' ); ?></th><td><input type="password" name="brevo_api_key" class="regular-text" autocomplete="off" placeholder="<?php echo esc_attr( $secret_ph( 'brevo_api_key' ) ); ?>"><p class="description"><?php esc_html_e( 'Transactional email + open/click tracking. Blank = send via WordPress mail.', 'your-architect-archie' ); ?> <?php echo esc_html( 'Webhook: ' . rest_url( 'yaa/v1/brevo-webhook' ) ); ?></p></td></tr>
					<tr><th><?php esc_html_e( 'Email from address', 'your-architect-archie' ); ?></th><td><input type="email" name="email_from" class="regular-text" value="<?php echo esc_attr( $s['email_from'] ); ?>"></td></tr>
					<tr><th><?php esc_html_e( 'Email from name', 'your-architect-archie' ); ?></th><td><input type="text" name="email_from_name" class="regular-text" value="<?php echo esc_attr( $s['email_from_name'] ); ?>"></td></tr>
					<tr><th><?php esc_html_e( 'Client portal page', 'your-architect-archie' ); ?></th><td><?php wp_dropdown_pages( array( 'name' => 'portal_page_id', 'selected' => (int) $s['portal_page_id'], 'show_option_none' => __( '— auto —', 'your-architect-archie' ), 'option_none_value' => 0 ) ); ?><p class="description"><?php esc_html_e( 'Page containing the [archie_portal] shortcode (auto-created on activation).', 'your-architect-archie' ); ?></p></td></tr>
				</table>
				<?php submit_button(); ?>
			</form>
			<p class="description"><?php esc_html_e( 'Embed Archie on any page with the [archie] shortcode or the "Archie" Elementor widget.', 'your-architect-archie' ); ?></p>
		</div>
		<?php
	}
}
