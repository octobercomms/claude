<?php
/**
 * Composes and sends the payment / reminder emails.
 *
 * Sending goes through Brevo's transactional API (matching the rest of the
 * October stack); if no Brevo key is set it falls back to wp_mail so the feature
 * still works. The staff-editable part of the email is the subject and the
 * message body — the branded wrapper, the green Pay button (a tracked redirect)
 * and the open-tracking pixel are added automatically.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ARPL_Email {

	const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

	/** Default templates, used when settings are blank. Placeholders: {customer} {amount} {note} */
	public static function default_subject( $kind ) {
		return 'reminder' === $kind
			? 'Reminder: your Architourian balance of {amount}'
			: 'Your Architourian balance — {amount} due';
	}

	public static function default_body( $kind ) {
		if ( 'reminder' === $kind ) {
			return "Hi {customer},\n\n"
				. "Just a gentle reminder that your balance of {amount} is still outstanding. "
				. "You can pay securely online using the button below.\n\n"
				. "If you've already paid, please ignore this message — thank you!\n\n"
				. "With best wishes,\nArchitourian";
		}
		return "Hi {customer},\n\n"
			. "Thank you for booking with Architourian. Your balance of {amount} is now due.\n\n"
			. "You can pay securely online using the button below — it only takes a moment.\n\n"
			. "If you have any questions, just reply to this email.\n\n"
			. "With best wishes,\nArchitourian";
	}

	/** Subject/body for a link, with settings overrides and placeholders filled. */
	public static function draft( $row, $kind ) {
		$subject = ARPL_Settings::get( 'reminder' === $kind ? 'reminder_subject' : 'email_subject', '' );
		$body    = ARPL_Settings::get( 'reminder' === $kind ? 'reminder_body' : 'email_body', '' );
		if ( '' === trim( (string) $subject ) ) {
			$subject = self::default_subject( $kind );
		}
		if ( '' === trim( (string) $body ) ) {
			$body = self::default_body( $kind );
		}
		return [
			'subject' => self::fill( $subject, $row ),
			'body'    => self::fill( $body, $row ),
		];
	}

	public static function fill( $text, $row ) {
		return strtr( (string) $text, [
			'{customer}' => $row->customer,
			'{amount}'   => self::money( $row->amount, $row->currency ),
			'{note}'     => (string) $row->note,
		] );
	}

	/**
	 * Send a payment/reminder email for a link.
	 *
	 * @return true|WP_Error
	 */
	public static function send( $row, $subject, $body_text ) {
		$to_email = sanitize_email( $row->email );
		if ( ! is_email( $to_email ) ) {
			return new WP_Error( 'arpl_no_email', 'No valid customer email address on this link.' );
		}

		$html = self::build_html( $row, $body_text );
		return self::dispatch( $to_email, $row->customer, $subject, $html );
	}

	/** Brevo transactional send, with a wp_mail fallback. */
	private static function dispatch( $to_email, $to_name, $subject, $html ) {
		$from_name  = ARPL_Settings::get( 'from_name', 'Architourian' );
		$from_email = ARPL_Settings::get( 'from_email', '' );
		// from_email defaults to '' in settings, so fall back to the site admin email
		// here rather than relying on get()'s default (which the empty value masks).
		if ( ! is_email( $from_email ) ) {
			$from_email = get_option( 'admin_email' );
		}
		$from_name  = '' !== trim( (string) $from_name ) ? $from_name : 'Architourian';
		$api_key    = ARPL_Settings::get( 'brevo_api_key', '' );

		if ( '' === trim( (string) $api_key ) ) {
			$headers = [
				'Content-Type: text/html; charset=UTF-8',
				sprintf( 'From: %s <%s>', $from_name, $from_email ),
			];
			$sent = wp_mail( $to_email, $subject, $html, $headers );
			return $sent ? true : new WP_Error( 'arpl_mail_failed', 'wp_mail() failed to send the email.' );
		}

		$payload = [
			'sender'      => [ 'name' => $from_name, 'email' => $from_email ],
			'to'          => [ [ 'email' => $to_email, 'name' => $to_name ] ],
			'subject'     => $subject,
			'htmlContent' => $html,
			'tags'        => [ 'architourian-payment-link' ],
		];

		$response = wp_remote_post( self::BREVO_ENDPOINT, [
			'headers' => [
				'api-key'      => trim( $api_key ),
				'Content-Type' => 'application/json',
				'Accept'       => 'application/json',
			],
			'body'    => wp_json_encode( $payload ),
			'timeout' => 20,
		] );

		if ( is_wp_error( $response ) ) {
			return $response;
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		if ( $code < 200 || $code >= 300 ) {
			$data = json_decode( wp_remote_retrieve_body( $response ), true );
			$msg  = isset( $data['message'] ) ? $data['message'] : sprintf( 'Brevo returned HTTP %d.', $code );
			return new WP_Error( 'arpl_brevo_error', $msg );
		}
		return true;
	}

	/**
	 * Wrap the editable message in a branded HTML email with a tracked Pay button
	 * and an open-tracking pixel.
	 */
	public static function build_html( $row, $body_text ) {
		$pay_url  = esc_url( ARPL_Track::go_url( $row->token ) );
		$open_url = esc_url( ARPL_Track::open_url( $row->token ) );
		$amount   = esc_html( self::money( $row->amount, $row->currency ) );
		$note     = $row->note ? esc_html( $row->note ) : '';
		$message  = wpautop( esc_html( $body_text ) );

		$terracotta = '#a8492b';
		$green      = '#41603c';
		$cream      = '#fbf8f2';
		$ink        = '#2b2924';

		ob_start();
		?>
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1ece2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1ece2;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:<?php echo $cream; ?>;border-radius:14px;overflow:hidden;font-family:Georgia,'Times New Roman',serif;">
	<tr><td style="background:<?php echo $terracotta; ?>;padding:26px 32px;">
		<div style="color:#ffffff;font-size:24px;font-weight:bold;letter-spacing:.01em;">Architourian</div>
	</td></tr>
	<tr><td style="padding:30px 32px 8px;color:<?php echo $ink; ?>;font-size:16px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
		<?php echo $message; // already escaped + wpautop'd ?>
	</td></tr>
	<tr><td style="padding:8px 32px 4px;">
		<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #ece1cf;border-radius:10px;font-family:Arial,Helvetica,sans-serif;">
			<?php if ( $note ) : ?>
			<tr><td style="padding:14px 18px 4px;color:#6b645a;font-size:13px;"><?php echo $note; ?></td></tr>
			<?php endif; ?>
			<tr><td style="padding:<?php echo $note ? '0 18px 14px' : '14px 18px'; ?>;color:<?php echo $ink; ?>;font-size:24px;font-weight:bold;">Amount due: <?php echo $amount; ?></td></tr>
		</table>
	</td></tr>
	<tr><td align="center" style="padding:24px 32px 8px;">
		<a href="<?php echo $pay_url; ?>" style="display:inline-block;background:<?php echo $green; ?>;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:bold;padding:15px 40px;border-radius:999px;">Pay now &rarr;</a>
	</td></tr>
	<tr><td align="center" style="padding:0 32px 28px;color:#9a9186;font-size:12px;font-family:Arial,Helvetica,sans-serif;">
		Secure payment powered by Stripe. If the button doesn't work, copy this link:<br>
		<a href="<?php echo $pay_url; ?>" style="color:<?php echo $green; ?>;word-break:break-all;"><?php echo $pay_url; ?></a>
	</td></tr>
</table>
</td></tr>
</table>
<img src="<?php echo $open_url; ?>" width="1" height="1" alt="" style="display:none;">
</body></html>
		<?php
		return ob_get_clean();
	}

	private static function money( $minor, $currency ) {
		$symbols = [ 'gbp' => '£', 'usd' => '$', 'eur' => '€', 'aud' => 'A$', 'cad' => 'C$' ];
		$symbol  = $symbols[ strtolower( $currency ) ] ?? '';
		$amount  = number_format( ( (int) $minor ) / 100, 2 );
		return $symbol ? $symbol . $amount : strtoupper( $currency ) . ' ' . $amount;
	}
}
