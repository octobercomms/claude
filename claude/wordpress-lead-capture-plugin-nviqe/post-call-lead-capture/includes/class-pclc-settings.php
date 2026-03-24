<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class PCLC_Settings {

	const OPTION_KEY = 'pclc_settings';

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'add_menu_page' ) );
		add_action( 'admin_init', array( __CLASS__, 'register_settings' ) );
	}

	public static function add_menu_page() {
		add_menu_page(
			__( 'Lead Capture', 'post-call-lead-capture' ),
			__( 'Lead Capture', 'post-call-lead-capture' ),
			'manage_options',
			'pclc-settings',
			array( __CLASS__, 'render_settings_page' ),
			'dashicons-email-alt',
			80
		);
	}

	public static function register_settings() {
		register_setting(
			'pclc_settings_group',
			self::OPTION_KEY,
			array( __CLASS__, 'sanitize_settings' )
		);
	}

	public static function sanitize_settings( $input ) {
		$sanitized = array();

		$sanitized['brevo_api_key']          = sanitize_text_field( $input['brevo_api_key'] ?? '' );
		$sanitized['sender_name']            = sanitize_text_field( $input['sender_name'] ?? '' );
		$sanitized['sender_email']           = sanitize_email( $input['sender_email'] ?? '' );
		$sanitized['email_subject']          = sanitize_text_field( $input['email_subject'] ?? '' );
		$sanitized['new_build_report_url']   = esc_url_raw( $input['new_build_report_url'] ?? '' );
		$sanitized['renovation_report_url']  = esc_url_raw( $input['renovation_report_url'] ?? '' );
		$sanitized['before_after_url']       = esc_url_raw( $input['before_after_url'] ?? '' );
		$sanitized['stripe_payment_url']     = esc_url_raw( $input['stripe_payment_url'] ?? '' );
		$sanitized['booking_url']            = esc_url_raw( $input['booking_url'] ?? '' );
		$sanitized['followup_1_delay']       = absint( $input['followup_1_delay'] ?? 28 );
		$sanitized['followup_2_delay']       = absint( $input['followup_2_delay'] ?? 180 );
		$sanitized['architect_email']        = sanitize_email( $input['architect_email'] ?? '' );
		$sanitized['intro_paragraph']        = wp_kses_post( $input['intro_paragraph'] ?? '' );
		$sanitized['chase_paragraph']        = wp_kses_post( $input['chase_paragraph'] ?? '' );

		if ( empty( $sanitized['followup_1_delay'] ) ) {
			$sanitized['followup_1_delay'] = 28;
		}
		if ( empty( $sanitized['followup_2_delay'] ) ) {
			$sanitized['followup_2_delay'] = 180;
		}

		return $sanitized;
	}

	public static function get( $key, $default = '' ) {
		$settings = get_option( self::OPTION_KEY, array() );
		return isset( $settings[ $key ] ) ? $settings[ $key ] : $default;
	}

	public static function render_settings_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You do not have permission to access this page.', 'post-call-lead-capture' ) );
		}
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Post-Call Lead Capture Settings', 'post-call-lead-capture' ); ?></h1>
			<form method="post" action="options.php">
				<?php
				settings_fields( 'pclc_settings_group' );
				$opt = get_option( self::OPTION_KEY, array() );
				?>
				<h2><?php esc_html_e( 'Brevo API', 'post-call-lead-capture' ); ?></h2>
				<table class="form-table">
					<tr>
						<th><label for="pclc_brevo_api_key"><?php esc_html_e( 'Brevo API Key', 'post-call-lead-capture' ); ?></label></th>
						<td><input type="password" id="pclc_brevo_api_key" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[brevo_api_key]" value="<?php echo esc_attr( $opt['brevo_api_key'] ?? '' ); ?>" class="regular-text" /></td>
					</tr>
					<tr>
						<th><label for="pclc_sender_name"><?php esc_html_e( 'Sender Name', 'post-call-lead-capture' ); ?></label></th>
						<td><input type="text" id="pclc_sender_name" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[sender_name]" value="<?php echo esc_attr( $opt['sender_name'] ?? '' ); ?>" class="regular-text" /></td>
					</tr>
					<tr>
						<th><label for="pclc_sender_email"><?php esc_html_e( 'Sender Email', 'post-call-lead-capture' ); ?></label></th>
						<td><input type="email" id="pclc_sender_email" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[sender_email]" value="<?php echo esc_attr( $opt['sender_email'] ?? '' ); ?>" class="regular-text" /></td>
					</tr>
				</table>

				<h2><?php esc_html_e( 'Email Content', 'post-call-lead-capture' ); ?></h2>
				<table class="form-table">
					<tr>
						<th><label for="pclc_email_subject"><?php esc_html_e( 'Email Subject Line', 'post-call-lead-capture' ); ?></label></th>
						<td><input type="text" id="pclc_email_subject" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[email_subject]" value="<?php echo esc_attr( $opt['email_subject'] ?? 'Your Project Resources' ); ?>" class="regular-text" /></td>
					</tr>
					<tr>
						<th><label for="pclc_intro_paragraph"><?php esc_html_e( 'Initial Email Body Paragraph', 'post-call-lead-capture' ); ?></label></th>
						<td>
							<textarea id="pclc_intro_paragraph" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[intro_paragraph]" rows="5" class="large-text"><?php echo esc_textarea( $opt['intro_paragraph'] ?? "Thank you for taking the time to speak with us. It was a pleasure learning about your project. I've put together some resources to help you take the next step — please find your personalised report, our portfolio highlights, and booking details below." ); ?></textarea>
						</td>
					</tr>
					<tr>
						<th><label for="pclc_chase_paragraph"><?php esc_html_e( 'Chase Email Body Paragraph', 'post-call-lead-capture' ); ?></label></th>
						<td>
							<textarea id="pclc_chase_paragraph" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[chase_paragraph]" rows="5" class="large-text"><?php echo esc_textarea( $opt['chase_paragraph'] ?? "I just wanted to check in and see how things are progressing with your project. We'd love to help you move forward — your report and booking link are still available below whenever you're ready." ); ?></textarea>
						</td>
					</tr>
				</table>

				<h2><?php esc_html_e( 'Resource Links', 'post-call-lead-capture' ); ?></h2>
				<table class="form-table">
					<tr>
						<th><label for="pclc_new_build_report_url"><?php esc_html_e( 'New Build Report URL', 'post-call-lead-capture' ); ?></label></th>
						<td><input type="url" id="pclc_new_build_report_url" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[new_build_report_url]" value="<?php echo esc_attr( $opt['new_build_report_url'] ?? '' ); ?>" class="regular-text" placeholder="https://" /></td>
					</tr>
					<tr>
						<th><label for="pclc_renovation_report_url"><?php esc_html_e( 'Renovation Report URL', 'post-call-lead-capture' ); ?></label></th>
						<td><input type="url" id="pclc_renovation_report_url" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[renovation_report_url]" value="<?php echo esc_attr( $opt['renovation_report_url'] ?? '' ); ?>" class="regular-text" placeholder="https://" /></td>
					</tr>
					<tr>
						<th><label for="pclc_before_after_url"><?php esc_html_e( 'Before/After Slider Page URL', 'post-call-lead-capture' ); ?></label></th>
						<td><input type="url" id="pclc_before_after_url" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[before_after_url]" value="<?php echo esc_attr( $opt['before_after_url'] ?? '' ); ?>" class="regular-text" placeholder="https://" /></td>
					</tr>
					<tr>
						<th><label for="pclc_stripe_payment_url"><?php esc_html_e( 'Stripe Payment Link', 'post-call-lead-capture' ); ?></label></th>
						<td><input type="url" id="pclc_stripe_payment_url" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[stripe_payment_url]" value="<?php echo esc_attr( $opt['stripe_payment_url'] ?? '' ); ?>" class="regular-text" placeholder="https://" /></td>
					</tr>
					<tr>
						<th><label for="pclc_booking_url"><?php esc_html_e( 'Booking Link (Calendly / Cal.com)', 'post-call-lead-capture' ); ?></label></th>
						<td><input type="url" id="pclc_booking_url" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[booking_url]" value="<?php echo esc_attr( $opt['booking_url'] ?? '' ); ?>" class="regular-text" placeholder="https://" /></td>
					</tr>
				</table>

				<h2><?php esc_html_e( 'Follow-Up Schedule', 'post-call-lead-capture' ); ?></h2>
				<table class="form-table">
					<tr>
						<th><label for="pclc_followup_1_delay"><?php esc_html_e( 'First Follow-Up Delay (days)', 'post-call-lead-capture' ); ?></label></th>
						<td><input type="number" id="pclc_followup_1_delay" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[followup_1_delay]" value="<?php echo esc_attr( $opt['followup_1_delay'] ?? 28 ); ?>" class="small-text" min="1" /></td>
					</tr>
					<tr>
						<th><label for="pclc_followup_2_delay"><?php esc_html_e( 'Second Follow-Up Delay (days from first)', 'post-call-lead-capture' ); ?></label></th>
						<td><input type="number" id="pclc_followup_2_delay" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[followup_2_delay]" value="<?php echo esc_attr( $opt['followup_2_delay'] ?? 180 ); ?>" class="small-text" min="1" /></td>
					</tr>
					<tr>
						<th><label for="pclc_architect_email"><?php esc_html_e( 'Architect Notification Email', 'post-call-lead-capture' ); ?></label></th>
						<td><input type="email" id="pclc_architect_email" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[architect_email]" value="<?php echo esc_attr( $opt['architect_email'] ?? '' ); ?>" class="regular-text" /></td>
					</tr>
				</table>

				<?php submit_button(); ?>
			</form>

			<hr />
			<h2><?php esc_html_e( 'Shortcode', 'post-call-lead-capture' ); ?></h2>
			<p><?php esc_html_e( 'Place this shortcode on any WordPress page (password-protect the page via Page Attributes):', 'post-call-lead-capture' ); ?></p>
			<code>[lead_capture_form]</code>
		</div>
		<?php
	}
}
