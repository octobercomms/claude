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

	/** Option storing the design-service product id (used for proposal milestones). */
	const OPT_DESIGN_PID = 'hgd_woo_design_pid';

	/** Option storing the maintenance-plan product id (used to mirror Stripe invoices). */
	const OPT_MAINT_PID = 'hgd_woo_maintenance_pid';

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
	 * The design-service product id, creating it the first time. Priced per
	 * order line (the milestone amount), so its base price is 0. Returns 0 if
	 * WooCommerce is unavailable.
	 */
	public static function design_product_id() {
		if ( ! self::is_active() ) {
			return 0;
		}

		$pid = (int) get_option( self::OPT_DESIGN_PID, 0 );
		if ( $pid && ( $p = wc_get_product( $pid ) ) && 'trash' !== $p->get_status() ) {
			return $pid;
		}

		$product = new WC_Product_Simple();
		$product->set_name( __( 'Garden design service', 'hillcroft-garden-designer' ) );
		$product->set_status( 'publish' );
		$product->set_catalog_visibility( 'hidden' ); // billed per project via proposals, not the shop
		$product->set_virtual( true );
		$product->set_regular_price( '0' );
		$product->set_price( '0' );
		$product->set_description( __( 'Bespoke garden design & installation, billed per project against an accepted proposal.', 'hillcroft-garden-designer' ) );
		$product->update_meta_data( '_hgd_managed', 'design' );
		$pid = (int) $product->save();

		if ( $pid ) {
			update_option( self::OPT_DESIGN_PID, $pid );
		}
		return $pid;
	}

	/**
	 * Create a Woo order for one proposal milestone, priced at the milestone
	 * amount, with the line named for the milestone + project. Woo takes the
	 * payment and sends the receipt; we fulfil on order-paid.
	 *
	 * @param array $payment  An HGD_Payment row.
	 * @param array $proposal An HGD_Proposal row.
	 * @return WC_Order|WP_Error
	 */
	public static function create_milestone_order( array $payment, array $proposal ) {
		if ( ! self::is_active() ) {
			return new WP_Error( 'hgd_woo_inactive', __( 'WooCommerce is not active.', 'hillcroft-garden-designer' ) );
		}

		$pid     = self::design_product_id();
		$product = $pid ? wc_get_product( $pid ) : null;
		if ( ! $product ) {
			return new WP_Error( 'hgd_woo_no_product', __( 'Could not find the design-service product.', 'hillcroft-garden-designer' ) );
		}

		$amount  = round( (float) $payment['amount_gbp'], 2 );
		$project = ! empty( $proposal['project_id'] ) ? HGD_Project::get( (int) $proposal['project_id'] ) : null;
		$client  = ( $project && ! empty( $project['client_id'] ) ) ? HGD_Client::get( (int) $project['client_id'] ) : null;
		$title   = $project ? (string) $project['title'] : __( 'Garden design', 'hillcroft-garden-designer' );

		$order   = wc_create_order();
		if ( is_wp_error( $order ) ) {
			return $order;
		}

		$item_id = $order->add_product( $product, 1 );
		$item    = $item_id ? $order->get_item( $item_id ) : null;
		if ( $item ) {
			$item->set_name( sprintf( '%s — %s', (string) $payment['label'], $title ) );
			$item->set_subtotal( $amount );
			$item->set_total( $amount );
			$item->save();
		}

		if ( $client ) {
			$order->set_billing_first_name( (string) $client['first_name'] );
			$order->set_billing_last_name( (string) $client['last_name'] );
			if ( ! empty( $client['email'] ) ) {
				$order->set_billing_email( (string) $client['email'] );
			}
			if ( ! empty( $client['phone'] ) ) {
				$order->set_billing_phone( (string) $client['phone'] );
			}
			if ( ! empty( $client['postcode'] ) ) {
				$order->set_billing_postcode( (string) $client['postcode'] );
			}
		}

		$order->update_meta_data( '_hgd_kind', 'payment' );
		$order->update_meta_data( '_hgd_payment_id', (int) $payment['id'] );
		$order->update_meta_data( '_hgd_proposal_id', (int) $proposal['id'] );
		$order->set_created_via( 'hillcroft-proposal' );
		$order->calculate_totals();
		$order->save();

		return $order;
	}

	/**
	 * The maintenance-plan product id, creating it the first time. Priced per
	 * order line (the invoice amount), so its base price is 0. Returns 0 if
	 * WooCommerce is unavailable.
	 */
	public static function maintenance_product_id() {
		if ( ! self::is_active() ) {
			return 0;
		}

		$pid = (int) get_option( self::OPT_MAINT_PID, 0 );
		if ( $pid && ( $p = wc_get_product( $pid ) ) && 'trash' !== $p->get_status() ) {
			return $pid;
		}

		$product = new WC_Product_Simple();
		$product->set_name( __( 'Garden maintenance plan', 'hillcroft-garden-designer' ) );
		$product->set_status( 'publish' );
		$product->set_catalog_visibility( 'hidden' ); // billed by Stripe Billing, not the shop
		$product->set_virtual( true );
		$product->set_regular_price( '0' );
		$product->set_price( '0' );
		$product->set_description( __( 'Recurring garden maintenance plan, billed monthly via Stripe.', 'hillcroft-garden-designer' ) );
		$product->update_meta_data( '_hgd_managed', 'maintenance' );
		$pid = (int) $product->save();

		if ( $pid ) {
			update_option( self::OPT_MAINT_PID, $pid );
		}
		return $pid;
	}

	/**
	 * Mirror a paid Stripe invoice into a completed Woo order, so Woo keeps the
	 * record and sends a receipt. Idempotent: an invoice already mirrored is
	 * skipped (matched on the stored Stripe invoice id).
	 *
	 * @param array $subscription An HGD_Subscription row.
	 * @param array $invoice      The Stripe invoice object from the webhook.
	 * @return WC_Order|WP_Error|null Order, error, or null when skipped.
	 */
	public static function create_subscription_invoice_order( $subscription, array $invoice ) {
		if ( ! self::is_active() ) {
			return new WP_Error( 'hgd_woo_inactive', __( 'WooCommerce is not active.', 'hillcroft-garden-designer' ) );
		}
		if ( ! is_array( $subscription ) ) {
			return new WP_Error( 'hgd_woo_no_sub', __( 'Missing subscription.', 'hillcroft-garden-designer' ) );
		}

		$invoice_id = isset( $invoice['id'] ) ? sanitize_text_field( (string) $invoice['id'] ) : '';

		// Idempotency: don't mirror the same invoice twice.
		if ( '' !== $invoice_id ) {
			$existing = wc_get_orders( array(
				'limit'      => 1,
				'return'     => 'ids',
				'meta_key'   => '_hgd_stripe_invoice',
				'meta_value' => $invoice_id,
			) );
			if ( ! empty( $existing ) ) {
				return null;
			}
		}

		$pid     = self::maintenance_product_id();
		$product = $pid ? wc_get_product( $pid ) : null;
		if ( ! $product ) {
			return new WP_Error( 'hgd_woo_no_product', __( 'Could not find the maintenance-plan product.', 'hillcroft-garden-designer' ) );
		}

		// Amount actually paid (pence → pounds), falling back to the plan price.
		$amount = isset( $invoice['amount_paid'] )
			? round( (int) $invoice['amount_paid'] / 100, 2 )
			: round( (float) $subscription['amount_gbp'], 2 );

		$order = wc_create_order();
		if ( is_wp_error( $order ) ) {
			return $order;
		}

		$item_id = $order->add_product( $product, 1 );
		$item    = $item_id ? $order->get_item( $item_id ) : null;
		if ( $item ) {
			$label = sprintf(
				/* translators: %s: plan name */
				__( '%s — monthly maintenance', 'hillcroft-garden-designer' ),
				(string) $subscription['plan_label']
			);
			$item->set_name( $label );
			$item->set_subtotal( $amount );
			$item->set_total( $amount );
			$item->save();
		}

		$parts = preg_split( '/\s+/', trim( (string) $subscription['name'] ), 2 );
		$order->set_billing_first_name( isset( $parts[0] ) ? $parts[0] : '' );
		$order->set_billing_last_name( isset( $parts[1] ) ? $parts[1] : '' );
		if ( ! empty( $subscription['email'] ) ) {
			$order->set_billing_email( (string) $subscription['email'] );
		}
		if ( ! empty( $subscription['phone'] ) ) {
			$order->set_billing_phone( (string) $subscription['phone'] );
		}
		if ( ! empty( $subscription['postcode'] ) ) {
			$order->set_billing_postcode( (string) $subscription['postcode'] );
		}

		$order->update_meta_data( '_hgd_kind', 'subscription' );
		$order->update_meta_data( '_hgd_subscription_id', (int) $subscription['id'] );
		if ( '' !== $invoice_id ) {
			$order->update_meta_data( '_hgd_stripe_invoice', $invoice_id );
		}
		$order->set_created_via( 'hillcroft-subscription' );
		$order->set_payment_method_title( 'Stripe (subscription)' );
		$order->calculate_totals();

		// Record the payment (sets paid date + sends the Woo receipt email).
		$txn = isset( $invoice['payment_intent'] ) ? (string) $invoice['payment_intent'] : $invoice_id;
		$order->payment_complete( $txn );
		$order->save();

		return $order;
	}

	/**
	 * On a paid Woo order, fulfil the linked Hillcroft record.
	 * Idempotent — the underlying fulfilment ignores already-paid records.
	 */
	public static function maybe_fulfil_order( $order_id ) {
		if ( ! self::is_active() ) {
			return;
		}
		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			return;
		}

		$kind = (string) $order->get_meta( '_hgd_kind' );

		if ( 'consultation' === $kind ) {
			$booking_id = (int) $order->get_meta( '_hgd_booking_id' );
			$booking    = $booking_id ? HGD_Booking::get( $booking_id ) : null;
			if ( $booking ) {
				HGD_Booking_Page::fulfil_booking( $booking );
			}
			return;
		}

		if ( 'payment' === $kind ) {
			$payment_id = (int) $order->get_meta( '_hgd_payment_id' );
			if ( $payment_id ) {
				// Woo sends the receipt — suppress the bespoke one to avoid duplicates.
				HGD_Booking_Page::fulfil_payment( $payment_id, '', false );
			}
			return;
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
