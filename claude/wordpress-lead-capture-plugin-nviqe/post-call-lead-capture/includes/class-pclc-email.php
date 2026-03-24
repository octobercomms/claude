<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class PCLC_Email {

	private static function brevo_request( $body ) {
		$api_key = PCLC_Settings::get( 'brevo_api_key' );

		if ( empty( $api_key ) ) {
			return new WP_Error( 'no_api_key', __( 'Brevo API key is not configured.', 'post-call-lead-capture' ) );
		}

		$response = wp_remote_post(
			'https://api.brevo.com/v3/smtp/email',
			array(
				'headers' => array(
					'api-key'      => $api_key,
					'Content-Type' => 'application/json',
					'Accept'       => 'application/json',
				),
				'body'    => wp_json_encode( $body ),
				'timeout' => 15,
			)
		);

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$status_code = wp_remote_retrieve_response_code( $response );
		if ( $status_code < 200 || $status_code >= 300 ) {
			$response_body = wp_remote_retrieve_body( $response );
			return new WP_Error( 'brevo_api_error', sprintf( 'Brevo API returned status %d: %s', $status_code, $response_body ) );
		}

		return true;
	}

	public static function send_initial_email( $contact_id ) {
		$contact = PCLC_Database::get_contact( $contact_id );
		if ( ! $contact ) {
			return false;
		}

		$subject       = PCLC_Settings::get( 'email_subject', 'Your Project Resources' );
		$sender_name   = PCLC_Settings::get( 'sender_name' );
		$sender_email  = PCLC_Settings::get( 'sender_email' );
		$intro         = PCLC_Settings::get( 'intro_paragraph' );
		$before_after  = PCLC_Settings::get( 'before_after_url' );
		$payment_url   = PCLC_Settings::get( 'stripe_payment_url' );
		$booking_url   = PCLC_Settings::get( 'booking_url' );

		if ( 'new_build' === $contact->project_type ) {
			$report_url   = PCLC_Settings::get( 'new_build_report_url' );
			$report_label = __( 'View Your New Build Pre-Design Report', 'post-call-lead-capture' );
		} else {
			$report_url   = PCLC_Settings::get( 'renovation_report_url' );
			$report_label = __( 'View Your Renovation Pre-Design Report', 'post-call-lead-capture' );
		}

		$html_body = self::build_initial_html( $contact, $intro, $report_url, $report_label, $before_after, $payment_url, $booking_url );

		$body = array(
			'sender'     => array(
				'name'  => $sender_name,
				'email' => $sender_email,
			),
			'to'         => array(
				array(
					'email' => $contact->email,
					'name'  => $contact->first_name . ' ' . $contact->last_name,
				),
			),
			'subject'    => $subject,
			'htmlContent' => $html_body,
		);

		return self::brevo_request( $body );
	}

	public static function send_chase_email( $contact_id ) {
		$contact = PCLC_Database::get_contact( $contact_id );
		if ( ! $contact ) {
			return false;
		}

		$subject      = PCLC_Settings::get( 'email_subject', 'Your Project Resources' );
		$sender_name  = PCLC_Settings::get( 'sender_name' );
		$sender_email = PCLC_Settings::get( 'sender_email' );
		$chase_para   = PCLC_Settings::get( 'chase_paragraph' );
		$payment_url  = PCLC_Settings::get( 'stripe_payment_url' );
		$booking_url  = PCLC_Settings::get( 'booking_url' );

		if ( 'new_build' === $contact->project_type ) {
			$report_url   = PCLC_Settings::get( 'new_build_report_url' );
			$report_label = __( 'View Your New Build Pre-Design Report', 'post-call-lead-capture' );
		} else {
			$report_url   = PCLC_Settings::get( 'renovation_report_url' );
			$report_label = __( 'View Your Renovation Pre-Design Report', 'post-call-lead-capture' );
		}

		$html_body = self::build_chase_html( $contact, $chase_para, $report_url, $report_label, $payment_url, $booking_url );

		$body = array(
			'sender'     => array(
				'name'  => $sender_name,
				'email' => $sender_email,
			),
			'to'         => array(
				array(
					'email' => $contact->email,
					'name'  => $contact->first_name . ' ' . $contact->last_name,
				),
			),
			'subject'    => 'Checking in — ' . $subject,
			'htmlContent' => $html_body,
		);

		return self::brevo_request( $body );
	}

	public static function send_architect_followup( $contact_id, $followup_number ) {
		$contact         = PCLC_Database::get_contact( $contact_id );
		$architect_email = PCLC_Settings::get( 'architect_email' );
		$sender_name     = PCLC_Settings::get( 'sender_name' );
		$sender_email    = PCLC_Settings::get( 'sender_email' );

		if ( ! $contact || empty( $architect_email ) ) {
			return false;
		}

		$delete_token = self::generate_action_token( $contact_id, 'delete' );
		$chase_token  = self::generate_action_token( $contact_id, 'chase' );

		$delete_url = add_query_arg(
			array(
				'pclc_action'     => 'delete',
				'pclc_contact_id' => $contact_id,
				'pclc_token'      => $delete_token,
			),
			home_url( '/' )
		);

		$chase_url = add_query_arg(
			array(
				'pclc_action'     => 'chase',
				'pclc_contact_id' => $contact_id,
				'pclc_token'      => $chase_token,
			),
			home_url( '/' )
		);

		$subject = sprintf(
			/* translators: 1: follow-up number, 2: contact full name */
			__( 'Follow-Up %1$d: %2$s', 'post-call-lead-capture' ),
			$followup_number,
			$contact->first_name . ' ' . $contact->last_name
		);

		$html_body = self::build_architect_html( $contact, $followup_number, $delete_url, $chase_url );

		$body = array(
			'sender'      => array(
				'name'  => $sender_name,
				'email' => $sender_email,
			),
			'to'          => array(
				array(
					'email' => $architect_email,
				),
			),
			'subject'     => $subject,
			'htmlContent' => $html_body,
		);

		return self::brevo_request( $body );
	}

	public static function generate_action_token( $contact_id, $action ) {
		$secret = wp_salt( 'auth' );
		return hash_hmac( 'sha256', $contact_id . '|' . $action, $secret );
	}

	public static function verify_action_token( $contact_id, $action, $token ) {
		$expected = self::generate_action_token( $contact_id, $action );
		return hash_equals( $expected, $token );
	}

	// -----------------------------------------------------------------
	// HTML builders
	// -----------------------------------------------------------------

	private static function email_wrapper( $content ) {
		return '<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Email</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:30px 10px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:4px;overflow:hidden;">
<tr><td style="padding:40px 40px 30px 40px;color:#333333;font-size:16px;line-height:1.6;">
' . $content . '
</td></tr>
<tr><td style="padding:20px 40px;background-color:#f9f9f9;color:#888888;font-size:12px;text-align:center;">
' . esc_html( get_bloginfo( 'name' ) ) . '
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>';
	}

	private static function cta_button( $url, $label ) {
		return '<p style="text-align:center;margin:24px 0;">
<a href="' . esc_url( $url ) . '" style="display:inline-block;padding:14px 28px;background-color:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:3px;font-size:15px;">' . esc_html( $label ) . '</a>
</p>';
	}

	private static function build_initial_html( $contact, $intro, $report_url, $report_label, $before_after, $payment_url, $booking_url ) {
		$content = '<h2 style="margin-top:0;font-size:22px;">Hi ' . esc_html( $contact->first_name ) . ',</h2>';
		$content .= '<p>' . wp_kses_post( $intro ) . '</p>';
		$content .= '<hr style="border:none;border-top:1px solid #eeeeee;margin:28px 0;">';

		if ( $report_url ) {
			$content .= self::cta_button( $report_url, $report_label );
		}
		if ( $before_after ) {
			$content .= self::cta_button( $before_after, __( 'View Our Before & After Projects', 'post-call-lead-capture' ) );
		}

		$content .= '<hr style="border:none;border-top:1px solid #eeeeee;margin:28px 0;">';

		if ( $payment_url ) {
			$content .= self::cta_button( $payment_url, __( 'Secure Your Project Fee', 'post-call-lead-capture' ) );
		}
		if ( $booking_url ) {
			$content .= self::cta_button( $booking_url, __( 'Book a Follow-Up Call', 'post-call-lead-capture' ) );
		}

		return self::email_wrapper( $content );
	}

	private static function build_chase_html( $contact, $chase_para, $report_url, $report_label, $payment_url, $booking_url ) {
		$content = '<h2 style="margin-top:0;font-size:22px;">Hi ' . esc_html( $contact->first_name ) . ',</h2>';
		$content .= '<p>' . wp_kses_post( $chase_para ) . '</p>';
		$content .= '<hr style="border:none;border-top:1px solid #eeeeee;margin:28px 0;">';

		if ( $report_url ) {
			$content .= self::cta_button( $report_url, $report_label );
		}
		if ( $payment_url ) {
			$content .= self::cta_button( $payment_url, __( 'Secure Your Project Fee', 'post-call-lead-capture' ) );
		}
		if ( $booking_url ) {
			$content .= self::cta_button( $booking_url, __( 'Book a Call', 'post-call-lead-capture' ) );
		}

		return self::email_wrapper( $content );
	}

	private static function build_architect_html( $contact, $followup_number, $delete_url, $chase_url ) {
		$full_name = esc_html( $contact->first_name . ' ' . $contact->last_name );
		$email     = esc_html( $contact->email );

		$content  = '<h2 style="margin-top:0;font-size:22px;">Follow-Up Prompt #' . intval( $followup_number ) . '</h2>';
		$content .= '<p>This is a reminder to action your follow-up for:</p>';
		$content .= '<table style="width:100%;border-collapse:collapse;margin-bottom:24px;">';
		$content .= '<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Name</td><td style="padding:8px;border:1px solid #ddd;">' . $full_name . '</td></tr>';
		$content .= '<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Email</td><td style="padding:8px;border:1px solid #ddd;">' . $email . '</td></tr>';
		$content .= '</table>';
		$content .= '<p>Please choose one of the following actions:</p>';
		$content .= self::cta_button( $chase_url, __( 'Send Follow-Up Email to Client', 'post-call-lead-capture' ) );
		$content .= self::cta_button( $delete_url, __( 'Delete This Contact', 'post-call-lead-capture' ) );
		$content .= '<p style="font-size:12px;color:#888888;">These links are unique to this contact. Clicking Delete will suppress all further emails for this prospect.</p>';

		return self::email_wrapper( $content );
	}
}
