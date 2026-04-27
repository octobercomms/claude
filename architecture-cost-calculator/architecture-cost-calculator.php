<?php
/**
 * Plugin Name:  Architecture Cost Calculator
 * Plugin URI:   https://octobercomms.co.uk
 * Description:  Residential construction cost calculator. Embed with [arch_cost_calculator].
 * Version:      1.0.0
 * Author:       October Communications
 * Author URI:   https://octobercomms.co.uk
 * License:      GPL-2.0+
 * License URI:  https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:  architecture-cost-calculator
 * Requires at least: 6.0
 * Requires PHP: 8.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ACC_VERSION',    '1.0.0' );
define( 'ACC_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'ACC_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

require_once ACC_PLUGIN_DIR . 'includes/class-acc-calculator.php';
require_once ACC_PLUGIN_DIR . 'includes/class-acc-shortcode.php';

if ( is_admin() ) {
	require_once ACC_PLUGIN_DIR . 'includes/class-acc-admin.php';
	new ACC_Admin();
}

new ACC_Shortcode();
