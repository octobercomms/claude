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
			'gemini_image_model'  => 'gemini-2.5-flash-image',
			'render_style'        => 'watercolour', // photoreal | watercolour | pencil_wash

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

			// --- Proposals --------------------------------------------------
			'proposal_expiry_days' => 30,
			'terms_default'        => '',

			// --- Pricing engine defaults ------------------------------------
			'default_day_rate_gbp'     => 250,
			'default_wastage_pct'      => 10,
			'default_contingency_pct'  => 5,
			'default_vat_pct'          => 0,    // set to 20 if VAT-registered
			'default_design_fee_gbp'   => 0,
			'better_uplift_pct'        => 25,   // Good→Better multiplier on plant/materials
			'best_uplift_pct'          => 60,   // Good→Best multiplier

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

	/** Render-style options for the Settings dropdown. */
	public static function render_styles() {
		return array(
			'watercolour' => __( 'Watercolour painting', 'hillcroft-garden-designer' ),
			'photoreal'   => __( 'Photorealistic', 'hillcroft-garden-designer' ),
			'pencil_wash' => __( 'Pencil & light wash', 'hillcroft-garden-designer' ),
		);
	}

	/**
	 * A prompt fragment describing the chosen render aesthetic, appended to the
	 * eye-level / concept render prompts. (Plan drawings and the dedicated
	 * watercolour/hand-drawn pack views keep their own fixed styles.)
	 */
	public static function render_style_suffix() {
		$style = (string) self::get( 'render_style', 'watercolour' );
		switch ( $style ) {
			case 'photoreal':
				return 'STYLE: a clean, photorealistic landscape photograph — natural daylight, true-to-life materials and planting, sharp focus, no lens distortion.';
			case 'pencil_wash':
				return 'STYLE: a hand-drawn pencil illustration with light watercolour washes — confident line-work, soft colour, an architect\'s presentation sketch; warm and hand-crafted, not photographic.';
			case 'watercolour':
			default:
				return 'STYLE: a loose, elegant watercolour painting — soft graded washes, confident brushwork, gentle bleeds and a hint of visible paper texture, in the manner of a fine garden-design illustration. Painterly and atmospheric rather than photographic, while staying true to the layout and planting.';
		}
	}
}
