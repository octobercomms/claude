<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Handles signed architect action URLs (delete contact / send chase email).
 * Actions are processed via a query-string handler on the front end
 * so no login is required, but every URL is protected by an HMAC token.
 */
class PCLC_Actions {

	public static function init() {
		add_action( 'template_redirect', array( __CLASS__, 'handle_action_url' ) );
	}

	public static function handle_action_url() {
		$action     = isset( $_GET['pclc_action'] ) ? sanitize_key( $_GET['pclc_action'] ) : '';
		$contact_id = isset( $_GET['pclc_contact_id'] ) ? absint( $_GET['pclc_contact_id'] ) : 0;
		$token      = isset( $_GET['pclc_token'] ) ? sanitize_text_field( wp_unslash( $_GET['pclc_token'] ) ) : '';

		if ( ! $action || ! $contact_id || ! $token ) {
			return;
		}

		if ( ! in_array( $action, array( 'delete', 'chase', 'cold' ), true ) ) {
			return;
		}

		if ( ! PCLC_Email::verify_action_token( $contact_id, $action, $token ) ) {
			wp_die(
				esc_html__( 'This link is invalid or has expired.', 'post-call-lead-capture' ),
				esc_html__( 'Invalid Link', 'post-call-lead-capture' ),
				array( 'response' => 403 )
			);
		}

		$contact = PCLC_Database::get_contact( $contact_id );

		if ( ! $contact ) {
			wp_die(
				esc_html__( 'Contact not found.', 'post-call-lead-capture' ),
				esc_html__( 'Not Found', 'post-call-lead-capture' ),
				array( 'response' => 404 )
			);
		}

		if ( 'deleted' === $contact->status ) {
			wp_die(
				esc_html__( 'This contact has already been deleted.', 'post-call-lead-capture' ),
				esc_html__( 'Already Done', 'post-call-lead-capture' ),
				array( 'response' => 200 )
			);
		}

		if ( 'delete' === $action ) {
			PCLC_Database::mark_deleted( $contact_id );
			wp_die(
				esc_html__( 'Contact deleted. No further emails will be sent to this prospect.', 'post-call-lead-capture' ),
				esc_html__( 'Contact Deleted', 'post-call-lead-capture' ),
				array( 'response' => 200 )
			);
		}

		if ( 'chase' === $action ) {
			if ( $contact->chase_email_sent ) {
				wp_die(
					esc_html__( 'A chase email has already been sent to this contact.', 'post-call-lead-capture' ),
					esc_html__( 'Already Sent', 'post-call-lead-capture' ),
					array( 'response' => 200 )
				);
			}

			$result = PCLC_Email::send_chase_email( $contact_id );

			if ( is_wp_error( $result ) ) {
				wp_die(
					esc_html__( 'There was a problem sending the chase email. Please try again or check your Brevo settings.', 'post-call-lead-capture' ),
					esc_html__( 'Send Error', 'post-call-lead-capture' ),
					array( 'response' => 500 )
				);
			}

			PCLC_Database::mark_chase_email_sent( $contact_id );

			wp_die(
				esc_html__( 'Chase email sent successfully.', 'post-call-lead-capture' ),
				esc_html__( 'Email Sent', 'post-call-lead-capture' ),
				array( 'response' => 200 )
			);
		}

		if ( 'cold' === $action ) {
			if ( $contact->cold_email_sent ) {
				wp_die(
					esc_html__( 'A cold re-engage email has already been sent to this contact.', 'post-call-lead-capture' ),
					esc_html__( 'Already Sent', 'post-call-lead-capture' ),
					array( 'response' => 200 )
				);
			}

			$result = PCLC_Email::send_cold_email( $contact_id );

			if ( is_wp_error( $result ) ) {
				wp_die(
					esc_html__( 'There was a problem sending the cold re-engage email. Please try again or check your Brevo settings.', 'post-call-lead-capture' ),
					esc_html__( 'Send Error', 'post-call-lead-capture' ),
					array( 'response' => 500 )
				);
			}

			PCLC_Database::mark_cold_email_sent( $contact_id );

			wp_die(
				esc_html__( 'Cold re-engage email sent successfully.', 'post-call-lead-capture' ),
				esc_html__( 'Email Sent', 'post-call-lead-capture' ),
				array( 'response' => 200 )
			);
		}
	}
}
