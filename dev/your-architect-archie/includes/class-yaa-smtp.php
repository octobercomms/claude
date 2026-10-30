<?php
/**
 * Built-in SMTP delivery.
 *
 * Routes every wp_mail() through an authenticated SMTP relay when configured, so
 * all of Archie's mail — quotes, summaries, studio alerts, portal links — goes
 * out from a reputable, DKIM-aligned sender instead of raw PHP mail() (which on
 * shared hosting is unauthenticated and the single biggest deliverability risk).
 * This is the same job WP Mail SMTP does, folded in so there's one fewer plugin
 * to maintain.
 *
 * Credentials: two sources, constants/env first.
 *   1. wp-config.php constants or environment variables (preferred for the relay
 *      key — it never touches the database and is never committed to the repo):
 *        YAA_SMTP_HOST, YAA_SMTP_PORT, YAA_SMTP_SECURE (tls|ssl|none),
 *        YAA_SMTP_USER, YAA_SMTP_PASS, YAA_SMTP_FROM (optional From override).
 *      Defining YAA_SMTP_HOST (or the env var) turns the relay on by itself — no
 *      need to tick the box or store anything in Archie's settings.
 *   2. The settings fields below (smtp_host/port/secure/auth/user/smtp_pass),
 *      with the password stored encrypted (smtp_pass via YAA_Crypto).
 *   A value from a constant/env always wins over the stored one, field by field,
 *   so you can keep the host/port/user in settings and supply only the key from
 *   wp-config.php.
 *
 * Failures surface: with isSMTP() in play PHPMailer throws on a relay error and
 * wp_mail() returns false — it does NOT quietly fall back to the unsigned PHP
 * mail() path. We also log the failure (debug) and send goes out as the aligned
 * From so it stays SPF/DKIM-aligned.
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

	/** Last wp_mail failure message (PHPMailer's reason), captured for the test screen. */
	private static $last_error = '';

	public static function init() {
		add_action( 'phpmailer_init', array( __CLASS__, 'configure' ) );
		add_action( 'wp_mail_failed', array( __CLASS__, 'log_failure' ) );
		if ( is_admin() ) {
			add_action( 'admin_post_yaa_smtp_test', array( __CLASS__, 'test' ) );
		}
	}

	/**
	 * Resolve a single SMTP config, preferring a wp-config.php constant or an
	 * environment variable over the stored setting, field by field. The password
	 * source is reported so the admin screen can confirm the key is coming from
	 * wp-config/env and is not held in the database.
	 */
	public static function creds() {
		$s = YAA_Settings::all();

		// constant > env var > null (fall back to the stored setting).
		$ext = static function ( $const, $env ) {
			if ( defined( $const ) && '' !== (string) constant( $const ) ) {
				return array( (string) constant( $const ), 'constant' );
			}
			$v = getenv( $env );
			if ( false !== $v && '' !== (string) $v ) {
				return array( (string) $v, 'env' );
			}
			return array( null, null );
		};

		list( $host, $host_src )   = $ext( 'YAA_SMTP_HOST', 'YAA_SMTP_HOST' );
		list( $port, $port_src )   = $ext( 'YAA_SMTP_PORT', 'YAA_SMTP_PORT' );
		list( $secure, $sec_src )  = $ext( 'YAA_SMTP_SECURE', 'YAA_SMTP_SECURE' );
		list( $user, $user_src )   = $ext( 'YAA_SMTP_USER', 'YAA_SMTP_USER' );
		list( $pass, $pass_src )   = $ext( 'YAA_SMTP_PASS', 'YAA_SMTP_PASS' );
		list( $from, $from_src )   = $ext( 'YAA_SMTP_FROM', 'YAA_SMTP_FROM' );

		$secure = null !== $secure ? strtolower( $secure ) : (string) $s['smtp_secure'];
		if ( ! in_array( $secure, array( 'tls', 'ssl', 'none' ), true ) ) {
			$secure = 'tls';
		}

		$from = ( null !== $from && is_email( $from ) ) ? $from : (string) $s['email_from'];

		return array(
			'host'        => null !== $host ? trim( $host ) : (string) $s['smtp_host'],
			'port'        => null !== $port ? (int) $port : (int) $s['smtp_port'],
			'secure'      => $secure,
			// Authenticate if the setting says so, or if a user/key is supplied externally.
			'auth'        => ! empty( $s['smtp_auth'] ) || null !== $user || null !== $pass,
			'user'        => null !== $user ? $user : (string) $s['smtp_user'],
			'pass'        => null !== $pass ? $pass : (string) $s['smtp_pass'],
			'from'        => $from,
			'from_name'   => (string) $s['email_from_name'],
			'pass_source' => null !== $pass_src ? $pass_src : ( '' !== (string) $s['smtp_pass'] ? 'database' : 'none' ),
			'host_managed' => null !== $host_src,
		);
	}

	/** True when any part of the relay config is being supplied from wp-config.php / env. */
	public static function managed() {
		$c = self::creds();
		return $c['host_managed'] || in_array( $c['pass_source'], array( 'constant', 'env' ), true );
	}

	/**
	 * On when a host is set AND either the box is ticked or the config is being
	 * supplied externally (so defining the wp-config constants is enough to
	 * activate the relay, and a half-filled form never breaks site mail).
	 */
	public static function enabled() {
		$c = self::creds();
		if ( '' === trim( (string) $c['host'] ) ) {
			return false;
		}
		return (int) YAA_Settings::get( 'smtp_enabled', 0 ) || self::managed();
	}

	/** Point PHPMailer at the configured relay for every wp_mail() call. */
	public static function configure( $phpmailer ) {
		if ( ! self::enabled() ) {
			return;
		}
		$c = self::creds();

		$phpmailer->isSMTP();
		$phpmailer->Host    = $c['host'];
		$phpmailer->Port    = $c['port'];
		$phpmailer->Timeout = 15; // Don't let a dead relay hang the request (see the submit-error fix).

		if ( 'ssl' === $c['secure'] ) {
			$phpmailer->SMTPSecure = 'ssl';
		} elseif ( 'tls' === $c['secure'] ) {
			$phpmailer->SMTPSecure = 'tls';
		} else {
			$phpmailer->SMTPSecure  = '';
			$phpmailer->SMTPAutoTLS = false;
		}

		if ( $c['auth'] ) {
			$phpmailer->SMTPAuth = true;
			$phpmailer->Username = $c['user'];
			$phpmailer->Password = $c['pass'];
		} else {
			$phpmailer->SMTPAuth = false;
		}

		// Force the aligned From on every message so nothing leaves as the WP
		// default (wordpress@host), which fails SPF/DKIM alignment on the relay.
		// All of Archie's mail already sends from this address; this guarantees it.
		if ( is_email( $c['from'] ) ) {
			$phpmailer->setFrom( $c['from'], $c['from_name'], false );
		}
	}

	/** Record a send failure so a broken relay surfaces instead of vanishing. */
	public static function log_failure( $wp_error ) {
		$msg = is_wp_error( $wp_error ) ? $wp_error->get_error_message() : (string) $wp_error;
		self::$last_error = $msg; // surfaced on the test screen so failures are diagnosable.
		if ( ! self::enabled() ) {
			return;
		}
		YAA_Log::debug( 'SMTP send failed', array( 'error' => $msg ) );
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
		$c       = self::creds();
		$from    = is_email( $c['from'] ) ? $c['from'] : YAA_Settings::get( 'email_from', get_option( 'admin_email' ) );
		$name    = $c['from_name'] ? $c['from_name'] : 'Your Architect';
		$headers = array( 'Content-Type: text/html; charset=UTF-8', sprintf( 'From: %s <%s>', $name, $from ) );
		if ( self::enabled() ) {
			$route = 'via SMTP relay (' . esc_html( $c['host'] ) . ')';
			if ( self::managed() ) {
				$route .= ' — credentials from wp-config.php / environment';
			}
		} else {
			$route = 'via WordPress default mail (SMTP not enabled)';
		}
		$body = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px">'
			. '<div style="font-size:20px;font-weight:800;color:#253E94;margin-bottom:14px">Your Architect</div>'
			. '<p style="line-height:1.6;color:#1a2233">This is a test email from Archie. If it reached you, your SMTP delivery settings are working.</p>'
			. '<p style="line-height:1.6;color:#6b7488;font-size:13px">Sent ' . esc_html( date_i18n( 'j M Y, H:i', current_time( 'timestamp' ) ) ) . ' · '
			. esc_html( $route ) . '</p></div>';

		self::$last_error = '';
		$ok = wp_mail( $to, 'Your Architect — SMTP test', $body, $headers );
		set_transient( 'yaa_smtp_test_' . get_current_user_id(), array(
			'status' => $ok ? 'ok' : 'fail',
			'to'     => $to,
			'error'  => $ok ? '' : self::$last_error,
		), 120 );
		$ref = wp_get_referer();
		wp_safe_redirect( add_query_arg( 'smtp_test', $ok ? '1' : '0', $ref ? $ref : admin_url( 'admin.php?page=yaa-settings' ) ) );
		exit;
	}
}
