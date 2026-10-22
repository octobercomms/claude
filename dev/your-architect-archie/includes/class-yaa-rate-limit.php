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

	/**
	 * Per-session daily cap on model turns. This is the per-client guard: it stops
	 * one visitor (or a script) from draining the GLOBAL daily token budget and
	 * taking the funnel offline for everyone. Cheap fast-path turns don't count —
	 * only turns that actually call the model (see count_session_turn()).
	 */
	public static function under_session_daily_cap( $session_id ) {
		$cap = (int) YAA_Settings::get( 'session_daily_cap', 60 );
		if ( $cap <= 0 ) {
			return true;
		}
		$key   = 'yaa_sd_' . md5( (string) $session_id ) . '_' . gmdate( 'Ymd' );
		$count = (int) get_transient( $key );
		return $count < $cap;
	}

	/** Count one model turn against the per-session daily cap. */
	public static function count_session_turn( $session_id ) {
		$key   = 'yaa_sd_' . md5( (string) $session_id ) . '_' . gmdate( 'Ymd' );
		$count = (int) get_transient( $key );
		set_transient( $key, $count + 1, DAY_IN_SECONDS );
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

	/**
	 * Durable per-month usage tally (input/output tokens + model turns), kept in a
	 * single option so the dashboard can show monthly spend. The daily transient
	 * above is only the cap counter and evaporates after a day; this persists.
	 */
	public static function record_usage( $in, $out, $cache_read = 0, $cache_write = 0 ) {
		$month = gmdate( 'Ym' );
		$all   = get_option( 'yaa_usage', array() );
		if ( ! is_array( $all ) ) {
			$all = array();
		}
		$m = isset( $all[ $month ] ) && is_array( $all[ $month ] ) ? $all[ $month ] : array();
		$m['in']    = ( isset( $m['in'] ) ? (int) $m['in'] : 0 ) + max( 0, (int) $in );
		$m['out']   = ( isset( $m['out'] ) ? (int) $m['out'] : 0 ) + max( 0, (int) $out );
		$m['cread']  = ( isset( $m['cread'] ) ? (int) $m['cread'] : 0 ) + max( 0, (int) $cache_read );
		$m['cwrite'] = ( isset( $m['cwrite'] ) ? (int) $m['cwrite'] : 0 ) + max( 0, (int) $cache_write );
		$m['turns'] = ( isset( $m['turns'] ) ? (int) $m['turns'] : 0 ) + 1;
		$all[ $month ] = $m;
		// Keep the store small: only the last 18 months.
		if ( count( $all ) > 18 ) {
			ksort( $all );
			$all = array_slice( $all, -18, null, true );
		}
		update_option( 'yaa_usage', $all, false );
	}

	/** The stored usage for a given YYYYMM (or the current month). */
	public static function usage_for( $month = '' ) {
		$month = $month ? $month : gmdate( 'Ym' );
		$all   = get_option( 'yaa_usage', array() );
		$m     = is_array( $all ) && isset( $all[ $month ] ) ? $all[ $month ] : array();
		return array(
			'in'     => isset( $m['in'] ) ? (int) $m['in'] : 0,
			'out'    => isset( $m['out'] ) ? (int) $m['out'] : 0,
			'cread'  => isset( $m['cread'] ) ? (int) $m['cread'] : 0,
			'cwrite' => isset( $m['cwrite'] ) ? (int) $m['cwrite'] : 0,
			'turns'  => isset( $m['turns'] ) ? (int) $m['turns'] : 0,
		);
	}
}
