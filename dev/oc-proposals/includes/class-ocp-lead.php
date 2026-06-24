<?php
/**
 * CRM lead model — pipeline modelled on October's Sales Leads Tracker.
 *
 * Statuses and lost-reasons mirror the spreadsheet's vocabulary; the proposal
 * lifecycle nudges these forward (sent ⇒ proposal_made, accepted ⇒ closed_won).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCP_Lead {

	/** Open pipeline stages, in order. */
	public static function stages() {
		return array(
			'lead_in'       => __( 'Lead in', 'oc-proposals' ),
			'contact_made'  => __( 'Contact made', 'oc-proposals' ),
			'proposal_made' => __( 'Proposal made', 'oc-proposals' ),
			'closed_won'    => __( 'Closed won', 'oc-proposals' ),
			'closed_lost'   => __( 'Closed lost', 'oc-proposals' ),
		);
	}

	/** Closed-lost reasons (kept as analytics, like the tracker). */
	public static function lost_reasons() {
		return array(
			'declined'    => __( 'Declined', 'oc-proposals' ),
			'no_response' => __( 'No response', 'oc-proposals' ),
			'late_reply'  => __( 'Late reply', 'oc-proposals' ),
			'retracted'   => __( 'Retracted', 'oc-proposals' ),
			'competitor'  => __( 'Competitor', 'oc-proposals' ),
			'cost'        => __( 'Cost', 'oc-proposals' ),
		);
	}

	public static function sources() {
		return array( 'Web Search', 'Contact Referral', 'Website Referral', 'Publication', 'Press Coverage', 'Social Media', 'Other' );
	}

	public static function budget_bands() {
		return array( 'Under £1000', '£1000 - £2500', '£2500 - £5000', '£5000 - £10000', 'Over £10000' );
	}

	public static function stage_label( $key ) {
		$s = self::stages();
		return isset( $s[ $key ] ) ? $s[ $key ] : ucfirst( str_replace( '_', ' ', (string) $key ) );
	}

	public static function all() {
		return OCP_Repo::all( OCP_DB::leads_table(), 'updated_at DESC' );
	}

	public static function by_stage( $stage ) {
		global $wpdb;
		return OCP_Repo::all( OCP_DB::leads_table(), 'updated_at DESC', $wpdb->prepare( 'status = %s', $stage ) );
	}

	public static function get( $id ) {
		return OCP_Repo::get( OCP_DB::leads_table(), $id );
	}

	public static function save( array $data, $id = 0 ) {
		$table = OCP_DB::leads_table();
		if ( $id ) {
			OCP_Repo::update( $table, $id, $data );
			return (int) $id;
		}
		return OCP_Repo::insert( $table, $data );
	}

	/**
	 * Import rows from the Sales Leads Tracker CSV (the "Leads" sheet exported to
	 * CSV). Maps the spreadsheet's free-text statuses to our pipeline vocabulary.
	 *
	 * @return array{imported:int, skipped:int}
	 */
	public static function import_csv( $path ) {
		$imported = 0;
		$skipped  = 0;
		if ( ! is_readable( $path ) ) {
			return array( 'imported' => 0, 'skipped' => 0 );
		}
		$fh = fopen( $path, 'r' ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		if ( ! $fh ) {
			return array( 'imported' => 0, 'skipped' => 0 );
		}
		$header = fgetcsv( $fh );
		while ( ( $row = fgetcsv( $fh ) ) !== false ) {
			$cols = array_pad( $row, 13, '' );
			$name = trim( (string) $cols[1] );
			if ( '' === $name ) {
				$skipped++;
				continue;
			}
			list( $status, $reason ) = self::map_status( (string) $cols[2] );
			$data = array(
				'client_name'      => $name,
				'status'           => $status,
				'lost_reason'      => $reason,
				'lead_source'      => sanitize_text_field( (string) $cols[3] ),
				'lead_source_desc' => sanitize_text_field( (string) $cols[4] ),
				'additional_info'  => sanitize_textarea_field( (string) $cols[5] ),
				'project_type'     => sanitize_text_field( (string) $cols[6] ),
				'budget_band'      => sanitize_text_field( (string) $cols[7] ),
				'contact_name'     => sanitize_text_field( (string) $cols[8] ),
				'email'            => sanitize_email( (string) $cols[9] ),
				'telephone'        => sanitize_text_field( (string) $cols[10] ),
				'address'          => sanitize_text_field( (string) $cols[11] ),
				'postcode'         => sanitize_text_field( (string) $cols[12] ),
				'lead_date'        => self::parse_date( (string) $cols[0] ),
			);
			OCP_Repo::insert( OCP_DB::leads_table(), $data );
			$imported++;
		}
		fclose( $fh ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		return array( 'imported' => $imported, 'skipped' => $skipped );
	}

	/** Map a tracker status string to [stage, lost_reason]. */
	private static function map_status( $raw ) {
		$raw = strtolower( $raw );
		if ( false !== strpos( $raw, 'won' ) ) {
			return array( 'closed_won', '' );
		}
		if ( false !== strpos( $raw, 'lost' ) || false !== strpos( $raw, 'closed' ) ) {
			$reason = 'declined';
			foreach ( array( 'no response' => 'no_response', 'late' => 'late_reply', 'retract' => 'retracted', 'competitor' => 'competitor', 'cost' => 'cost', 'declin' => 'declined' ) as $needle => $key ) {
				if ( false !== strpos( $raw, $needle ) ) {
					$reason = $key;
					break;
				}
			}
			return array( 'closed_lost', $reason );
		}
		if ( false !== strpos( $raw, 'proposal' ) ) {
			return array( 'proposal_made', '' );
		}
		if ( false !== strpos( $raw, 'contact' ) ) {
			return array( 'contact_made', '' );
		}
		return array( 'lead_in', '' );
	}

	private static function parse_date( $raw ) {
		$raw = trim( $raw );
		if ( '' === $raw ) {
			return null;
		}
		$ts = strtotime( $raw );
		return $ts ? gmdate( 'Y-m-d', $ts ) : null;
	}
}
