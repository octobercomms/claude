<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Compatibility shims so [nvelope_form] (and the [oc_form] alias) get
 * processed in custom-field values, not just inside post content.
 *
 * WordPress only runs shortcodes inside `the_content` and a handful of
 * other filters. Page builders / theme frameworks (ACF, JetEngine,
 * Elementor's dynamic tags, Bricks, etc.) commonly output custom field
 * values as raw strings — so an embedded shortcode shows up as literal
 * text on the front end. This file hooks the most common value
 * filters and runs `do_shortcode()` whenever the value clearly contains
 * one of our shortcodes. It only touches strings that mention our
 * shortcodes, so unrelated content is left alone.
 *
 * Final safety net: an output-buffer scan on the rendered front-end
 * HTML that catches any remaining `[nvelope_form …]` literals. Triggers
 * only when the page actually contains one of our shortcodes, so the
 * cost is a single strpos for pages that don't, and a single
 * preg_replace_callback for pages that do.
 */
class OCF_Compat {

	const NEEDLES = array( '[nvelope_form', '[oc_form' );

	public static function init() {
		// ACF — runs after the default value formatting (priority 20).
		add_filter( 'acf/format_value',                                  array( __CLASS__, 'maybe_run' ), 20, 1 );

		// JetEngine dynamic-field listings.
		add_filter( 'jet-engine/listings/dynamic-field/value',           array( __CLASS__, 'maybe_run' ), 20, 1 );
		add_filter( 'jet-engine/listing/data/prepared-meta-value',       array( __CLASS__, 'maybe_run' ), 20, 1 );

		// Elementor.
		add_filter( 'elementor/widget/render_content',                   array( __CLASS__, 'maybe_run' ), 20, 1 );
		add_filter( 'elementor_pro/dynamic_tags/text/before_save',       array( __CLASS__, 'maybe_run' ), 20, 1 );
		add_filter( 'elementor/frontend/the_content',                    array( __CLASS__, 'maybe_run' ), 20, 1 );

		// Bricks builder.
		add_filter( 'bricks/dynamic_data/render_content',                array( __CLASS__, 'maybe_run' ), 20, 1 );

		// Generic fallbacks that some themes use for custom-field rendering.
		add_filter( 'the_content',  array( __CLASS__, 'maybe_run' ), 20, 1 );
		add_filter( 'the_excerpt',  array( __CLASS__, 'maybe_run' ), 20, 1 );
		add_filter( 'widget_text',  array( __CLASS__, 'maybe_run' ), 20, 1 );

		// Output-buffer safety net for any path that bypasses the above
		// (custom theme templates, raw `the_field()` calls, page builders
		// that render before our filters can run, etc.).
		add_action( 'template_redirect', array( __CLASS__, 'maybe_start_output_buffer' ), 1 );
	}

	/**
	 * @param mixed $value
	 * @return mixed
	 */
	public static function maybe_run( $value ) {
		if ( ! is_string( $value ) || $value === '' ) {
			return $value;
		}
		foreach ( self::NEEDLES as $needle ) {
			if ( strpos( $value, $needle ) !== false ) {
				return do_shortcode( $value );
			}
		}
		return $value;
	}

	public static function maybe_start_output_buffer() {
		// Skip admin, REST, AJAX, cron, CLI, feeds.
		if ( is_admin() || defined( 'REST_REQUEST' ) || wp_doing_ajax() || wp_doing_cron() || ( defined( 'WP_CLI' ) && WP_CLI ) ) {
			return;
		}
		if ( function_exists( 'is_feed' ) && is_feed() ) {
			return;
		}
		// Skip if we're already inside the REST namespace.
		if ( ! empty( $_SERVER['REQUEST_URI'] ) && strpos( $_SERVER['REQUEST_URI'], '/wp-json/' ) !== false ) {
			return;
		}
		ob_start( array( __CLASS__, 'filter_output' ) );
	}

	/**
	 * Replace any literal [nvelope_form …] (or [oc_form …]) in the full
	 * rendered HTML with the actual shortcode output. Cheap fast-path
	 * for pages that don't contain our shortcode at all.
	 */
	public static function filter_output( $html ) {
		if ( ! is_string( $html ) || $html === '' ) {
			return $html;
		}
		$has = false;
		foreach ( self::NEEDLES as $needle ) {
			if ( strpos( $html, $needle ) !== false ) { $has = true; break; }
		}
		if ( ! $has ) {
			return $html;
		}
		// Match [nvelope_form …] / [oc_form …] tags only — leave escaped/encoded forms alone.
		$pattern = '/\[(nvelope_form|oc_form)\b[^\]]*\]/i';
		return preg_replace_callback( $pattern, function ( $m ) {
			return do_shortcode( $m[0] );
		}, $html );
	}
}
