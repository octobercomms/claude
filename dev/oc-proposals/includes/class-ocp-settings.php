<?php
/**
 * Settings store. A single option array, with typed getters and a defaults seed.
 *
 * Design tokens default to the OMI design system so every proposal matches OMI
 * out of the box; only fonts + colours need changing to re-skin.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCP_Settings {

	const OPTION = 'ocp_settings';

	/** Default settings — also the canonical list of recognised keys. */
	public static function defaults() {
		return array(
			// Brand / design tokens (OMI design system).
			'font_family'    => 'Brockmann, -apple-system, "Segoe UI", system-ui, sans-serif',
			'color_page'     => '#faf9f5',
			'color_surface'  => '#ffffff',
			'color_ink'      => '#1a1a1a',
			'color_muted'    => '#555555',
			'color_border'   => '#1a1a1a',
			'color_card'     => '#e3e2db',
			'color_accent'   => '#E7CD41',
			'color_accent_on' => '#1a1a1a',
			'color_positive' => '#2e7d32',
			'logo_url'       => '',

			// Company / legal.
			'company_name'   => 'October Communications Ltd.',
			'company_legal'  => 'Company No. 8816416. VAT Registration No. GB 176 6335 82. Registered in England and Wales.',
			'company_address' => '167-169 Great Portland Street, 5th Floor, London, W1W 5PF.',
			'company_email'  => 'hello@octobercomms.com',
			'company_site'   => 'octobercomms.com',

			// Commercial defaults.
			'default_currency' => 'GBP',
			'vat_rate'         => 20,

			// Integrations (set per-site; never committed).
			'github_token'   => '',
			'claude_key'     => '',
			'stripe_secret'  => '',
			'stripe_public'  => '',
			'gocardless_token' => '',
			'clarity_id'     => '',
			'dataforseo_login' => '',
			'dataforseo_password' => '',
			'turnstile_site' => '',
			'turnstile_secret' => '',

			// Pricing rate card (grounds the Claude pricing agent).
			'hourly_rate'       => '75',
			'band_oneoff_min'   => '250',
			'band_oneoff_max'   => '2000',
			'band_monthly_min'  => '500',
			'band_monthly_max'  => '3000',
			'band_project_min'  => '2000',
			'band_project_max'  => '15000',

			// Conversion + automation.
			'booking_url'          => '',
			'followup_enabled'     => '1',
			'followup_days'        => '4',
			'report_email_enabled' => '1',
		);
	}

	/** Rate-card bands keyed by cadence, for the pricing agent's clamp. */
	public static function bands() {
		$s = self::all();
		return array(
			'oneoff'  => array( 'min' => (float) $s['band_oneoff_min'], 'max' => (float) $s['band_oneoff_max'] ),
			'monthly' => array( 'min' => (float) $s['band_monthly_min'], 'max' => (float) $s['band_monthly_max'] ),
			'project' => array( 'min' => (float) $s['band_project_min'], 'max' => (float) $s['band_project_max'] ),
		);
	}

	public static function all() {
		$saved = get_option( self::OPTION, array() );
		return wp_parse_args( is_array( $saved ) ? $saved : array(), self::defaults() );
	}

	public static function get( $key, $fallback = '' ) {
		$all = self::all();
		return array_key_exists( $key, $all ) ? $all[ $key ] : $fallback;
	}

	public static function update( array $values ) {
		$current = self::all();
		$merged  = array_merge( $current, $values );
		// Only persist recognised keys.
		$clean = array_intersect_key( $merged, self::defaults() );
		update_option( self::OPTION, $clean );
	}

	/** Seed defaults on first install without clobbering existing values. */
	public static function seed_defaults() {
		$saved = get_option( self::OPTION, null );
		if ( null === $saved ) {
			update_option( self::OPTION, self::defaults() );
		}
	}

	/**
	 * Design tokens as a ready-to-print `:root{}` CSS block, shared by the admin,
	 * the public portal and the PDF template so all three match.
	 */
	public static function css_root() {
		$s = self::all();
		return ':root{'
			. '--ocp-font:' . $s['font_family'] . ';'
			. '--ocp-page:' . $s['color_page'] . ';'
			. '--ocp-surface:' . $s['color_surface'] . ';'
			. '--ocp-ink:' . $s['color_ink'] . ';'
			. '--ocp-muted:' . $s['color_muted'] . ';'
			. '--ocp-line:' . $s['color_border'] . ';'
			. '--ocp-card:' . $s['color_card'] . ';'
			. '--ocp-accent:' . $s['color_accent'] . ';'
			. '--ocp-accent-on:' . $s['color_accent_on'] . ';'
			. '--ocp-positive:' . $s['color_positive'] . ';'
			. '}';
	}
}
