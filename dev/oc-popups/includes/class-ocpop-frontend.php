<?php
/**
 * Frontend: works out which popups apply to the current request, prints their
 * markup in the footer, and hands the trigger config to popups.js.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCPOP_Frontend {

	/** @var array Popups queued for output on this request. */
	private static $queued = array();

	public static function init() {
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue' ) );
		add_action( 'wp_footer', array( __CLASS__, 'render_footer' ), 99 );
		add_shortcode( 'october_popup', array( __CLASS__, 'shortcode' ) );
	}

	/**
	 * Is "now" inside a popup's start/end window? Empty dates mean open-ended.
	 * end_date is inclusive of the whole day.
	 */
	public static function within_schedule( $s ) {
		$today = current_time( 'Y-m-d' );
		if ( ! empty( $s['start_date'] ) && $today < $s['start_date'] ) {
			return false;
		}
		if ( ! empty( $s['end_date'] ) && $today > $s['end_date'] ) {
			return false;
		}
		return true;
	}

	/**
	 * Decide whether a popup should load on the current page. Device is left to
	 * the client (JS) so that page caching can't serve the wrong variant.
	 */
	public static function should_load( $post_id, $s ) {
		if ( empty( $s['enabled'] ) ) {
			return false;
		}
		if ( ! self::within_schedule( $s ) ) {
			return false;
		}

		// Logged-in state.
		if ( 'in' === $s['logged_in'] && ! is_user_logged_in() ) {
			return false;
		}
		if ( 'out' === $s['logged_in'] && is_user_logged_in() ) {
			return false;
		}

		// Manual popups are still rendered on matching pages so that a button
		// carrying the `ocpop-open-<ID>` class can open them; popups.js simply
		// never auto-fires them. (The shortcode can also force-queue one on a
		// page the targeting rules would otherwise exclude.)

		// Page targeting.
		$ids = array_filter( array_map( 'absint', explode( ',', (string) $s['target_ids'] ) ) );
		switch ( $s['display_on'] ) {
			case 'front':
				return is_front_page();
			case 'selected':
				return ( is_singular() && in_array( get_queried_object_id(), $ids, true ) );
			case 'exclude':
				return ! ( is_singular() && in_array( get_queried_object_id(), $ids, true ) );
			case 'all':
			default:
				return true;
		}
	}

	/**
	 * Gather all publish-status popups and queue the ones that match.
	 */
	private static function collect() {
		if ( is_admin() ) {
			return;
		}
		$popups = get_posts(
			array(
				'post_type'        => OCPOP_CPT,
				'post_status'      => 'publish',
				'numberposts'      => 50,
				'suppress_filters' => false,
			)
		);
		foreach ( $popups as $popup ) {
			$s = OCPOP_Meta::get_settings( $popup->ID );
			if ( self::should_load( $popup->ID, $s ) ) {
				self::$queued[ $popup->ID ] = $s;
			}
		}
	}

	/** Force a popup into the output queue (used by shortcode / manual open). */
	public static function queue( $post_id ) {
		if ( isset( self::$queued[ $post_id ] ) ) {
			return;
		}
		$post = get_post( $post_id );
		if ( $post && OCPOP_CPT === $post->post_type && 'publish' === $post->post_status ) {
			self::$queued[ $post_id ] = OCPOP_Meta::get_settings( $post_id );
		}
	}

	public static function enqueue() {
		if ( is_admin() ) {
			return;
		}
		// Enqueue whenever at least one published popup exists, so that popups
		// added mid-page by the shortcode / manual class still have their JS
		// and CSS available. The exact match set is finalised in the footer.
		$count = (int) wp_count_posts( OCPOP_CPT )->publish;
		if ( $count < 1 ) {
			return;
		}

		self::collect();

		OCPOP_Builders::enqueue_builder_assets();

		wp_enqueue_style( 'ocpop-front', OCPOP_URL . 'assets/css/popups.css', array(), OCPOP_VERSION );
		wp_enqueue_script( 'ocpop-front', OCPOP_URL . 'assets/js/popups.js', array(), OCPOP_VERSION, true );
	}

	/**
	 * The per-popup config object handed to the browser.
	 */
	private static function js_config( $id, $s ) {
		return array(
			'id'           => (int) $id,
			'trigger'      => $s['trigger_type'],
			'delay'        => (int) $s['delay_seconds'],
			'scroll'       => (int) $s['scroll_percent'],
			'idle'         => (int) $s['idle_seconds'],
			'selector'     => $s['click_selector'],
			'frequency'    => $s['frequency'],
			'freqDays'     => (int) $s['frequency_days'],
			'devices'      => $s['devices'],
			'position'     => $s['position'],
			'width'        => (int) $s['width'],
			'animation'    => $s['animation'],
			'overlay'      => (int) $s['overlay'],
			'overlayColor' => $s['overlay_color'],
			'overlayClose' => (int) $s['overlay_close'],
			'escClose'     => (int) $s['esc_close'],
			'showClose'    => (int) $s['show_close'],
			'closeDelay'   => (int) $s['close_delay'],
		);
	}

	/**
	 * Print each queued popup's shell + builder-rendered body into the footer.
	 */
	public static function render_footer() {
		if ( empty( self::$queued ) ) {
			return;
		}

		// Hand the browser the trigger config for every queued popup, plus the
		// tracking endpoint. Read by popups.js on load (order-independent).
		$config = array();
		foreach ( self::$queued as $id => $s ) {
			$config[] = self::js_config( $id, $s );
		}
		printf(
			'<script type="application/json" id="ocpop-config">%s</script>',
			wp_json_encode(
				array(
					'popups'   => $config,
					'trackUrl' => esc_url_raw( rest_url( 'october-popups/v1/track' ) ),
					'nonce'    => wp_create_nonce( 'wp_rest' ),
				)
			)
		);

		foreach ( self::$queued as $id => $s ) {
			$body = OCPOP_Builders::render_content( $id );

			$classes = 'ocpop ocpop--' . esc_attr( $s['position'] ) . ' ocpop--anim-' . esc_attr( $s['animation'] );
			printf(
				'<div class="ocpop-wrap ocpop-wrap--%2$s" id="ocpop-wrap-%1$d" data-ocpop-id="%1$d" hidden>',
				(int) $id,
				esc_attr( $s['position'] )
			);
			if ( ! empty( $s['overlay'] ) ) {
				echo '<div class="ocpop-overlay"></div>';
			}
			printf(
				'<div class="%1$s" role="dialog" aria-modal="true" style="--ocpop-w:%2$dpx;--ocpop-w-mobile:%3$dpx">',
				esc_attr( $classes ),
				(int) $s['width'],
				(int) $s['width_mobile']
			);
			if ( ! empty( $s['show_close'] ) ) {
				echo '<button type="button" class="ocpop-close" aria-label="' . esc_attr__( 'Close', 'october-popups' ) . '">&times;</button>';
			}
			echo '<div class="ocpop-body">' . $body . '</div>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- builder output.
			echo '</div></div>';
		}
	}

	/**
	 * [october_popup id="123" text="Enter now" class="btn"] — a button that
	 * opens the popup, and force-queues its markup even on manual-only popups.
	 */
	public static function shortcode( $atts ) {
		$atts = shortcode_atts(
			array(
				'id'    => 0,
				'text'  => __( 'Open', 'october-popups' ),
				'class' => '',
			),
			$atts,
			'october_popup'
		);
		$id = absint( $atts['id'] );
		if ( ! $id ) {
			return '';
		}
		self::queue( $id );

		return sprintf(
			'<button type="button" class="ocpop-open-%1$d %2$s">%3$s</button>',
			$id,
			esc_attr( $atts['class'] ),
			esc_html( $atts['text'] )
		);
	}
}
