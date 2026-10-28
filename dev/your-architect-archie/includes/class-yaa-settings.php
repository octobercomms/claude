<?php
/**
 * Plugin settings, stored in a single wp_option. Secret fields are encrypted
 * at rest via YAA_Crypto and never returned to the browser.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Settings {

	const OPTION = 'yaa_settings';

	/** Keys whose values are encrypted at rest. */
	const SECRETS = array( 'claude_api_key', 'stripe_secret_key', 'stripe_webhook_secret', 'brevo_api_key', 'smtp_pass', 'github_token' );

	public static function defaults() {
		return array(
			'claude_api_key'        => '',
			'claude_model'          => 'claude-sonnet-4-6',
			'max_output_tokens'     => 700,
			'notify_email'          => get_option( 'admin_email' ),
			'notify_emails'         => '', // extra studio recipients, comma-separated.
			'email_templates'       => array(), // per-stage {subject, body} overrides.
			'arb_no'                => '091365K & 091921G',
			'company_no'            => 'OC437815',
			'rate_limit_per_min'    => 20,   // Archie turns per session per minute.
			'session_daily_cap'     => 60,   // model turns per session per day (per-client DoS guard).
			'terms_url'             => '',
			'privacy_url'           => '',
			'chat_url'              => '', // page where the [archie] chat lives; blank = home. Used by the emailed-quote "finish & submit" link.
			'daily_token_cap'       => 500000, // soft cap; hard-stop new turns beyond it.
			'ai_price_in'           => 3.0,  // est. cost per 1M input tokens (model's published rate).
			'ai_price_out'          => 15.0, // est. cost per 1M output tokens.
			'ai_price_currency'     => '$',  // currency symbol for the cost estimate.
			'stripe_secret_key'     => '',
			'stripe_publishable'    => '',
			'stripe_webhook_secret' => '',
			'brevo_api_key'         => '',
			'smtp_enabled'          => 0,          // route wp_mail through the SMTP relay below.
			'smtp_host'             => '',         // e.g. smtp-relay.brevo.com
			'smtp_port'             => 587,        // 587 = STARTTLS, 465 = SSL.
			'smtp_secure'           => 'tls',      // 'tls' | 'ssl' | 'none'
			'smtp_auth'             => 1,          // authenticate with username/password.
			'smtp_user'             => '',         // SMTP login (often the from address or a relay login).
			'smtp_pass'             => '',         // SMTP password / relay key (stored encrypted).
			'email_from'            => get_option( 'admin_email' ),
			'email_from_name'       => 'Your Architect',
			'portal_page_id'        => 0,
			'currency'              => 'gbp',
			'historic_api_on'       => 0,
			// Self-updater: one-click plugin updates from the private GitHub repo.
			'github_repo'           => 'octobercomms/claude',
			'github_token'          => '',   // fine-grained token, Contents: read (stored encrypted).
			'github_tag_prefix'     => 'yaa-v',
		);
	}

	public static function all() {
		$saved = get_option( self::OPTION, array() );
		$out   = wp_parse_args( is_array( $saved ) ? $saved : array(), self::defaults() );
		foreach ( self::SECRETS as $k ) {
			$out[ $k ] = YAA_Crypto::decrypt( isset( $out[ $k ] ) ? $out[ $k ] : '' );
		}
		return $out;
	}

	public static function get( $key, $default = null ) {
		$all = self::all();
		return array_key_exists( $key, $all ) ? $all[ $key ] : $default;
	}

	/**
	 * Save a set of values (merged). Secret fields are encrypted; a blank secret
	 * leaves the stored value untouched (so you don't have to re-enter it).
	 */
	public static function update( array $values ) {
		$raw = get_option( self::OPTION, array() );
		$raw = is_array( $raw ) ? $raw : array();
		foreach ( $values as $k => $v ) {
			if ( in_array( $k, self::SECRETS, true ) ) {
				if ( '' === trim( (string) $v ) ) {
					continue; // keep existing secret.
				}
				$raw[ $k ] = YAA_Crypto::encrypt( trim( (string) $v ) );
			} else {
				$raw[ $k ] = $v;
			}
		}
		update_option( self::OPTION, $raw, false );
	}

	/** Explicitly wipe one or more stored secrets (leaving a secret field blank keeps it; this clears it). */
	public static function clear_secrets( array $keys ) {
		$raw = get_option( self::OPTION, array() );
		$raw = is_array( $raw ) ? $raw : array();
		$changed = false;
		foreach ( $keys as $k ) {
			if ( in_array( $k, self::SECRETS, true ) && ! empty( $raw[ $k ] ) ) {
				$raw[ $k ] = '';
				$changed = true;
			}
		}
		if ( $changed ) {
			update_option( self::OPTION, $raw, false );
		}
	}

	/** Whether a secret is set (without exposing it). */
	public static function has_secret( $key ) {
		$raw = get_option( self::OPTION, array() );
		return ! empty( $raw[ $key ] );
	}
}
