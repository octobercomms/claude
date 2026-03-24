<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class PCLC_Settings {

	const OPTION_KEY = 'pclc_settings';

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'add_menu_page' ) );
		add_action( 'admin_init', array( __CLASS__, 'register_settings' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_admin_scripts' ) );
		add_action( 'wp_ajax_pclc_send_test_email', array( __CLASS__, 'handle_test_email' ) );
		add_filter( 'plugin_action_links_post-call-lead-capture/post-call-lead-capture.php', array( __CLASS__, 'add_plugin_action_links' ) );
	}

	public static function add_plugin_action_links( $links ) {
		$settings_link = '<a href="' . esc_url( admin_url( 'admin.php?page=pclc-settings' ) ) . '">' . esc_html__( 'Settings', 'post-call-lead-capture' ) . '</a>';
		array_unshift( $links, $settings_link );
		return $links;
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

	public static function enqueue_admin_scripts( $hook ) {
		if ( 'toplevel_page_pclc-settings' !== $hook ) {
			return;
		}

		wp_enqueue_media();
		wp_enqueue_script(
			'pclc-admin',
			PCLC_PLUGIN_URL . 'assets/js/admin.js',
			array( 'jquery', 'wp-util' ),
			PCLC_VERSION,
			true
		);
		wp_localize_script(
			'pclc-admin',
			'pclcAdmin',
			array(
				'ajaxUrl'            => admin_url( 'admin-ajax.php' ),
				'nonce'              => wp_create_nonce( 'pclc_admin_nonce' ),
				'mediaTitle'         => __( 'Select Logo', 'post-call-lead-capture' ),
				'mediaButton'        => __( 'Use this image', 'post-call-lead-capture' ),
				'sending'            => __( 'Sending…', 'post-call-lead-capture' ),
				'sent'               => __( 'Sent!', 'post-call-lead-capture' ),
				'error'              => __( 'Error — check console', 'post-call-lead-capture' ),
			)
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
		$sanitized['logo_attachment_id']     = absint( $input['logo_attachment_id'] ?? 0 );
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
		$sanitized['cold_paragraph']         = wp_kses_post( $input['cold_paragraph'] ?? '' );
		$sanitized['email_signature']        = wp_kses_post( $input['email_signature'] ?? '' );

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

	/**
	 * Handles sending a test email to the configured architect email address.
	 */
	public static function handle_test_email() {
		check_ajax_referer( 'pclc_admin_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( array( 'message' => __( 'Permission denied.', 'post-call-lead-capture' ) ) );
		}

		$type            = isset( $_POST['email_type'] ) ? sanitize_key( $_POST['email_type'] ) : '';
		$architect_email = PCLC_Settings::get( 'architect_email' );
		$sender_email    = PCLC_Settings::get( 'sender_email' );

		// Use architect email as recipient for test; fall back to sender email.
		$test_recipient = $architect_email ?: $sender_email;

		if ( empty( $test_recipient ) ) {
			wp_send_json_error( array( 'message' => __( 'Please set an Architect Notification Email (or Sender Email) before sending a test.', 'post-call-lead-capture' ) ) );
		}

		// Build a dummy contact object.
		$dummy               = new stdClass();
		$dummy->id           = 0;
		$dummy->first_name   = 'Jane';
		$dummy->last_name    = 'Smith';
		$dummy->email        = $test_recipient;
		$dummy->project_type = 'new_build';
		$dummy->date_created = current_time( 'mysql' );

		$result = false;

		switch ( $type ) {
			case 'initial':
				$result = PCLC_Email::send_test_initial( $dummy, $test_recipient );
				break;
			case 'chase':
				$result = PCLC_Email::send_test_chase( $dummy, $test_recipient );
				break;
			case 'followup_1':
			case 'followup_2':
				$followup_number = ( 'followup_1' === $type ) ? 1 : 2;
				// Use the most recent real contact so the action links are functional.
				$contact = PCLC_Database::get_latest_contact();
				if ( ! $contact ) {
					$contact = $dummy;
				}
				$result = PCLC_Email::send_test_architect_followup( $contact, $followup_number, $test_recipient );
				break;
			case 'cold':
				$result = PCLC_Email::send_test_cold( $dummy, $test_recipient );
				break;
			default:
				wp_send_json_error( array( 'message' => __( 'Unknown email type.', 'post-call-lead-capture' ) ) );
		}

		if ( is_wp_error( $result ) ) {
			wp_send_json_error( array( 'message' => $result->get_error_message() ) );
		}

		wp_send_json_success( array( 'message' => sprintf( __( 'Test email sent to %s.', 'post-call-lead-capture' ), $test_recipient ) ) );
	}

	public static function render_settings_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You do not have permission to access this page.', 'post-call-lead-capture' ) );
		}

		$opt         = get_option( self::OPTION_KEY, array() );
		$logo_id     = intval( $opt['logo_attachment_id'] ?? 0 );
		$logo_url    = $logo_id ? wp_get_attachment_image_url( $logo_id, 'medium' ) : '';
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Post-Call Lead Capture Settings', 'post-call-lead-capture' ); ?></h1>

			<form method="post" action="options.php">
				<?php settings_fields( 'pclc_settings_group' ); ?>

				<h2><?php esc_html_e( 'Brevo API', 'post-call-lead-capture' ); ?></h2>
				<table class="form-table">
					<tr>
						<th><label for="pclc_brevo_api_key"><?php esc_html_e( 'Brevo API Key', 'post-call-lead-capture' ); ?></label></th>
						<td><input type="password" id="pclc_brevo_api_key" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[brevo_api_key]" value="<?php echo esc_attr( $opt['brevo_api_key'] ?? '' ); ?>" class="regular-text" autocomplete="new-password" /></td>
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

				<h2><?php esc_html_e( 'Email Branding', 'post-call-lead-capture' ); ?></h2>
				<table class="form-table">
					<tr>
						<th><label><?php esc_html_e( 'Logo', 'post-call-lead-capture' ); ?></label></th>
						<td>
							<input type="hidden" id="pclc_logo_attachment_id" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[logo_attachment_id]" value="<?php echo esc_attr( $logo_id ); ?>" />
							<div id="pclc-logo-preview" style="margin-bottom:8px;">
								<?php if ( $logo_url ) : ?>
									<img src="<?php echo esc_url( $logo_url ); ?>" style="max-height:80px;display:block;" />
								<?php endif; ?>
							</div>
							<button type="button" class="button" id="pclc-logo-select"><?php esc_html_e( 'Select from Media Library', 'post-call-lead-capture' ); ?></button>
							<?php if ( $logo_id ) : ?>
								<button type="button" class="button" id="pclc-logo-remove" style="margin-left:6px;"><?php esc_html_e( 'Remove', 'post-call-lead-capture' ); ?></button>
							<?php else : ?>
								<button type="button" class="button" id="pclc-logo-remove" style="margin-left:6px;display:none;"><?php esc_html_e( 'Remove', 'post-call-lead-capture' ); ?></button>
							<?php endif; ?>
							<p class="description"><?php esc_html_e( 'Displayed at the top of all client emails. Recommended max width: 200px.', 'post-call-lead-capture' ); ?></p>
						</td>
					</tr>
				</table>

				<h2><?php esc_html_e( 'Email Content', 'post-call-lead-capture' ); ?></h2>
				<table class="form-table">
					<tr>
						<th><label for="pclc_email_subject"><?php esc_html_e( 'Email Subject Line', 'post-call-lead-capture' ); ?></label></th>
						<td><input type="text" id="pclc_email_subject" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[email_subject]" value="<?php echo esc_attr( $opt['email_subject'] ?? 'Your Project Resources' ); ?>" class="regular-text" /></td>
					</tr>
					<tr>
						<th><label for="pclc_intro_paragraph"><?php esc_html_e( 'Initial Email Body', 'post-call-lead-capture' ); ?></label></th>
						<td>
							<?php
							wp_editor(
								$opt['intro_paragraph'] ?? "Thank you for taking the time to speak with us. It was a pleasure learning about your project. I've put together some resources to help you take the next step — please find your personalised report, our portfolio highlights, and booking details below.",
								'pclc_intro_paragraph',
								array(
									'textarea_name' => self::OPTION_KEY . '[intro_paragraph]',
									'textarea_rows' => 6,
									'media_buttons' => false,
									'teeny'         => true,
								)
							);
							?>
						</td>
					</tr>
					<tr>
						<th><label for="pclc_chase_paragraph"><?php esc_html_e( 'Chase Email Body', 'post-call-lead-capture' ); ?></label></th>
						<td>
							<?php
							wp_editor(
								$opt['chase_paragraph'] ?? "I just wanted to check in and see how things are progressing with your project. We'd love to help you move forward — your report and booking link are still available below whenever you're ready.",
								'pclc_chase_paragraph',
								array(
									'textarea_name' => self::OPTION_KEY . '[chase_paragraph]',
									'textarea_rows' => 6,
									'media_buttons' => false,
									'teeny'         => true,
								)
							);
							?>
							<p class="description"><?php esc_html_e( 'Sent to the client when you click "Send Follow-Up Email" in Follow-Up Prompt #1 (~28 days).', 'post-call-lead-capture' ); ?></p>
						</td>
					</tr>
					<tr>
						<th><label for="pclc_cold_paragraph"><?php esc_html_e( 'Cold Re-Engage Email Body', 'post-call-lead-capture' ); ?></label></th>
						<td>
							<?php
							wp_editor(
								$opt['cold_paragraph'] ?? "I hope you're well. It's been a while since we last spoke about your project and I wanted to reach out in case the timing is right now. We'd love to help you move forward — your resources are still available below whenever you're ready.",
								'pclc_cold_paragraph',
								array(
									'textarea_name' => self::OPTION_KEY . '[cold_paragraph]',
									'textarea_rows' => 6,
									'media_buttons' => false,
									'teeny'         => true,
								)
							);
							?>
							<p class="description"><?php esc_html_e( 'Sent to the client when you click "Send Cold Re-Engage Email" in Follow-Up Prompt #2 (~6 months). Only fires if no chase email was sent earlier.', 'post-call-lead-capture' ); ?></p>
						</td>
					</tr>
					<tr>
						<th><label for="pclc_email_signature"><?php esc_html_e( 'Email Signature', 'post-call-lead-capture' ); ?></label></th>
						<td>
							<?php
							wp_editor(
								$opt['email_signature'] ?? '',
								'pclc_email_signature',
								array(
									'textarea_name' => self::OPTION_KEY . '[email_signature]',
									'textarea_rows' => 5,
									'media_buttons' => false,
									'teeny'         => true,
								)
							);
							?>
							<p class="description"><?php esc_html_e( 'Appended to the bottom of every email sent to clients. Include your name, title, phone, etc.', 'post-call-lead-capture' ); ?></p>
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
						<td>
							<input type="email" id="pclc_architect_email" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[architect_email]" value="<?php echo esc_attr( $opt['architect_email'] ?? '' ); ?>" class="regular-text" />
							<p class="description"><?php esc_html_e( 'Follow-up prompts and test emails are sent to this address.', 'post-call-lead-capture' ); ?></p>
						</td>
					</tr>
				</table>

				<?php submit_button(); ?>
			</form>

			<hr />

			<h2><?php esc_html_e( 'Send Test Emails', 'post-call-lead-capture' ); ?></h2>
			<p><?php esc_html_e( 'Send a preview of each email to the Architect Notification Email address (uses dummy contact data: Jane Smith, New Build).', 'post-call-lead-capture' ); ?></p>
			<table class="form-table">
				<tr>
					<th><?php esc_html_e( 'Initial Client Email', 'post-call-lead-capture' ); ?></th>
					<td>
						<button type="button" class="button pclc-test-email-btn" data-type="initial"><?php esc_html_e( 'Send Test', 'post-call-lead-capture' ); ?></button>
						<span class="pclc-test-result" style="margin-left:10px;"></span>
					</td>
				</tr>
				<tr>
					<th><?php esc_html_e( 'Chase Email', 'post-call-lead-capture' ); ?></th>
					<td>
						<button type="button" class="button pclc-test-email-btn" data-type="chase"><?php esc_html_e( 'Send Test', 'post-call-lead-capture' ); ?></button>
						<span class="pclc-test-result" style="margin-left:10px;"></span>
					</td>
				</tr>
				<tr>
					<th><?php esc_html_e( 'Follow-Up Prompt #1 (to Architect)', 'post-call-lead-capture' ); ?></th>
					<td>
						<button type="button" class="button pclc-test-email-btn" data-type="followup_1"><?php esc_html_e( 'Send Test', 'post-call-lead-capture' ); ?></button>
						<span class="pclc-test-result" style="margin-left:10px;"></span>
					</td>
				</tr>
				<tr>
					<th><?php esc_html_e( 'Follow-Up Prompt #2 (to Architect)', 'post-call-lead-capture' ); ?></th>
					<td>
						<button type="button" class="button pclc-test-email-btn" data-type="followup_2"><?php esc_html_e( 'Send Test', 'post-call-lead-capture' ); ?></button>
						<span class="pclc-test-result" style="margin-left:10px;"></span>
					</td>
				</tr>
				<tr>
					<th><?php esc_html_e( 'Cold Re-Engage Email (to Client)', 'post-call-lead-capture' ); ?></th>
					<td>
						<button type="button" class="button pclc-test-email-btn" data-type="cold"><?php esc_html_e( 'Send Test', 'post-call-lead-capture' ); ?></button>
						<span class="pclc-test-result" style="margin-left:10px;"></span>
					</td>
				</tr>
			</table>

			<hr />
			<h2><?php esc_html_e( 'Shortcode', 'post-call-lead-capture' ); ?></h2>
			<p><?php esc_html_e( 'Place this shortcode on any WordPress page (password-protect the page via Page Attributes):', 'post-call-lead-capture' ); ?></p>
			<code>[lead_capture_form]</code>
		</div>
		<?php
	}
}
