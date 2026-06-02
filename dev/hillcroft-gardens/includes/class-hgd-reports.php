<?php
/**
 * Business reporting — read-only aggregates across the plugin's own tables.
 *
 * Pulls a single, at-a-glance picture of the business from the records the
 * plugin already keeps: collected revenue (paid consultations + paid design
 * milestones), recurring revenue (active maintenance plans → MRR/ARR), the
 * open sales pipeline (proposal value by stage), the project pipeline by
 * status, and a simple lead→won funnel.
 *
 * Everything is derived from local tables (no WooCommerce queries), so the
 * figures match what the plugin recorded as paid. All amounts are GBP.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Reports {

	/** [start, end] MySQL datetimes for a named period, or [null, null] for all-time. */
	public static function period_bounds( $period ) {
		$tz  = wp_timezone();
		$now = new DateTimeImmutable( 'now', $tz );

		switch ( $period ) {
			case 'month':
				$start = $now->modify( 'first day of this month' )->setTime( 0, 0, 0 );
				break;
			case 'year':
				$start = $now->setDate( (int) $now->format( 'Y' ), 1, 1 )->setTime( 0, 0, 0 );
				break;
			case 'all':
			default:
				return array( null, null );
		}
		return array( $start->format( 'Y-m-d H:i:s' ), $now->format( 'Y-m-d H:i:s' ) );
	}

	/**
	 * Sum a money column over a table, optionally bounded by a date column.
	 *
	 * @param string $table  Fully-qualified table name.
	 * @param string $amount Amount column.
	 * @param string $where  Extra WHERE (already-safe literal, e.g. "status = 'paid'").
	 * @param string $date_col Date column to bound on (empty = no bound).
	 * @param ?string $start  MySQL datetime or null.
	 * @param ?string $end    MySQL datetime or null.
	 */
	private static function sum( $table, $amount, $where, $date_col = '', $start = null, $end = null ) {
		global $wpdb;
		$sql    = "SELECT COALESCE(SUM({$amount}),0) FROM {$table} WHERE {$where}";
		$params = array();
		if ( '' !== $date_col && $start && $end ) {
			$sql     .= " AND {$date_col} >= %s AND {$date_col} <= %s";
			$params[] = $start;
			$params[] = $end;
		}
		$sql = $params ? $wpdb->prepare( $sql, $params ) : $sql;
		return (float) $wpdb->get_var( $sql );
	}

	private static function count_where( $table, $where, $date_col = '', $start = null, $end = null ) {
		global $wpdb;
		$sql    = "SELECT COUNT(*) FROM {$table} WHERE {$where}";
		$params = array();
		if ( '' !== $date_col && $start && $end ) {
			$sql     .= " AND {$date_col} >= %s AND {$date_col} <= %s";
			$params[] = $start;
			$params[] = $end;
		}
		$sql = $params ? $wpdb->prepare( $sql, $params ) : $sql;
		return (int) $wpdb->get_var( $sql );
	}

	/**
	 * Collected (paid) revenue for a period: paid consultations + paid design
	 * milestones. Maintenance income is recurring and reported separately.
	 *
	 * @return array consultations, milestones, total (floats).
	 */
	public static function collected_revenue( $period ) {
		list( $start, $end ) = self::period_bounds( $period );

		$consult = self::sum( HGD_DB::bookings_table(), 'amount_gbp', "status = 'paid'", 'created_at', $start, $end );
		// Milestones use paid_at — the moment Stripe/Woo confirmed payment.
		$milestones = self::sum( HGD_DB::payments_table(), 'amount_gbp', "status = 'paid'", 'paid_at', $start, $end );

		return array(
			'consultations' => $consult,
			'milestones'    => $milestones,
			'total'         => $consult + $milestones,
		);
	}

	/**
	 * Recurring revenue from active maintenance plans.
	 *
	 * @return array mrr, arr, active (int), new_this_month (int).
	 */
	public static function recurring() {
		global $wpdb;
		$table = HGD_DB::subscriptions_table();

		// Normalise yearly plans to a monthly contribution.
		$mrr = (float) $wpdb->get_var(
			"SELECT COALESCE(SUM(CASE WHEN billing_interval = 'year' THEN amount_gbp/12 ELSE amount_gbp END),0)
			 FROM {$table} WHERE status = 'active'"
		);
		$active = self::count_where( $table, "status = 'active'" );

		list( $m_start, $m_end ) = self::period_bounds( 'month' );
		$new = self::count_where( $table, "status IN ('active','past_due')", 'created_at', $m_start, $m_end );

		return array(
			'mrr'            => $mrr,
			'arr'            => $mrr * 12,
			'active'         => $active,
			'new_this_month' => $new,
		);
	}

	/**
	 * Open sales pipeline from proposals not yet fully complete.
	 *
	 * @return array open_value (float), by_status (status => [count, value]).
	 */
	public static function proposal_pipeline() {
		global $wpdb;
		$table = HGD_DB::proposals_table();

		$rows = $wpdb->get_results(
			"SELECT status, COUNT(*) AS n, COALESCE(SUM(total_gbp),0) AS v
			 FROM {$table} GROUP BY status",
			ARRAY_A
		) ?: array();

		$by_status = array();
		$open      = 0.0;
		$open_set  = array( 'sent', 'viewed', 'accepted', 'deposit_paid' );
		foreach ( $rows as $r ) {
			$by_status[ $r['status'] ] = array( 'count' => (int) $r['n'], 'value' => (float) $r['v'] );
			if ( in_array( $r['status'], $open_set, true ) ) {
				$open += (float) $r['v'];
			}
		}

		return array( 'open_value' => $open, 'by_status' => $by_status );
	}

	/** Project counts keyed by status (every known status present, zero-filled). */
	public static function projects_by_status() {
		global $wpdb;
		$table = HGD_DB::projects_table();
		$rows  = $wpdb->get_results( "SELECT status, COUNT(*) AS n FROM {$table} GROUP BY status", ARRAY_A ) ?: array();

		$counts = array();
		foreach ( array_keys( HGD_Project::STATUSES ) as $key ) {
			$counts[ $key ] = 0;
		}
		foreach ( $rows as $r ) {
			$counts[ $r['status'] ] = (int) $r['n'];
		}
		return $counts;
	}

	/**
	 * A simple acquisition funnel (all-time counts).
	 *
	 * @return array leads, consultations, proposals_sent, accepted, complete.
	 */
	public static function funnel() {
		$projects  = HGD_DB::projects_table();
		$bookings  = HGD_DB::bookings_table();
		$proposals = HGD_DB::proposals_table();

		return array(
			'leads'           => self::count_where( $projects, "1=1" ),
			'consultations'   => self::count_where( $bookings, "status = 'paid'" ),
			'proposals_sent'  => self::count_where( $proposals, "status <> 'draft'" ),
			'accepted'        => self::count_where( $proposals, "status IN ('accepted','deposit_paid','complete')" ),
			'complete'        => self::count_where( $projects, "status = 'complete'" ),
		);
	}
}
