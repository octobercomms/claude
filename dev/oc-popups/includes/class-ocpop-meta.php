<?php
/**
 * The "Popup Settings" meta box: triggers, frequency, scheduling, targeting
 * and appearance. Stored as a single serialised array in _ocpop_settings so
 * the popup body stays 100% owned by the page builder.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCPOP_Meta {

	const META_KEY = '_ocpop_settings';

	public static function init() {
		add_action( 'add_meta_boxes', array( __CLASS__, 'add_box' ) );
		add_action( 'save_post_' . OCPOP_CPT, array( __CLASS__, 'save' ), 10, 2 );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'admin_assets' ) );
	}

	/**
	 * Default settings for a popup. Also the single source of truth for which
	 * keys exist, used by save() to know what to read.
	 */
	public static function defaults() {
		return array(
			'enabled'          => 1,

			// Trigger.
			'trigger_type'     => 'delay',   // load|delay|scroll|exit|idle|click|manual
			'delay_seconds'    => 3,
			'scroll_percent'   => 50,
			'idle_seconds'     => 20,
			'click_selector'   => '',

			// Frequency.
			'frequency'        => 'days',    // always|session|once|days
			'frequency_days'   => 7,

			// Scheduling (site timezone, Y-m-d).
			'start_date'       => '',
			'end_date'         => '',

			// Targeting.
			'display_on'       => 'all',     // all|front|selected|exclude
			'target_ids'       => '',        // comma-separated post/page IDs
			'devices'          => 'all',     // all|desktop|mobile
			'logged_in'        => 'all',     // all|in|out

			// Appearance.
			'position'         => 'center',  // center|top-bar|bottom-bar|slide-left|slide-right
			'width'            => 600,
			'animation'        => 'fade',    // fade|slide|zoom|none
			'overlay'          => 1,
			'overlay_color'    => 'rgba(0,0,0,0.6)',
			'overlay_close'    => 1,
			'esc_close'        => 1,
			'show_close'       => 1,
			'close_delay'      => 0,         // seconds before the close button appears
		);
	}

	/**
	 * Merge saved settings over defaults. Always returns a full array.
	 */
	public static function get_settings( $post_id ) {
		$saved = get_post_meta( $post_id, self::META_KEY, true );
		if ( ! is_array( $saved ) ) {
			$saved = array();
		}
		return array_merge( self::defaults(), $saved );
	}

	public static function add_box() {
		add_meta_box(
			'ocpop_settings',
			__( 'Popup Settings', 'october-popups' ),
			array( __CLASS__, 'render_box' ),
			OCPOP_CPT,
			'normal',
			'high'
		);
		add_meta_box(
			'ocpop_help',
			__( 'How to use', 'october-popups' ),
			array( __CLASS__, 'render_help' ),
			OCPOP_CPT,
			'side',
			'low'
		);
	}

	public static function render_box( $post ) {
		$s = self::get_settings( $post->ID );
		wp_nonce_field( 'ocpop_save', 'ocpop_nonce' );
		require OCPOP_PATH . 'admin/views/meta-box.php';
	}

	public static function render_help( $post ) {
		$builders = array();
		if ( OCPOP_Builders::wpbakery_active() ) {
			$builders[] = 'WP Bakery';
		}
		if ( OCPOP_Builders::elementor_active() ) {
			$builders[] = 'Elementor';
		}
		echo '<div class="ocpop-help">';
		echo '<p>' . esc_html__( 'Build the popup body with the editor above — the same builder you use for pages.', 'october-popups' ) . '</p>';
		if ( $builders ) {
			echo '<p><strong>' . esc_html__( 'Detected builders:', 'october-popups' ) . '</strong> ' . esc_html( implode( ', ', $builders ) ) . '</p>';
		}
		echo '<p>' . esc_html__( 'Open this popup from any link or button by adding the CSS class:', 'october-popups' ) . '</p>';
		echo '<p><code>ocpop-open-' . (int) $post->ID . '</code></p>';
		echo '<p>' . esc_html__( 'Or drop this shortcode anywhere:', 'october-popups' ) . '</p>';
		echo '<p><code>[october_popup id="' . (int) $post->ID . '" text="Enter now"]</code></p>';
		echo '<p>' . esc_html__( 'Mark a link inside the popup as the call-to-action (for click tracking) by adding the class:', 'october-popups' ) . ' <code>ocpop-cta</code></p>';
		echo '</div>';
	}

	public static function save( $post_id, $post ) {
		if ( ! isset( $_POST['ocpop_nonce'] ) || ! wp_verify_nonce( wp_unslash( $_POST['ocpop_nonce'] ), 'ocpop_save' ) ) {
			return;
		}
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}

		$in  = isset( $_POST['ocpop'] ) && is_array( $_POST['ocpop'] ) ? wp_unslash( $_POST['ocpop'] ) : array();
		$out = self::sanitize( $in );
		update_post_meta( $post_id, self::META_KEY, $out );
	}

	/**
	 * Sanitise every known field. Unknown keys are dropped.
	 */
	public static function sanitize( $in ) {
		$d   = self::defaults();
		$out = array();

		$out['enabled']       = empty( $in['enabled'] ) ? 0 : 1;
		$out['overlay']       = empty( $in['overlay'] ) ? 0 : 1;
		$out['overlay_close'] = empty( $in['overlay_close'] ) ? 0 : 1;
		$out['esc_close']     = empty( $in['esc_close'] ) ? 0 : 1;
		$out['show_close']    = empty( $in['show_close'] ) ? 0 : 1;

		$enums = array(
			'trigger_type' => array( 'load', 'delay', 'scroll', 'exit', 'idle', 'click', 'manual' ),
			'frequency'    => array( 'always', 'session', 'once', 'days' ),
			'display_on'   => array( 'all', 'front', 'selected', 'exclude' ),
			'devices'      => array( 'all', 'desktop', 'mobile' ),
			'logged_in'    => array( 'all', 'in', 'out' ),
			'position'     => array( 'center', 'top-bar', 'bottom-bar', 'slide-left', 'slide-right' ),
			'animation'    => array( 'fade', 'slide', 'zoom', 'none' ),
		);
		foreach ( $enums as $key => $allowed ) {
			$val          = isset( $in[ $key ] ) ? sanitize_key( $in[ $key ] ) : $d[ $key ];
			$out[ $key ]  = in_array( $val, $allowed, true ) ? $val : $d[ $key ];
		}

		$ints = array(
			'delay_seconds'  => array( 0, 600 ),
			'scroll_percent' => array( 1, 100 ),
			'idle_seconds'   => array( 1, 3600 ),
			'frequency_days' => array( 1, 365 ),
			'width'          => array( 200, 2000 ),
			'close_delay'    => array( 0, 120 ),
		);
		foreach ( $ints as $key => $range ) {
			$val         = isset( $in[ $key ] ) ? (int) $in[ $key ] : $d[ $key ];
			$out[ $key ] = max( $range[0], min( $range[1], $val ) );
		}

		$out['click_selector'] = isset( $in['click_selector'] ) ? sanitize_text_field( $in['click_selector'] ) : '';
		$out['overlay_color']  = isset( $in['overlay_color'] ) ? sanitize_text_field( $in['overlay_color'] ) : $d['overlay_color'];

		// Dates: keep only valid Y-m-d, otherwise blank.
		foreach ( array( 'start_date', 'end_date' ) as $key ) {
			$val = isset( $in[ $key ] ) ? trim( $in[ $key ] ) : '';
			$out[ $key ] = self::valid_date( $val ) ? $val : '';
		}

		// Target IDs: comma-separated list of positive ints.
		$ids = isset( $in['target_ids'] ) ? preg_split( '/[\s,]+/', (string) $in['target_ids'] ) : array();
		$ids = array_filter( array_map( 'absint', (array) $ids ) );
		$out['target_ids'] = implode( ',', $ids );

		return $out;
	}

	private static function valid_date( $val ) {
		if ( ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $val ) ) {
			return false;
		}
		$parts = explode( '-', $val );
		return checkdate( (int) $parts[1], (int) $parts[2], (int) $parts[0] );
	}

	public static function admin_assets( $hook ) {
		$screen = get_current_screen();
		if ( ! $screen || OCPOP_CPT !== $screen->post_type ) {
			return;
		}
		if ( ! in_array( $hook, array( 'post.php', 'post-new.php' ), true ) ) {
			return;
		}
		wp_enqueue_style( 'ocpop-admin', OCPOP_URL . 'admin/css/admin.css', array(), OCPOP_VERSION );
		wp_enqueue_script( 'ocpop-admin', OCPOP_URL . 'admin/js/admin.js', array(), OCPOP_VERSION, true );
	}

	/** Get a single setting for a popup (convenience for other classes). */
	public static function get( $post_id, $key, $fallback = null ) {
		$s = self::get_settings( $post_id );
		return isset( $s[ $key ] ) ? $s[ $key ] : $fallback;
	}
}
