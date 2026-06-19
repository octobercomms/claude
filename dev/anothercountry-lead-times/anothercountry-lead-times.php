<?php
/**
 * Plugin Name: Another Country Lead Times
 * Plugin URI:  https://github.com/octobercomms/claude
 * Description: Central, supplier-based lead-time manager for Another Country. Set delivery lead times once per supplier/workshop, attach products to suppliers, and have the notice update everywhere automatically — with out-of-stock and seasonal (e.g. summer shutdown) variations, plus per-product overrides.
 * Version:     1.1.0
 * Author:      October Comms
 * Author URI:  https://octobercomms.com
 * License:     GPL v2 or later
 * Text Domain: anothercountry-lead-times
 * Requires at least: 6.0
 * Requires PHP: 8.0
 * WC requires at least: 7.0
 */

defined( 'ABSPATH' ) || exit;

define( 'ACLT_VERSION', '1.1.0' );
define( 'ACLT_PATH', plugin_dir_path( __FILE__ ) );
define( 'ACLT_URL', plugin_dir_url( __FILE__ ) );
define( 'ACLT_BASENAME', plugin_basename( __FILE__ ) );

// The supplier / workshop taxonomy that products are grouped under.
define( 'ACLT_TAX', 'ac_supplier' );

require_once ACLT_PATH . 'includes/class-aclt-taxonomy.php';
require_once ACLT_PATH . 'includes/class-aclt-assign.php';
require_once ACLT_PATH . 'includes/class-aclt-product.php';
require_once ACLT_PATH . 'includes/class-aclt-resolver.php';
require_once ACLT_PATH . 'includes/class-aclt-stock-label.php';
require_once ACLT_PATH . 'includes/class-aclt-admin.php';
require_once ACLT_PATH . 'includes/class-aclt-display.php';

/**
 * Default settings, merged with the saved option.
 *
 * The defaults are deliberately seeded to reproduce the site's CURRENT
 * behaviour, so that on first activation — before any supplier is configured —
 * every product shows exactly what it shows today. Nothing wrong goes live; the
 * central system only takes over per-supplier as the team fills it in.
 */
function aclt_default_settings(): array {
	return [
		// Display (theme drives the product page; these are for the shortcode /
		// optional standalone notice).
		'auto_display'           => 0,
		'prefix'                 => __( 'Estimated lead time:', 'anothercountry-lead-times' ),

		// Global default lead time — the bottom fallback when a product has no
		// per-product value and no configured supplier. Matches today's fallback.
		'default_lead'           => '8-10 weeks',

		// Global default seasonal note — reproduces the currently hardcoded line.
		'default_season_enabled' => 1,
		'default_season_start'   => '07-01',
		'default_season_end'     => '09-30',
		'default_season_note'    => __( 'Allow up to 15 weeks for orders placed July to September.', 'anothercountry-lead-times' ),

		// Stock label relabelling (absorbs the Woo Custom Stock Status plugin so
		// it can be deactivated). Matches the current live configuration.
		'relabel_stock'          => 1,
		'label_backorder'        => 'Made to Order',
		'label_outofstock'       => 'Out of Stock',
		'label_color'            => '#77a464',
		'label_color_oos'        => '#ff0000',
	];
}

/**
 * Read plugin settings (option `aclt_settings`).
 */
function aclt_get_settings(): array {
	$saved = get_option( 'aclt_settings', [] );
	return wp_parse_args( is_array( $saved ) ? $saved : [], aclt_default_settings() );
}

// Bootstrap once WordPress + WooCommerce are loaded.
add_action( 'plugins_loaded', function () {
	if ( ! class_exists( 'WooCommerce' ) ) {
		add_action( 'admin_notices', function () {
			echo '<div class="notice notice-error"><p>' .
				esc_html__( 'Another Country Lead Times requires WooCommerce to be active.', 'anothercountry-lead-times' ) .
				'</p></div>';
		} );
		return;
	}

	new ACLT_Taxonomy();
	new ACLT_Assign();
	new ACLT_Product();
	new ACLT_Stock_Label();
	new ACLT_Admin();
	new ACLT_Display();
} );

/* -------------------------------------------------------------------------
 * Public API — used by the theme (functions.php trust chips and the product
 * template) so all lead-time wording reads from this one engine.
 * ---------------------------------------------------------------------- */

/** The lead-time figure for a product, e.g. "8-10 weeks". */
function aclt_get_lead_time( $product_id ): string {
	return ACLT_Resolver::get_lead_time( (int) $product_id );
}

/** An optional supplier note (e.g. "from receipt of fabric…"), or ''. */
function aclt_get_lead_time_note( $product_id ): string {
	return ACLT_Resolver::get_lead_time_note( (int) $product_id );
}

/** The active seasonal note (e.g. summer shutdown) for a product, or ''. */
function aclt_get_seasonal_note( $product_id ): string {
	return ACLT_Resolver::get_seasonal_note( (int) $product_id );
}

// Register the taxonomy on activation and flush rewrite rules.
register_activation_hook( __FILE__, function () {
	require_once ACLT_PATH . 'includes/class-aclt-taxonomy.php';
	ACLT_Taxonomy::register_taxonomy();
	flush_rewrite_rules();
} );

register_deactivation_hook( __FILE__, 'flush_rewrite_rules' );
