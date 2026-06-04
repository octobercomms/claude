<?php
/**
 * Public lead-capture form.
 *
 * Place [hgd_enquiry] on any page. On submit it creates (or reuses) a client and
 * a project in `enquiry` status, and emails Donna via the site's mailer (the
 * existing IMAP/SMTP service — no new email provider).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Lead_Form {

	const ACTION = 'hgd_enquiry_submit';

	public function register() {
		add_shortcode( 'hgd_enquiry', array( $this, 'render' ) );
		add_action( 'admin_post_nopriv_' . self::ACTION, array( $this, 'handle' ) );
		add_action( 'admin_post_' . self::ACTION, array( $this, 'handle' ) );
	}

	public function render( $atts ) {
		$atts = shortcode_atts( array( 'title' => __( 'Tell us about your garden', 'hillcroft-garden-designer' ) ), $atts, 'hgd_enquiry' );

		$sent  = isset( $_GET['hgd_enquiry'] ) && 'sent' === $_GET['hgd_enquiry']; // phpcs:ignore WordPress.Security.NonceVerification
		$error = isset( $_GET['hgd_enquiry'] ) && 'error' === $_GET['hgd_enquiry']; // phpcs:ignore WordPress.Security.NonceVerification

		ob_start();
		?>
		<style>
			.hgd-enquiry-form{max-width:560px;margin:0 auto}
			.hgd-enquiry-form h3{font-family:"Cormorant Garamond",Georgia,serif;font-size:1.8em;margin:0 0 .6em}
			.hgd-enquiry-form label{display:block;font-size:.85em;letter-spacing:.3px}
			.hgd-enquiry-form input,.hgd-enquiry-form textarea{width:100%;padding:10px 12px;border:1px solid #d8d2c2;border-radius:10px;box-sizing:border-box;margin-top:4px}
			.hgd-enquiry-form button{background:#494A20;color:#fff;border:0;border-radius:999px;padding:12px 28px;font-size:1em;cursor:pointer}
			.hgd-enquiry-form button:hover{background:#777834}
			.hgd-enquiry-error{color:#9b2c2c}
			.hgd-enquiry-thanks{max-width:560px;margin:0 auto;padding:18px 20px;border:1px solid #9FA145;border-radius:12px;background:rgba(159,161,69,.1)}
		</style>
		<?php
		if ( $sent ) {
			echo '<div class="hgd-enquiry-thanks"><p>' . esc_html__( 'Thank you — your enquiry has been received. Donna will be in touch shortly.', 'hillcroft-garden-designer' ) . '</p></div>';
			return ob_get_clean();
		}
		?>
		<form class="hgd-enquiry-form" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="<?php echo esc_attr( self::ACTION ); ?>" />
			<input type="hidden" name="redirect" value="<?php echo esc_url( $this->current_url() ); ?>" />
			<?php wp_nonce_field( self::ACTION ); ?>
			<!-- honeypot -->
			<input type="text" name="hgd_hp" value="" style="position:absolute;left:-9999px;" tabindex="-1" autocomplete="off" aria-hidden="true" />

			<?php if ( $error ) : ?>
				<p class="hgd-enquiry-error"><?php esc_html_e( 'Please add your name and a valid email, then try again.', 'hillcroft-garden-designer' ); ?></p>
			<?php endif; ?>

			<h3><?php echo esc_html( $atts['title'] ); ?></h3>

			<p><label><?php esc_html_e( 'Name', 'hillcroft-garden-designer' ); ?><br>
				<input type="text" name="name" required></label></p>
			<p><label><?php esc_html_e( 'Email', 'hillcroft-garden-designer' ); ?><br>
				<input type="email" name="email" required></label></p>
			<p><label><?php esc_html_e( 'Phone', 'hillcroft-garden-designer' ); ?><br>
				<input type="tel" name="phone"></label></p>
			<p><label><?php esc_html_e( 'Postcode', 'hillcroft-garden-designer' ); ?><br>
				<input type="text" name="postcode"></label></p>
			<p><label><?php esc_html_e( 'Rough budget', 'hillcroft-garden-designer' ); ?><br>
				<input type="text" name="budget_range" placeholder="<?php esc_attr_e( 'e.g. £5k–£10k', 'hillcroft-garden-designer' ); ?>"></label></p>
			<p><label><?php esc_html_e( 'Tell us about your garden and ideas', 'hillcroft-garden-designer' ); ?><br>
				<textarea name="message" rows="5"></textarea></label></p>

			<p><button type="submit"><?php esc_html_e( 'Send enquiry', 'hillcroft-garden-designer' ); ?></button></p>
		</form>
		<?php
		return ob_get_clean();
	}

	public function handle() {
		check_admin_referer( self::ACTION );

		$redirect = isset( $_POST['redirect'] ) ? esc_url_raw( wp_unslash( $_POST['redirect'] ) ) : home_url( '/' );

		// Honeypot: silently accept (pretend success) to not tip off bots.
		if ( ! empty( $_POST['hgd_hp'] ) ) {
			wp_safe_redirect( add_query_arg( 'hgd_enquiry', 'sent', $redirect ) );
			exit;
		}

		// Throttle submissions per IP — each one creates a client + project row
		// and sends mail. Pretend success on limit so bots get no signal.
		if ( ! HGD_Rate_Limit::check( 'lead_form', 6, 10 * MINUTE_IN_SECONDS ) ) {
			wp_safe_redirect( add_query_arg( 'hgd_enquiry', 'sent', $redirect ) );
			exit;
		}

		$name  = isset( $_POST['name'] ) ? sanitize_text_field( wp_unslash( $_POST['name'] ) ) : '';
		$email = isset( $_POST['email'] ) ? sanitize_email( wp_unslash( $_POST['email'] ) ) : '';

		if ( '' === $name || ! is_email( $email ) ) {
			wp_safe_redirect( add_query_arg( 'hgd_enquiry', 'error', $redirect ) );
			exit;
		}

		$parts      = preg_split( '/\s+/', $name, 2 );
		$first      = $parts[0];
		$last       = isset( $parts[1] ) ? $parts[1] : '';
		$phone      = isset( $_POST['phone'] ) ? sanitize_text_field( wp_unslash( $_POST['phone'] ) ) : '';
		$postcode   = isset( $_POST['postcode'] ) ? sanitize_text_field( wp_unslash( $_POST['postcode'] ) ) : '';
		$budget     = isset( $_POST['budget_range'] ) ? sanitize_text_field( wp_unslash( $_POST['budget_range'] ) ) : '';
		$message    = isset( $_POST['message'] ) ? sanitize_textarea_field( wp_unslash( $_POST['message'] ) ) : '';

		$client_id = HGD_Client::find_or_create( array(
			'first_name' => $first,
			'last_name'  => $last,
			'email'      => $email,
			'phone'      => $phone,
			'postcode'   => $postcode,
		) );

		$project_id = HGD_Project::insert( array(
			'client_id'    => $client_id,
			'title'        => sprintf( /* translators: %s client name */ __( '%s — enquiry', 'hillcroft-garden-designer' ), $name ),
			'status'       => 'enquiry',
			'source'       => 'enquiry_form',
			'postcode'     => $postcode,
			'budget_range' => $budget,
			'brief_notes'  => $message,
		) );

		$this->notify_admin( $name, $email, $phone, $postcode, $budget, $message, $project_id );

		wp_safe_redirect( add_query_arg( 'hgd_enquiry', 'sent', $redirect ) );
		exit;
	}

	private function notify_admin( $name, $email, $phone, $postcode, $budget, $message, $project_id ) {
		$to      = get_option( 'admin_email' );
		$subject = sprintf( /* translators: %s client name */ __( 'New garden enquiry from %s', 'hillcroft-garden-designer' ), $name );
		$link    = admin_url( 'admin.php?page=hgd-projects&action=edit&id=' . (int) $project_id );
		$lines   = array(
			__( 'A new enquiry has come in:', 'hillcroft-garden-designer' ),
			'',
			sprintf( '%s: %s', __( 'Name', 'hillcroft-garden-designer' ), $name ),
			sprintf( '%s: %s', __( 'Email', 'hillcroft-garden-designer' ), $email ),
			sprintf( '%s: %s', __( 'Phone', 'hillcroft-garden-designer' ), $phone ),
			sprintf( '%s: %s', __( 'Postcode', 'hillcroft-garden-designer' ), $postcode ),
			sprintf( '%s: %s', __( 'Budget', 'hillcroft-garden-designer' ), $budget ),
			'',
			__( 'Message:', 'hillcroft-garden-designer' ),
			$message,
			'',
			sprintf( '%s: %s', __( 'Open in Designer', 'hillcroft-garden-designer' ), $link ),
		);
		wp_mail( $to, $subject, implode( "\n", $lines ) );
	}

	private function current_url() {
		$host = isset( $_SERVER['HTTP_HOST'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_HOST'] ) ) : '';
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';
		$url  = ( is_ssl() ? 'https://' : 'http://' ) . $host . $uri;
		return remove_query_arg( 'hgd_enquiry', $url );
	}
}
