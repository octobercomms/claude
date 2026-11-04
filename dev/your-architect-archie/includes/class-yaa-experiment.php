<?php
/**
 * A/B test: "ask for email first" vs the current browse-freely flow.
 *
 * Variant A (the client's proposal) is a HARD gate — Archie asks for the email
 * up front and no quote is built or shown until it's given. Variant B is the
 * current behaviour (email asked near the end). Visitors are split 50/50 and the
 * assignment is sticky via a 90-day cookie, carried onto the project row the
 * moment the project is created (on the first message).
 *
 * The funnel per variant — started → reached a quote → submitted → converted,
 * plus recovered (came back after leaving) — is read off the projects table and
 * the event log, and the report calls significance on the primary metric
 * (reached-a-quote rate) with a two-proportion z-test, with an explicit
 * "still collecting / enough data" state to discourage stopping on an early dip.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Experiment {

	const COOKIE = 'yaa_ab';

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ), 30 );
		add_action( 'admin_post_yaa_mark_converted', array( __CLASS__, 'act_converted' ) );
	}

	/** Whether the experiment is live. Off (a Settings toggle) = everyone gets Variant B. */
	public static function running() {
		return '0' !== (string) YAA_Settings::get( 'ab_test_on', 1 );
	}

	// ---- Variant assignment ----

	/** Resolve (or assign, 50/50) the sticky variant from the visitor's cookie. */
	public static function variant_cookie() {
		if ( ! self::running() ) {
			return 'B'; // test paused — no new split, everyone gets the normal flow.
		}
		$v = isset( $_COOKIE[ self::COOKIE ] ) ? strtoupper( sanitize_text_field( wp_unslash( $_COOKIE[ self::COOKIE ] ) ) ) : '';
		if ( 'A' !== $v && 'B' !== $v ) {
			$v = ( 0 === wp_rand( 0, 1 ) ) ? 'A' : 'B';
			if ( ! headers_sent() ) {
				setcookie( self::COOKIE, $v, array( 'expires' => time() + 90 * DAY_IN_SECONDS, 'path' => '/', 'samesite' => 'Lax' ) );
			}
			$_COOKIE[ self::COOKIE ] = $v;
		}
		return $v;
	}

	/** The project's stored variant, assigning it from the cookie the first time. */
	public static function variant( $project_id ) {
		global $wpdb;
		$t = YAA_DB::projects_table();
		$v = (string) $wpdb->get_var( $wpdb->prepare( "SELECT variant FROM {$t} WHERE id = %d", (int) $project_id ) ); // phpcs:ignore WordPress.DB
		if ( 'A' === $v || 'B' === $v ) {
			return $v;
		}
		if ( ! self::running() ) {
			return 'B'; // paused — new visitors aren't assigned, they just get the normal flow.
		}
		$v = self::variant_cookie();
		$wpdb->update( $t, array( 'variant' => $v ), array( 'id' => (int) $project_id ), array( '%s' ), array( '%d' ) ); // phpcs:ignore WordPress.DB
		YAA_Project::log_event( (int) $project_id, 'ab_assigned', array( 'variant' => $v ) );
		return $v;
	}

	/** Variant A withholds the quote until there's an email on file. Paused = never gated. */
	public static function gated( $project_id, $state ) {
		return self::running() && 'A' === self::variant( $project_id ) && empty( $state['email'] );
	}

	// ---- Funnel marks ----

	/** Mark "reached a quote" (engaged) once — the moment a priced quote is actually shown. */
	public static function mark_quoted( $project_id ) {
		global $wpdb;
		$t = YAA_DB::projects_table();
		if ( $wpdb->get_var( $wpdb->prepare( "SELECT quoted_at FROM {$t} WHERE id = %d", (int) $project_id ) ) ) { // phpcs:ignore WordPress.DB
			return;
		}
		$wpdb->update( $t, array( 'quoted_at' => current_time( 'mysql' ) ), array( 'id' => (int) $project_id ), array( '%s' ), array( '%d' ) ); // phpcs:ignore WordPress.DB
		YAA_Project::log_event( (int) $project_id, 'quote_reached', array( 'variant' => self::variant( $project_id ) ) );
	}

	public static function mark_converted( $project_id, $note = '' ) {
		global $wpdb;
		$wpdb->update(
			YAA_DB::projects_table(),
			array( 'converted' => 1, 'converted_at' => current_time( 'mysql' ), 'converted_note' => mb_substr( (string) $note, 0, 240 ) ),
			array( 'id' => (int) $project_id ),
			array( '%d', '%s', '%s' ),
			array( '%d' )
		); // phpcs:ignore WordPress.DB
		YAA_Project::log_event( (int) $project_id, 'converted', array( 'note' => (string) $note ) );
	}

	public static function unmark_converted( $project_id ) {
		global $wpdb;
		$wpdb->update(
			YAA_DB::projects_table(),
			array( 'converted' => 0, 'converted_at' => null, 'converted_note' => null ),
			array( 'id' => (int) $project_id ),
			array( '%d', '%s', '%s' ),
			array( '%d' )
		); // phpcs:ignore WordPress.DB
	}

	// ---- Report data ----

	/** Per-variant funnel counts + rates + the z-test verdict on reached-a-quote. */
	public static function report() {
		global $wpdb;
		$p   = YAA_DB::projects_table();
		$ev  = YAA_DB::events_table();
		$agg = $wpdb->get_results( // phpcs:ignore WordPress.DB
			"SELECT variant,
				COUNT(*) AS starts,
				SUM(CASE WHEN quoted_at IS NOT NULL THEN 1 ELSE 0 END)                              AS quoted,
				SUM(CASE WHEN status IN ('submitted','redirected') OR submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS submitted,
				SUM(CASE WHEN converted = 1 THEN 1 ELSE 0 END)                                      AS converted
			 FROM {$p} WHERE variant IN ('A','B') GROUP BY variant",
			OBJECT_K
		);
		$resumed = $wpdb->get_results( // phpcs:ignore WordPress.DB
			"SELECT p.variant AS variant, COUNT(DISTINCT e.project_id) AS n
			 FROM {$ev} e JOIN {$p} p ON p.id = e.project_id
			 WHERE e.type = 'resumed' AND p.variant IN ('A','B') GROUP BY p.variant",
			OBJECT_K
		);

		$out = array();
		foreach ( array( 'A', 'B' ) as $v ) {
			$r = isset( $agg[ $v ] ) ? $agg[ $v ] : null;
			$starts = $r ? (int) $r->starts : 0;
			$out[ $v ] = array(
				'label'     => 'A' === $v ? __( 'A — email first (gate)', 'your-architect-archie' ) : __( 'B — no gate', 'your-architect-archie' ),
				'starts'    => $starts,
				'quoted'    => $r ? (int) $r->quoted : 0,
				'submitted' => $r ? (int) $r->submitted : 0,
				'converted' => $r ? (int) $r->converted : 0,
				'resumed'   => isset( $resumed[ $v ] ) ? (int) $resumed[ $v ]->n : 0,
			);
		}

		// Primary metric: reached-a-quote rate. Two-proportion z-test, A vs B.
		$a = $out['A']; $b = $out['B'];
		$stat = array( 'ready' => false, 'p' => null, 'sig' => false, 'need' => null, 'a_rate' => null, 'b_rate' => null );
		if ( $a['starts'] > 0 && $b['starts'] > 0 ) {
			$p1 = $a['quoted'] / $a['starts'];
			$p2 = $b['quoted'] / $b['starts'];
			$stat['a_rate'] = $p1;
			$stat['b_rate'] = $p2;
			$pool = ( $a['quoted'] + $b['quoted'] ) / ( $a['starts'] + $b['starts'] );
			$se   = sqrt( $pool * ( 1 - $pool ) * ( 1 / $a['starts'] + 1 / $b['starts'] ) );
			if ( $se > 0 ) {
				$z            = ( $p1 - $p2 ) / $se;
				$stat['p']    = 2 * ( 1 - self::norm_cdf( abs( $z ) ) );
				$stat['sig']  = $stat['p'] < 0.05;
			}
			// Target n/variant to detect the observed gap (alpha .05 two-sided, power .8).
			$need = self::required_n( $p1, $p2 );
			$stat['need']  = $need;
			$stat['ready'] = $need && $a['starts'] >= $need && $b['starts'] >= $need;
		}
		return array( 'variants' => $out, 'stat' => $stat );
	}

	/** Per-group sample size to detect the gap between two rates. Null if no gap. */
	private static function required_n( $p1, $p2 ) {
		$d = abs( $p1 - $p2 );
		if ( $d <= 0 ) {
			return null;
		}
		$za   = 1.959964; // 95% two-sided
		$zb   = 0.841621; // 80% power
		$pbar = ( $p1 + $p2 ) / 2;
		$n    = ( pow( $za * sqrt( 2 * $pbar * ( 1 - $pbar ) ) + $zb * sqrt( $p1 * ( 1 - $p1 ) + $p2 * ( 1 - $p2 ) ), 2 ) ) / ( $d * $d );
		return (int) ceil( $n );
	}

	/** Standard-normal CDF (Abramowitz-Stegun erf approximation). */
	private static function norm_cdf( $x ) {
		$z   = abs( $x ) / sqrt( 2 );
		$tt  = 1 / ( 1 + 0.3275911 * $z );
		$erf = 1 - ( ( ( ( ( 1.061405429 * $tt - 1.453152027 ) * $tt ) + 1.421413741 ) * $tt - 0.284496736 ) * $tt + 0.254829592 ) * $tt * exp( -$z * $z );
		return 0.5 * ( 1 + ( $x < 0 ? -$erf : $erf ) );
	}

	// ---- Admin ----

	public static function menu() {
		add_submenu_page(
			'yaa-projects',
			__( 'A/B Test', 'your-architect-archie' ),
			__( 'A/B Test', 'your-architect-archie' ),
			'manage_options',
			'yaa-experiment',
			array( __CLASS__, 'render' )
		);
	}

	/** Mark / unmark a project as converted (manual, for offline conversions). */
	public static function act_converted() {
		if ( ! current_user_can( 'manage_options' ) || ! check_admin_referer( 'yaa_mark_converted' ) ) {
			wp_die( 'Nope' );
		}
		$id   = (int) ( $_POST['project_id'] ?? 0 );
		$note = sanitize_text_field( wp_unslash( $_POST['note'] ?? '' ) );
		if ( $id ) {
			if ( ! empty( $_POST['undo'] ) ) {
				self::unmark_converted( $id );
			} else {
				self::mark_converted( $id, $note );
			}
		}
		$ref = wp_get_referer();
		wp_safe_redirect( $ref ? $ref : add_query_arg( 'page', 'yaa-experiment', admin_url( 'admin.php' ) ) );
		exit;
	}

	private static function pct( $n, $d ) {
		return $d > 0 ? round( ( $n / $d ) * 100, 1 ) : 0;
	}

	public static function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$data = self::report();
		$A    = $data['variants']['A'];
		$B    = $data['variants']['B'];
		$st   = $data['stat'];
		$post = admin_url( 'admin-post.php' );
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'A/B Test — email-first gate', 'your-architect-archie' ); ?></h1>
			<p class="description" style="max-width:820px">
				<?php esc_html_e( 'Variant A asks for an email before building any quote (a hard gate). Variant B is the current flow (browse freely, email asked later). The headline metric is "reached a quote" — the share of visitors who are actually shown a price. Submissions and conversions are shown too but, at low traffic, settle more slowly.', 'your-architect-archie' ); ?>
			</p>
			<?php $live = self::running(); $su = add_query_arg( 'page', 'yaa-settings', admin_url( 'admin.php' ) ); ?>
			<p style="margin:10px 0">
				<strong><?php esc_html_e( 'Status:', 'your-architect-archie' ); ?></strong>
				<?php if ( $live ) : ?>
					<span style="color:#0f7a3d;font-weight:600"><?php esc_html_e( 'Running', 'your-architect-archie' ); ?></span> — <?php esc_html_e( 'new visitors are being split 50/50.', 'your-architect-archie' ); ?>
					<a href="<?php echo esc_url( $su ); ?>"><?php esc_html_e( 'Pause it in Settings', 'your-architect-archie' ); ?></a>
				<?php else : ?>
					<span style="color:#8a6d00;font-weight:600"><?php esc_html_e( 'Paused', 'your-architect-archie' ); ?></span> — <?php esc_html_e( 'everyone now gets the normal flow; the numbers below are the data collected so far.', 'your-architect-archie' ); ?>
					<a href="<?php echo esc_url( $su ); ?>"><?php esc_html_e( 'Resume it in Settings', 'your-architect-archie' ); ?></a>
				<?php endif; ?>
			</p>

			<table class="widefat striped" style="max-width:820px;margin-top:12px">
				<thead><tr>
					<th><?php esc_html_e( 'Stage', 'your-architect-archie' ); ?></th>
					<th><?php echo esc_html( $A['label'] ); ?></th>
					<th><?php echo esc_html( $B['label'] ); ?></th>
				</tr></thead>
				<tbody>
					<tr><td><strong><?php esc_html_e( 'Started the chat', 'your-architect-archie' ); ?></strong></td>
						<td><?php echo esc_html( number_format_i18n( $A['starts'] ) ); ?></td>
						<td><?php echo esc_html( number_format_i18n( $B['starts'] ) ); ?></td></tr>
					<tr><td><strong><?php esc_html_e( 'Reached a quote', 'your-architect-archie' ); ?></strong> <span class="description"><?php esc_html_e( '(primary)', 'your-architect-archie' ); ?></span></td>
						<td><?php echo esc_html( number_format_i18n( $A['quoted'] ) . ' (' . self::pct( $A['quoted'], $A['starts'] ) . '%)' ); ?></td>
						<td><?php echo esc_html( number_format_i18n( $B['quoted'] ) . ' (' . self::pct( $B['quoted'], $B['starts'] ) . '%)' ); ?></td></tr>
					<tr><td><?php esc_html_e( 'Recovered (came back)', 'your-architect-archie' ); ?></td>
						<td><?php echo esc_html( number_format_i18n( $A['resumed'] ) . ' (' . self::pct( $A['resumed'], $A['starts'] ) . '%)' ); ?></td>
						<td><?php echo esc_html( number_format_i18n( $B['resumed'] ) . ' (' . self::pct( $B['resumed'], $B['starts'] ) . '%)' ); ?></td></tr>
					<tr><td><?php esc_html_e( 'Submitted a project', 'your-architect-archie' ); ?></td>
						<td><?php echo esc_html( number_format_i18n( $A['submitted'] ) . ' (' . self::pct( $A['submitted'], $A['starts'] ) . '%)' ); ?></td>
						<td><?php echo esc_html( number_format_i18n( $B['submitted'] ) . ' (' . self::pct( $B['submitted'], $B['starts'] ) . '%)' ); ?></td></tr>
					<tr><td><?php esc_html_e( 'Converted (real project)', 'your-architect-archie' ); ?></td>
						<td><?php echo esc_html( number_format_i18n( $A['converted'] ) . ' (' . self::pct( $A['converted'], $A['starts'] ) . '%)' ); ?></td>
						<td><?php echo esc_html( number_format_i18n( $B['converted'] ) . ' (' . self::pct( $B['converted'], $B['starts'] ) . '%)' ); ?></td></tr>
				</tbody>
			</table>

			<h2 style="margin-top:22px"><?php esc_html_e( 'Verdict — reached-a-quote rate', 'your-architect-archie' ); ?></h2>
			<div class="yaa-card" style="max-width:820px;background:#fff;border:1px solid #dcdcde;border-radius:8px;padding:16px">
			<?php
			if ( null === $st['p'] ) {
				echo '<p>' . esc_html__( 'No data on both variants yet. Send some traffic to the chat and come back.', 'your-architect-archie' ) . '</p>';
			} else {
				$dir = ( $st['a_rate'] < $st['b_rate'] )
					? __( 'Variant A (the email gate) is showing FEWER people a quote', 'your-architect-archie' )
					: __( 'Variant A is showing MORE people a quote', 'your-architect-archie' );
				echo '<p style="font-size:15px"><strong>' . esc_html( $dir ) . '</strong> — '
					. esc_html( sprintf( __( 'A %1$s%% vs B %2$s%% reached a quote.', 'your-architect-archie' ), round( $st['a_rate'] * 100, 1 ), round( $st['b_rate'] * 100, 1 ) ) ) . '</p>';
				echo '<p>' . esc_html( sprintf( __( 'p-value: %s', 'your-architect-archie' ), number_format( (float) $st['p'], 3 ) ) ) . ' — ';
				if ( $st['sig'] && $st['ready'] ) {
					echo '<strong style="color:#0f7a3d">' . esc_html__( 'Significant at 95%, and you have enough data to call it.', 'your-architect-archie' ) . '</strong>';
				} elseif ( $st['sig'] && ! $st['ready'] ) {
					echo '<strong style="color:#8a6d00">' . esc_html__( 'Significant at 95%, but still below the target sample — keep running so an early dip doesn\'t fool you (don\'t peek-and-stop).', 'your-architect-archie' ) . '</strong>';
				} else {
					echo '<strong style="color:#8a6d00">' . esc_html__( 'Not significant yet — keep collecting.', 'your-architect-archie' ) . '</strong>';
				}
				echo '</p>';
				if ( $st['need'] ) {
					echo '<p class="description">' . esc_html( sprintf( __( 'Target for a confident call: about %1$s starts per variant (you have A %2$s, B %3$s).', 'your-architect-archie' ), number_format_i18n( $st['need'] ), number_format_i18n( $A['starts'] ), number_format_i18n( $B['starts'] ) ) ) . '</p>';
				}
			}
			?>
			</div>

			<h2 style="margin-top:22px"><?php esc_html_e( 'Submitted leads — mark the ones that became real projects', 'your-architect-archie' ); ?></h2>
			<p class="description"><?php esc_html_e( 'The studio may convert a lead offline (a direct email or call). Mark those here so conversions count against the right variant.', 'your-architect-archie' ); ?></p>
			<?php
			global $wpdb;
			$p    = YAA_DB::projects_table();
			$rows = $wpdb->get_results( // phpcs:ignore WordPress.DB
				"SELECT id, ref, name, email, variant, total, converted, converted_at, submitted_at
				 FROM {$p} WHERE variant IN ('A','B') AND ( status IN ('submitted','redirected') OR submitted_at IS NOT NULL OR converted = 1 )
				 ORDER BY converted DESC, COALESCE(submitted_at, created) DESC LIMIT 200"
			);
			if ( empty( $rows ) ) {
				echo '<p class="description">' . esc_html__( 'No submitted leads yet.', 'your-architect-archie' ) . '</p>';
			} else {
				echo '<table class="widefat striped" style="max-width:980px"><thead><tr>'
					. '<th>' . esc_html__( 'Ref', 'your-architect-archie' ) . '</th>'
					. '<th>' . esc_html__( 'Lead', 'your-architect-archie' ) . '</th>'
					. '<th>' . esc_html__( 'Variant', 'your-architect-archie' ) . '</th>'
					. '<th>' . esc_html__( 'Quote', 'your-architect-archie' ) . '</th>'
					. '<th>' . esc_html__( 'Converted?', 'your-architect-archie' ) . '</th>'
					. '</tr></thead><tbody>';
				foreach ( $rows as $r ) {
					echo '<tr><td>' . esc_html( $r->ref ? $r->ref : ( '#' . (int) $r->id ) ) . '</td>';
					echo '<td>' . esc_html( ( $r->name ? $r->name : '—' ) . ( $r->email ? ' · ' . $r->email : '' ) ) . '</td>';
					echo '<td><strong>' . esc_html( (string) $r->variant ) . '</strong></td>';
					echo '<td>' . esc_html( YAA_Pricing::money( (int) $r->total ) ) . '</td>';
					echo '<td>';
					echo '<form method="post" action="' . esc_url( $post ) . '" style="display:flex;gap:6px;align-items:center">';
					echo '<input type="hidden" name="action" value="yaa_mark_converted">';
					echo '<input type="hidden" name="project_id" value="' . (int) $r->id . '">';
					echo wp_nonce_field( 'yaa_mark_converted', '_wpnonce', true, false );
					if ( (int) $r->converted ) {
						echo '<span style="color:#0f7a3d;font-weight:600">' . esc_html__( 'Converted', 'your-architect-archie' ) . ( $r->converted_at ? ' · ' . esc_html( date_i18n( 'j M Y', strtotime( $r->converted_at ) ) ) : '' ) . '</span>';
						echo '<input type="hidden" name="undo" value="1">';
						echo '<button type="submit" class="button button-small">' . esc_html__( 'Undo', 'your-architect-archie' ) . '</button>';
					} else {
						echo '<input type="text" name="note" placeholder="' . esc_attr__( 'note (optional)', 'your-architect-archie' ) . '" style="width:150px">';
						echo '<button type="submit" class="button button-primary button-small">' . esc_html__( 'Mark converted', 'your-architect-archie' ) . '</button>';
					}
					echo '</form></td></tr>';
				}
				echo '</tbody></table>';
			}
			?>
		</div>
		<?php
	}
}
