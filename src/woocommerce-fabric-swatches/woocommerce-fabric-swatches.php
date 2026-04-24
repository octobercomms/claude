<?php
/**
 * Plugin Name: WooCommerce Fabric Swatches
 * Plugin URI:  https://anothercountry.com
 * Description: Adds a right-side fabric swatch drawer to WooCommerce product pages, with swatches organised by price category groups.
 * Version:     1.0.0
 * Author:      Another Country
 * Text Domain: wc-fabric-swatches
 * Requires at least: 5.8
 * Requires PHP: 7.4
 * WC requires at least: 6.0
 */

defined( 'ABSPATH' ) || exit;

define( 'WC_FABRIC_SWATCHES_VERSION', '1.0.0' );
define( 'WC_FABRIC_SWATCHES_PATH', plugin_dir_path( __FILE__ ) );
define( 'WC_FABRIC_SWATCHES_URL', plugin_dir_url( __FILE__ ) );

function wc_fabric_swatches_init() {
	if ( ! class_exists( 'WooCommerce' ) ) {
		add_action( 'admin_notices', function () {
			echo '<div class="notice notice-error"><p>'
				. esc_html__( 'WooCommerce Fabric Swatches requires WooCommerce to be installed and active.', 'wc-fabric-swatches' )
				. '</p></div>';
		} );
		return;
	}

	require_once WC_FABRIC_SWATCHES_PATH . 'includes/class-wc-fabric-swatches.php';
	WC_Fabric_Swatches::instance();
}
add_action( 'plugins_loaded', 'wc_fabric_swatches_init' );
