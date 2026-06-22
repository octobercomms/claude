<?php
/**
 * Plugin Name: Variant Showcase
 * Plugin URI:  https://github.com/octobercomms/claude
 * Description: Show selected product variations as their own cards on shop/category pages, each with an optional lifestyle image that fades in on hover. Per-product control: keep the normal single card, expand chosen variations into separate cards, or feature one variation — so sofas (seat counts) and dining tables (sizes/shapes) can each expose just the variations that matter.
 * Version:     1.0.4
 * Author:      October Comms
 * Author URI:  https://octobercomms.com
 * License:     GPL v2 or later
 * Text Domain: variant-showcase
 * Requires at least: 6.0
 * Requires PHP: 8.0
 * WC requires at least: 7.0
 */

defined( 'ABSPATH' ) || exit;

define( 'ACVS_VERSION', '1.0.4' );
define( 'ACVS_PATH', plugin_dir_path( __FILE__ ) );
define( 'ACVS_URL', plugin_dir_url( __FILE__ ) );
define( 'ACVS_BASENAME', plugin_basename( __FILE__ ) );

// Meta keys (shared between admin save and front-end read).
define( 'ACVS_META_MODE', '_acvs_mode' );             // Product-level catalog mode: default|expand|single.
define( 'ACVS_META_SINGLE', '_acvs_single_variation' ); // Product-level: variation ID to feature (single mode).
define( 'ACVS_META_SHOW', '_acvs_show_in_catalog' );  // Variation-level: 'yes' to expose as its own card.
define( 'ACVS_META_LIFESTYLE', '_acvs_lifestyle_image_id' ); // Product- or variation-level lifestyle image ID.

require_once ACVS_PATH . 'includes/class-acvs-admin.php';
require_once ACVS_PATH . 'includes/class-acvs-catalog.php';

// Bootstrap once WordPress + WooCommerce are loaded.
add_action( 'plugins_loaded', function () {
	if ( ! class_exists( 'WooCommerce' ) ) {
		add_action( 'admin_notices', function () {
			echo '<div class="notice notice-error"><p>' .
				esc_html__( 'Variant Showcase requires WooCommerce to be active.', 'variant-showcase' ) .
				'</p></div>';
		} );
		return;
	}

	new ACVS_Admin();
	new ACVS_Catalog();
} );

// Declare HPOS / custom order tables compatibility (this plugin stores no order data,
// but declaring keeps WooCommerce from flagging it as incompatible).
add_action( 'before_woocommerce_init', function () {
	if ( class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
		\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
	}
} );
