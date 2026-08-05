<?php
/**
 * Analytics — funnel + sales dashboard with date-range toggles.
 *
 * A submenu under Archie Projects. Everything is computed from the projects +
 * events tables (no external chart library — bars are plain CSS). Ranges:
 * 7 / 30 / 90 days / all, by the relevant timestamp for each metric.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Analytics {

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ), 20 );
	}

	public static function menu() {
		add_submenu_page(
			YAA_Projects_Admin::SLUG,
			__( 'Archie Analytics', 'your-architect-archie' ),
			__( 'Analytics', 'your-architect-archie' ),
			'manage_options',
			'yaa-analytics',
			array( __CLASS__, 'render' )
		);
	}

	private static function ranges() {
		return array( '7' => 'Last 7 days', '30' => 'Last 30 days', '90' => 'Last 90 days', 'all' => 'All time' );
	}

	public static function render() {
		global $wpdb;
		$p = YAA_DB::projects_table();

		$range = isset( $_GET['range'] ) ? sanitize_key( wp_unslash( $_GET['range'] ) ) : '30'; // phpcs:ignore WordPress.Security.NonceVerification
		if ( ! array_key_exists( $range, self::ranges() ) ) {
			$range = '30';
		}
		$since = ( 'all' === $range ) ? '1970-01-01 00:00:00' : gmdate( 'Y-m-d H:i:s', current_time( 'timestamp' ) - ( (int) $range * DAY_IN_SECONDS ) );

		$count = function ( $col ) use ( $wpdb, $p, $since ) {
			return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$p} WHERE {$col} >= %s", $since ) ); // phpcs:ignore WordPress.DB
		};
		$started   = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$p} WHERE created >= %s", $since ) ); // phpcs:ignore WordPress.DB
		$submitted = $count( 'submitted_at' );
		$approved  = $count( 'approved_at' );
		$paid      = $count( 'paid_at' );
		$revenue   = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COALESCE(SUM(amount_paid),0) FROM {$p} WHERE paid_at >= %s", $since ) ); // phpcs:ignore WordPress.DB
		$rev_pounds = (int) round( $revenue / 100 );
		$avg       = $paid ? (int) round( $rev_pounds / $paid ) : 0;

		// Attach rates + location splits, over submitted projects in range.
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT london, listed, conservation, state_json FROM {$p} WHERE submitted_at >= %s", $since ) ); // phpcs:ignore WordPress.DB
		$att  = array( 'submitApp' => 0, 'concept' => 0, 'siteVisit' => 0, 'survey' => 0, 'structural' => 0 );
		$loc  = array( 'london' => 0, 'listed' => 0, 'conservation' => 0 );
		foreach ( (array) $rows as $r ) {
			$loc['london']       += $r->london ? 1 : 0;
			$loc['listed']       += $r->listed ? 1 : 0;
			$loc['conservation'] += $r->conservation ? 1 : 0;
			$s = json_decode( (string) $r->state_json, true );
			if ( is_array( $s ) ) {
				foreach ( $att as $k => $_ ) {
					$att[ $k ] += ! empty( $s[ $k ] ) ? 1 : 0;
				}
			}
		}
		$sub_n = max( 1, count( (array) $rows ) );

		// Revenue by day (paid_at) in range — bars.
		$days = ( 'all' === $range ) ? 60 : min( 90, (int) $range );
		$series = $wpdb->get_results( $wpdb->prepare(
			"SELECT DATE(paid_at) d, COALESCE(SUM(amount_paid),0) a FROM {$p} WHERE paid_at >= %s GROUP BY DATE(paid_at) ORDER BY d ASC",
			gmdate( 'Y-m-d H:i:s', current_time( 'timestamp' ) - ( $days * DAY_IN_SECONDS ) )
		), OBJECT_K ); // phpcs:ignore WordPress.DB
		$max_day = 0;
		foreach ( (array) $series as $s ) {
			$max_day = max( $max_day, (int) $s->a );
		}

		$pct = function ( $n, $d ) {
			return $d ? round( ( $n / $d ) * 100 ) : 0;
		};
		?>
		<div class="wrap yaa-admin">
			<div class="yaa-head"><h1><?php esc_html_e( 'Analytics', 'your-architect-archie' ); ?></h1>
				<a class="yaa-btn" href="<?php echo esc_url( admin_url( 'admin.php?page=' . YAA_Projects_Admin::SLUG ) ); ?>"><?php esc_html_e( 'Projects', 'your-architect-archie' ); ?></a>
			</div>

			<div class="yaa-tabs">
				<?php foreach ( self::ranges() as $key => $label ) : ?>
					<a class="yaa-tab <?php echo $range === $key ? 'is-active' : ''; ?>" href="<?php echo esc_url( add_query_arg( array( 'page' => 'yaa-analytics', 'range' => $key ), admin_url( 'admin.php' ) ) ); ?>"><?php echo esc_html( $label ); ?></a>
				<?php endforeach; ?>
			</div>

			<div class="yaa-stats">
				<div class="yaa-stat"><span class="n"><?php echo esc_html( YAA_Pricing::money( $rev_pounds ) ); ?></span><span class="l"><?php esc_html_e( 'Revenue', 'your-architect-archie' ); ?></span></div>
				<div class="yaa-stat"><span class="n"><?php echo esc_html( $paid ); ?></span><span class="l"><?php esc_html_e( 'Paid projects', 'your-architect-archie' ); ?></span></div>
				<div class="yaa-stat"><span class="n"><?php echo esc_html( YAA_Pricing::money( $avg ) ); ?></span><span class="l"><?php esc_html_e( 'Avg project value', 'your-architect-archie' ); ?></span></div>
				<div class="yaa-stat"><span class="n"><?php echo esc_html( $pct( $paid, $started ) ); ?>%</span><span class="l"><?php esc_html_e( 'Started → paid', 'your-architect-archie' ); ?></span></div>
			</div>

			<div class="yaa-grid">
				<div class="yaa-card">
					<div class="yaa-card-head"><h2><?php esc_html_e( 'Funnel', 'your-architect-archie' ); ?></h2></div>
					<?php
					$funnel = array(
						array( __( 'Started', 'your-architect-archie' ), $started, 100 ),
						array( __( 'Submitted', 'your-architect-archie' ), $submitted, $pct( $submitted, $started ) ),
						array( __( 'Approved', 'your-architect-archie' ), $approved, $pct( $approved, $started ) ),
						array( __( 'Paid', 'your-architect-archie' ), $paid, $pct( $paid, $started ) ),
					);
					foreach ( $funnel as $f ) :
						?>
						<div class="yaa-funnel-row">
							<span class="yaa-funnel-l"><?php echo esc_html( $f[0] ); ?></span>
							<div class="yaa-funnel-bar"><span style="width:<?php echo esc_attr( max( 3, $f[2] ) ); ?>%"><?php echo esc_html( $f[1] ); ?></span></div>
							<span class="yaa-funnel-p"><?php echo esc_html( $f[2] ); ?>%</span>
						</div>
					<?php endforeach; ?>
					<p class="yaa-sub"><?php echo esc_html( sprintf( __( 'Submit rate %1$s%% · Payment rate %2$s%%', 'your-architect-archie' ), $pct( $submitted, $started ), $pct( $paid, $submitted ) ) ); ?></p>
				</div>

				<div class="yaa-card">
					<div class="yaa-card-head"><h2><?php esc_html_e( 'Revenue over time', 'your-architect-archie' ); ?></h2></div>
					<?php if ( empty( $series ) ) : ?>
						<div class="yaa-sub"><?php esc_html_e( 'No payments in this range yet.', 'your-architect-archie' ); ?></div>
					<?php else : ?>
						<div class="yaa-chart">
							<?php foreach ( $series as $s ) : $h = $max_day ? max( 4, round( ( (int) $s->a / $max_day ) * 100 ) ) : 4; ?>
								<div class="yaa-bar" title="<?php echo esc_attr( $s->d . ' · ' . YAA_Pricing::money( (int) round( $s->a / 100 ) ) ); ?>"><span style="height:<?php echo esc_attr( $h ); ?>%"></span></div>
							<?php endforeach; ?>
						</div>
					<?php endif; ?>
				</div>
			</div>

			<div class="yaa-grid">
				<div class="yaa-card">
					<div class="yaa-card-head"><h2><?php esc_html_e( 'Add-on attach (of submitted)', 'your-architect-archie' ); ?></h2></div>
					<?php
					$labels = array( 'submitApp' => 'We submit the application', 'concept' => '3D concept', 'siteVisit' => 'Site visit', 'survey' => 'Measured survey', 'structural' => 'Structural changes' );
					foreach ( $labels as $k => $lab ) :
						?>
						<div class="yaa-funnel-row">
							<span class="yaa-funnel-l"><?php echo esc_html( $lab ); ?></span>
							<div class="yaa-funnel-bar alt"><span style="width:<?php echo esc_attr( max( 3, $pct( $att[ $k ], $sub_n ) ) ); ?>%"><?php echo esc_html( $att[ $k ] ); ?></span></div>
							<span class="yaa-funnel-p"><?php echo esc_html( $pct( $att[ $k ], $sub_n ) ); ?>%</span>
						</div>
					<?php endforeach; ?>
				</div>

				<div class="yaa-card">
					<div class="yaa-card-head"><h2><?php esc_html_e( 'Property mix (of submitted)', 'your-architect-archie' ); ?></h2></div>
					<?php
					$locs = array( 'london' => 'London / M25', 'listed' => 'Listed building', 'conservation' => 'Conservation area' );
					foreach ( $locs as $k => $lab ) :
						?>
						<div class="yaa-funnel-row">
							<span class="yaa-funnel-l"><?php echo esc_html( $lab ); ?></span>
							<div class="yaa-funnel-bar alt"><span style="width:<?php echo esc_attr( max( 3, $pct( $loc[ $k ], $sub_n ) ) ); ?>%"><?php echo esc_html( $loc[ $k ] ); ?></span></div>
							<span class="yaa-funnel-p"><?php echo esc_html( $pct( $loc[ $k ], $sub_n ) ); ?>%</span>
						</div>
					<?php endforeach; ?>
				</div>
			</div>
		</div>
		<style>
		.yaa-funnel-row { display:flex; align-items:center; gap:12px; margin-bottom:10px; }
		.yaa-funnel-l { width:180px; color:var(--ink); font-weight:600; font-size:.9rem; }
		.yaa-funnel-bar { flex:1; background:var(--bg); border-radius:8px; height:26px; overflow:hidden; }
		.yaa-funnel-bar span { display:flex; align-items:center; justify-content:flex-end; height:100%; background:var(--blue); color:#fff; font-weight:700; font-size:.8rem; padding:0 8px; border-radius:8px; min-width:24px; }
		.yaa-funnel-bar.alt span { background:var(--navy); }
		.yaa-funnel-p { width:44px; text-align:right; color:var(--muted); font-weight:600; }
		.yaa-chart { display:flex; align-items:flex-end; gap:4px; height:140px; padding-top:10px; }
		.yaa-bar { flex:1; display:flex; align-items:flex-end; height:100%; }
		.yaa-bar span { width:100%; background:var(--blue); border-radius:4px 4px 0 0; min-height:4px; }
		</style>
		<?php
	}
}
