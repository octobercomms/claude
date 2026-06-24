<?php
/**
 * Engagement analytics — aggregates the first-party events logged by the portal
 * (and complements Microsoft Clarity). Feeds the admin Analytics screen and the
 * Claude monthly/annual report.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCP_Analytics {

	/** Aggregate counts by event, plus section drop-off, over a window (days). */
	public static function summary( $days = 30 ) {
		global $wpdb;
		$table = OCP_DB::events_table();
		$since = gmdate( 'Y-m-d H:i:s', current_time( 'timestamp' ) - $days * DAY_IN_SECONDS );

		$by_event = $wpdb->get_results( $wpdb->prepare(
			"SELECT event, COUNT(*) AS n FROM {$table} WHERE created_at >= %s GROUP BY event ORDER BY n DESC",
			$since
		), ARRAY_A );

		$by_section = $wpdb->get_results( $wpdb->prepare(
			"SELECT section_key, COUNT(*) AS n FROM {$table} WHERE event = 'section_view' AND created_at >= %s GROUP BY section_key ORDER BY n DESC",
			$since
		), ARRAY_A );

		$views   = self::count_event( 'view', $since );
		$accepts = self::count_event( 'accept', $since );

		return array(
			'window_days' => $days,
			'views'       => $views,
			'accepts'     => $accepts,
			'accept_rate' => $views ? round( $accepts / $views * 100, 1 ) : 0,
			'by_event'    => $by_event,
			'by_section'  => $by_section,
		);
	}

	private static function count_event( $event, $since ) {
		global $wpdb;
		$table = OCP_DB::events_table();
		return (int) $wpdb->get_var( $wpdb->prepare(
			"SELECT COUNT(*) FROM {$table} WHERE event = %s AND created_at >= %s",
			$event, $since
		) );
	}

	public static function render() {
		$s = self::summary( 30 );
		echo '<div class="wrap ocp-wrap"><h1 class="ocp-h1">' . esc_html__( 'Analytics', 'oc-proposals' ) . '</h1>';
		echo '<p class="ocp-lede">' . esc_html__( 'First-party engagement over the last 30 days. Microsoft Clarity (set in Settings) adds heatmaps and session recordings.', 'oc-proposals' ) . '</p>';

		echo '<div class="ocp-grid">';
		printf( '<div class="ocp-card"><h2>%d</h2><p class="ocp-muted">%s</p></div>', (int) $s['views'], esc_html__( 'Proposal views', 'oc-proposals' ) );
		printf( '<div class="ocp-card"><h2>%d</h2><p class="ocp-muted">%s</p></div>', (int) $s['accepts'], esc_html__( 'Acceptances', 'oc-proposals' ) );
		printf( '<div class="ocp-card ocp-card--accent"><h2>%s%%</h2><p class="ocp-muted">%s</p></div>', esc_html( $s['accept_rate'] ), esc_html__( 'Accept rate', 'oc-proposals' ) );
		echo '</div>';

		echo '<h2>' . esc_html__( 'Section engagement', 'oc-proposals' ) . '</h2><table class="widefat striped"><thead><tr><th>' . esc_html__( 'Section', 'oc-proposals' ) . '</th><th>' . esc_html__( 'Views', 'oc-proposals' ) . '</th></tr></thead><tbody>';
		foreach ( (array) $s['by_section'] as $row ) {
			printf( '<tr><td>%s</td><td>%d</td></tr>', esc_html( $row['section_key'] ), (int) $row['n'] );
		}
		if ( ! $s['by_section'] ) {
			echo '<tr><td colspan="2">' . esc_html__( 'No data yet.', 'oc-proposals' ) . '</td></tr>';
		}
		echo '</tbody></table>';

		// Claude report (on demand).
		if ( OCP_Claude::enabled() ) {
			echo '<h2>' . esc_html__( 'Claude report', 'oc-proposals' ) . '</h2>';
			$report = OCP_Claude::engagement_report( $s );
			echo $report ? wp_kses_post( wpautop( $report ) ) : '<p class="ocp-muted">' . esc_html__( 'No report generated.', 'oc-proposals' ) . '</p>';
		}
		echo '</div>';
	}
}
