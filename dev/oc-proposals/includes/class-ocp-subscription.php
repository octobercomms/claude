<?php
/**
 * Monthly retainer subscription state + the client-controlled pause.
 *
 * Billing model: payment is taken at the END of the month for the month ahead,
 * with 14 days' notice required before a renewal to pause or stop.
 *
 * Pause rules:
 *   - Pause OUTSIDE the 14-day window before the next charge ⇒ no further
 *     payments; cleanly paused.
 *   - Pause INSIDE the window ⇒ the upcoming (already-committed) charge still
 *     goes through, then nothing after — and we say so explicitly.
 *
 * State is kept per-proposal in an option; the GoCardless mandate is paused via
 * its API when configured.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCP_Subscription {

	const NOTICE_DAYS = 14;

	public static function init() {
		add_action( 'admin_post_nopriv_ocp_pause', array( __CLASS__, 'handle_pause' ) );
		add_action( 'admin_post_ocp_pause', array( __CLASS__, 'handle_pause' ) );
	}

	private static function option_key( $proposal_id ) {
		return 'ocp_sub_' . (int) $proposal_id;
	}

	public static function get( $proposal_id ) {
		return get_option( self::option_key( $proposal_id ), array() );
	}

	public static function start( $proposal_id, $mandate = '' ) {
		update_option( self::option_key( $proposal_id ), array(
			'status'      => 'active',
			'mandate'     => $mandate,
			'started_at'  => current_time( 'mysql' ),
			'next_charge' => self::next_charge_date(),
		) );
	}

	public static function record_collection( $links ) {
		// Hook point for reconciliation/reporting; no-op placeholder for now.
		return true;
	}

	/** Last day of the current month (or next month if today is that day/past). */
	public static function next_charge_date( $from = null ) {
		$ts    = $from ? strtotime( $from ) : current_time( 'timestamp' );
		$eom   = strtotime( gmdate( 'Y-m-t', $ts ) );
		if ( $eom < $ts ) {
			$eom = strtotime( gmdate( 'Y-m-t', strtotime( '+1 month', $ts ) ) );
		}
		return gmdate( 'Y-m-d', $eom );
	}

	/** Days from now until the next charge. */
	public static function days_until_charge( $proposal_id ) {
		$sub  = self::get( $proposal_id );
		$next = $sub['next_charge'] ?? self::next_charge_date();
		$diff = strtotime( $next ) - current_time( 'timestamp' );
		return (int) ceil( $diff / DAY_IN_SECONDS );
	}

	/**
	 * Pause the subscription. Returns a human message describing exactly what
	 * will and won't be charged.
	 *
	 * @return array{ok:bool, message:string, charges_once_more:bool}
	 */
	public static function pause( $proposal_id ) {
		$sub = self::get( $proposal_id );
		if ( ! $sub || ( $sub['status'] ?? '' ) !== 'active' ) {
			return array( 'ok' => false, 'message' => __( 'No active subscription to pause.', 'oc-proposals' ), 'charges_once_more' => false );
		}
		$days  = self::days_until_charge( $proposal_id );
		$next  = $sub['next_charge'] ?? self::next_charge_date();
		$within = ( $days <= self::NOTICE_DAYS );

		$sub['status']            = 'paused';
		$sub['paused_at']         = current_time( 'mysql' );
		$sub['charges_once_more'] = $within;
		$sub['final_charge']      = $within ? $next : '';
		update_option( self::option_key( $proposal_id ), $sub );

		// Pause the GoCardless mandate where we can.
		self::pause_mandate( $sub['mandate'] ?? '' );

		if ( $within ) {
			$message = sprintf(
				/* translators: %s date */
				__( 'Paused. As your next payment on %s is already within the 14-day notice window, it will still be taken — nothing will be taken after that.', 'oc-proposals' ),
				date_i18n( get_option( 'date_format' ), strtotime( $next ) )
			);
			return array( 'ok' => true, 'message' => $message, 'charges_once_more' => true );
		}
		return array( 'ok' => true, 'message' => __( 'Paused. No further payments will be taken.', 'oc-proposals' ), 'charges_once_more' => false );
	}

	public static function resume( $proposal_id ) {
		$sub = self::get( $proposal_id );
		if ( ! $sub ) {
			return false;
		}
		$sub['status']      = 'active';
		$sub['resumed_at']  = current_time( 'mysql' );
		$sub['next_charge'] = self::next_charge_date();
		unset( $sub['charges_once_more'], $sub['final_charge'] );
		update_option( self::option_key( $proposal_id ), $sub );
		return true;
	}

	private static function pause_mandate( $mandate ) {
		$token = OCP_Settings::get( 'gocardless_token' );
		if ( ! $token || ! $mandate ) {
			return;
		}
		// Cancelling the mandate stops future collections; a fresh flow re-enables.
		wp_remote_post( 'https://api.gocardless.com/mandates/' . rawurlencode( $mandate ) . '/actions/cancel', array(
			'headers' => array(
				'Authorization'      => 'Bearer ' . $token,
				'GoCardless-Version' => '2015-07-06',
				'Content-Type'       => 'application/json',
			),
			'body'    => '{}',
			'timeout' => 20,
		) );
	}

	// --- Client / admin pause entrypoint -------------------------------------

	public static function handle_pause() {
		$token = preg_replace( '/[^A-Za-z0-9]/', '', (string) ( $_REQUEST['token'] ?? '' ) );
		$p     = OCP_Proposal::get_by_token( $token );
		if ( ! $p || ! wp_verify_nonce( $_REQUEST['_ocp_nonce'] ?? '', 'ocp_pause_' . $token ) ) {
			wp_die( esc_html__( 'Security check failed.', 'oc-proposals' ) );
		}
		$do = sanitize_key( wp_unslash( $_REQUEST['do'] ?? 'pause' ) );
		if ( 'resume' === $do ) {
			self::resume( $p['id'] );
		} else {
			self::pause( $p['id'] );
		}
		wp_safe_redirect( OCP_Proposal::url( $token ) . '&sub=1' );
		exit;
	}
}
