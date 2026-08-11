<?php
/**
 * Confirmation emails — Claude-drafted, Tiam-editable, sent with open/click tracking.
 *
 * Flow: Tiam approve a project → draft() asks Claude to write a warm "good to go"
 * email from the project data → Tiam edit the subject/body in the admin → send()
 * delivers it. Sending goes through Brevo's transactional API when a key is set
 * (so opens/clicks come back via webhook); otherwise it falls back to wp_mail with
 * a tracking pixel + click-through redirect. The email always carries the secure
 * payment button (the client portal link) appended by the system.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Email {

	const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
	}

	public static function routes() {
		register_rest_route( 'yaa/v1', '/brevo-webhook', array(
			'methods'             => 'POST',
			'permission_callback' => '__return_true',
			'callback'            => array( __CLASS__, 'brevo_webhook' ),
		) );
		// Fallback (wp_mail) open pixel + click redirect.
		register_rest_route( 'yaa/v1', '/track', array(
			'methods'             => 'GET',
			'permission_callback' => '__return_true',
			'callback'            => array( __CLASS__, 'track' ),
		) );
	}

	// ---- Store helpers ----
	public static function latest( $project_id ) {
		global $wpdb;
		$t = YAA_DB::emails_table();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t} WHERE project_id = %d ORDER BY id DESC LIMIT 1", (int) $project_id ) ); // phpcs:ignore WordPress.DB
	}
	public static function get( $email_id ) {
		global $wpdb;
		$t = YAA_DB::emails_table();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t} WHERE id = %d", (int) $email_id ) ); // phpcs:ignore WordPress.DB
	}

	/** Draft (or re-draft) the confirmation email for a project via Claude. */
	public static function draft( $project_id ) {
		$row = YAA_Project::get( $project_id );
		if ( ! $row ) {
			return new WP_Error( 'yaa_no_project', 'Project not found.' );
		}
		$summary = self::project_summary( $row );

		$subject = 'Your Architect — your project is good to go';
		$body    = "Hi " . ( $row->name ? strtok( $row->name, ' ' ) : 'there' ) . ",\n\n"
			. "Great news — we've reviewed your project and it's good to go. Everything you told Archie is confirmed, and your fixed price is ready.\n\n"
			. "To get started, just complete your secure payment using the button below. As soon as that's done we'll begin your drawings and you'll be able to track everything in your project portal.\n\n"
			. "If anything's changed or you have a question, simply reply to this email.";

		// Prefer a Claude-written draft when configured; fall back to the template above.
		if ( YAA_Claude::is_configured() ) {
			$system = implode( "\n", array(
				'You write a short, warm confirmation email from Your Architect (a trading name of Tiam Architects LLP, ARB-registered) to a UK homeowner whose fixed-price drawings project has just been approved and is good to go.',
				'Plain, friendly British English, about 110–140 words. One line of good news, a sentence on what happens next, and an invitation to complete their secure payment to start the drawings.',
				'Do NOT invent facts, dates, prices or phone numbers. Do NOT add the payment link, a subject line inside the body, or a formal signature — the system appends the secure payment button and the signature. Write body as plain text with paragraph breaks.',
				'Call draft_email with a subject and body.',
			) );
			$tools = array( array(
				'name'         => 'draft_email',
				'description'  => 'Return the confirmation email subject and plain-text body.',
				'input_schema' => array(
					'type'       => 'object',
					'properties' => array(
						'subject' => array( 'type' => 'string' ),
						'body'    => array( 'type' => 'string' ),
					),
					'required'   => array( 'subject', 'body' ),
				),
			) );
			$res = YAA_Claude::turn( $system, array( array( 'role' => 'user', 'text' => $summary ) ), $tools );
			if ( ! is_wp_error( $res ) && ! empty( $res['tool']['input']['subject'] ) && ! empty( $res['tool']['input']['body'] ) ) {
				$subject = sanitize_text_field( (string) $res['tool']['input']['subject'] );
				$body    = (string) $res['tool']['input']['body'];
			}
		}

		return self::store_draft( $project_id, $subject, $body );
	}

	private static function project_summary( $row ) {
		$state = json_decode( (string) $row->state_json, true );
		$state = is_array( $state ) ? $state : array();
		$lines = array();
		$lines[] = 'Client name: ' . ( $row->name ? $row->name : 'unknown' );
		$lines[] = 'Property: ' . ( $row->postcode ? $row->postcode : 'not given' );
		foreach ( YAA_Archie::answer_summary( $state ) as $q ) {
			if ( $q['answered'] ) {
				$lines[] = $q['label'] . ': ' . $q['value'];
			}
		}
		$lines[] = 'Fixed price total: ' . YAA_Pricing::money( (int) $row->total );
		return implode( "\n", $lines );
	}

	/** One draft per project — replace any prior unsent draft. */
	public static function store_draft( $project_id, $subject, $body ) {
		global $wpdb;
		$t   = YAA_DB::emails_table();
		$row = self::latest( $project_id );
		$data = array( 'subject' => (string) $subject, 'body' => (string) $body, 'status' => 'draft' );
		if ( $row && 'draft' === $row->status ) {
			$wpdb->update( $t, $data, array( 'id' => (int) $row->id ), array( '%s', '%s', '%s' ), array( '%d' ) ); // phpcs:ignore WordPress.DB
			return (int) $row->id;
		}
		$data['project_id'] = (int) $project_id;
		$data['created']    = current_time( 'mysql' );
		$wpdb->insert( $t, $data, array( '%s', '%s', '%s', '%d', '%s' ) ); // phpcs:ignore WordPress.DB
		return (int) $wpdb->insert_id;
	}

	public static function update_draft( $email_id, $subject, $body ) {
		global $wpdb;
		$t = YAA_DB::emails_table();
		$wpdb->update( $t, array( 'subject' => (string) $subject, 'body' => (string) $body ), array( 'id' => (int) $email_id, 'status' => 'draft' ), array( '%s', '%s' ), array( '%d', '%s' ) ); // phpcs:ignore WordPress.DB
	}

	/** Send a drafted email to the client. */
	public static function send( $email_id ) {
		global $wpdb;
		$email = self::get( $email_id );
		if ( ! $email ) {
			return new WP_Error( 'yaa_no_email', 'Email not found.' );
		}
		$project = YAA_Project::get( $email->project_id );
		if ( ! $project || ! is_email( $project->email ) ) {
			return new WP_Error( 'yaa_no_recipient', 'No valid recipient email on the project.' );
		}

		$html = self::html( $email, $project );
		$from = YAA_Settings::get( 'email_from', get_option( 'admin_email' ) );
		$name = YAA_Settings::get( 'email_from_name', 'Your Architect' );

		$provider_id = '';
		$brevo_key   = trim( (string) YAA_Settings::get( 'brevo_api_key', '' ) );
		if ( '' !== $brevo_key ) {
			$provider_id = self::send_brevo( $brevo_key, $project, $email, $html, $from, $name );
			if ( is_wp_error( $provider_id ) ) {
				return $provider_id;
			}
		} else {
			$headers = array( 'Content-Type: text/html; charset=UTF-8', sprintf( 'From: %s <%s>', $name, $from ) );
			$sent    = wp_mail( $project->email, $email->subject, $html, $headers );
			if ( ! $sent ) {
				return new WP_Error( 'yaa_mail_failed', 'WordPress could not send the email.' );
			}
		}

		$wpdb->update(
			YAA_DB::emails_table(),
			array( 'status' => 'sent', 'sent_at' => current_time( 'mysql' ), 'provider_id' => (string) $provider_id ),
			array( 'id' => (int) $email_id ),
			array( '%s', '%s', '%s' ),
			array( '%d' )
		); // phpcs:ignore WordPress.DB

		YAA_Project::set_status( $email->project_id, 'emailed' );
		YAA_Project::log_event( $email->project_id, 'email_sent', array( 'email_id' => (int) $email_id ) );
		return true;
	}

	private static function send_brevo( $key, $project, $email, $html, $from, $name ) {
		$body = array(
			'sender'      => array( 'email' => $from, 'name' => $name ),
			'to'          => array( array( 'email' => $project->email, 'name' => $project->name ? $project->name : $project->email ) ),
			'subject'     => $email->subject,
			'htmlContent' => $html,
			'tags'        => array( 'yaa-email-' . (int) $email->id ),
		);
		$res = wp_remote_post( self::BREVO_ENDPOINT, array(
			'timeout' => 20,
			'headers' => array( 'api-key' => $key, 'content-type' => 'application/json', 'accept' => 'application/json' ),
			'body'    => wp_json_encode( $body ),
		) );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		$code = wp_remote_retrieve_response_code( $res );
		$json = json_decode( wp_remote_retrieve_body( $res ), true );
		if ( (int) $code >= 300 ) {
			$msg = isset( $json['message'] ) ? $json['message'] : ( 'Brevo HTTP ' . $code );
			return new WP_Error( 'yaa_brevo', $msg );
		}
		return isset( $json['messageId'] ) ? (string) $json['messageId'] : '';
	}

	/** Branded HTML wrapper + the secure payment button (portal link). */
	private static function html( $email, $project ) {
		$portal = YAA_Portal::url( $project->id );
		$paras  = '';
		foreach ( preg_split( '/\n\s*\n/', (string) $email->body ) as $p ) {
			$p = trim( $p );
			if ( '' !== $p ) {
				$paras .= '<p style="margin:0 0 16px;line-height:1.6;color:#1a2233">' . nl2br( esc_html( $p ) ) . '</p>';
			}
		}
		$cta = $project->paid
			? '<p style="margin:0 0 16px;line-height:1.6;color:#0f7a3d"><strong>Payment received — thank you.</strong> You can view everything in your portal below.</p>'
			: '<a href="' . esc_url( $portal ) . '" style="display:inline-block;background:#253E94;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px">Complete secure payment</a>';
		$total = YAA_Pricing::money( (int) $project->total );

		// wp_mail fallback: append a 1px open pixel (Brevo tracks natively).
		$pixel = '' === trim( (string) YAA_Settings::get( 'brevo_api_key', '' ) )
			? '<img src="' . esc_url( rest_url( 'yaa/v1/track' ) . '?e=' . (int) $email->id . '&a=open' ) . '" width="1" height="1" alt="" style="display:none">'
			: '';

		return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px">'
			. '<div style="font-size:20px;font-weight:800;color:#253E94;margin-bottom:20px">Your Architect</div>'
			. $paras
			. '<div style="margin:22px 0">' . $cta . '</div>'
			. '<div style="border-top:1px solid #e6e9f2;margin-top:24px;padding-top:16px;color:#6b7488;font-size:13px">'
			. 'Your fixed price: <strong style="color:#253E94">' . esc_html( $total ) . '</strong>'
			. ( $project->ref ? ' · Ref ' . esc_html( $project->ref ) : '' )
			. '<br>Your Architect — a trading name of Tiam Architects LLP. ARB-registered, RIBA chartered.'
			. '</div>' . $pixel . '</div>';
	}

	// ---- Tracking ----
	/** Brevo event webhook: opened / clicked → update counts + timestamps. */
	public static function brevo_webhook( $req ) {
		$payload = json_decode( $req->get_body(), true );
		$events  = isset( $payload[0] ) ? $payload : array( $payload ); // Brevo may batch.
		foreach ( (array) $events as $e ) {
			if ( ! is_array( $e ) ) {
				continue;
			}
			$event = isset( $e['event'] ) ? $e['event'] : '';
			$email_id = 0;
			if ( ! empty( $e['tags'] ) && is_array( $e['tags'] ) ) {
				foreach ( $e['tags'] as $tag ) {
					if ( 0 === strpos( (string) $tag, 'yaa-email-' ) ) {
						$email_id = (int) substr( $tag, strlen( 'yaa-email-' ) );
					}
				}
			}
			if ( ! $email_id && ! empty( $e['message-id'] ) ) {
				$row = self::by_provider_id( (string) $e['message-id'] );
				$email_id = $row ? (int) $row->id : 0;
			}
			if ( ! $email_id ) {
				continue;
			}
			if ( in_array( $event, array( 'opened', 'unique_opened' ), true ) ) {
				self::record( $email_id, 'open' );
			} elseif ( 'click' === $event ) {
				self::record( $email_id, 'click' );
			}
		}
		return new WP_REST_Response( array( 'ok' => true ) );
	}

	private static function by_provider_id( $mid ) {
		global $wpdb;
		$t = YAA_DB::emails_table();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t} WHERE provider_id = %s ORDER BY id DESC LIMIT 1", $mid ) ); // phpcs:ignore WordPress.DB
	}

	/** wp_mail fallback pixel / click redirect. */
	public static function track( $req ) {
		$id     = (int) $req->get_param( 'e' );
		$action = 'click' === $req->get_param( 'a' ) ? 'click' : 'open';
		if ( $id ) {
			self::record( $id, $action );
		}
		if ( 'click' === $action ) {
			$url = esc_url_raw( (string) $req->get_param( 'u' ) );
			wp_safe_redirect( $url ? $url : home_url( '/' ) );
			exit;
		}
		// 1x1 transparent GIF.
		header( 'Content-Type: image/gif' );
		echo base64_decode( 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' ); // phpcs:ignore
		exit;
	}

	private static function record( $email_id, $action ) {
		global $wpdb;
		$t   = YAA_DB::emails_table();
		$row = self::get( $email_id );
		if ( ! $row ) {
			return;
		}
		if ( 'open' === $action ) {
			$wpdb->query( $wpdb->prepare( "UPDATE {$t} SET opens = opens + 1, opened_at = COALESCE(opened_at, %s) WHERE id = %d", current_time( 'mysql' ), $email_id ) ); // phpcs:ignore WordPress.DB
			YAA_Project::log_event( $row->project_id, 'email_opened', array( 'email_id' => (int) $email_id ) );
		} else {
			$wpdb->query( $wpdb->prepare( "UPDATE {$t} SET clicks = clicks + 1, clicked_at = COALESCE(clicked_at, %s) WHERE id = %d", current_time( 'mysql' ), $email_id ) ); // phpcs:ignore WordPress.DB
			YAA_Project::log_event( $row->project_id, 'email_clicked', array( 'email_id' => (int) $email_id ) );
		}
	}
}
