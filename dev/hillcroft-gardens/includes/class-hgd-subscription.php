<?php
/**
 * Maintenance-plan subscription model (hgd_subscriptions table).
 *
 * Recurring garden-care plans billed by Stripe Billing. Stripe owns the
 * recurring charge, SCA, automatic retries and dunning emails; each successful
 * invoice is mirrored into a WooCommerce order so Woo remains the system of
 * record for receipts. A row here tracks the local view of one subscription:
 * who, which plan, the Stripe ids and the current status / next bill date.
 *
 * Status mirrors Stripe: incomplete → active → past_due → canceled.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Subscription {

	/**
	 * Default maintenance plans. Editable via the `hgd_maintenance_plans`
	 * filter (and overridable per-key from the `maintenance_plans` setting),
	 * so pricing can move without a schema change. Amounts are GBP/month.
	 */
	public static function plans() {
		$defaults = array(
			'essential' => array(
				'label'    => __( 'Essential Care', 'hillcroft-garden-designer' ),
				'price'    => 45.00,
				'interval' => 'month',
				'blurb'    => __( 'Monthly visit — lawn care, edging, weeding and seasonal tidy.', 'hillcroft-garden-designer' ),
				'features' => array(
					__( 'One scheduled visit each month', 'hillcroft-garden-designer' ),
					__( 'Mowing, edging & weeding', 'hillcroft-garden-designer' ),
					__( 'Green-waste removal', 'hillcroft-garden-designer' ),
				),
			),
			'full'      => array(
				'label'    => __( 'Full Care', 'hillcroft-garden-designer' ),
				'price'    => 85.00,
				'interval' => 'month',
				'blurb'    => __( 'Fortnightly visits with planting care and pruning through the seasons.', 'hillcroft-garden-designer' ),
				'features' => array(
					__( 'Two scheduled visits each month', 'hillcroft-garden-designer' ),
					__( 'Everything in Essential Care', 'hillcroft-garden-designer' ),
					__( 'Bed maintenance, pruning & feeding', 'hillcroft-garden-designer' ),
					__( 'Priority booking for extra work', 'hillcroft-garden-designer' ),
				),
			),
			'premium'   => array(
				'label'    => __( 'Premium Care', 'hillcroft-garden-designer' ),
				'price'    => 140.00,
				'interval' => 'month',
				'blurb'    => __( 'Weekly attention with full seasonal planting and a yearly refresh.', 'hillcroft-garden-designer' ),
				'features' => array(
					__( 'Weekly scheduled visits', 'hillcroft-garden-designer' ),
					__( 'Everything in Full Care', 'hillcroft-garden-designer' ),
					__( 'Seasonal planting & containers', 'hillcroft-garden-designer' ),
					__( 'Annual borders refresh', 'hillcroft-garden-designer' ),
				),
			),
		);

		// Per-key price/label overrides from settings (future admin UI), if any.
		$override = HGD_Settings::get( 'maintenance_plans', '' );
		if ( is_array( $override ) ) {
			foreach ( $override as $key => $vals ) {
				if ( isset( $defaults[ $key ] ) && is_array( $vals ) ) {
					$defaults[ $key ] = array_merge( $defaults[ $key ], $vals );
				}
			}
		}

		/**
		 * Filter the available maintenance plans.
		 *
		 * @param array $defaults plan_key => [label, price, interval, blurb, features].
		 */
		return apply_filters( 'hgd_maintenance_plans', $defaults );
	}

	/** A single plan definition by key, or null. */
	public static function plan( $key ) {
		$plans = self::plans();
		return isset( $plans[ $key ] ) ? $plans[ $key ] : null;
	}

	// -------------------------------------------------------------------------
	// CRUD
	// -------------------------------------------------------------------------

	public static function get( $id ) {
		global $wpdb;
		$table = HGD_DB::subscriptions_table();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", (int) $id ), ARRAY_A );
	}

	/** All subscriptions, newest first, optionally filtered by status. */
	public static function all( $status = '' ) {
		global $wpdb;
		$table = HGD_DB::subscriptions_table();
		if ( '' !== $status ) {
			return $wpdb->get_results( $wpdb->prepare(
				"SELECT * FROM {$table} WHERE status = %s ORDER BY id DESC",
				sanitize_text_field( $status )
			), ARRAY_A ) ?: array();
		}
		return $wpdb->get_results( "SELECT * FROM {$table} ORDER BY id DESC", ARRAY_A ) ?: array();
	}

	/**
	 * Insert a subscription row.
	 *
	 * @param array $data plan_key, plan_label, name, email, phone, postcode,
	 *                    amount_gbp, billing_interval, status, client_id, project_id.
	 * @return int New subscription id.
	 */
	public static function create( array $data ) {
		global $wpdb;
		$now = current_time( 'mysql' );

		$row = array(
			'client_id'               => isset( $data['client_id'] ) ? (int) $data['client_id'] : null,
			'project_id'              => isset( $data['project_id'] ) ? (int) $data['project_id'] : null,
			'plan_key'                => isset( $data['plan_key'] ) ? sanitize_text_field( $data['plan_key'] ) : '',
			'plan_label'              => isset( $data['plan_label'] ) ? sanitize_text_field( $data['plan_label'] ) : '',
			'name'                    => isset( $data['name'] ) ? sanitize_text_field( $data['name'] ) : '',
			'email'                   => isset( $data['email'] ) ? sanitize_email( $data['email'] ) : '',
			'phone'                   => isset( $data['phone'] ) ? sanitize_text_field( $data['phone'] ) : '',
			'postcode'                => isset( $data['postcode'] ) ? sanitize_text_field( $data['postcode'] ) : '',
			'amount_gbp'              => isset( $data['amount_gbp'] ) ? round( (float) $data['amount_gbp'], 2 ) : 0,
			'billing_interval'        => isset( $data['billing_interval'] ) ? sanitize_text_field( $data['billing_interval'] ) : 'month',
			'status'                  => isset( $data['status'] ) ? sanitize_text_field( $data['status'] ) : 'incomplete',
			'stripe_customer_id'      => isset( $data['stripe_customer_id'] ) ? sanitize_text_field( $data['stripe_customer_id'] ) : '',
			'stripe_subscription_id'  => isset( $data['stripe_subscription_id'] ) ? sanitize_text_field( $data['stripe_subscription_id'] ) : '',
			'stripe_checkout_session' => isset( $data['stripe_checkout_session'] ) ? sanitize_text_field( $data['stripe_checkout_session'] ) : '',
			'current_period_end'      => isset( $data['current_period_end'] ) ? $data['current_period_end'] : null,
			'created_at'              => $now,
			'updated_at'              => $now,
		);

		$wpdb->insert( HGD_DB::subscriptions_table(), $row );
		return (int) $wpdb->insert_id;
	}

	/**
	 * Update a subscription.
	 *
	 * @param array $clean Already-sanitised key => value pairs.
	 */
	public static function update( $id, array $clean ) {
		global $wpdb;
		$clean['updated_at'] = current_time( 'mysql' );
		return false !== $wpdb->update( HGD_DB::subscriptions_table(), $clean, array( 'id' => (int) $id ) );
	}

	/** Find a subscription by its Stripe Checkout Session id. */
	public static function find_by_session( $session_id ) {
		global $wpdb;
		$session_id = sanitize_text_field( (string) $session_id );
		if ( '' === $session_id ) {
			return null;
		}
		$table = HGD_DB::subscriptions_table();
		return $wpdb->get_row( $wpdb->prepare(
			"SELECT * FROM {$table} WHERE stripe_checkout_session = %s LIMIT 1",
			$session_id
		), ARRAY_A );
	}

	/** Find a subscription by its Stripe Subscription id. */
	public static function find_by_stripe_id( $sub_id ) {
		global $wpdb;
		$sub_id = sanitize_text_field( (string) $sub_id );
		if ( '' === $sub_id ) {
			return null;
		}
		$table = HGD_DB::subscriptions_table();
		return $wpdb->get_row( $wpdb->prepare(
			"SELECT * FROM {$table} WHERE stripe_subscription_id = %s LIMIT 1",
			$sub_id
		), ARRAY_A );
	}

	/** Human label for a status. */
	public static function status_label( $status ) {
		$map = array(
			'incomplete' => __( 'Awaiting payment', 'hillcroft-garden-designer' ),
			'active'     => __( 'Active', 'hillcroft-garden-designer' ),
			'past_due'   => __( 'Payment failed', 'hillcroft-garden-designer' ),
			'canceled'   => __( 'Cancelled', 'hillcroft-garden-designer' ),
		);
		return isset( $map[ $status ] ) ? $map[ $status ] : ucfirst( (string) $status );
	}
}
