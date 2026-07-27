<?php
/**
 * Page-builder integration.
 *
 * Two jobs:
 *   1. Make WP Bakery and Elementor offer their editor on the Popup CPT.
 *   2. Render a popup's saved content through the correct builder pipeline so
 *      it looks on the frontend exactly as built (shortcodes, Elementor CSS…).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCPOP_Builders {

	public static function init() {
		// Elementor: keep our CPT in Elementor's supported-post-types option.
		add_action( 'admin_init', array( __CLASS__, 'enable_builder_support' ) );

		// WP Bakery: confirm the CPT is a valid target when it asks. (Enabling
		// the editor button also requires the one-time Role Manager toggle — see
		// readme.txt.) Scoped strictly to our own post type.
		add_filter( 'vc_check_post_type_validation', array( __CLASS__, 'wpbakery_allow_cpt' ), 10, 2 );
	}

	public static function wpbakery_active() {
		return defined( 'WPB_VC_VERSION' ) || class_exists( 'Vc_Manager' );
	}

	public static function elementor_active() {
		return did_action( 'elementor/loaded' ) || class_exists( '\\Elementor\\Plugin' );
	}

	/**
	 * WP Bakery asks, per post type, whether it may run. Say yes for ours.
	 *
	 * @param bool   $valid
	 * @param string $type
	 * @return bool
	 */
	public static function wpbakery_allow_cpt( $valid, $type ) {
		return ( OCPOP_CPT === $type ) ? true : $valid;
	}

	/**
	 * Add our CPT to Elementor's list of editable post types (non-destructive).
	 * Elementor stores this as the option `elementor_cpt_support`; if it is
	 * unset Elementor defaults to page + post, so we seed those too.
	 */
	public static function enable_builder_support() {
		if ( ! self::elementor_active() ) {
			return;
		}
		$supported = get_option( 'elementor_cpt_support' );
		if ( ! is_array( $supported ) ) {
			$supported = array( 'page', 'post' );
		}
		if ( ! in_array( OCPOP_CPT, $supported, true ) ) {
			$supported[] = OCPOP_CPT;
			update_option( 'elementor_cpt_support', $supported );
		}
	}

	/**
	 * Render a popup body for display on the frontend.
	 *
	 * @param int $popup_id
	 * @return string HTML.
	 */
	public static function render_content( $popup_id ) {
		$post = get_post( $popup_id );
		if ( ! $post || OCPOP_CPT !== $post->post_type ) {
			return '';
		}

		// Elementor-built content: use Elementor's own renderer (also enqueues
		// the required CSS for this document).
		if ( self::elementor_active() ) {
			$plugin = \Elementor\Plugin::$instance;
			if ( isset( $plugin->documents ) ) {
				$doc = $plugin->documents->get( $popup_id );
				if ( $doc && $doc->is_built_with_elementor() ) {
					return $plugin->frontend->get_builder_content_for_display( $popup_id, true );
				}
			}
		}

		// WP Bakery / Gutenberg / classic: run the standard content filters,
		// which execute shortcodes (including WP Bakery's) and blocks.
		$content = apply_filters( 'the_content', $post->post_content );

		// WP Bakery stores the page's design custom CSS in this meta; inline it
		// so the popup matches the builder preview.
		if ( self::wpbakery_active() ) {
			$css = get_post_meta( $popup_id, '_wpb_shortcodes_custom_css', true );
			if ( $css ) {
				$content = '<style>' . wp_strip_all_tags( $css ) . '</style>' . $content;
			}
		}

		return $content;
	}

	/**
	 * Ensure builder frontend assets are present on pages that show a popup.
	 * (Both builders normally enqueue site-wide, but be defensive.)
	 */
	public static function enqueue_builder_assets() {
		if ( self::wpbakery_active() && wp_style_is( 'js_composer_front', 'registered' ) ) {
			wp_enqueue_style( 'js_composer_front' );
		}
	}
}
