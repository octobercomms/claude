<?php
/**
 * Lightweight server-side logging plus a rolling log of outbound calls.
 *
 * Two jobs:
 *   1. write()  — records warnings/errors to the PHP error log with a consistent
 *      `[OMI]` prefix, and fires an `octobermi_log` action so a site can forward
 *      them to its own monitoring without this plugin depending on any service.
 *   2. record_outbound() — keeps a rolling log (the last LIMIT calls) of every
 *      push to the platform in an option, so the admin screen can show recent
 *      activity for support and debugging.
 *
 * Callers MUST pass only non-sensitive context — never the refresh secret or a
 * full customer payload.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OctoberMI_Log {

	/** Option holding the rolling outbound-call log. */
	const OUTBOUND_OPTION = 'octobermi_outbound_log';

	/** How many recent outbound calls to retain. */
	const LIMIT = 50;

	/** A recoverable problem worth knowing about. */
	public static function warning( $context, $message, array $data = array() ) {
		self::write( 'WARN', $context, $message, $data );
	}

	/** A failure: a push could not be delivered, an API call failed, etc. */
	public static function error( $context, $message, array $data = array() ) {
		self::write( 'ERROR', $context, $message, $data );
	}

	private static function write( $level, $context, $message, array $data ) {
		$line = sprintf( '[OMI] %s %s: %s', $level, (string) $context, (string) $message );
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
		 * @param string $context Dot-namespaced source, e.g. 'push.orders'.
		 * @param string $message Human-readable summary.
		 * @param array  $data    Extra non-sensitive context.
		 */
		do_action( 'octobermi_log', $level, (string) $context, (string) $message, $data );
	}

	/**
	 * Append one outbound-call result to the rolling log.
	 *
	 * @param string $endpoint Short endpoint name, e.g. 'orders'.
	 * @param string $event    The event that triggered it, e.g. 'order.placed'.
	 * @param int    $status   HTTP status code (0 on transport failure).
	 * @param bool   $ok       Whether the call succeeded.
	 * @param string $note     Optional short note (e.g. an error message).
	 */
	public static function record_outbound( $endpoint, $event, $status, $ok, $note = '' ) {
		$log = get_option( self::OUTBOUND_OPTION, array() );
		if ( ! is_array( $log ) ) {
			$log = array();
		}

		array_unshift( $log, array(
			'time'     => time(),
			'endpoint' => (string) $endpoint,
			'event'    => (string) $event,
			'status'   => (int) $status,
			'ok'       => (bool) $ok,
			'note'     => mb_substr( (string) $note, 0, 300 ),
		) );

		if ( count( $log ) > self::LIMIT ) {
			$log = array_slice( $log, 0, self::LIMIT );
		}

		update_option( self::OUTBOUND_OPTION, $log, false );
	}

	/** Return the rolling outbound-call log, newest first. */
	public static function outbound_log() {
		$log = get_option( self::OUTBOUND_OPTION, array() );
		return is_array( $log ) ? $log : array();
	}

	/** Clear the rolling outbound-call log. */
	public static function clear_outbound() {
		delete_option( self::OUTBOUND_OPTION );
	}
}
