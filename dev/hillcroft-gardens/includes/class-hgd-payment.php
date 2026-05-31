<?php
/**
 * Payment model — milestone payments within a proposal (hgd_payments table).
 *
 * Each proposal generates three milestones (deposit / commencement / completion).
 * A milestone is 'due' until its Stripe PaymentIntent succeeds, at which point the
 * webhook marks it 'paid'. Amounts are always recomputed/stored server-side; the
 * client never supplies an amount.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Payment {

	/** Ordered milestone labels. */
	const MILESTONES = array(
		'deposit'      => 'Deposit on signing',
		'commencement' => 'On commencement',
		'completion'   => 'On completion',
	);

	public static function milestone_label( $milestone ) {
		return isset( self::MILESTONES[ $milestone ] ) ? self::MILESTONES[ $milestone ] : ucfirst( (string) $milestone );
	}

	// -------------------------------------------------------------------------
	// CRUD
	// -------------------------------------------------------------------------

	public static function get( $id ) {
		global $wpdb;
		$table = HGD_DB::payments_table();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", (int) $id ), ARRAY_A );
	}

	/** All payments for a proposal, ordered by sort_order then id. */
	public static function for_proposal( $proposal_id ) {
		global $wpdb;
		$table = HGD_DB::payments_table();
		$rows  = $wpdb->get_results( $wpdb->prepare(
			"SELECT * FROM {$table} WHERE proposal_id = %d ORDER BY sort_order ASC, id ASC",
			(int) $proposal_id
		), ARRAY_A );
		return $rows ? $rows : array();
	}

	/**
	 * Insert a payment row.
	 *
	 * @param array $data proposal_id, project_id, milestone, label, amount_gbp, status, sort_order, due_at
	 * @return int New payment id.
	 */
	public static function create( array $data ) {
		global $wpdb;
		$now      = current_time( 'mysql' );
		$milestone = isset( $data['milestone'] ) && isset( self::MILESTONES[ $data['milestone'] ] ) ? $data['milestone'] : 'deposit';

		$row = array(
			'proposal_id'           => isset( $data['proposal_id'] ) ? (int) $data['proposal_id'] : 0,
			'project_id'            => isset( $data['project_id'] ) ? (int) $data['project_id'] : null,
			'milestone'             => $milestone,
			'label'                 => isset( $data['label'] ) ? sanitize_text_field( $data['label'] ) : self::milestone_label( $milestone ),
			'amount_gbp'            => isset( $data['amount_gbp'] ) ? round( (float) $data['amount_gbp'], 2 ) : 0,
			'status'                => isset( $data['status'] ) && 'paid' === $data['status'] ? 'paid' : 'due',
			'stripe_payment_intent' => isset( $data['stripe_payment_intent'] ) ? sanitize_text_field( $data['stripe_payment_intent'] ) : '',
			'sort_order'            => isset( $data['sort_order'] ) ? (int) $data['sort_order'] : 0,
			'due_at'                => isset( $data['due_at'] ) ? $data['due_at'] : null,
			'created_at'            => $now,
			'updated_at'            => $now,
		);

		$wpdb->insert( HGD_DB::payments_table(), $row );
		return (int) $wpdb->insert_id;
	}

	/**
	 * Update a payment.
	 *
	 * @param array $clean Already-sanitised key => value pairs.
	 */
	public static function update( $id, array $clean ) {
		global $wpdb;
		$clean['updated_at'] = current_time( 'mysql' );
		return false !== $wpdb->update( HGD_DB::payments_table(), $clean, array( 'id' => (int) $id ) );
	}

	public static function delete( $id ) {
		global $wpdb;
		return false !== $wpdb->delete( HGD_DB::payments_table(), array( 'id' => (int) $id ) );
	}

	/** Find a payment by its stored Stripe PaymentIntent id. */
	public static function find_by_payment_intent( $pi ) {
		global $wpdb;
		$pi = sanitize_text_field( (string) $pi );
		if ( '' === $pi ) {
			return null;
		}
		$table = HGD_DB::payments_table();
		return $wpdb->get_row( $wpdb->prepare(
			"SELECT * FROM {$table} WHERE stripe_payment_intent = %s LIMIT 1",
			$pi
		), ARRAY_A );
	}

	/** Mark a payment paid, recording the PaymentIntent id and paid timestamp. */
	public static function mark_paid( $id, $pi_id ) {
		return self::update( (int) $id, array(
			'status'                => 'paid',
			'stripe_payment_intent' => sanitize_text_field( (string) $pi_id ),
			'paid_at'               => current_time( 'mysql' ),
		) );
	}

	/** True when every payment for the proposal is paid (and at least one exists). */
	public static function all_paid( $proposal_id ) {
		$rows = self::for_proposal( $proposal_id );
		if ( empty( $rows ) ) {
			return false;
		}
		foreach ( $rows as $row ) {
			if ( 'paid' !== $row['status'] ) {
				return false;
			}
		}
		return true;
	}

	/** The deposit milestone for a proposal, or null. */
	public static function deposit_for_proposal( $proposal_id ) {
		global $wpdb;
		$table = HGD_DB::payments_table();
		return $wpdb->get_row( $wpdb->prepare(
			"SELECT * FROM {$table} WHERE proposal_id = %d AND milestone = 'deposit' ORDER BY id ASC LIMIT 1",
			(int) $proposal_id
		), ARRAY_A );
	}
}
