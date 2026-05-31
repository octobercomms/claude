<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Amazon SES SMTP integration. When enabled in Settings, hooks PHPMailer
 * so all wp_mail() calls (lead notifications + anything else WordPress
 * sends) go via Amazon SES — no separate SMTP plugin required.
 *
 * Credentials are SES *SMTP* credentials (Username/Password generated in
 * the SES console → SMTP settings), NOT IAM access keys.
 */
class HGDF_Mail {

	public static function init() {
		add_action( 'phpmailer_init',   array( __CLASS__, 'configure_phpmailer' ) );
		add_filter( 'wp_mail_from',      array( __CLASS__, 'filter_from_address' ) );
		add_filter( 'wp_mail_from_name', array( __CLASS__, 'filter_from_name' ) );
		add_action( 'admin_post_hgd_form_send_test_email', array( __CLASS__, 'handle_test_email' ) );
	}

	public static function ses_enabled() {
		return (bool) get_option( 'hgd_form_ses_enabled', false );
	}

	public static function configure_phpmailer( $phpmailer ) {
		if ( ! self::ses_enabled() ) { return; }

		$region   = trim( (string) get_option( 'hgd_form_ses_region', 'us-east-1' ) );
		$username = trim( (string) get_option( 'hgd_form_ses_smtp_username', '' ) );
		$password = trim( (string) get_option( 'hgd_form_ses_smtp_password', '' ) );
		$port     = (int) get_option( 'hgd_form_ses_smtp_port', 587 );

		if ( $region === '' || $username === '' || $password === '' ) {
			return;
		}

		$phpmailer->isSMTP();
		$phpmailer->Host       = 'email-smtp.' . $region . '.amazonaws.com';
		$phpmailer->Port       = $port;
		$phpmailer->SMTPAuth   = true;
		$phpmailer->Username   = $username;
		$phpmailer->Password   = $password;
		$phpmailer->SMTPSecure = ( $port === 465 ) ? 'ssl' : 'tls';

		// SES will reject messages whose From doesn't match a verified
		// identity. Make sure the configured From is on the envelope too.
		$from_email = self::get_from_address();
		$from_name  = self::get_from_name();
		if ( $from_email && is_email( $from_email ) ) {
			try {
				$phpmailer->setFrom( $from_email, $from_name, false );
			} catch ( \Throwable $e ) {
				error_log( 'OCF SES: setFrom failed — ' . $e->getMessage() );
			}
		}
	}

	public static function filter_from_address( $current ) {
		$custom = trim( (string) get_option( 'hgd_form_from_email', '' ) );
		return ( $custom !== '' && is_email( $custom ) ) ? $custom : $current;
	}

	public static function filter_from_name( $current ) {
		$custom = trim( (string) get_option( 'hgd_form_from_name', '' ) );
		return $custom !== '' ? $custom : $current;
	}

	private static function get_from_address() {
		$custom = trim( (string) get_option( 'hgd_form_from_email', '' ) );
		return $custom !== '' ? $custom : (string) get_option( 'admin_email', '' );
	}

	private static function get_from_name() {
		$custom = trim( (string) get_option( 'hgd_form_from_name', '' ) );
		return $custom !== '' ? $custom : (string) get_bloginfo( 'name' );
	}

	/**
	 * admin-post handler for the "send test email" form. Self-contained:
	 * verifies capability + nonce and redirects inline.
	 */
	public static function handle_test_email() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'Forbidden' );
		}
		check_admin_referer( 'hgd_form_send_test_email' );

		$to = sanitize_email( wp_unslash( $_POST['to'] ?? '' ) );
		if ( ! is_email( $to ) ) {
			wp_safe_redirect( admin_url( 'admin.php?page=hgd-forms-analytics&test=invalid' ) );
			exit;
		}

		// Capture wp_mail failures so we can surface a useful message back.
		$failure_msg = '';
		$capture = function ( $wp_error ) use ( &$failure_msg ) {
			if ( is_wp_error( $wp_error ) ) {
				$failure_msg = $wp_error->get_error_message();
			}
		};
		add_action( 'wp_mail_failed', $capture );

		$sent = wp_mail(
			$to,
			'Hillcroft Forms — SMTP test',
			"This is a test email from the Hillcroft Garden Designer forms engine.\n\nSent at " . current_time( 'mysql' ) . " by " . wp_get_current_user()->user_email . ".\n\nIf you received this, your mail configuration is working."
		);

		remove_action( 'wp_mail_failed', $capture );

		$status = $sent ? 'ok' : 'fail';
		$args   = array( 'page' => 'hgd-forms-analytics', 'test' => $status );
		if ( ! $sent && $failure_msg ) {
			set_transient( 'hgd_form_test_mail_error', $failure_msg, 60 );
		}
		wp_safe_redirect( add_query_arg( $args, admin_url( 'admin.php' ) ) );
		exit;
	}
}
