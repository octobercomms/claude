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
 * Open/click tracking: when a sending relay (Brevo over SMTP) is active it does the
 * tracking and its events — opens, clicks, delivery, bounces, spam — come back via
 * brevo_webhook(); inject_tracking() is a no-op then (see relay_tracks()) so mail
 * goes out clean, with no double pixel or double-wrapped links. Without a relay we
 * track ourselves: every HTML email the plugin sends
 * via wp_mail — staged client emails, quote copies, studio alerts, sign-in links,
 * resume nudges — is run through inject_tracking() so it carries a 1px open pixel
 * and click-wrapped links back to the /track route. Each open and click is logged
 * as its own project event (with a timestamp, and the URL for clicks), so the
 * email log can show exactly when a recipient opened a message and how often —
 * not just a single first-seen timestamp. (Caveat worth remembering: open pixels
 * are unreliable — Gmail image-proxy pre-fetches and Apple Mail Privacy Protection
 * can inflate or mask opens — so treat clicks as the stronger signal.)
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
		// Auto-send the payment receipt when a project is marked paid.
		add_action( 'yaa_project_paid', array( __CLASS__, 'send_receipt' ), 10, 1 );
	}

	/**
	 * The editable email stages, in workflow order. Each: the studio-facing label,
	 * the project status set when it's sent, whether it carries the secure-payment
	 * button, and the default subject/body (tokens: {first_name} {ref} {total}).
	 * The defaults are overridable per-stage in Archie → Settings.
	 */
	public static function stages() {
		return array(
			'approved' => array(
				'label'   => __( 'Approved — preparing your drawings', 'your-architect-archie' ),
				'status'  => 'approved',
				'cta'     => false,
				'subject' => 'Your Architect — we\'ve reviewed your project',
				'body'    => "Hi {first_name},\n\nGreat news — we've reviewed the details of your project and we're happy to help. Our team is now preparing your drawings.\n\nWe'll send you a watermarked preview to look over shortly. Once you're happy with it, we'll share a secure link to confirm and pay.\n\nIf anything's changed in the meantime, just reply to this email.",
			),
			'progress' => array(
				'label'   => __( 'Drawings in progress', 'your-architect-archie' ),
				'status'  => 'in_progress',
				'cta'     => false,
				'subject' => 'Your Architect — we\'ve started your drawings',
				'body'    => "Hi {first_name},\n\nJust a quick update — our team has now started work on your drawings. We'll be in touch again as soon as your watermarked preview is ready to look over.\n\nIf you have any questions in the meantime, simply reply to this email.",
			),
			'preview'  => array(
				'label'   => __( 'Preview ready — payment link', 'your-architect-archie' ),
				'status'  => 'preview',
				'cta'     => true,
				'subject' => 'Your Architect — your preview is ready',
				'body'    => "Hi {first_name},\n\nYour drawings are ready to preview. You can view a watermarked version in your secure project portal using the button below.\n\nOnce you're happy, complete your secure payment on the same page and the full, un-watermarked drawings unlock straight away for you to download.\n\nIf you'd like anything adjusted first, just reply and let us know.",
			),
			'rejected' => array(
				'label'   => __( 'Not accepted', 'your-architect-archie' ),
				'status'  => 'rejected',
				'cta'     => false,
				'subject' => 'Your Architect — about your enquiry',
				'body'    => "Hi {first_name},\n\nThank you for your enquiry and for the details you shared. Having looked at it, this particular piece of work falls outside the service we're able to offer, so we're sorry that we won't be able to take it on this time.\n\nWe'd recommend speaking to a local specialist who can help. Wishing you the very best with your project.",
			),
			'receipt'  => array(
				'label'   => __( 'Payment receipt', 'your-architect-archie' ),
				'status'  => 'paid',
				'cta'     => false,
				'subject' => 'Your Architect — payment received',
				'body'    => "Hi {first_name},\n\nThank you — we've received your payment for {total}. Your full drawings are now unlocked in your project portal, ready to download.\n\nWe'll be in touch as your project progresses. If you need anything, just reply to this email.",
			),
		);
	}

	/** The subject/body for a stage — a Settings override if set, else the default. */
	public static function template( $kind ) {
		$stages = self::stages();
		if ( ! isset( $stages[ $kind ] ) ) {
			return array( 'subject' => '', 'body' => '' );
		}
		$saved = YAA_Settings::get( 'email_templates', array() );
		$saved = is_array( $saved ) && isset( $saved[ $kind ] ) && is_array( $saved[ $kind ] ) ? $saved[ $kind ] : array();
		$subject = ! empty( $saved['subject'] ) ? $saved['subject'] : $stages[ $kind ]['subject'];
		$body    = ! empty( $saved['body'] ) ? $saved['body'] : $stages[ $kind ]['body'];
		return array( 'subject' => (string) $subject, 'body' => (string) $body );
	}

	/** Replace {first_name} {name} {ref} {total} tokens against a project row. */
	private static function fill_tokens( $text, $project ) {
		$first = trim( (string) $project->name ) ? strtok( trim( (string) $project->name ), ' ' ) : 'there';
		$repl  = array(
			'{first_name}' => $first,
			'{name}'       => trim( (string) $project->name ) ? $project->name : 'there',
			'{ref}'        => (string) $project->ref,
			'{total}'      => YAA_Pricing::money( (int) $project->total ),
		);
		return strtr( (string) $text, $repl );
	}

	public static function routes() {
		register_rest_route( 'yaa/v1', '/brevo-webhook', array(
			'methods'             => 'POST',
			'permission_callback' => '__return_true',
			'callback'            => array( __CLASS__, 'brevo_webhook' ),
		) );
		// Our own open pixel + click redirect (used for every wp_mail-sent email).
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

	/** Newest email of a given stage kind (draft or sent). */
	public static function latest_of_kind( $project_id, $kind ) {
		global $wpdb;
		$t = YAA_DB::emails_table();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t} WHERE project_id = %d AND kind = %s ORDER BY id DESC LIMIT 1", (int) $project_id, (string) $kind ) ); // phpcs:ignore WordPress.DB
	}

	/** Prefill a stage email from its (editable) template, tokens filled in. */
	public static function draft_stage( $project_id, $kind ) {
		$row = YAA_Project::get( $project_id );
		if ( ! $row ) {
			return new WP_Error( 'yaa_no_project', 'Project not found.' );
		}
		$stages = self::stages();
		if ( ! isset( $stages[ $kind ] ) ) {
			return new WP_Error( 'yaa_bad_kind', 'Unknown email type.' );
		}
		$tpl = self::template( $kind );
		return self::store_draft( $project_id, self::fill_tokens( $tpl['subject'], $row ), self::fill_tokens( $tpl['body'], $row ), $kind );
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

	/** One draft per stage kind per project — replace any prior unsent draft of that kind. */
	public static function store_draft( $project_id, $subject, $body, $kind = 'confirmation' ) {
		global $wpdb;
		$t   = YAA_DB::emails_table();
		$row = self::latest_of_kind( $project_id, $kind );
		$data = array( 'subject' => (string) $subject, 'body' => (string) $body, 'status' => 'draft', 'kind' => (string) $kind );
		if ( $row && 'draft' === $row->status ) {
			$wpdb->update( $t, $data, array( 'id' => (int) $row->id ), array( '%s', '%s', '%s', '%s' ), array( '%d' ) ); // phpcs:ignore WordPress.DB
			return (int) $row->id;
		}
		$data['project_id'] = (int) $project_id;
		$data['created']    = current_time( 'mysql' );
		$wpdb->insert( $t, $data, array( '%s', '%s', '%s', '%s', '%d', '%s' ) ); // phpcs:ignore WordPress.DB
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
			// Relay/ESP tracking when the relay is on (inject_tracking() no-ops then and
			// the tag header lets the webhook match); our own pixel only without a relay.
			$tracked = self::inject_tracking( $html, (int) $email_id );
			$headers = array_merge(
				array( 'Content-Type: text/html; charset=UTF-8', sprintf( 'From: %s <%s>', $name, $from ) ),
				self::tag_headers( (int) $email_id )
			);
			$sent    = wp_mail( $project->email, $email->subject, $tracked, $headers );
			if ( ! $sent ) {
				return new WP_Error( 'yaa_mail_failed', 'WordPress could not send the email.' );
			}
		}

		$wpdb->update(
			YAA_DB::emails_table(),
			array( 'status' => 'sent', 'sent_at' => current_time( 'mysql' ), 'provider_id' => (string) $provider_id, 'recipient' => (string) $project->email, 'recipient_type' => 'client' ),
			array( 'id' => (int) $email_id ),
			array( '%s', '%s', '%s', '%s', '%s' ),
			array( '%d' )
		); // phpcs:ignore WordPress.DB

		$stages     = self::stages();
		$kind       = isset( $email->kind ) ? (string) $email->kind : 'confirmation';
		$new_status = isset( $stages[ $kind ]['status'] ) ? $stages[ $kind ]['status'] : 'emailed';
		YAA_Project::set_status( $email->project_id, $new_status );
		YAA_Project::log_event( $email->project_id, 'email_sent', array( 'email_id' => (int) $email_id, 'kind' => $kind ) );
		return true;
	}

	/**
	 * Low-level insert into the emails table. Returns the new row id. Used both by
	 * log_sent() (post-hoc logging) and send_tracked() (pre-send, so the row id can
	 * be baked into the tracking pixel/links before the mail goes out).
	 */
	private static function insert_log( $project_id, $to, $recipient_type, $kind, $subject, $body, $status, $sent_at = null ) {
		global $wpdb;
		$wpdb->insert(
			YAA_DB::emails_table(),
			array(
				'project_id'     => (int) $project_id,
				'kind'           => (string) $kind,
				'subject'        => (string) $subject,
				'body'           => (string) $body,
				'status'         => (string) $status,
				'recipient'      => (string) $to,
				'recipient_type' => 'studio' === $recipient_type ? 'studio' : 'client',
				'created'        => current_time( 'mysql' ),
				'sent_at'        => $sent_at,
			),
			array( '%d', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s' )
		); // phpcs:ignore WordPress.DB
		return (int) $wpdb->insert_id;
	}

	/**
	 * Record a one-off transactional email in the same table as the staged emails,
	 * so the Emails admin page shows everything the plugin sends. $ok is wp_mail()'s
	 * boolean return, so a failed send is logged too. Prefer send_tracked() for new
	 * callers — it logs AND adds our open/click tracking; this stays for anything
	 * that has already sent (or can't be tracked, e.g. plain-text mail).
	 */
	public static function log_sent( $project_id, $to, $recipient_type, $kind, $subject, $ok = true, $body = '' ) {
		return self::insert_log( $project_id, (string) $to, $recipient_type, $kind, $subject, $body, $ok ? 'sent' : 'failed', current_time( 'mysql' ) );
	}

	/**
	 * Send an HTML email through wp_mail with our own open + click tracking, and log
	 * it. This is the single path every ad-hoc plugin email should use (quote copies,
	 * studio alerts, sign-in links, resume nudges, client summaries) so engagement is
	 * visible regardless of whether an ESP is configured.
	 *
	 * The log row is created first (status 'sending') to mint an id, the tracking is
	 * injected using that id, the mail goes out, and the row is finalised to
	 * sent/failed. The *stored* body is the original (untracked) HTML, so the email
	 * viewer shows a clean copy; the opens/clicks are recorded against the row id.
	 *
	 * @param array $args project_id, to (string|array), recipient_type, kind, subject, html, headers.
	 * @return array { ok: bool, id: int }
	 */
	public static function send_tracked( $args ) {
		global $wpdb;
		$a = array_merge( array(
			'project_id'     => 0,
			'to'             => '',
			'recipient_type' => 'client',
			'kind'           => 'notice',
			'subject'        => '',
			'html'           => '',
			'headers'        => array(),
		), (array) $args );

		$to_raw = $a['to'];
		$to_str = is_array( $to_raw ) ? implode( ', ', $to_raw ) : (string) $to_raw;

		$email_id = self::insert_log( (int) $a['project_id'], $to_str, (string) $a['recipient_type'], (string) $a['kind'], (string) $a['subject'], (string) $a['html'], 'sending', null );

		$tracked = self::inject_tracking( (string) $a['html'], $email_id );
		$headers = ! empty( $a['headers'] ) ? (array) $a['headers'] : array( 'Content-Type: text/html; charset=UTF-8' );
		$headers = array_merge( $headers, self::tag_headers( $email_id ) );
		try {
			$ok = wp_mail( $to_raw, (string) $a['subject'], $tracked, $headers );
		} catch ( \Throwable $e ) {
			error_log( 'YAA send_tracked wp_mail failed (' . (string) $a['kind'] . '): ' . $e->getMessage() );
			$ok = false;
		}

		$wpdb->update(
			YAA_DB::emails_table(),
			array( 'status' => $ok ? 'sent' : 'failed', 'sent_at' => current_time( 'mysql' ) ),
			array( 'id' => (int) $email_id ),
			array( '%s', '%s' ),
			array( '%d' )
		); // phpcs:ignore WordPress.DB

		if ( (int) $a['project_id'] ) {
			YAA_Project::log_event( (int) $a['project_id'], 'email_sent', array( 'email_id' => (int) $email_id, 'kind' => (string) $a['kind'] ) );
		}
		return array( 'ok' => (bool) $ok, 'id' => (int) $email_id );
	}

	/**
	 * Re-deliver a logged email. Quote copies are regenerated fresh (latest price +
	 * a working resume link); everything else re-sends the stored HTML to the stored
	 * recipient, with fresh tracking, and lands as a new row in the log.
	 */
	public static function resend( $email_id ) {
		$em = self::get( $email_id );
		if ( ! $em ) {
			return new WP_Error( 'yaa_no_email', 'Email not found.' );
		}
		if ( 'quote' === $em->kind && class_exists( 'YAA_Followups' ) ) {
			return YAA_Followups::send_quote_copy( (int) $em->project_id, true )
				? true
				: new WP_Error( 'yaa_resend_failed', 'Could not resend the quote (nothing priced, or no email on file).' );
		}

		$to = (string) $em->recipient;
		if ( '' === $to && (int) $em->project_id ) {
			$p  = YAA_Project::get( $em->project_id );
			$to = $p ? (string) $p->email : '';
		}
		if ( '' === $to ) {
			return new WP_Error( 'yaa_no_recipient', 'No recipient on file for this email.' );
		}
		if ( '' === trim( (string) $em->body ) ) {
			return new WP_Error( 'yaa_no_body', 'The original message wasn\'t stored, so it can\'t be resent.' );
		}

		$from = YAA_Settings::get( 'email_from', get_option( 'admin_email' ) );
		$name = YAA_Settings::get( 'email_from_name', 'Your Architect' );
		$headers = array( 'Content-Type: text/html; charset=UTF-8', sprintf( 'From: %s <%s>', $name, $from ) );
		if ( 'studio' !== $em->recipient_type && class_exists( 'YAA_Followups' ) ) {
			$studio = YAA_Followups::studio_recipients();
			if ( ! empty( $studio[0] ) && is_email( $studio[0] ) ) {
				$headers[] = sprintf( 'Reply-To: %s <%s>', 'Your Architect', $studio[0] );
			}
		}

		$res = self::send_tracked( array(
			'project_id'     => (int) $em->project_id,
			'to'             => $to,
			'recipient_type' => (string) $em->recipient_type,
			'kind'           => (string) $em->kind,
			'subject'        => (string) $em->subject,
			'html'           => (string) $em->body,
			'headers'        => $headers,
		) );
		return ! empty( $res['ok'] ) ? true : new WP_Error( 'yaa_resend_failed', 'WordPress could not resend the email.' );
	}

	/** Recent sent/failed emails across all projects, newest first, with project ref/name. */
	public static function recent_log( $limit = 200 ) {
		global $wpdb;
		$e     = YAA_DB::emails_table();
		$p     = YAA_DB::projects_table();
		$limit = max( 1, min( 1000, (int) $limit ) );
		return $wpdb->get_results( $wpdb->prepare(
			"SELECT em.*, pr.ref AS project_ref, pr.name AS project_name, pr.email AS project_email
			 FROM {$e} em LEFT JOIN {$p} pr ON pr.id = em.project_id
			 WHERE em.status IN ('sent','failed')
			 ORDER BY COALESCE(em.sent_at, em.created) DESC, em.id DESC
			 LIMIT %d",
			$limit
		) ); // phpcs:ignore WordPress.DB
	}

	/** Headline counts for the email log: delivered, opened, clicked, failed (+ rates). */
	public static function log_stats() {
		global $wpdb;
		$e = YAA_DB::emails_table();
		$r = $wpdb->get_row( // phpcs:ignore WordPress.DB
			"SELECT
				SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END)   AS sent,
				SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
				SUM(CASE WHEN opens  > 0 THEN 1 ELSE 0 END)        AS opened,
				SUM(CASE WHEN clicks > 0 THEN 1 ELSE 0 END)        AS clicked,
				SUM(CASE WHEN delivery IN ('bounced','blocked') THEN 1 ELSE 0 END) AS bounced,
				SUM(CASE WHEN delivery = 'spam' THEN 1 ELSE 0 END)                 AS spam
			 FROM {$e} WHERE status IN ('sent','failed')",
			ARRAY_A
		);
		$sent    = (int) ( $r['sent'] ?? 0 );
		$opened  = (int) ( $r['opened'] ?? 0 );
		$clicked = (int) ( $r['clicked'] ?? 0 );
		return array(
			'sent'       => $sent,
			'failed'     => (int) ( $r['failed'] ?? 0 ),
			'opened'     => $opened,
			'clicked'    => $clicked,
			'bounced'    => (int) ( $r['bounced'] ?? 0 ),
			'spam'       => (int) ( $r['spam'] ?? 0 ),
			'open_rate'  => $sent ? (int) round( ( $opened / $sent ) * 100 ) : 0,
			'click_rate' => $sent ? (int) round( ( $clicked / $sent ) * 100 ) : 0,
		);
	}

	/**
	 * Every open and click recorded for one email, oldest first, each with its own
	 * timestamp (and, for clicks, the destination URL). Backed by the append-only
	 * events log, so it's a true per-event history rather than a single first-seen
	 * timestamp.
	 *
	 * @return array[] list of { action: 'open'|'click', at: mysql datetime, url: string }
	 */
	public static function engagement( $email_id ) {
		global $wpdb;
		$row = self::get( $email_id );
		if ( ! $row ) {
			return array();
		}
		$ev   = YAA_DB::events_table();
		$rows = $wpdb->get_results( $wpdb->prepare( // phpcs:ignore WordPress.DB
			"SELECT type, meta_json, created FROM {$ev}
			 WHERE project_id = %d AND type IN ('email_opened','email_clicked')
			 ORDER BY created ASC, id ASC",
			(int) $row->project_id
		) );
		$out = array();
		foreach ( (array) $rows as $r ) {
			$meta = json_decode( (string) $r->meta_json, true );
			if ( ! is_array( $meta ) || (int) ( $meta['email_id'] ?? 0 ) !== (int) $email_id ) {
				continue;
			}
			$out[] = array(
				'action' => ( 'email_clicked' === $r->type ) ? 'click' : 'open',
				'at'     => (string) $r->created,
				'url'    => isset( $meta['url'] ) ? (string) $meta['url'] : '',
			);
		}
		return $out;
	}

	/** Auto-send the payment receipt once (fired on yaa_project_paid). */
	public static function send_receipt( $project_id ) {
		$row = YAA_Project::get( $project_id );
		if ( ! $row || ! is_email( $row->email ) ) {
			return;
		}
		if ( self::latest_of_kind( $project_id, 'receipt' ) ) {
			return; // don't send twice — webhooks can fire more than once.
		}
		$id = self::draft_stage( $project_id, 'receipt' );
		if ( ! is_wp_error( $id ) ) {
			self::send( $id );
		}
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
		$portal = YAA_Portal::magic_url( $project );
		$paras  = '';
		foreach ( preg_split( '/\n\s*\n/', (string) $email->body ) as $p ) {
			$p = trim( $p );
			if ( '' !== $p ) {
				$paras .= '<p style="margin:0 0 16px;line-height:1.6;color:#1a2233">' . nl2br( esc_html( $p ) ) . '</p>';
			}
		}
		$stages    = self::stages();
		$kind      = isset( $email->kind ) ? (string) $email->kind : 'confirmation';
		$wants_cta = isset( $stages[ $kind ] ) ? ! empty( $stages[ $kind ]['cta'] ) : true; // legacy 'confirmation' keeps the button.
		if ( $project->paid ) {
			$cta = '<p style="margin:0 0 16px;line-height:1.6;color:#0f7a3d"><strong>Payment received — thank you.</strong> You can view everything in your portal below.</p>'
				. '<a href="' . esc_url( $portal ) . '" style="display:inline-block;background:#253E94;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px">Open your portal</a>';
		} elseif ( $wants_cta ) {
			$cta = '<a href="' . esc_url( $portal ) . '" style="display:inline-block;background:#253E94;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px">View preview &amp; pay securely</a>';
		} else {
			$cta = '';
		}
		$total = YAA_Pricing::money( (int) $project->total );

		return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px">'
			. '<div style="font-size:20px;font-weight:800;color:#253E94;margin-bottom:20px">Your Architect</div>'
			. $paras
			. '<div style="margin:22px 0">' . $cta . '</div>'
			. '<div style="border-top:1px solid #e6e9f2;margin-top:24px;padding-top:16px;color:#6b7488;font-size:13px">'
			. 'Your fixed price: <strong style="color:#253E94">' . esc_html( $total ) . '</strong>'
			. ( $project->ref ? ' · Ref ' . esc_html( $project->ref ) : '' )
			. '<br>Your Architect — a trading name of Tiam Architects LLP. ARB-registered, RIBA chartered.'
			. '</div></div>';
	}

	// ---- Tracking ----

	/**
	 * Whether the sending relay (Brevo, via SMTP) is doing open/click tracking, so
	 * we must not add ours on top. On by default whenever the relay is enabled; a
	 * site can force our own pixel back on with the `delegate_tracking` setting = 0.
	 */
	public static function relay_tracks() {
		if ( ! class_exists( 'YAA_SMTP' ) || ! YAA_SMTP::enabled() ) {
			return false;
		}
		return '0' !== (string) YAA_Settings::get( 'delegate_tracking', 1 );
	}

	/** Header that tags a relayed message so brevo_webhook() can tie its events back. */
	public static function tag_headers( $email_id ) {
		if ( ! self::relay_tracks() || ! (int) $email_id ) {
			return array();
		}
		return array( 'X-Mailin-Tag: yaa-email-' . (int) $email_id );
	}

	/**
	 * Add our open pixel + click redirects to an HTML email. Every absolute http(s)
	 * link is rewritten to go through /track (which records the click, then 302s to
	 * the real URL); a 1px pixel is appended so the open is recorded when images load.
	 * Links already pointing at /track, and non-http links (mailto:, tel:), are left
	 * alone. Safe to call on a full document or a bare <div> fragment.
	 */
	public static function inject_tracking( $html, $email_id ) {
		$email_id = (int) $email_id;
		$html     = (string) $html;
		if ( ! $email_id || '' === $html ) {
			return $html;
		}
		// Relay does the tracking → send clean, no pixel or click-wrapping of ours.
		if ( self::relay_tracks() ) {
			return $html;
		}
		$base = rest_url( 'yaa/v1/track' );

		// Click tracking: wrap absolute http(s) hrefs through the redirect.
		$html = preg_replace_callback(
			'/href=("|\')(https?:\/\/[^"\']+)\1/i',
			function ( $m ) use ( $base, $email_id ) {
				$url = $m[2];
				if ( false !== strpos( $url, $base ) ) {
					return $m[0]; // already a track link — don't double-wrap.
				}
				$track = $base . '?e=' . $email_id . '&a=click&u=' . rawurlencode( $url );
				return 'href=' . $m[1] . esc_url( $track ) . $m[1];
			},
			$html
		);

		// Open pixel.
		$pixel = '<img src="' . esc_url( $base . '?e=' . $email_id . '&a=open' ) . '" width="1" height="1" alt="" style="display:none;width:1px;height:1px;max-height:0;overflow:hidden">';
		if ( false !== stripos( $html, '</body>' ) ) {
			$html = preg_replace( '/<\/body>/i', $pixel . '</body>', $html, 1 );
		} else {
			$html .= $pixel;
		}
		return $html;
	}

	/**
	 * Brevo event webhook. With the SMTP relay doing the tracking, this is how opens,
	 * clicks, delivery, bounces and spam complaints get back into the email log.
	 * Configure it in Brevo → Transactional → Settings → Webhook, pointed at this
	 * route, with delivered / opened / click / hard_bounce / soft_bounce / blocked /
	 * spam / unsubscribed ticked.
	 */
	public static function brevo_webhook( $req ) {
		$payload = json_decode( $req->get_body(), true );
		if ( ! is_array( $payload ) ) {
			return new WP_REST_Response( array( 'ok' => true ) );
		}
		$events = isset( $payload[0] ) ? $payload : array( $payload ); // Brevo may batch.
		foreach ( $events as $e ) {
			if ( is_array( $e ) ) {
				self::ingest_event( $e );
			}
		}
		return new WP_REST_Response( array( 'ok' => true ) );
	}

	/**
	 * Resolve one Brevo event to a logged email and record it. Matching, most precise
	 * first: a message-id we already tied to a row, then a yaa-email-<id> tag, then the
	 * most recent sent email to that recipient — whose message-id we then store, so
	 * every later event for the same message matches exactly.
	 */
	private static function ingest_event( $e ) {
		$event = strtolower( (string) ( $e['event'] ?? '' ) );
		if ( '' === $event ) {
			return;
		}
		$mid = (string) ( $e['message-id'] ?? ( $e['message_id'] ?? '' ) );
		$to  = sanitize_email( (string) ( $e['email'] ?? '' ) );

		$row = $mid ? self::by_provider_id( $mid ) : null;
		if ( ! $row ) {
			$id  = self::tag_email_id( $e );
			$row = $id ? self::get( $id ) : null;
		}
		if ( ! $row && $to ) {
			$row = self::by_recipient_recent( $to );
			if ( $row && $mid && '' === (string) $row->provider_id ) {
				global $wpdb;
				$wpdb->update( YAA_DB::emails_table(), array( 'provider_id' => $mid ), array( 'id' => (int) $row->id ), array( '%s' ), array( '%d' ) ); // phpcs:ignore WordPress.DB
			}
		}
		if ( ! $row ) {
			return;
		}
		$email_id = (int) $row->id;

		if ( in_array( $event, array( 'opened', 'proxy_open' ), true ) ) {
			self::record( $email_id, 'open' );
		} elseif ( 'click' === $event ) {
			self::record( $email_id, 'click', (string) ( $e['link'] ?? '' ) );
		} elseif ( 'delivered' === $event ) {
			self::set_delivery( $row, 'delivered', '' );
		} elseif ( in_array( $event, array( 'hard_bounce', 'soft_bounce', 'blocked', 'error', 'invalid_email' ), true ) ) {
			self::set_delivery( $row, ( 'blocked' === $event ? 'blocked' : 'bounced' ), (string) ( $e['reason'] ?? $event ) );
		} elseif ( in_array( $event, array( 'spam', 'complaint' ), true ) ) {
			self::set_delivery( $row, 'spam', (string) ( $e['reason'] ?? '' ) );
		} elseif ( 'unsubscribed' === $event && (int) $row->project_id ) {
			YAA_Project::log_event( (int) $row->project_id, 'email_unsubscribed', array( 'email_id' => $email_id ) );
		}
		// 'deferred', 'request' and anything unrecognised are transient / no-op.
	}

	/** Pull a yaa-email-<id> tag out of a webhook event (tag may be a string, JSON, or array). */
	private static function tag_email_id( $e ) {
		$tags = array();
		foreach ( array( 'tags', 'tag' ) as $k ) {
			if ( empty( $e[ $k ] ) ) {
				continue;
			}
			$v = $e[ $k ];
			if ( is_array( $v ) ) {
				$tags = array_merge( $tags, $v );
			} elseif ( is_string( $v ) ) {
				$dec  = json_decode( $v, true );
				$tags = array_merge( $tags, is_array( $dec ) ? $dec : array( $v ) );
			}
		}
		foreach ( $tags as $tag ) {
			if ( 0 === strpos( (string) $tag, 'yaa-email-' ) ) {
				return (int) substr( (string) $tag, strlen( 'yaa-email-' ) );
			}
		}
		return 0;
	}

	/** Most recent sent email to a recipient (exact match, then as one of a comma list). */
	private static function by_recipient_recent( $email ) {
		global $wpdb;
		$t   = YAA_DB::emails_table();
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t} WHERE recipient = %s AND status = 'sent' ORDER BY COALESCE(sent_at, created) DESC, id DESC LIMIT 1", $email ) ); // phpcs:ignore WordPress.DB
		if ( ! $row ) {
			$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t} WHERE recipient LIKE %s AND status = 'sent' ORDER BY COALESCE(sent_at, created) DESC, id DESC LIMIT 1", '%' . $wpdb->esc_like( $email ) . '%' ) ); // phpcs:ignore WordPress.DB
		}
		return $row;
	}

	/** Set the relay-reported delivery state on an email row + log a project event. */
	private static function set_delivery( $row, $state, $detail = '' ) {
		global $wpdb;
		$wpdb->update(
			YAA_DB::emails_table(),
			array( 'delivery' => (string) $state, 'delivery_at' => current_time( 'mysql' ), 'delivery_detail' => mb_substr( (string) $detail, 0, 180 ) ),
			array( 'id' => (int) $row->id ),
			array( '%s', '%s', '%s' ),
			array( '%d' )
		); // phpcs:ignore WordPress.DB
		$map = array( 'delivered' => 'email_delivered', 'bounced' => 'email_bounced', 'blocked' => 'email_bounced', 'spam' => 'email_spam' );
		if ( (int) $row->project_id && isset( $map[ $state ] ) ) {
			YAA_Project::log_event( (int) $row->project_id, $map[ $state ], array( 'email_id' => (int) $row->id, 'detail' => (string) $detail ) );
		}
	}

	private static function by_provider_id( $mid ) {
		global $wpdb;
		$t = YAA_DB::emails_table();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t} WHERE provider_id = %s ORDER BY id DESC LIMIT 1", $mid ) ); // phpcs:ignore WordPress.DB
	}

	/** Our open-pixel / click-redirect endpoint. */
	public static function track( $req ) {
		$id     = (int) $req->get_param( 'e' );
		$action = 'click' === $req->get_param( 'a' ) ? 'click' : 'open';
		$url    = esc_url_raw( (string) $req->get_param( 'u' ) );
		if ( $id ) {
			self::record( $id, $action, $url );
		}
		if ( 'click' === $action ) {
			wp_safe_redirect( $url ? $url : home_url( '/' ) );
			exit;
		}
		// 1x1 transparent GIF, never cached (so repeat opens are counted).
		nocache_headers();
		header( 'Content-Type: image/gif' );
		echo base64_decode( 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' ); // phpcs:ignore
		exit;
	}

	/**
	 * Record one open/click. Counts + first-seen timestamps live on the email row;
	 * every single event is also appended to the project event log (with the clicked
	 * URL), which is what engagement() reads back for the per-event history.
	 */
	private static function record( $email_id, $action, $url = '' ) {
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
			$meta = array( 'email_id' => (int) $email_id );
			if ( '' !== $url ) {
				$meta['url'] = $url;
			}
			YAA_Project::log_event( $row->project_id, 'email_clicked', $meta );
		}
	}

	/**
	 * The From address for plugin email. Uses the configured "Email from address"
	 * (Settings) so every email — staged and ad-hoc alike — comes from one
	 * authenticated mailbox the SMTP relay will accept (e.g. info@domain), instead
	 * of a hardcoded noreply@ that may not exist on the mail host and get bounced.
	 * Falls back to noreply@<domain>. Filterable via yaa_notify_from_email.
	 */
	public static function from_address() {
		$set = sanitize_email( (string) YAA_Settings::get( 'email_from', '' ) );
		if ( ! is_email( $set ) ) {
			$host = preg_replace( '/^www\\./', '', (string) wp_parse_url( home_url(), PHP_URL_HOST ) );
			$set  = 'noreply@' . ( $host ? $host : 'yourarchitect.uk' );
		}
		return (string) apply_filters( 'yaa_notify_from_email', $set );
	}

	/**
	 * Whether open tracking is trustworthy for a recipient's email provider. Open
	 * pixels fire in the recipient's mail client, so some providers make the data
	 * unreliable no matter how we send: Outlook / Hotmail block tracking images by
	 * default (opens under-count), and Apple Mail Privacy Protection pre-loads them
	 * (opens over-count). For those, clicks are the honest signal. Returns
	 * array{ label, why } or null when opens are broadly reliable. This is
	 * provider-level — identical whether we send via Brevo or our own SMTP.
	 */
	public static function open_reliability( $email ) {
		$email = strtolower( trim( (string) $email ) );
		$at    = strrpos( $email, '@' );
		if ( false === $at ) {
			return null;
		}
		$domain = substr( $email, $at + 1 );
		foreach ( array( 'outlook.', 'hotmail.', 'live.', 'msn.', 'windowslive.', 'passport.' ) as $p ) {
			if ( 0 === strpos( $domain, $p ) ) {
				return array(
					'label' => __( 'Limited stats', 'your-architect-archie' ),
					'why'   => __( 'Outlook / Hotmail blocks tracking images by default, so an "open" often won\'t register even when the email is read. Trust clicks over opens for this recipient.', 'your-architect-archie' ),
				);
			}
		}
		if ( in_array( $domain, array( 'icloud.com', 'me.com', 'mac.com' ), true ) ) {
			return array(
				'label' => __( 'Limited stats', 'your-architect-archie' ),
				'why'   => __( 'Apple Mail Privacy Protection can pre-load images, so an "open" may show even if the email was never read. Trust clicks over opens for this recipient.', 'your-architect-archie' ),
			);
		}
		return null;
	}
}
