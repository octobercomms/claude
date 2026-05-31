<?php
/**
 * Proposal model — a sent, payable presentation of a chosen quote (hgd_proposals).
 *
 * A proposal snapshots a quote's total, carries an intro + terms, an unguessable
 * 64-char token (its only credential on the public portal), a deposit definition,
 * and an expiry. Accepting + signing it, then paying milestones, drives the
 * project lifecycle forward.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Proposal {

	/** Ordered status labels. */
	const STATUSES = array(
		'draft'        => 'Draft',
		'sent'         => 'Sent',
		'viewed'       => 'Viewed',
		'accepted'     => 'Accepted',
		'deposit_paid' => 'Deposit paid',
		'complete'     => 'Complete',
		'expired'      => 'Expired',
	);

	public static function status_label( $status ) {
		return isset( self::STATUSES[ $status ] ) ? self::STATUSES[ $status ] : ucfirst( (string) $status );
	}

	// -------------------------------------------------------------------------
	// CRUD
	// -------------------------------------------------------------------------

	public static function get( $id ) {
		global $wpdb;
		$table = HGD_DB::proposals_table();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", (int) $id ), ARRAY_A );
	}

	/** Load a proposal by its public token. */
	public static function get_by_token( $token ) {
		global $wpdb;
		$token = preg_replace( '/[^A-Za-z0-9]/', '', (string) $token );
		if ( strlen( $token ) < 32 ) {
			return null;
		}
		$table = HGD_DB::proposals_table();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE token = %s LIMIT 1", $token ), ARRAY_A );
	}

	/** The most recent proposal for a project, or null. */
	public static function for_project( $project_id ) {
		global $wpdb;
		$table = HGD_DB::proposals_table();
		return $wpdb->get_row( $wpdb->prepare(
			"SELECT * FROM {$table} WHERE project_id = %d ORDER BY id DESC LIMIT 1",
			(int) $project_id
		), ARRAY_A );
	}

	/**
	 * Create a proposal from a chosen quote.
	 *
	 * Snapshots the quote total, seeds the deposit from settings, sets an expiry
	 * and default terms. Status starts 'draft'.
	 *
	 * @return int New proposal id (0 on failure).
	 */
	public static function create( $project_id, $quote_id, array $overrides = array() ) {
		global $wpdb;

		$quote = HGD_Quote::get( $quote_id );
		if ( ! $quote || (int) $quote['project_id'] !== (int) $project_id ) {
			return 0;
		}

		$totals       = HGD_Quote::compute( $quote_id );
		$total        = round( (float) $totals['total_rounded'], 2 );
		$deposit_pct  = (float) HGD_Settings::get( 'deposit_pct', 50 );
		$expiry_days  = max( 1, (int) HGD_Settings::get( 'proposal_expiry_days', 30 ) );
		$now          = current_time( 'mysql' );
		$expires_at   = gmdate( 'Y-m-d H:i:s', strtotime( $now . ' +' . $expiry_days . ' days' ) );

		$data = array(
			'project_id'     => (int) $project_id,
			'quote_id'       => (int) $quote_id,
			'token'          => self::generate_token(),
			'status'         => 'draft',
			'total_gbp'      => $total,
			'deposit_type'   => 'pct',
			'deposit_value'  => round( $deposit_pct, 2 ),
			'intro_text'     => '',
			'terms_text'     => (string) HGD_Settings::get( 'terms_default', '' ),
			'signature_name' => '',
			'expires_at'     => $expires_at,
			'created_at'     => $now,
			'updated_at'     => $now,
		);

		foreach ( $overrides as $key => $value ) {
			if ( array_key_exists( $key, $data ) && 'token' !== $key ) {
				$data[ $key ] = $value;
			}
		}

		$wpdb->insert( HGD_DB::proposals_table(), $data );
		return (int) $wpdb->insert_id;
	}

	/** Generate a unique 64-char alphanumeric token. */
	private static function generate_token() {
		global $wpdb;
		$table = HGD_DB::proposals_table();
		for ( $i = 0; $i < 5; $i++ ) {
			$token  = wp_generate_password( 64, false );
			$exists = $wpdb->get_var( $wpdb->prepare( "SELECT id FROM {$table} WHERE token = %s LIMIT 1", $token ) );
			if ( ! $exists ) {
				return $token;
			}
		}
		return wp_generate_password( 64, false );
	}

	/**
	 * Update a proposal.
	 *
	 * @param array $clean Already-sanitised key => value pairs.
	 */
	public static function update( $id, array $clean ) {
		global $wpdb;
		unset( $clean['token'] ); // token is immutable
		$clean['updated_at'] = current_time( 'mysql' );
		return false !== $wpdb->update( HGD_DB::proposals_table(), $clean, array( 'id' => (int) $id ) );
	}

	/** Delete a proposal and all of its payments. */
	public static function delete( $id ) {
		global $wpdb;
		$wpdb->delete( HGD_DB::payments_table(), array( 'proposal_id' => (int) $id ) );
		return false !== $wpdb->delete( HGD_DB::proposals_table(), array( 'id' => (int) $id ) );
	}

	// -------------------------------------------------------------------------
	// Behaviour
	// -------------------------------------------------------------------------

	/** Public portal URL for a proposal (front-end query var). */
	public static function portal_url( array $proposal ) {
		return home_url( '/?hgd_proposal=' . rawurlencode( $proposal['token'] ) );
	}

	/** True when the proposal has an expiry in the past. */
	public static function is_expired( array $proposal ) {
		if ( empty( $proposal['expires_at'] ) ) {
			return false;
		}
		if ( in_array( $proposal['status'], array( 'accepted', 'deposit_paid', 'complete' ), true ) ) {
			return false; // already in motion — expiry no longer applies
		}
		return strtotime( $proposal['expires_at'] ) < strtotime( current_time( 'mysql' ) );
	}

	/** Record a client view; promote 'sent' → 'viewed' the first time. */
	public static function mark_viewed( $id ) {
		$proposal = self::get( $id );
		if ( ! $proposal ) {
			return;
		}
		$update = array();
		if ( empty( $proposal['viewed_at'] ) ) {
			$update['viewed_at'] = current_time( 'mysql' );
		}
		if ( 'sent' === $proposal['status'] ) {
			$update['status'] = 'viewed';
		}
		if ( ! empty( $update ) ) {
			self::update( (int) $id, $update );
		}
	}

	/** Deposit amount in pounds (rounded to 2dp). */
	public static function deposit_amount( array $proposal ) {
		$total = (float) $proposal['total_gbp'];
		if ( 'fixed' === $proposal['deposit_type'] ) {
			return round( (float) $proposal['deposit_value'], 2 );
		}
		return round( $total * (float) $proposal['deposit_value'] / 100, 2 );
	}

	/**
	 * (Re)build the three milestone payments from the proposal total + settings
	 * percentages. Existing payments are cleared first. Any rounding remainder is
	 * placed on the final (completion) milestone so the milestones sum to the total.
	 */
	public static function generate_milestones( $proposal_id ) {
		$proposal = self::get( $proposal_id );
		if ( ! $proposal ) {
			return;
		}

		global $wpdb;
		$wpdb->delete( HGD_DB::payments_table(), array( 'proposal_id' => (int) $proposal_id ) );

		$total = round( (float) $proposal['total_gbp'], 2 );

		$deposit_pct = (float) HGD_Settings::get( 'deposit_pct', 50 );
		$comm_pct    = (float) HGD_Settings::get( 'commencement_pct', 25 );
		$compl_pct   = (float) HGD_Settings::get( 'completion_pct', 25 );

		// Deposit honours the proposal's own deposit definition; the rest split
		// commencement/completion by their settings ratio over the remaining sum.
		$deposit = self::deposit_amount( $proposal );
		if ( $deposit > $total ) {
			$deposit = $total;
		}
		$remaining = round( $total - $deposit, 2 );

		$comm_share = ( $comm_pct + $compl_pct ) > 0 ? $comm_pct / ( $comm_pct + $compl_pct ) : 0.5;
		$commencement = round( $remaining * $comm_share, 2 );
		$completion   = round( $remaining - $commencement, 2 ); // remainder lands here

		$rows = array(
			array( 'milestone' => 'deposit', 'amount' => $deposit ),
			array( 'milestone' => 'commencement', 'amount' => $commencement ),
			array( 'milestone' => 'completion', 'amount' => $completion ),
		);

		$sort = 0;
		foreach ( $rows as $r ) {
			HGD_Payment::create( array(
				'proposal_id' => (int) $proposal_id,
				'project_id'  => (int) $proposal['project_id'],
				'milestone'   => $r['milestone'],
				'label'       => HGD_Payment::milestone_label( $r['milestone'] ),
				'amount_gbp'  => $r['amount'],
				'status'      => 'due',
				'sort_order'  => $sort++,
			) );
		}
	}

	/**
	 * Sanitise raw admin input down to the editable proposal columns.
	 */
	public static function sanitise_settings( array $raw ) {
		$deposit_type = isset( $raw['deposit_type'] ) && 'fixed' === $raw['deposit_type'] ? 'fixed' : 'pct';
		$clean = array(
			'intro_text'    => isset( $raw['intro_text'] ) ? sanitize_textarea_field( wp_unslash( $raw['intro_text'] ) ) : '',
			'terms_text'    => isset( $raw['terms_text'] ) ? sanitize_textarea_field( wp_unslash( $raw['terms_text'] ) ) : '',
			'deposit_type'  => $deposit_type,
			'deposit_value' => isset( $raw['deposit_value'] ) ? round( (float) $raw['deposit_value'], 2 ) : 0,
		);
		if ( isset( $raw['expires_at'] ) && '' !== trim( (string) $raw['expires_at'] ) ) {
			$ts = strtotime( sanitize_text_field( wp_unslash( $raw['expires_at'] ) ) );
			if ( $ts ) {
				$clean['expires_at'] = gmdate( 'Y-m-d H:i:s', $ts );
			}
		}
		return $clean;
	}
}
