<?php
defined( 'ABSPATH' ) || exit;

class WC_Fabric_Swatches {

	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		require_once WC_FABRIC_SWATCHES_PATH . 'includes/class-wc-fabric-swatches-admin.php';
		require_once WC_FABRIC_SWATCHES_PATH . 'includes/class-wc-fabric-swatches-frontend.php';

		new WC_Fabric_Swatches_Admin();
		new WC_Fabric_Swatches_Frontend();
	}
}
