<?php
/**
 * Proposal model — a token-addressable, payable presentation built from the
 * library + a little per-client writing.
 *
 * Rendering (web portal + PDF) and payments live in later PRs; this owns the
 * data: CRUD, the status lifecycle, the section list, the pricing line items and
 * the money maths (grouped by cadence, currency/VAT aware).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCP_Proposal {

	/** Ordered lifecycle statuses. */
	public static function statuses() {
		return array(
			'draft'    => __( 'Draft', 'oc-proposals' ),
			'sent'     => __( 'Sent', 'oc-proposals' ),
			'viewed'   => __( 'Viewed', 'oc-proposals' ),
			'accepted' => __( 'Accepted', 'oc-proposals' ),
			'declined' => __( 'Declined', 'oc-proposals' ),
			'expired'  => __( 'Expired', 'oc-proposals' ),
		);
	}

	public static function status_label( $key ) {
		$s = self::statuses();
		return isset( $s[ $key ] ) ? $s[ $key ] : ucfirst( (string) $key );
	}

	// --- CRUD ----------------------------------------------------------------

	public static function get( $id ) {
		return OCP_Repo::get( OCP_DB::proposals_table(), $id );
	}

	public static function get_by_token( $token ) {
		global $wpdb;
		$token = preg_replace( '/[^A-Za-z0-9]/', '', (string) $token );
		if ( '' === $token ) {
			return null;
		}
		$table = OCP_DB::proposals_table();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE token = %s", $token ), ARRAY_A );
	}

	public static function all() {
		return OCP_Repo::all( OCP_DB::proposals_table(), 'updated_at DESC' );
	}

	public static function create( array $data ) {
		$data = wp_parse_args( $data, array(
			'token'      => self::new_token(),
			'type'       => 'retainer',
			'status'     => 'draft',
			'currency'   => OCP_Settings::get( 'default_currency', 'GBP' ),
		) );
		// US region implies USD + no VAT (applied silently).
		if ( 'us' === ( $data['region'] ?? '' ) ) {
			$data['currency']    = 'USD';
			$data['vat_applies'] = 0;
		}
		return OCP_Repo::insert( OCP_DB::proposals_table(), $data );
	}

	public static function update( $id, array $data ) {
		if ( isset( $data['region'] ) && 'us' === $data['region'] ) {
			$data['currency']    = 'USD';
			$data['vat_applies'] = 0;
		}
		return OCP_Repo::update( OCP_DB::proposals_table(), $id, $data );
	}

	public static function delete( $id ) {
		global $wpdb;
		$wpdb->delete( OCP_DB::items_table(), array( 'proposal_id' => (int) $id ) );
		$wpdb->delete( OCP_DB::sections_table(), array( 'proposal_id' => (int) $id ) );
		return OCP_Repo::delete( OCP_DB::proposals_table(), $id );
	}

	public static function new_token() {
		return bin2hex( random_bytes( 32 ) ); // 64 hex chars.
	}

	/** Public portal URL for a proposal token. */
	public static function url( $token ) {
		return add_query_arg( 'ocp_proposal', $token, home_url( '/' ) );
	}

	// --- Status transitions --------------------------------------------------

	public static function mark_sent( $id ) {
		self::update( $id, array( 'status' => 'sent', 'sent_at' => current_time( 'mysql' ) ) );
		// Snapshot the current Terms version so later edits can't change what was sent.
		if ( class_exists( 'OCP_Terms' ) ) {
			OCP_Terms::snapshot_for( $id );
		}
	}

	public static function mark_viewed( $id ) {
		$p = self::get( $id );
		if ( $p && in_array( $p['status'], array( 'sent' ), true ) ) {
			self::update( $id, array( 'status' => 'viewed', 'first_viewed_at' => current_time( 'mysql' ) ) );
		}
	}

	public static function mark_accepted( $id ) {
		self::update( $id, array( 'status' => 'accepted', 'accepted_at' => current_time( 'mysql' ) ) );
	}

	// --- Per-proposal sections (body text + referenced library ids) ----------

	public static function get_section( $proposal_id, $key ) {
		global $wpdb;
		$table = OCP_DB::sections_table();
		return $wpdb->get_row( $wpdb->prepare(
			"SELECT * FROM {$table} WHERE proposal_id = %d AND section_key = %s",
			$proposal_id, $key
		), ARRAY_A );
	}

	public static function set_section( $proposal_id, $key, array $data ) {
		$existing = self::get_section( $proposal_id, $key );
		$row      = array_merge( array(
			'proposal_id' => (int) $proposal_id,
			'section_key' => $key,
			'enabled'     => 1,
			'sort_order'  => 0,
		), $data );
		if ( $existing ) {
			OCP_Repo::update( OCP_DB::sections_table(), $existing['id'], $row );
		} else {
			OCP_Repo::insert( OCP_DB::sections_table(), $row );
		}
	}

	/** Referenced library IDs for a section (e.g. chosen case studies). */
	public static function section_ref_ids( $proposal_id, $key ) {
		$s = self::get_section( $proposal_id, $key );
		if ( ! $s || '' === (string) $s['ref_ids'] ) {
			return array();
		}
		return array_filter( array_map( 'intval', explode( ',', $s['ref_ids'] ) ) );
	}

	// --- Pricing line items --------------------------------------------------

	public static function items( $proposal_id ) {
		global $wpdb;
		return OCP_Repo::all( OCP_DB::items_table(), 'sort_order ASC, id ASC', $wpdb->prepare( 'proposal_id = %d', $proposal_id ) );
	}

	public static function replace_items( $proposal_id, array $items ) {
		global $wpdb;
		$wpdb->delete( OCP_DB::items_table(), array( 'proposal_id' => (int) $proposal_id ) );
		$order = 0;
		foreach ( $items as $item ) {
			$label = trim( (string) ( $item['label'] ?? '' ) );
			if ( '' === $label ) {
				continue;
			}
			OCP_Repo::insert( OCP_DB::items_table(), array(
				'proposal_id' => (int) $proposal_id,
				'cadence'     => in_array( ( $item['cadence'] ?? '' ), array( 'oneoff', 'monthly', 'project' ), true ) ? $item['cadence'] : 'oneoff',
				'stage'       => isset( $item['stage'] ) && '' !== $item['stage'] ? (int) $item['stage'] : null,
				'label'       => $label,
				'detail'      => (string) ( $item['detail'] ?? '' ),
				'qty'         => (float) ( $item['qty'] ?? 1 ),
				'unit_amount' => (float) ( $item['unit_amount'] ?? 0 ),
				'hours'       => isset( $item['hours'] ) && '' !== $item['hours'] ? (float) $item['hours'] : null,
				'sort_order'  => $order++,
			) );
		}
	}

	/**
	 * Totals grouped by cadence, plus VAT where it applies.
	 *
	 * @return array{by_cadence:array<string,float>, vat:float, currency:string, vat_applies:bool}
	 */
	public static function totals( $proposal_id ) {
		$p     = self::get( $proposal_id );
		$items = self::items( $proposal_id );
		$by    = array( 'oneoff' => 0.0, 'monthly' => 0.0, 'project' => 0.0 );
		foreach ( (array) $items as $it ) {
			$by[ $it['cadence'] ] = ( $by[ $it['cadence'] ] ?? 0 ) + ( (float) $it['qty'] * (float) $it['unit_amount'] );
		}
		$vat_applies = $p ? (int) $p['vat_applies'] === 1 : false;
		$vat_rate    = (float) OCP_Settings::get( 'vat_rate', 20 ) / 100;
		$vat         = $vat_applies ? array_sum( $by ) * $vat_rate : 0.0;
		return array(
			'by_cadence'  => $by,
			'vat'         => $vat,
			'currency'    => $p ? $p['currency'] : 'GBP',
			'vat_applies' => $vat_applies,
		);
	}

	/**
	 * Amount due "to start" via Stripe: any one-off total, plus either the first
	 * milestone (deposit) of the project total, or the whole project if no
	 * schedule is set.
	 */
	public static function start_amount( $proposal_id ) {
		$p = self::get( $proposal_id );
		$t = self::totals( $proposal_id );
		$oneoff  = $t['by_cadence']['oneoff'] ?? 0;
		$project = $t['by_cadence']['project'] ?? 0;
		$meta    = ( $p && $p['pricing_meta'] ) ? json_decode( $p['pricing_meta'], true ) : array();
		if ( is_array( $meta ) && ! empty( $meta['milestones'][0]['pct'] ) ) {
			$project = $project * (float) $meta['milestones'][0]['pct'] / 100;
		}
		return (float) ( $oneoff + $project );
	}

	/** Format an amount in the proposal's currency (no client-facing VAT wording). */
	public static function money( $amount, $currency ) {
		$symbols = array( 'GBP' => '£', 'USD' => '$', 'EUR' => '€' );
		$sym     = $symbols[ $currency ] ?? '';
		return $sym . number_format( (float) $amount, ( fmod( $amount, 1 ) ? 2 : 0 ) );
	}
}
