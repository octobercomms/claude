<?php
/**
 * Per-session rate limiting + a daily token cap, so a bot hammering the chat
 * endpoint can't run up the Claude bill. Transient-backed (works on shared
 * hosting without a persistent store). Mirrors HGD_Rate_Limit in spirit.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Rate_Limit {

	/** Returns true if this session may make another turn now (true per-minute window). */
	public static function allow_turn( $session_id ) {
		$per_min = (int) YAA_Settings::get( 'rate_limit_per_min', 20 );
		if ( $per_min <= 0 ) {
			return true;
		}
		// Bucket by calendar minute so the window actually resets each minute — the
		// old code reset the transient's TTL on every turn, so a normal multi-turn
		// conversation accumulated hits and blocked itself. Each minute is its own key.
		$bucket = (int) floor( time() / MINUTE_IN_SECONDS );
		$key    = 'yaa_rl_' . md5( (string) $session_id ) . '_' . $bucket;
		$count  = (int) get_transient( $key );
		if ( $count >= $per_min ) {
			return false;
		}
		set_transient( $key, $count + 1, MINUTE_IN_SECONDS + 5 );
		return true;
	}

	/** Add spent tokens to today's tally. */
	public static function add_tokens( $tokens ) {
		$key   = 'yaa_tok_' . gmdate( 'Ymd' );
		$total = (int) get_transient( $key ) + (int) $tokens;
		set_transient( $key, $total, DAY_IN_SECONDS );
	}

	/** True if today's token tally is under the configured cap. */
	public static function under_daily_cap() {
		$cap = (int) YAA_Settings::get( 'daily_token_cap', 500000 );
		if ( $cap <= 0 ) {
			return true;
		}
		$used = (int) get_transient( 'yaa_tok_' . gmdate( 'Ymd' ) );
		return $used < $cap;
	}
}
