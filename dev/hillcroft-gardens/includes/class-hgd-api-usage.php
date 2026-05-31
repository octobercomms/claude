<?php
/**
 * API usage logging + cost roll-ups that feed the persistent cost banner.
 *
 * Every external API call should call HGD_API_Usage::log() once the integrations
 * land. For now the table + roll-ups exist so the banner is wired and ready.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_API_Usage {

	/**
	 * Record one API call.
	 *
	 * @param string $api        e.g. 'claude', 'gemini', 'maps', 'plantid'.
	 * @param float  $units      Tokens / images / calls / credits used.
	 * @param string $unit_type  Human label for the units.
	 * @param float  $cost_gbp   Estimated cost in GBP.
	 * @param int    $project_id Optional project association.
	 * @param array  $meta       Optional extra context.
	 */
	public static function log( $api, $units, $unit_type, $cost_gbp, $project_id = null, array $meta = array() ) {
		global $wpdb;
		$wpdb->insert( HGD_DB::api_usage_table(), array(
			'api'        => sanitize_key( $api ),
			'units'      => (float) $units,
			'unit_type'  => sanitize_text_field( $unit_type ),
			'cost_gbp'   => round( (float) $cost_gbp, 4 ),
			'project_id' => $project_id ? (int) $project_id : null,
			'meta'       => $meta ? wp_json_encode( $meta ) : null,
			'created_at' => current_time( 'mysql' ),
		) );
	}

	/** Total estimated GBP spend in the current calendar month. */
	public static function spend_this_month() {
		global $wpdb;
		$table = HGD_DB::api_usage_table();
		$start = gmdate( 'Y-m-01 00:00:00', current_time( 'timestamp' ) );
		return (float) $wpdb->get_var( $wpdb->prepare(
			"SELECT COALESCE(SUM(cost_gbp),0) FROM {$table} WHERE created_at >= %s",
			$start
		) );
	}

	/** Spend grouped by API for the current month. */
	public static function spend_by_api_this_month() {
		global $wpdb;
		$table = HGD_DB::api_usage_table();
		$start = gmdate( 'Y-m-01 00:00:00', current_time( 'timestamp' ) );
		$rows  = $wpdb->get_results( $wpdb->prepare(
			"SELECT api, COALESCE(SUM(cost_gbp),0) AS total FROM {$table} WHERE created_at >= %s GROUP BY api",
			$start
		), ARRAY_A );
		$out = array();
		foreach ( (array) $rows as $r ) {
			$out[ $r['api'] ] = (float) $r['total'];
		}
		return $out;
	}

	/** Total GBP spend attributed to one project (cost-to-produce). */
	public static function spend_for_project( $project_id ) {
		global $wpdb;
		$table = HGD_DB::api_usage_table();
		return (float) $wpdb->get_var( $wpdb->prepare(
			"SELECT COALESCE(SUM(cost_gbp),0) FROM {$table} WHERE project_id = %d",
			(int) $project_id
		) );
	}

	/**
	 * Compute the banner state for the admin header.
	 *
	 * @return array{spend: float, cap: float, level: string, credits: int}
	 */
	public static function banner_state() {
		$settings = HGD_Settings::all();
		$spend    = self::spend_this_month();
		$cap      = (float) $settings['soft_monthly_cap_gbp'];
		$credits  = (int) $settings['plantid_credits_balance'];

		$level = 'green';
		if ( $cap > 0 && $spend >= $cap ) {
			$level = 'red';
		} elseif ( $cap > 0 && $spend >= $cap * 0.8 ) {
			$level = 'amber';
		}
		if ( $credits > 0 && $credits <= 50 ) {
			$level = ( 'red' === $level ) ? 'red' : 'amber';
		}

		return array(
			'spend'   => round( $spend, 2 ),
			'cap'     => $cap,
			'level'   => $level,
			'credits' => $credits,
		);
	}
}
