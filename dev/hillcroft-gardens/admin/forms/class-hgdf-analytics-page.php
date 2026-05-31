<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGDF_Analytics_Page {

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ), 11 );
	}

	public static function menu() {
		// Registered hidden (null parent) — reached via the Forms hub tabs.
		add_submenu_page(
			null,
			'Form Analytics',
			'Form Analytics',
			'manage_options',
			'hgd-forms-analytics',
			array( __CLASS__, 'render' )
		);
	}

	public static function render() {
		if ( ! current_user_can( 'manage_options' ) ) { return; }
		$form_id = absint( $_GET['form_id'] ?? 0 );
		$forms   = get_posts( array(
			'post_type'      => HGDF_CPT,
			'posts_per_page' => 100,
			'post_status'    => array( 'publish', 'draft' ),
		) );

		$from = sanitize_text_field( $_GET['from'] ?? '' );
		$to   = sanitize_text_field( $_GET['to'] ?? '' );

		echo '<div class="wrap"><h1>Forms</h1>';
		if ( class_exists( 'HGD_Admin' ) ) {
			HGD_Admin::forms_tabs( 'hgd-forms-analytics' );
		}
		echo '<form method="get" style="margin: 16px 0; display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">';
		echo '<input type="hidden" name="page" value="hgd-forms-analytics">';
		echo '<label>Form: <select name="form_id">';
		echo '<option value="">— Choose —</option>';
		foreach ( $forms as $f ) {
			printf( '<option value="%d" %s>%s</option>', $f->ID, selected( $form_id, $f->ID, false ), esc_html( $f->post_title ) );
		}
		echo '</select></label>';
		echo '<label>From: <input type="date" name="from" value="' . esc_attr( $from ) . '"></label>';
		echo '<label>To: <input type="date" name="to" value="' . esc_attr( $to ) . '"></label>';
		echo '<button class="button button-primary">Apply</button>';
		echo '</form>';

		if ( ! $form_id ) {
			echo '<p>Choose a form to see its analytics.</p></div>';
			return;
		}

		$stats   = HGDF_Analytics::form_stats( $form_id, $from, $to );
		$funnel  = HGDF_Analytics::funnel( $form_id, $from, $to );
		$series  = HGDF_Analytics::timeseries( $form_id, $from, $to );

		self::render_kpis( $stats );
		echo '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 24px;">';
		self::render_funnel( $funnel );
		self::render_timeseries( $series );
		echo '</div>';

		echo '<p style="margin-top: 24px;">';
		echo '<a class="button" href="' . esc_url( admin_url( 'admin.php?page=hgd-forms-submissions&form_id=' . $form_id ) ) . '">View submissions →</a> ';
		echo '<a class="button" href="' . esc_url( wp_nonce_url( admin_url( 'admin.php?page=hgd-forms-submissions&form_id=' . $form_id . '&action=export' ), 'hgd_form_export' ) ) . '">Export CSV</a>';
		echo '</p>';

		echo '</div>';
	}

	private static function render_kpis( $stats ) {
		echo '<div class="hgd-form-kpi-grid">';
		self::kpi( 'Views',     $stats['views'] );
		self::kpi( 'Starts',    $stats['starts'] );
		self::kpi( 'Partial',   $stats['partials'] );
		self::kpi( 'Completed', $stats['completes'] );
		self::kpi( 'View → start', self::pct( $stats['view_to_start_rate'] ) );
		self::kpi( 'Start → complete', self::pct( $stats['start_to_complete'] ) );
		self::kpi( 'Overall conversion', self::pct( $stats['overall_conversion'] ) );
		self::kpi( 'Median time on form', self::duration( $stats['median_seconds'] ) );
		echo '</div>';

		echo '<style>
			.hgd-form-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
			.hgd-form-kpi { background: #fff; border: 1px solid #c3c4c7; border-radius: 4px; padding: 16px; }
			.hgd-form-kpi-label { font-size: 12px; color: #6c7781; text-transform: uppercase; letter-spacing: .04em; }
			.hgd-form-kpi-value { font-size: 28px; font-weight: 600; margin-top: 4px; }
			.hgd-form-card { background: #fff; border: 1px solid #c3c4c7; border-radius: 4px; padding: 20px; }
			.hgd-form-card h2 { margin-top: 0; }
			.hgd-form-bar { height: 26px; background: #2271b1; border-radius: 3px; display: flex; align-items: center; padding: 0 10px; color: #fff; font-size: 13px; min-width: 4px; transition: width .2s; }
			.hgd-form-funnel-row { display: grid; grid-template-columns: 200px 1fr 60px; gap: 12px; align-items: center; margin-bottom: 8px; }
			.hgd-form-funnel-row span:last-child { text-align: right; font-variant-numeric: tabular-nums; }
			.hgd-form-ts svg { width: 100%; height: 220px; display: block; }
		</style>';
	}

	private static function kpi( $label, $value ) {
		echo '<div class="hgd-form-kpi"><div class="hgd-form-kpi-label">' . esc_html( $label ) . '</div><div class="hgd-form-kpi-value">' . esc_html( $value ) . '</div></div>';
	}

	private static function render_funnel( $funnel ) {
		$max = 0;
		foreach ( $funnel as $row ) { if ( $row['reached'] > $max ) { $max = $row['reached']; } }
		echo '<div class="hgd-form-card"><h2>Step funnel</h2>';
		if ( ! $funnel || ! $max ) {
			echo '<p>No data yet.</p>';
		} else {
			foreach ( $funnel as $row ) {
				$pct = $max > 0 ? round( ( $row['reached'] / $max ) * 100 ) : 0;
				$label = $row['title'] ?: ( '#' . ( $row['step_index'] + 1 ) );
				echo '<div class="hgd-form-funnel-row">';
				echo '<span>' . esc_html( $label ) . '</span>';
				echo '<div class="hgd-form-bar" style="width: ' . (int) $pct . '%;">' . (int) $pct . '%</div>';
				echo '<span>' . (int) $row['reached'] . '</span>';
				echo '</div>';
			}
		}
		echo '</div>';
	}

	private static function render_timeseries( $series ) {
		echo '<div class="hgd-form-card hgd-form-ts"><h2>Daily activity</h2>';
		if ( empty( $series ) ) {
			echo '<p>No data yet.</p></div>';
			return;
		}
		$w   = 600;
		$h   = 200;
		$pad = 30;
		$max = 1;
		foreach ( $series as $d ) {
			$max = max( $max, $d['views'], $d['starts'], $d['completes'] );
		}
		$xstep = ( $w - 2 * $pad ) / max( 1, count( $series ) - 1 );
		$pointAt = function ( $i, $v ) use ( $pad, $h, $max, $xstep ) {
			$x = $pad + $i * $xstep;
			$y = $h - $pad - ( $v / $max ) * ( $h - 2 * $pad );
			return $x . ',' . $y;
		};
		$paths = array( 'views' => '#94a3b8', 'starts' => '#2271b1', 'completes' => '#059669' );
		echo '<svg viewBox="0 0 ' . $w . ' ' . $h . '" preserveAspectRatio="xMidYMid meet">';
		echo '<rect x="0" y="0" width="' . $w . '" height="' . $h . '" fill="#fff" />';
		// Gridlines.
		for ( $i = 0; $i <= 4; $i++ ) {
			$y = $pad + ( ( $h - 2 * $pad ) / 4 ) * $i;
			echo '<line x1="' . $pad . '" y1="' . $y . '" x2="' . ( $w - $pad ) . '" y2="' . $y . '" stroke="#eee" />';
		}
		// Lines.
		foreach ( $paths as $key => $color ) {
			$d = '';
			foreach ( $series as $i => $p ) {
				$d .= ( $i === 0 ? 'M ' : ' L ' ) . $pointAt( $i, $p[ $key ] );
			}
			echo '<path d="' . esc_attr( $d ) . '" fill="none" stroke="' . esc_attr( $color ) . '" stroke-width="2" />';
		}
		// Axis labels.
		echo '<text x="' . $pad . '" y="' . ( $h - 8 ) . '" font-size="10" fill="#6c7781">' . esc_html( $series[0]['date'] ) . '</text>';
		echo '<text x="' . ( $w - $pad ) . '" y="' . ( $h - 8 ) . '" font-size="10" fill="#6c7781" text-anchor="end">' . esc_html( $series[ count( $series ) - 1 ]['date'] ) . '</text>';
		echo '<text x="' . $pad . '" y="' . ( $pad - 8 ) . '" font-size="10" fill="#6c7781">max ' . (int) $max . '</text>';
		echo '</svg>';
		echo '<div style="display: flex; gap: 16px; font-size: 12px;">';
		foreach ( $paths as $key => $color ) {
			echo '<span><span style="display: inline-block; width: 10px; height: 10px; background: ' . esc_attr( $color ) . '; margin-right: 4px;"></span>' . esc_html( ucfirst( $key ) ) . '</span>';
		}
		echo '</div></div>';
	}

	private static function pct( $f ) {
		return number_format( $f * 100, 1 ) . '%';
	}
	private static function duration( $s ) {
		$s = (int) $s;
		if ( $s < 60 ) { return $s . 's'; }
		if ( $s < 3600 ) { return floor( $s / 60 ) . 'm ' . ( $s % 60 ) . 's'; }
		return floor( $s / 3600 ) . 'h ' . floor( ( $s % 3600 ) / 60 ) . 'm';
	}
}
