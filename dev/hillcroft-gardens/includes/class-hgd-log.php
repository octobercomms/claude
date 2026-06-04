<?php
/**
 * Lightweight server-side error logging.
 *
 * The WordPress-appropriate answer to "set up Sentry": we can't bundle a SaaS
 * agent into a distributed plugin, but the principle — *you can't fix what you
 * can't see* — still applies. Payment and webhook failures happen server-side,
 * often with no user watching, so this records them to the PHP error log with
 * a consistent `[HGD]` prefix and structured context.
 *
 * It also fires a `hgd_log` action on every entry, giving a site the seam to
 * forward errors to real monitoring (Sentry, Slack, a log drain) without this
 * plugin depending on any of them:
 *
 *     add_action( 'hgd_log', function ( $level, $context, $message, $data ) {
 *         \Sentry\captureMessage( "$context: $message" );
 *     }, 10, 4 );
 *
 * Callers MUST pass only non-sensitive context — never API keys, full request
 * payloads or card data.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Log {

	/** A recoverable problem worth knowing about. */
	public static function warning( $context, $message, array $data = array() ) {
		self::write( 'WARN', $context, $message, $data );
	}

	/** A failure: a payment couldn't be taken, an API call failed, etc. */
	public static function error( $context, $message, array $data = array() ) {
		self::write( 'ERROR', $context, $message, $data );
	}

	private static function write( $level, $context, $message, array $data ) {
		$line = sprintf( '[HGD] %s %s: %s', $level, (string) $context, (string) $message );
		if ( ! empty( $data ) ) {
			$line .= ' ' . wp_json_encode( $data );
		}
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( $line );

		/**
		 * Fires on every logged entry so a site can forward it to its own
		 * monitoring. Handlers must not assume any particular service.
		 *
		 * @param string $level   'WARN' or 'ERROR'.
		 * @param string $context Dot-namespaced source, e.g. 'stripe.api'.
		 * @param string $message Human-readable summary.
		 * @param array  $data    Extra non-sensitive context.
		 */
		do_action( 'hgd_log', $level, (string) $context, (string) $message, $data );
	}
}
