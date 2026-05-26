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
 */
class OCF_Compat {

	const NEEDLES = array( '[nvelope_form', '[oc_form' );

	public static function init() {
		// ACF — runs after the default value formatting (priority 20).
		add_filter( 'acf/format_value',                  array( __CLASS__, 'maybe_run' ), 20, 1 );

		// JetEngine dynamic-field listings.
		add_filter( 'jet-engine/listings/dynamic-field/value', array( __CLASS__, 'maybe_run' ), 20, 1 );
		add_filter( 'jet-engine/listing/data/prepared-meta-value', array( __CLASS__, 'maybe_run' ), 20, 1 );

		// Bricks builder.
		add_filter( 'bricks/dynamic_data/render_content', array( __CLASS__, 'maybe_run' ), 20, 1 );

		// Generic fallbacks that some themes use for custom-field rendering.
		add_filter( 'the_excerpt',  array( __CLASS__, 'maybe_run' ), 20, 1 );
		add_filter( 'widget_text',  array( __CLASS__, 'maybe_run' ), 20, 1 );
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
}
