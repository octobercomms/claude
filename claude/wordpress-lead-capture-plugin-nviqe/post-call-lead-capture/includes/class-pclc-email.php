<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class PCLC_Email {

	// -----------------------------------------------------------------
	// Brevo API
	// -----------------------------------------------------------------

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

	private static function dispatch( $to_email, $to_name, $subject, $html_body ) {
		$sender_name  = PCLC_Settings::get( 'sender_name' );
		$sender_email = PCLC_Settings::get( 'sender_email' );

		$body = array(
			'sender'      => array(
				'name'  => $sender_name,
				'email' => $sender_email,
			),
			'to'          => array(
				array(
					'email' => $to_email,
					'name'  => $to_name,
				),
			),
			'subject'     => $subject,
			'htmlContent' => $html_body,
		);

		return self::brevo_request( $body );
	}

	// -----------------------------------------------------------------
	// Public send methods
	// -----------------------------------------------------------------

	public static function send_initial_email( $contact_id ) {
		$contact = PCLC_Database::get_contact( $contact_id );
		if ( ! $contact ) {
			return false;
		}
		return self::dispatch(
			$contact->email,
			$contact->first_name . ' ' . $contact->last_name,
			PCLC_Settings::get( 'email_subject', 'Your Project Resources' ),
			self::build_initial_html( $contact )
		);
	}

	public static function send_chase_email( $contact_id ) {
		$contact = PCLC_Database::get_contact( $contact_id );
		if ( ! $contact ) {
			return false;
		}
		return self::dispatch(
			$contact->email,
			$contact->first_name . ' ' . $contact->last_name,
			'Checking in — ' . PCLC_Settings::get( 'email_subject', 'Your Project Resources' ),
			self::build_chase_html( $contact )
		);
	}

	public static function send_architect_followup( $contact_id, $followup_number ) {
		$contact         = PCLC_Database::get_contact( $contact_id );
		$architect_email = PCLC_Settings::get( 'architect_email' );

		if ( ! $contact || empty( $architect_email ) ) {
			return false;
		}

		return self::dispatch(
			$architect_email,
			PCLC_Settings::get( 'sender_name', 'Architect' ),
			sprintf(
				/* translators: 1: follow-up number, 2: contact full name */
				__( 'Follow-Up %1$d: %2$s', 'post-call-lead-capture' ),
				$followup_number,
				$contact->first_name . ' ' . $contact->last_name
			),
			self::build_architect_html( $contact, $followup_number )
		);
	}

	// -----------------------------------------------------------------
	// Test send methods (dummy contact, arbitrary recipient)
	// -----------------------------------------------------------------

	public static function send_test_initial( $contact, $recipient ) {
		return self::dispatch(
			$recipient,
			$contact->first_name . ' ' . $contact->last_name,
			'[TEST] ' . PCLC_Settings::get( 'email_subject', 'Your Project Resources' ),
			self::build_initial_html( $contact )
		);
	}

	public static function send_test_chase( $contact, $recipient ) {
		return self::dispatch(
			$recipient,
			$contact->first_name . ' ' . $contact->last_name,
			'[TEST] Checking in — ' . PCLC_Settings::get( 'email_subject', 'Your Project Resources' ),
			self::build_chase_html( $contact )
		);
	}

	public static function send_test_architect_followup( $contact, $followup_number, $recipient ) {
		return self::dispatch(
			$recipient,
			PCLC_Settings::get( 'sender_name', 'Architect' ),
			sprintf( '[TEST] Follow-Up %d: %s', $followup_number, $contact->first_name . ' ' . $contact->last_name ),
			self::build_architect_html( $contact, $followup_number )
		);
	}

	// -----------------------------------------------------------------
	// Token helpers
	// -----------------------------------------------------------------

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

	/**
	 * Minimal plain-text-style wrapper.
	 * White background, readable font, max 600px. No decorative containers.
	 */
	private static function email_wrapper( $content, $include_signature = true ) {
		$logo_id  = (int) PCLC_Settings::get( 'logo_attachment_id', 0 );
		$logo_url = $logo_id ? wp_get_attachment_image_url( $logo_id, 'medium' ) : '';

		$logo_block = '';
		if ( $logo_url ) {
			$logo_block = '<p style="margin:0 0 32px 0;"><img src="' . esc_url( $logo_url ) . '" alt="' . esc_attr( get_bloginfo( 'name' ) ) . '" style="max-width:200px;height:auto;display:block;" /></p>';
		}

		$sig_block = '';
		if ( $include_signature ) {
			$signature = PCLC_Settings::get( 'email_signature', '' );
			if ( $signature ) {
				$sig_block = '<p style="margin:32px 0 0 0;border-top:1px solid #e0e0e0;padding-top:20px;color:#555555;font-size:14px;line-height:1.5;">'
					. wp_kses_post( $signature )
					. '</p>';
			}
		}

		return '<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:Georgia,\'Times New Roman\',serif;color:#1a1a1a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:40px 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">
<tr><td style="font-size:16px;line-height:1.7;color:#1a1a1a;">
' . $logo_block . $content . $sig_block . '
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>';
	}

	private static function cta_button( $url, $label ) {
		return '<p style="margin:20px 0;">'
			. '<a href="' . esc_url( $url ) . '" style="display:inline-block;padding:12px 24px;background-color:#1a1a1a;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;letter-spacing:0.03em;">'
			. esc_html( $label )
			. '</a>'
			. '</p>';
	}

	private static function get_report( $project_type ) {
		if ( 'new_build' === $project_type ) {
			return array(
				'url'   => PCLC_Settings::get( 'new_build_report_url' ),
				'label' => __( 'View Your New Build Pre-Design Report', 'post-call-lead-capture' ),
			);
		}
		return array(
			'url'   => PCLC_Settings::get( 'renovation_report_url' ),
			'label' => __( 'View Your Renovation Pre-Design Report', 'post-call-lead-capture' ),
		);
	}

	private static function build_initial_html( $contact ) {
		$intro        = PCLC_Settings::get( 'intro_paragraph' );
		$before_after = PCLC_Settings::get( 'before_after_url' );
		$payment_url  = PCLC_Settings::get( 'stripe_payment_url' );
		$booking_url  = PCLC_Settings::get( 'booking_url' );
		$report       = self::get_report( $contact->project_type );

		$content  = '<p style="margin:0 0 20px 0;">Hi ' . esc_html( $contact->first_name ) . ',</p>';
		$content .= '<p style="margin:0 0 28px 0;">' . wp_kses_post( $intro ) . '</p>';

		if ( $report['url'] ) {
			$content .= self::cta_button( $report['url'], $report['label'] );
		}
		if ( $before_after ) {
			$content .= self::cta_button( $before_after, __( 'View Our Before & After Projects', 'post-call-lead-capture' ) );
		}
		if ( $payment_url ) {
			$content .= self::cta_button( $payment_url, __( 'Secure Your Project Fee', 'post-call-lead-capture' ) );
		}
		if ( $booking_url ) {
			$content .= self::cta_button( $booking_url, __( 'Book a Follow-Up Call', 'post-call-lead-capture' ) );
		}

		return self::email_wrapper( $content );
	}

	private static function build_chase_html( $contact ) {
		$chase_para  = PCLC_Settings::get( 'chase_paragraph' );
		$payment_url = PCLC_Settings::get( 'stripe_payment_url' );
		$booking_url = PCLC_Settings::get( 'booking_url' );
		$report      = self::get_report( $contact->project_type );

		$content  = '<p style="margin:0 0 20px 0;">Hi ' . esc_html( $contact->first_name ) . ',</p>';
		$content .= '<p style="margin:0 0 28px 0;">' . wp_kses_post( $chase_para ) . '</p>';

		if ( $report['url'] ) {
			$content .= self::cta_button( $report['url'], $report['label'] );
		}
		if ( $payment_url ) {
			$content .= self::cta_button( $payment_url, __( 'Secure Your Project Fee', 'post-call-lead-capture' ) );
		}
		if ( $booking_url ) {
			$content .= self::cta_button( $booking_url, __( 'Book a Call', 'post-call-lead-capture' ) );
		}

		return self::email_wrapper( $content );
	}

	private static function build_architect_html( $contact, $followup_number ) {
		$full_name = esc_html( $contact->first_name . ' ' . $contact->last_name );
		$email     = esc_html( $contact->email );

		$delete_token = self::generate_action_token( $contact->id, 'delete' );
		$chase_token  = self::generate_action_token( $contact->id, 'chase' );

		$delete_url = add_query_arg(
			array(
				'pclc_action'     => 'delete',
				'pclc_contact_id' => $contact->id,
				'pclc_token'      => $delete_token,
			),
			home_url( '/' )
		);

		$chase_url = add_query_arg(
			array(
				'pclc_action'     => 'chase',
				'pclc_contact_id' => $contact->id,
				'pclc_token'      => $chase_token,
			),
			home_url( '/' )
		);

		$content  = '<p style="margin:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;">Follow-Up Prompt #' . intval( $followup_number ) . '</p>';
		$content .= '<p style="margin:0 0 20px 0;font-family:Arial,Helvetica,sans-serif;">This is your reminder to action the follow-up for:</p>';
		$content .= '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;">';
		$content .= '<tr><td style="padding:8px 16px 8px 0;color:#555555;">Name</td><td style="padding:8px 0;font-weight:bold;">' . $full_name . '</td></tr>';
		$content .= '<tr><td style="padding:8px 16px 8px 0;color:#555555;">Email</td><td style="padding:8px 0;">' . $email . '</td></tr>';
		$content .= '</table>';
		$content .= self::cta_button( $chase_url, __( 'Send Follow-Up Email to Client', 'post-call-lead-capture' ) );
		$content .= self::cta_button( $delete_url, __( 'Delete This Contact', 'post-call-lead-capture' ) );
		$content .= '<p style="margin:20px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#888888;">These links are unique to this contact. Clicking Delete will suppress all further emails for this prospect.</p>';

		// Architect prompt emails do not include the client signature.
		return self::email_wrapper( $content, false );
	}
}
