<?php
/**
 * Consultation booking model — CRUD over the hgd_bookings table.
 *
 * A booking is created (status `pending`) when a visitor picks a slot, and moves
 * to `paid` once Stripe confirms the £200 consultation payment, at which point a
 * Project is spun up and (if connected) a Google Calendar event is written.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Booking {

	const STATUSES = array(
		'pending'   => 'Pending payment',
		'paid'      => 'Paid',
		'cancelled' => 'Cancelled',
	);

	public static function get( $id ) {
		global $wpdb;
		$t = HGD_DB::bookings_table();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t} WHERE id = %d", $id ), ARRAY_A );
	}

	public static function find_by_payment_intent( $pi ) {
		global $wpdb;
		$t = HGD_DB::bookings_table();
		$pi = sanitize_text_field( $pi );
		if ( '' === $pi ) {
			return null;
		}
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t} WHERE stripe_payment_intent = %s LIMIT 1", $pi ), ARRAY_A );
	}

	/**
	 * @param array $args status, from (Y-m-d H:i:s), to, orderby, order
	 */
	public static function query( array $args = array() ) {
		global $wpdb;
		$t = HGD_DB::bookings_table();
		$args = wp_parse_args( $args, array(
			'status'  => '',
			'from'    => '',
			'to'      => '',
			'orderby' => 'slot_start',
			'order'   => 'ASC',
		) );

		$where  = '1=1';
		$params = array();
		if ( '' !== $args['status'] && isset( self::STATUSES[ $args['status'] ] ) ) {
			$where   .= ' AND status = %s';
			$params[] = $args['status'];
		}
		if ( '' !== $args['from'] ) {
			$where   .= ' AND slot_start >= %s';
			$params[] = $args['from'];
		}
		if ( '' !== $args['to'] ) {
			$where   .= ' AND slot_start <= %s';
			$params[] = $args['to'];
		}

		$orderby = in_array( $args['orderby'], array( 'slot_start', 'created_at', 'status' ), true ) ? $args['orderby'] : 'slot_start';
		$order   = strtoupper( $args['order'] ) === 'DESC' ? 'DESC' : 'ASC';

		$sql  = "SELECT * FROM {$t} WHERE {$where} ORDER BY {$orderby} {$order}";
		$rows = $params ? $wpdb->get_results( $wpdb->prepare( $sql, $params ), ARRAY_A ) : $wpdb->get_results( $sql, ARRAY_A );
		return $rows ? $rows : array();
	}

	/** Paid/pending bookings overlapping a window — used to block taken slots. */
	public static function booked_slots( $from, $to ) {
		global $wpdb;
		$t = HGD_DB::bookings_table();
		return $wpdb->get_results( $wpdb->prepare(
			"SELECT slot_start, slot_end FROM {$t} WHERE status IN ('pending','paid') AND slot_start < %s AND slot_end > %s",
			$to,
			$from
		), ARRAY_A );
	}

	public static function insert( array $data ) {
		global $wpdb;
		$now              = current_time( 'mysql' );
		$data['created_at'] = $now;
		$data['updated_at'] = $now;
		$wpdb->insert( HGD_DB::bookings_table(), $data );
		return (int) $wpdb->insert_id;
	}

	public static function update( $id, array $data ) {
		global $wpdb;
		$data['updated_at'] = current_time( 'mysql' );
		return false !== $wpdb->update( HGD_DB::bookings_table(), $data, array( 'id' => (int) $id ) );
	}

	public static function count( $status = '' ) {
		global $wpdb;
		$t = HGD_DB::bookings_table();
		if ( '' !== $status ) {
			return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$t} WHERE status = %s", $status ) );
		}
		return (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$t}" );
	}

	/** Upcoming paid bookings (for the dashboard). */
	public static function count_upcoming() {
		global $wpdb;
		$t = HGD_DB::bookings_table();
		return (int) $wpdb->get_var( $wpdb->prepare(
			"SELECT COUNT(*) FROM {$t} WHERE status = 'paid' AND slot_start >= %s",
			current_time( 'mysql' )
		) );
	}

	public static function status_label( $status ) {
		return isset( self::STATUSES[ $status ] ) ? self::STATUSES[ $status ] : ucfirst( $status );
	}
}
