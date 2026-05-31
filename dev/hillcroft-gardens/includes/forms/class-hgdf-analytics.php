<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Analytics + tracking for Forms.
 *
 * Pipeline of a single visitor:
 *   1. Page renders → JS POSTs to /view → row in wp_hgd_form_views.
 *   2. User starts filling → JS POSTs to /start → row in wp_hgd_form_submissions.
 *   3. Each step transition / answer change → /save with step_reached + seconds_active.
 *   4. Final step → /submit → status='complete'.
 *
 * The session_hash links a view to its submission so we can count "viewed
 * but never started" and reason about conversion.
 */
class HGDF_Analytics {

	public static function views_table() {
		global $wpdb;
		return $wpdb->prefix . 'hgd_form_views';
	}

	public static function record_view( $form_id, $session_hash ) {
		global $wpdb;
		$session_hash = self::clean_session_hash( $session_hash );
		// Dedupe: only one view per (form, session) per 10 min.
		$recent = $wpdb->get_var( $wpdb->prepare(
			'SELECT id FROM ' . self::views_table() . ' WHERE form_id = %d AND session_hash = %s AND created_at >= %s LIMIT 1',
			$form_id,
			$session_hash,
			gmdate( 'Y-m-d H:i:s', time() - 600 )
		) );
		if ( $recent ) {
			return (int) $recent;
		}
		$wpdb->insert( self::views_table(), array(
			'form_id'      => $form_id,
			'session_hash' => $session_hash,
			'ip_address'   => HGDF_Submission::client_ip(),
			'user_agent'   => substr( $_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255 ),
			'referrer'     => esc_url_raw( $_SERVER['HTTP_REFERER'] ?? '' ),
			'created_at'   => current_time( 'mysql' ),
		) );
		return (int) $wpdb->insert_id;
	}

	public static function link_view_to_submission( $session_hash, $form_id, $submission_id ) {
		global $wpdb;
		$session_hash = self::clean_session_hash( $session_hash );
		// Update the most recent matching view row.
		$wpdb->query( $wpdb->prepare(
			'UPDATE ' . self::views_table() . ' SET submission_id = %d WHERE form_id = %d AND session_hash = %s AND submission_id IS NULL ORDER BY id DESC LIMIT 1',
			$submission_id,
			$form_id,
			$session_hash
		) );
	}

	public static function update_progress( $submission_id, $step_reached, $seconds_active ) {
		global $wpdb;
		$existing = $wpdb->get_row( $wpdb->prepare(
			'SELECT step_reached, seconds_active FROM ' . HGDF_Submission::table() . ' WHERE id = %d',
			$submission_id
		), ARRAY_A );
		if ( ! $existing ) { return; }
		$wpdb->update( HGDF_Submission::table(), array(
			'step_reached'   => max( (int) $existing['step_reached'], (int) $step_reached ),
			'seconds_active' => max( (int) $existing['seconds_active'], (int) $seconds_active ),
			'updated_at'     => current_time( 'mysql' ),
		), array( 'id' => $submission_id ) );
	}

	public static function clean_session_hash( $s ) {
		$s = preg_replace( '/[^a-zA-Z0-9_-]/', '', (string) $s );
		return substr( $s, 0, 64 );
	}

	// ---- Aggregations ----

	/**
	 * Headline stats for one form, optionally bounded by date range.
	 *
	 * @param int    $form_id
	 * @param string $from Y-m-d (inclusive) or empty
	 * @param string $to   Y-m-d (inclusive) or empty
	 * @return array
	 */
	public static function form_stats( $form_id, $from = '', $to = '' ) {
		global $wpdb;
		list( $from_ts, $to_ts ) = self::resolve_range( $from, $to );
		$where_v = $wpdb->prepare( 'form_id = %d AND created_at BETWEEN %s AND %s', $form_id, $from_ts, $to_ts );
		$where_s = $wpdb->prepare( 'form_id = %d AND created_at BETWEEN %s AND %s', $form_id, $from_ts, $to_ts );

		$views    = (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . self::views_table() . " WHERE {$where_v}" );
		$starts   = (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . HGDF_Submission::table() . " WHERE {$where_s}" );
		$partials = (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . HGDF_Submission::table() . " WHERE {$where_s} AND status = 'partial'" );
		$completes= (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . HGDF_Submission::table() . " WHERE {$where_s} AND status = 'complete'" );

		// Time-on-form: seconds_active for completed submissions only (clean signal).
		$times = $wpdb->get_col( 'SELECT seconds_active FROM ' . HGDF_Submission::table() . " WHERE {$where_s} AND status = 'complete' AND seconds_active > 0 ORDER BY seconds_active ASC" );
		$median = self::median( array_map( 'intval', $times ) );
		$mean   = $times ? (int) round( array_sum( $times ) / max( 1, count( $times ) ) ) : 0;

		return array(
			'range'              => array( 'from' => $from_ts, 'to' => $to_ts ),
			'views'              => $views,
			'starts'             => $starts,
			'partials'           => $partials,
			'completes'          => $completes,
			'view_to_start_rate' => $views    > 0 ? round( $starts    / $views    , 4 ) : 0,
			'start_to_complete'  => $starts   > 0 ? round( $completes / $starts   , 4 ) : 0,
			'overall_conversion' => $views    > 0 ? round( $completes / $views    , 4 ) : 0,
			'median_seconds'     => $median,
			'mean_seconds'       => $mean,
		);
	}

	/**
	 * Funnel: for each step in the schema, count submissions that reached
	 * at least that step.
	 */
	public static function funnel( $form_id, $from = '', $to = '' ) {
		global $wpdb;
		$schema  = HGDF_Schema::get( $form_id );
		$steps   = $schema['steps'] ?? array();
		list( $from_ts, $to_ts ) = self::resolve_range( $from, $to );

		$where = $wpdb->prepare( 'form_id = %d AND created_at BETWEEN %s AND %s', $form_id, $from_ts, $to_ts );

		$out = array();
		foreach ( $steps as $idx => $step ) {
			$reached = (int) $wpdb->get_var(
				'SELECT COUNT(*) FROM ' . HGDF_Submission::table() . " WHERE {$where} AND step_reached >= " . (int) $idx
			);
			$out[] = array(
				'step_index' => $idx,
				'step_id'    => $step['id'] ?? ('step_' . $idx),
				'title'      => $step['title'] ?? '',
				'reached'    => $reached,
			);
		}
		$completes = (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . HGDF_Submission::table() . " WHERE {$where} AND status = 'complete'" );
		$out[] = array(
			'step_index' => count( $steps ),
			'step_id'    => 'completed',
			'title'      => 'Submitted',
			'reached'    => $completes,
		);
		return $out;
	}

	/**
	 * Daily counts for the chart: views, starts, completes for the last N days.
	 */
	public static function timeseries( $form_id, $from = '', $to = '' ) {
		global $wpdb;
		list( $from_ts, $to_ts ) = self::resolve_range( $from, $to );

		// Buckets by date (UTC because MySQL DATE() depends on server tz; we
		// match the wp timezone by going through current_time formatting).
		$views = $wpdb->get_results( $wpdb->prepare(
			'SELECT DATE(created_at) AS d, COUNT(*) AS c FROM ' . self::views_table() . ' WHERE form_id = %d AND created_at BETWEEN %s AND %s GROUP BY DATE(created_at)',
			$form_id, $from_ts, $to_ts
		), ARRAY_A );
		$starts = $wpdb->get_results( $wpdb->prepare(
			'SELECT DATE(created_at) AS d, COUNT(*) AS c FROM ' . HGDF_Submission::table() . ' WHERE form_id = %d AND created_at BETWEEN %s AND %s GROUP BY DATE(created_at)',
			$form_id, $from_ts, $to_ts
		), ARRAY_A );
		$completes = $wpdb->get_results( $wpdb->prepare(
			"SELECT DATE(completed_at) AS d, COUNT(*) AS c FROM " . HGDF_Submission::table() . " WHERE form_id = %d AND status = 'complete' AND completed_at BETWEEN %s AND %s GROUP BY DATE(completed_at)",
			$form_id, $from_ts, $to_ts
		), ARRAY_A );

		$index = function ( $rows ) {
			$out = array();
			foreach ( $rows as $r ) { $out[ $r['d'] ] = (int) $r['c']; }
			return $out;
		};
		$v = $index( $views );
		$s = $index( $starts );
		$c = $index( $completes );

		$series = array();
		$cur = strtotime( substr( $from_ts, 0, 10 ) );
		$end = strtotime( substr( $to_ts, 0, 10 ) );
		while ( $cur <= $end ) {
			$d = gmdate( 'Y-m-d', $cur );
			$series[] = array(
				'date'      => $d,
				'views'     => $v[ $d ] ?? 0,
				'starts'    => $s[ $d ] ?? 0,
				'completes' => $c[ $d ] ?? 0,
			);
			$cur += DAY_IN_SECONDS;
		}
		return $series;
	}

	/**
	 * @return array{0:string,1:string} (from_ts, to_ts) inclusive MySQL datetimes.
	 */
	public static function resolve_range( $from, $to ) {
		$from = is_string( $from ) ? trim( $from ) : '';
		$to   = is_string( $to ) ? trim( $to )   : '';
		if ( ! $to ) {
			$to_ts = current_time( 'mysql' );
		} else {
			$to_ts = $to . ' 23:59:59';
		}
		if ( ! $from ) {
			$from_ts = gmdate( 'Y-m-d', strtotime( $to_ts ) - 29 * DAY_IN_SECONDS ) . ' 00:00:00';
		} else {
			$from_ts = $from . ' 00:00:00';
		}
		return array( $from_ts, $to_ts );
	}

	public static function median( $values ) {
		$n = count( $values );
		if ( ! $n ) { return 0; }
		sort( $values );
		$mid = (int) floor( $n / 2 );
		if ( $n % 2 ) { return (int) $values[ $mid ]; }
		return (int) round( ( $values[ $mid - 1 ] + $values[ $mid ] ) / 2 );
	}

	/**
	 * Cookie-friendly session hash for the current visitor.
	 * Falls back to a hash of IP + UA when the cookie isn't available
	 * (e.g. pure server-side calls), which is good-enough dedupe.
	 */
	public static function visitor_session() {
		if ( ! empty( $_COOKIE['hgd_form_sess'] ) && preg_match( '/^[a-zA-Z0-9_-]{16,64}$/', $_COOKIE['hgd_form_sess'] ) ) {
			return $_COOKIE['hgd_form_sess'];
		}
		$base = ( $_SERVER['REMOTE_ADDR'] ?? '' ) . '|' . ( $_SERVER['HTTP_USER_AGENT'] ?? '' );
		return substr( hash( 'sha256', $base . '|' . wp_salt() ), 0, 32 );
	}
}
