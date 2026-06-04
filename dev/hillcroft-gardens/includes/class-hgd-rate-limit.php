<?php
/**
 * Lightweight rate limiting for unauthenticated, side-effect endpoints.
 *
 * The public booking / subscription / form routes create database rows, call
 * paid APIs (Stripe) and send email — all without a login. Without a throttle
 * they can be abused for resource exhaustion, Stripe-quota burn, slot squatting
 * and (worst) email-bombing a known address via the "manage my plan" link.
 *
 * This is a deliberately simple transient-bucket limiter (the same approach the
 * Forms module already uses): N events per window per identifier. The identifier
 * defaults to the client IP, but callers can pass another key — e.g. the target
 * email address — so a per-recipient cap holds even across rotating source IPs.
 *
 * Note on IP source: we prefer Cloudflare's `CF-Connecting-IP` (set by the edge,
 * not client-spoofable) then `REMOTE_ADDR`. We deliberately do NOT trust
 * `X-Forwarded-For`, which a client can forge to evade a per-IP limit.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Rate_Limit {

	/**
	 * Record an event and report whether it is within the allowed rate.
	 *
	 * @param string      $bucket     Logical action name, e.g. 'booking_create'.
	 * @param int         $max        Max events permitted per window.
	 * @param int         $window     Window length in seconds.
	 * @param string|null $identifier Defaults to the client IP; pass e.g. an email for a per-recipient cap.
	 * @return bool True if allowed (and counted), false if the limit is exceeded.
	 */
	public static function check( $bucket, $max, $window, $identifier = null ) {
		if ( null === $identifier ) {
			$identifier = self::client_ip();
		}
		// No usable identifier (e.g. CLI/cron) — don't block legitimate flows.
		if ( '' === (string) $identifier ) {
			return true;
		}

		$key     = 'hgd_rl_' . md5( $bucket . '|' . strtolower( (string) $identifier ) );
		$current = (int) get_transient( $key );
		if ( $current >= (int) $max ) {
			return false;
		}
		set_transient( $key, $current + 1, (int) $window );
		return true;
	}

	/** Best-effort client IP, avoiding the spoofable X-Forwarded-For header. */
	public static function client_ip() {
		foreach ( array( 'HTTP_CF_CONNECTING_IP', 'REMOTE_ADDR' ) as $header ) {
			if ( empty( $_SERVER[ $header ] ) ) {
				continue;
			}
			$ip = trim( (string) wp_unslash( $_SERVER[ $header ] ) );
			if ( filter_var( $ip, FILTER_VALIDATE_IP ) ) {
				return $ip;
			}
		}
		return '';
	}
}
