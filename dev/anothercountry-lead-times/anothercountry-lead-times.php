<?php
/**
 * Plugin Name: Another Country Lead Times
 * Plugin URI:  https://github.com/octobercomms/claude
 * Description: Central, supplier-based lead-time manager for Another Country. Set delivery lead times once per supplier/workshop, attach products to suppliers, and have the notice update everywhere automatically — with out-of-stock and seasonal (e.g. summer shutdown) variations, plus per-product overrides.
 * Version:     1.0.0
 * Author:      October Comms
 * Author URI:  https://octobercomms.com
 * License:     GPL v2 or later
 * Text Domain: anothercountry-lead-times
 * Requires at least: 6.0
 * Requires PHP: 8.0
 * WC requires at least: 7.0
 */

defined( 'ABSPATH' ) || exit;

define( 'ACLT_VERSION', '1.0.0' );
define( 'ACLT_PATH', plugin_dir_path( __FILE__ ) );
define( 'ACLT_URL', plugin_dir_url( __FILE__ ) );
define( 'ACLT_BASENAME', plugin_basename( __FILE__ ) );

// The supplier / workshop taxonomy that products are grouped under.
define( 'ACLT_TAX', 'ac_supplier' );

require_once ACLT_PATH . 'includes/class-aclt-taxonomy.php';
require_once ACLT_PATH . 'includes/class-aclt-product.php';
require_once ACLT_PATH . 'includes/class-aclt-resolver.php';
require_once ACLT_PATH . 'includes/class-aclt-admin.php';
require_once ACLT_PATH . 'includes/class-aclt-display.php';

/**
 * Default settings, merged with the saved option.
 */
function aclt_default_settings(): array {
	return [
		'auto_display' => 1,
		'prefix'       => __( 'Estimated lead time:', 'anothercountry-lead-times' ),
		'fallback'     => '',
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
	new ACLT_Product();
	new ACLT_Admin();
	new ACLT_Display();
} );

// Register the taxonomy on activation and flush rewrite rules.
register_activation_hook( __FILE__, function () {
	require_once ACLT_PATH . 'includes/class-aclt-taxonomy.php';
	ACLT_Taxonomy::register_taxonomy();
	flush_rewrite_rules();
} );

register_deactivation_hook( __FILE__, 'flush_rewrite_rules' );
