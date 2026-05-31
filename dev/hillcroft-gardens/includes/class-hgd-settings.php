<?php
/**
 * Settings store.
 *
 * All settings live in a single `hgd_settings` option array. API keys and the
 * GitHub token are secrets — they are masked in the UI and never echoed back in
 * full. (Storage hardening / encryption is tracked for a later pass.)
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Settings {

	const OPTION = 'hgd_settings';

	/** Keys treated as secrets — masked in the admin UI. */
	const SECRET_KEYS = array(
		'claude_api_key',
		'gemini_api_key',
		'google_maps_api_key',
		'plantid_api_key',
		'stripe_secret_key',
		'stripe_webhook_secret',
		'github_token',
		'google_client_secret',
		'google_refresh_token',
	);

	public static function defaults() {
		return array(
			// --- API keys ---------------------------------------------------
			'claude_api_key'      => '',
			'gemini_api_key'      => '',
			'google_maps_api_key' => '',
			'plantid_api_key'     => '',
			'stripe_secret_key'    => '',
			'stripe_pub_key'       => '',
			'stripe_webhook_secret' => '',

			// --- AI ---------------------------------------------------------
			'claude_model'        => 'claude-sonnet-4-6',

			// --- Self-updater (private GitHub repo) -------------------------
			'github_repo'         => 'octobercomms/claude',
			'github_token'        => '',
			'github_tag_prefix'   => 'hgd-v',
			'auto_update'         => 0,

			// --- Cost rates (used to estimate spend in GBP) -----------------
			'usd_to_gbp'          => 0.79,
			'eur_to_gbp'          => 0.85,
			'rate_claude_per_mtok_usd' => 15.0,   // blended $/million tokens
			'rate_gemini_per_image_usd' => 0.04,
			'rate_maps_per_1k_usd'      => 7.0,
			'rate_plantid_per_credit_eur' => 0.05,
			'plantid_credits_balance'   => 0,     // prepaid balance (manual or fetched)

			// --- Cost banner ------------------------------------------------
			'soft_monthly_cap_gbp' => 50,

			// --- Business defaults ------------------------------------------
			'consultation_fee_gbp' => 200,
			'deposit_pct'          => 50,
			'commencement_pct'     => 25,
			'completion_pct'       => 25,

			// --- Brand ------------------------------------------------------
			'brand_olive'    => '#494A20',
			'brand_charcoal' => '#1B1C18',
			'brand_cream'    => '#F2ECDD',

			// --- Google Calendar (booking sync; personal Gmail OAuth) -------
			'google_client_id'     => '',
			'google_client_secret' => '',
			'google_refresh_token' => '',
			'google_calendar_id'   => 'primary',

			// --- Booking availability ---------------------------------------
			'avail_days'          => '1,2,3,4,5', // 1=Mon … 7=Sun
			'avail_start'         => '09:00',
			'avail_end'           => '17:00',
			'slot_minutes'        => 60,
			'buffer_minutes'      => 30,
			'booking_lead_days'   => 2,   // earliest bookable = today + N days
			'booking_window_days' => 30,  // latest bookable = today + N days
		);
	}

	public static function all() {
		$saved = get_option( self::OPTION, array() );
		if ( ! is_array( $saved ) ) {
			$saved = array();
		}
		return array_merge( self::defaults(), $saved );
	}

	public static function get( $key, $fallback = '' ) {
		$all = self::all();
		return isset( $all[ $key ] ) ? $all[ $key ] : $fallback;
	}

	public static function seed_defaults() {
		if ( false === get_option( self::OPTION, false ) ) {
			add_option( self::OPTION, self::defaults() );
		}
	}

	/**
	 * Save a partial set of values. Secret fields left blank in the submission
	 * keep their existing stored value (so the masked UI never wipes a key).
	 *
	 * @param array $input Raw, already-sanitised key => value pairs.
	 */
	public static function save( array $input ) {
		$current = self::all();
		foreach ( $input as $key => $value ) {
			if ( in_array( $key, self::SECRET_KEYS, true ) && '' === trim( (string) $value ) ) {
				continue; // keep existing secret
			}
			$current[ $key ] = $value;
		}
		update_option( self::OPTION, $current );
	}

	public static function is_secret( $key ) {
		return in_array( $key, self::SECRET_KEYS, true );
	}
}
