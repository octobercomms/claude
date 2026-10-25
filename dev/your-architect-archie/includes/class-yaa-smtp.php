<?php
/**
 * Built-in SMTP delivery.
 *
 * Routes every wp_mail() through an authenticated SMTP relay when configured, so
 * all of Archie's mail — quotes, summaries, studio alerts, portal links — goes
 * out from a reputable, DKIM-aligned sender instead of raw PHP mail() (which on
 * shared hosting is unauthenticated and the single biggest deliverability risk).
 * This is the same job WP Mail SMTP does, folded in so there's one fewer plugin
 * to maintain. The relay password is stored encrypted (smtp_pass via YAA_Crypto)
 * and only applied server-side in phpmailer_init.
 *
 * Interaction with Brevo: if a Brevo API key is set, Archie's *staged* emails
 * (approval / preview / receipt) still go through the Brevo API, which bypasses
 * wp_mail — so SMTP doesn't touch those. Clear the Brevo key to route absolutely
 * everything through this one relay (and pick up our own open/click tracking on
 * the staged emails too).
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_SMTP {

	public static function init() {
		add_action( 'phpmailer_init', array( __CLASS__, 'configure' ) );
		if ( is_admin() ) {
			add_action( 'admin_post_yaa_smtp_test', array( __CLASS__, 'test' ) );
		}
	}

	/** On only when the box is ticked AND a host is set (so a half-filled form never breaks site mail). */
	public static function enabled() {
		return (int) YAA_Settings::get( 'smtp_enabled', 0 )
			&& '' !== trim( (string) YAA_Settings::get( 'smtp_host', '' ) );
	}

	/** Point PHPMailer at the configured relay for every wp_mail() call. */
	public static function configure( $phpmailer ) {
		if ( ! self::enabled() ) {
			return;
		}
		$s = YAA_Settings::all();

		$phpmailer->isSMTP();
		$phpmailer->Host = (string) $s['smtp_host'];
		$phpmailer->Port = (int) $s['smtp_port'];

		$secure = (string) $s['smtp_secure'];
		if ( 'ssl' === $secure ) {
			$phpmailer->SMTPSecure = 'ssl';
		} elseif ( 'tls' === $secure ) {
			$phpmailer->SMTPSecure = 'tls';
		} else {
			$phpmailer->SMTPSecure  = '';
			$phpmailer->SMTPAutoTLS = false;
		}

		if ( ! empty( $s['smtp_auth'] ) ) {
			$phpmailer->SMTPAuth = true;
			$phpmailer->Username = (string) $s['smtp_user'];
			$phpmailer->Password = (string) $s['smtp_pass'];
		} else {
			$phpmailer->SMTPAuth = false;
		}

		// Keep whatever From an Archie email already set; only backfill when WP's
		// default (wordpress@host) would otherwise go out — that address usually
		// fails SPF/DKIM alignment on a relay.
		$from = (string) $s['email_from'];
		if ( is_email( $from ) && 0 === strpos( (string) $phpmailer->From, 'wordpress@' ) ) {
			$phpmailer->setFrom( $from, (string) $s['email_from_name'], false );
		}
	}

	/** Send a one-off test email through the current settings and report back. */
	public static function test() {
		if ( ! current_user_can( 'manage_options' ) || ! check_admin_referer( 'yaa_smtp_test' ) ) {
			wp_die( 'Nope' );
		}
		$to = sanitize_email( wp_unslash( $_POST['smtp_test_to'] ?? '' ) );
		if ( ! is_email( $to ) ) {
			$to = wp_get_current_user()->user_email;
		}
		$from    = YAA_Settings::get( 'email_from', get_option( 'admin_email' ) );
		$name    = YAA_Settings::get( 'email_from_name', 'Your Architect' );
		$headers = array( 'Content-Type: text/html; charset=UTF-8', sprintf( 'From: %s <%s>', $name, $from ) );
		$body    = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px">'
			. '<div style="font-size:20px;font-weight:800;color:#253E94;margin-bottom:14px">Your Architect</div>'
			. '<p style="line-height:1.6;color:#1a2233">This is a test email from Archie. If it reached you, your SMTP delivery settings are working.</p>'
			. '<p style="line-height:1.6;color:#6b7488;font-size:13px">Sent ' . esc_html( date_i18n( 'j M Y, H:i', current_time( 'timestamp' ) ) ) . ' · '
			. esc_html( self::enabled() ? 'via SMTP relay' : 'via WordPress default mail (SMTP not enabled)' ) . '</p></div>';

		$ok = wp_mail( $to, 'Your Architect — SMTP test', $body, $headers );
		set_transient( 'yaa_smtp_test_' . get_current_user_id(), ( $ok ? 'ok' : 'fail' ) . '|' . $to, 120 );
		$ref = wp_get_referer();
		wp_safe_redirect( add_query_arg( 'smtp_test', $ok ? '1' : '0', $ref ? $ref : admin_url( 'admin.php?page=yaa-settings' ) ) );
		exit;
	}
}
