<?php
/**
 * WooCommerce bridge.
 *
 * The site uses WooCommerce as the system of record for sellable products and
 * for receipts/order emails. This class:
 *   - detects WooCommerce and nudges the admin if it's missing;
 *   - provisions + price-syncs the catalogue products the plugin owns
 *     (currently the paid consultation; design + subscriptions follow);
 *   - creates a real Woo order for a consultation booking and hands the
 *     customer to Woo checkout, so Woo takes payment and sends the receipt;
 *   - fulfils the booking (client/project/calendar/.ics) once the order is
 *     paid, by calling the existing HGD_Booking_Page::fulfil_booking().
 *
 * No bespoke Stripe form is used when Woo is active — Woo's own payment
 * gateway handles the card payment and the confirmation email.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Woo {

	/** Option storing the consultation product id. */
	const OPT_CONSULT_PID = 'hgd_woo_consultation_pid';

	public static function init() {
		// Fulfil consultation bookings once their Woo order is paid.
		add_action( 'woocommerce_order_status_processing', array( __CLASS__, 'maybe_fulfil_order' ) );
		add_action( 'woocommerce_order_status_completed', array( __CLASS__, 'maybe_fulfil_order' ) );

		// Keep the consultation product price in step with the fee setting.
		add_action( 'update_option_hgd_settings', array( __CLASS__, 'sync_consultation_price' ), 10, 0 );

		// Nudge if WooCommerce is expected but missing.
		add_action( 'admin_notices', array( __CLASS__, 'maybe_admin_notice' ) );
	}

	/** Is WooCommerce active? */
	public static function is_active() {
		return class_exists( 'WooCommerce' ) && function_exists( 'wc_create_order' );
	}

	/**
	 * The consultation product id, creating the product the first time.
	 * Returns 0 if WooCommerce is unavailable.
	 */
	public static function consultation_product_id() {
		if ( ! self::is_active() ) {
			return 0;
		}

		$pid = (int) get_option( self::OPT_CONSULT_PID, 0 );
		if ( $pid && ( $p = wc_get_product( $pid ) ) && 'trash' !== $p->get_status() ) {
			return $pid;
		}

		$fee = (float) HGD_Settings::get( 'consultation_fee_gbp', 200 );

		$product = new WC_Product_Simple();
		$product->set_name( __( 'Garden design consultation', 'hillcroft-garden-designer' ) );
		$product->set_status( 'publish' );
		$product->set_catalog_visibility( 'hidden' ); // sold via the booking flow, not the shop
		$product->set_virtual( true );
		$product->set_sold_individually( true );
		$product->set_regular_price( (string) $fee );
		$product->set_price( (string) $fee );
		$product->set_description( __( 'On-site garden design consultation. Booked and paid online; the fee secures your visit.', 'hillcroft-garden-designer' ) );
		$product->update_meta_data( '_hgd_managed', 'consultation' );
		$pid = (int) $product->save();

		if ( $pid ) {
			update_option( self::OPT_CONSULT_PID, $pid );
		}
		return $pid;
	}

	/** Keep the consultation product price equal to the configured fee. */
	public static function sync_consultation_price() {
		if ( ! self::is_active() ) {
			return;
		}
		$pid = (int) get_option( self::OPT_CONSULT_PID, 0 );
		if ( ! $pid ) {
			return;
		}
		$product = wc_get_product( $pid );
		if ( ! $product ) {
			return;
		}
		$fee = (string) (float) HGD_Settings::get( 'consultation_fee_gbp', 200 );
		if ( (string) $product->get_regular_price() !== $fee ) {
			$product->set_regular_price( $fee );
			$product->set_price( $fee );
			$product->save();
		}
	}

	/**
	 * Create a Woo order for a consultation booking and return it.
	 *
	 * @param array $booking A booking row (must include id, name, email, …).
	 * @return WC_Order|WP_Error
	 */
	public static function create_consultation_order( array $booking ) {
		if ( ! self::is_active() ) {
			return new WP_Error( 'hgd_woo_inactive', __( 'WooCommerce is not active.', 'hillcroft-garden-designer' ) );
		}

		$pid = self::consultation_product_id();
		$product = $pid ? wc_get_product( $pid ) : null;
		if ( ! $product ) {
			return new WP_Error( 'hgd_woo_no_product', __( 'Could not find the consultation product.', 'hillcroft-garden-designer' ) );
		}

		// Make sure the price reflects the current fee before we add it.
		self::sync_consultation_price();
		$product = wc_get_product( $pid );

		$order = wc_create_order();
		if ( is_wp_error( $order ) ) {
			return $order;
		}

		$order->add_product( $product, 1 );

		$parts = preg_split( '/\s+/', trim( (string) $booking['name'] ), 2 );
		$first = isset( $parts[0] ) ? $parts[0] : '';
		$last  = isset( $parts[1] ) ? $parts[1] : '';

		$order->set_billing_first_name( $first );
		$order->set_billing_last_name( $last );
		$order->set_billing_email( (string) $booking['email'] );
		if ( ! empty( $booking['phone'] ) ) {
			$order->set_billing_phone( (string) $booking['phone'] );
		}
		if ( ! empty( $booking['address'] ) ) {
			$order->set_billing_address_1( (string) $booking['address'] );
		}
		if ( ! empty( $booking['postcode'] ) ) {
			$order->set_billing_postcode( (string) $booking['postcode'] );
		}

		$order->update_meta_data( '_hgd_kind', 'consultation' );
		$order->update_meta_data( '_hgd_booking_id', (int) $booking['id'] );
		$order->set_created_via( 'hillcroft-booking' );
		$order->calculate_totals();
		$order->save();

		return $order;
	}

	/**
	 * On a paid Woo order, fulfil the linked consultation booking.
	 * Idempotent — fulfil_booking() ignores an already-paid booking.
	 */
	public static function maybe_fulfil_order( $order_id ) {
		if ( ! self::is_active() ) {
			return;
		}
		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			return;
		}
		if ( 'consultation' !== (string) $order->get_meta( '_hgd_kind' ) ) {
			return;
		}
		$booking_id = (int) $order->get_meta( '_hgd_booking_id' );
		if ( ! $booking_id ) {
			return;
		}
		$booking = HGD_Booking::get( $booking_id );
		if ( $booking ) {
			HGD_Booking_Page::fulfil_booking( $booking );
		}
	}

	/** Admin notice if the plugin's commerce features need WooCommerce. */
	public static function maybe_admin_notice() {
		if ( self::is_active() || ! current_user_can( 'activate_plugins' ) ) {
			return;
		}
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( ! $screen || false === strpos( (string) $screen->id, 'hgd' ) ) {
			return;
		}
		echo '<div class="notice notice-warning"><p>'
			. esc_html__( 'Hillcroft Garden Designer uses WooCommerce for paid consultations and receipts. Please install and activate WooCommerce to take payments and send order confirmations.', 'hillcroft-garden-designer' )
			. '</p></div>';
	}
}
