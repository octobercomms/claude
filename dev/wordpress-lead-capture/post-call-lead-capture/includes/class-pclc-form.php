<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class PCLC_Form {

	public static function init() {
		add_shortcode( 'lead_capture_form', array( __CLASS__, 'render_form' ) );
		add_action( 'wp_ajax_pclc_submit_form', array( __CLASS__, 'handle_submission' ) );
		add_action( 'wp_ajax_nopriv_pclc_submit_form', array( __CLASS__, 'handle_submission' ) );
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue_scripts' ) );
	}

	public static function enqueue_scripts() {
		global $post;
		if ( is_a( $post, 'WP_Post' ) && has_shortcode( $post->post_content, 'lead_capture_form' ) ) {
			wp_enqueue_script(
				'pclc-form',
				PCLC_PLUGIN_URL . 'assets/js/form.js',
				array( 'jquery' ),
				PCLC_VERSION,
				true
			);
			wp_localize_script(
				'pclc-form',
				'pclcAjax',
				array(
					'ajaxUrl' => admin_url( 'admin-ajax.php' ),
					'nonce'   => wp_create_nonce( 'pclc_submit_nonce' ),
				)
			);
			wp_enqueue_style(
				'pclc-form',
				PCLC_PLUGIN_URL . 'assets/css/form.css',
				array(),
				PCLC_VERSION
			);
		}
	}

	public static function render_form() {
		ob_start();
		?>
		<div id="pclc-form-wrap">
			<form id="pclc-lead-capture-form" novalidate>
				<?php wp_nonce_field( 'pclc_submit_nonce', 'pclc_nonce' ); ?>

				<div class="pclc-field-group">
					<label for="pclc_first_name"><?php esc_html_e( 'First Name', 'post-call-lead-capture' ); ?> <span class="required">*</span></label>
					<input type="text" id="pclc_first_name" name="first_name" required autocomplete="given-name" />
				</div>

				<div class="pclc-field-group">
					<label for="pclc_last_name"><?php esc_html_e( 'Last Name', 'post-call-lead-capture' ); ?> <span class="required">*</span></label>
					<input type="text" id="pclc_last_name" name="last_name" required autocomplete="family-name" />
				</div>

				<div class="pclc-field-group">
					<label for="pclc_email"><?php esc_html_e( 'Email Address', 'post-call-lead-capture' ); ?> <span class="required">*</span></label>
					<input type="email" id="pclc_email" name="email" required autocomplete="email" />
				</div>

				<div class="pclc-field-group">
					<label for="pclc_project_type"><?php esc_html_e( 'Project Type', 'post-call-lead-capture' ); ?> <span class="required">*</span></label>
					<select id="pclc_project_type" name="project_type" required>
						<option value=""><?php esc_html_e( '-- Select --', 'post-call-lead-capture' ); ?></option>
						<option value="new_build"><?php esc_html_e( 'New Build', 'post-call-lead-capture' ); ?></option>
						<option value="renovation"><?php esc_html_e( 'Renovation', 'post-call-lead-capture' ); ?></option>
					</select>
				</div>

				<div class="pclc-messages" aria-live="polite"></div>

				<div class="pclc-field-group">
					<button type="submit" id="pclc-submit-btn"><?php esc_html_e( 'Send Resources', 'post-call-lead-capture' ); ?></button>
				</div>
			</form>
		</div>
		<?php
		return ob_get_clean();
	}

	public static function handle_submission() {
		check_ajax_referer( 'pclc_submit_nonce', 'nonce' );

		$first_name   = isset( $_POST['first_name'] ) ? sanitize_text_field( wp_unslash( $_POST['first_name'] ) ) : '';
		$last_name    = isset( $_POST['last_name'] ) ? sanitize_text_field( wp_unslash( $_POST['last_name'] ) ) : '';
		$email        = isset( $_POST['email'] ) ? sanitize_email( wp_unslash( $_POST['email'] ) ) : '';
		$project_type = isset( $_POST['project_type'] ) ? sanitize_text_field( wp_unslash( $_POST['project_type'] ) ) : '';

		$errors = array();

		if ( empty( $first_name ) ) {
			$errors[] = __( 'First name is required.', 'post-call-lead-capture' );
		}
		if ( empty( $last_name ) ) {
			$errors[] = __( 'Last name is required.', 'post-call-lead-capture' );
		}
		if ( empty( $email ) || ! is_email( $email ) ) {
			$errors[] = __( 'A valid email address is required.', 'post-call-lead-capture' );
		}
		if ( ! in_array( $project_type, array( 'new_build', 'renovation' ), true ) ) {
			$errors[] = __( 'Please select a valid project type.', 'post-call-lead-capture' );
		}

		if ( ! empty( $errors ) ) {
			wp_send_json_error( array( 'messages' => $errors ) );
		}

		$contact_id = PCLC_Database::insert_contact(
			array(
				'first_name'   => $first_name,
				'last_name'    => $last_name,
				'email'        => $email,
				'project_type' => $project_type,
			)
		);

		if ( ! $contact_id ) {
			wp_send_json_error( array( 'messages' => array( __( 'There was a problem saving the contact. Please try again.', 'post-call-lead-capture' ) ) ) );
		}

		// Send initial client email.
		$email_sent = PCLC_Email::send_initial_email( $contact_id );

		// Schedule follow-up prompts to architect.
		PCLC_Scheduler::schedule_followups( $contact_id );

		wp_send_json_success(
			array(
				'message' => __( 'Contact saved and resources sent successfully.', 'post-call-lead-capture' ),
			)
		);
	}
}
