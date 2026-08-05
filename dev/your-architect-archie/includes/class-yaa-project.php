<?php
/**
 * Project records — now backed by custom tables (see YAA_DB), not a CPT.
 *
 * A project is one row in {prefix}yaa_projects tied to a browser cookie (UUID).
 * It holds the conversation, the collected state, the current package (JSON),
 * a status (the state-machine below) and contact details, plus denormalised
 * columns (email, postcode, flags, package, total, submitted_at) so the admin
 * list, the started-vs-submitted funnel and reporting are cheap to query.
 * Anonymous until an email is provided.
 *
 * Status state-machine:
 *   partial     started the chat, not yet submitted (this is the "abandonment" pool)
 *   quoted      reached the end of the chat (price built) but not submitted
 *   submitted   confirmed their project (a real lead)
 *   redirected  a full-RIBA / larger commission handed to Tiam directly
 *   abandoned   explicitly reset / started over
 *
 * The public method names match the old CPT version so callers are unchanged.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Project {

	const COOKIE = 'yaa_pid';

	/** "Not yet submitted" statuses — the started/partial funnel bucket. */
	public static function started_statuses() {
		return array( 'partial', 'quoted' );
	}

	public static function init() {
		// Tables are created on activation; this catches plugin updates applied
		// without a re-activation (cheap option check, dbDelta only on mismatch).
		add_action( 'admin_init', array( 'YAA_DB', 'maybe_upgrade' ) );
	}

	/** Resolve the current project from the cookie, creating one if needed. */
	public static function current( $create = true ) {
		global $wpdb;
		$table = YAA_DB::projects_table();
		$uuid  = isset( $_COOKIE[ self::COOKIE ] ) ? sanitize_text_field( wp_unslash( $_COOKIE[ self::COOKIE ] ) ) : '';

		if ( $uuid ) {
			$id = $wpdb->get_var( $wpdb->prepare( "SELECT id FROM {$table} WHERE uuid = %s", $uuid ) ); // phpcs:ignore WordPress.DB
			if ( $id ) {
				return (int) $id;
			}
		}
		if ( ! $create ) {
			return 0;
		}
		if ( ! $uuid ) {
			$uuid = wp_generate_uuid4();
			// 180-day cookie; SameSite=Lax so it survives the return visit.
			setcookie( self::COOKIE, $uuid, array( 'expires' => time() + 180 * DAY_IN_SECONDS, 'path' => '/', 'samesite' => 'Lax', 'secure' => is_ssl(), 'httponly' => true ) );
			$_COOKIE[ self::COOKIE ] = $uuid;
		}
		$now = current_time( 'mysql' );
		$wpdb->insert( // phpcs:ignore WordPress.DB
			$table,
			array( 'uuid' => $uuid, 'status' => 'partial', 'created' => $now, 'updated' => $now ),
			array( '%s', '%s', '%s', '%s' )
		);
		$id = (int) $wpdb->insert_id;
		if ( $id ) {
			self::log_event( $id, 'created' );
		}
		return $id;
	}

	/** Low-level row accessor. */
	public static function get( $id ) {
		global $wpdb;
		$table = YAA_DB::projects_table();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", (int) $id ) ); // phpcs:ignore WordPress.DB
	}

	private static function update_row( $id, array $data, array $formats ) {
		global $wpdb;
		$data['updated']  = current_time( 'mysql' );
		$formats[]        = '%s';
		$wpdb->update( YAA_DB::projects_table(), $data, array( 'id' => (int) $id ), $formats, array( '%d' ) ); // phpcs:ignore WordPress.DB
	}

	// ---- State (structured fields Archie collects) ----
	public static function state( $id ) {
		$row = self::get( $id );
		$s   = $row ? json_decode( (string) $row->state_json, true ) : array();
		return is_array( $s ) ? $s : array();
	}
	public static function set_state( $id, array $state ) {
		// Sync the denormalised columns used by the admin list + reporting.
		$data = array(
			'state_json'   => wp_json_encode( $state ),
			'postcode'     => isset( $state['postcode'] ) ? sanitize_text_field( (string) $state['postcode'] ) : null,
			'london'       => ! empty( $state['london'] ) ? 1 : 0,
			'listed'       => ! empty( $state['listed'] ) ? 1 : 0,
			'conservation' => ! empty( $state['conservation'] ) ? 1 : 0,
			'project_type' => isset( $state['projectType'] ) ? sanitize_text_field( (string) $state['projectType'] ) : null,
			'package'      => isset( $state['package'] ) ? sanitize_text_field( (string) $state['package'] ) : null,
		);
		self::update_row( $id, $data, array( '%s', '%s', '%d', '%d', '%d', '%s', '%s' ) );
	}

	// ---- Conversation transcript ----
	public static function messages( $id ) {
		$row = self::get( $id );
		$m   = $row ? json_decode( (string) $row->messages_json, true ) : array();
		return is_array( $m ) ? $m : array();
	}
	public static function add_message( $id, $role, $text ) {
		$m   = self::messages( $id );
		$m[] = array( 'role' => ( 'assistant' === $role ? 'assistant' : 'user' ), 'text' => (string) $text );
		self::update_row( $id, array( 'messages_json' => wp_json_encode( $m ) ), array( '%s' ) );
	}

	// ---- Package (authoritative price, computed by YAA_Pricing) ----
	public static function set_package( $id, array $package ) {
		self::update_row(
			$id,
			array( 'package_json' => wp_json_encode( $package ), 'total' => (int) ( isset( $package['total'] ) ? $package['total'] : 0 ) ),
			array( '%s', '%d' )
		);
	}
	public static function package( $id ) {
		$row = self::get( $id );
		$p   = $row ? json_decode( (string) $row->package_json, true ) : array();
		return is_array( $p ) ? $p : array( 'nodes' => array(), 'total' => 0 );
	}

	// ---- Contact ----
	public static function set_contact( $id, $name, $email ) {
		$name  = sanitize_text_field( $name );
		$email = sanitize_email( $email );
		self::update_row( $id, array( 'name' => $name, 'email' => $email ), array( '%s', '%s' ) );
	}

	// ---- Status ----
	public static function set_status( $id, $status ) {
		$status = sanitize_key( $status );
		$data   = array( 'status' => $status );
		$fmt    = array( '%s' );
		if ( in_array( $status, array( 'submitted', 'redirected' ), true ) ) {
			$row = self::get( $id );
			if ( $row && empty( $row->submitted_at ) ) {
				$data['submitted_at'] = current_time( 'mysql' );
				$fmt[]                = '%s';
			}
			if ( $row && empty( $row->ref ) ) {
				$data['ref'] = self::make_ref( $id );
				$fmt[]       = '%s';
			}
		}
		self::update_row( $id, $data, $fmt );
		self::log_event( $id, 'status_change', array( 'status' => $status ) );
	}

	public static function make_ref( $id ) {
		return 'YA-' . strtoupper( substr( wp_hash( (string) $id ), 0, 6 ) );
	}

	/** Unguessable token for the client portal URL; created once, then reused. */
	public static function ensure_token( $id ) {
		$row = self::get( $id );
		if ( $row && ! empty( $row->token ) ) {
			return $row->token;
		}
		$token = substr( bin2hex( random_bytes( 16 ) ), 0, 32 );
		self::update_row( $id, array( 'token' => $token ), array( '%s' ) );
		return $token;
	}

	public static function by_token( $token ) {
		global $wpdb;
		$token = preg_replace( '/[^a-f0-9]/', '', (string) $token );
		if ( 32 !== strlen( $token ) ) {
			return null;
		}
		$table = YAA_DB::projects_table();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE token = %s", $token ) ); // phpcs:ignore WordPress.DB
	}

	/** Tiam approves a submitted project — ready to send the confirmation email. */
	public static function approve( $id ) {
		$row = self::get( $id );
		$data = array( 'status' => 'approved', 'approved_at' => current_time( 'mysql' ) );
		$fmt  = array( '%s', '%s' );
		if ( $row && empty( $row->ref ) ) {
			$data['ref'] = self::make_ref( $id );
			$fmt[]       = '%s';
		}
		self::update_row( $id, $data, $fmt );
		self::ensure_token( $id );
		self::log_event( $id, 'approved' );
	}

	/** Record a successful payment and unlock the drawings. */
	public static function mark_paid( $id, $amount_pennies, $intent = '' ) {
		$row = self::get( $id );
		if ( $row && $row->paid ) {
			return; // idempotent — webhooks can fire twice.
		}
		self::update_row(
			$id,
			array( 'paid' => 1, 'amount_paid' => (int) $amount_pennies, 'stripe_intent' => sanitize_text_field( (string) $intent ), 'paid_at' => current_time( 'mysql' ), 'status' => 'paid' ),
			array( '%d', '%d', '%s', '%s', '%s' )
		);
		self::log_event( $id, 'paid', array( 'amount' => (int) $amount_pennies ) );
	}

	// ---- Event log (audit + funnel; email/payment events land here later) ----
	public static function log_event( $id, $type, array $meta = array() ) {
		global $wpdb;
		$wpdb->insert( // phpcs:ignore WordPress.DB
			YAA_DB::events_table(),
			array(
				'project_id' => (int) $id,
				'type'       => sanitize_key( $type ),
				'meta_json'  => $meta ? wp_json_encode( $meta ) : null,
				'created'    => current_time( 'mysql' ),
			),
			array( '%d', '%s', '%s', '%s' )
		);
	}
	public static function events( $id ) {
		global $wpdb;
		$table = YAA_DB::events_table();
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$table} WHERE project_id = %d ORDER BY id ASC", (int) $id ) ); // phpcs:ignore WordPress.DB
	}

	// ---- Admin queries ----
	/**
	 * @param array $args { statuses:string[], search:string, since:string, limit:int, offset:int }
	 * @return array rows
	 */
	public static function query( array $args = array() ) {
		global $wpdb;
		$table  = YAA_DB::projects_table();
		$where  = array( '1=1' );
		$params = array();

		if ( ! empty( $args['statuses'] ) ) {
			$in     = implode( ',', array_fill( 0, count( $args['statuses'] ), '%s' ) );
			$where[] = "status IN ({$in})";
			$params  = array_merge( $params, $args['statuses'] );
		}
		if ( ! empty( $args['search'] ) ) {
			$like    = '%' . $wpdb->esc_like( $args['search'] ) . '%';
			$where[] = '(name LIKE %s OR email LIKE %s OR postcode LIKE %s OR ref LIKE %s)';
			array_push( $params, $like, $like, $like, $like );
		}
		if ( ! empty( $args['since'] ) ) {
			$where[] = 'created >= %s';
			$params[] = $args['since'];
		}
		$limit  = isset( $args['limit'] ) ? (int) $args['limit'] : 100;
		$offset = isset( $args['offset'] ) ? (int) $args['offset'] : 0;

		$sql = "SELECT * FROM {$table} WHERE " . implode( ' AND ', $where ) . ' ORDER BY updated DESC LIMIT %d OFFSET %d';
		$params[] = $limit;
		$params[] = $offset;
		return $wpdb->get_results( $wpdb->prepare( $sql, $params ) ); // phpcs:ignore WordPress.DB
	}

	/** Counts keyed by status, for the admin tabs + dashboard. */
	public static function status_counts() {
		global $wpdb;
		$table = YAA_DB::projects_table();
		$rows  = $wpdb->get_results( "SELECT status, COUNT(*) AS n FROM {$table} GROUP BY status", ARRAY_A ); // phpcs:ignore WordPress.DB
		$out   = array();
		foreach ( (array) $rows as $r ) {
			$out[ $r['status'] ] = (int) $r['n'];
		}
		return $out;
	}
}
