<?php
/**
 * Settings + connection store.
 *
 * Everything lives in a single `octobermi_settings` option array. The
 * `refresh_secret` is a secret: it is encrypted at rest (see OctoberMI_Crypto)
 * and never echoed back to the browser.
 *
 * Connection state:
 *   - client_id      — the platform's identifier for this site (public-ish).
 *   - refresh_secret — the HMAC signing key for every outbound payload (secret).
 *   - client_name    — human label shown in the admin ("Connected to: …").
 *   - connected_at   — Unix seconds the pairing completed; the push cut-off
 *                      (no historic backfill before this).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OctoberMI_Settings {

	const OPTION = 'octobermi_settings';

	/** Keys treated as secrets — encrypted at rest, never echoed in full. */
	const SECRET_KEYS = array(
		'refresh_secret',
		'github_token',
	);

	public static function defaults() {
		return array(
			// --- Connection state (set during pairing) ----------------------
			'client_id'      => '',
			'refresh_secret' => '',
			'client_name'    => '',
			'connected_at'   => 0,

			// --- Self-updater (GitHub repo) ---------------------------------
			'github_token'   => '',

			// --- Activity ---------------------------------------------------
			'last_sync'      => 0,
			'events_total'   => 0,
		);
	}

	/** Return the full settings array, with secrets decrypted for use. */
	public static function all() {
		$stored = get_option( self::OPTION, array() );
		if ( ! is_array( $stored ) ) {
			$stored = array();
		}
		$settings = array_merge( self::defaults(), $stored );

		foreach ( self::SECRET_KEYS as $key ) {
			if ( isset( $settings[ $key ] ) && '' !== $settings[ $key ] ) {
				$settings[ $key ] = OctoberMI_Crypto::decrypt( $settings[ $key ] );
			}
		}
		return $settings;
	}

	/** Get a single setting value (decrypted if it is a secret). */
	public static function get( $key, $default = '' ) {
		$all = self::all();
		return array_key_exists( $key, $all ) ? $all[ $key ] : $default;
	}

	/**
	 * Merge and persist a partial set of settings. Secret values are encrypted
	 * before storage.
	 */
	public static function update( array $changes ) {
		$stored = get_option( self::OPTION, array() );
		if ( ! is_array( $stored ) ) {
			$stored = array();
		}

		foreach ( $changes as $key => $value ) {
			if ( in_array( $key, self::SECRET_KEYS, true ) && '' !== (string) $value ) {
				$stored[ $key ] = OctoberMI_Crypto::encrypt( (string) $value );
			} else {
				$stored[ $key ] = $value;
			}
		}

		update_option( self::OPTION, $stored, false );
	}

	/** Is the site paired with the platform? */
	public static function is_connected() {
		$all = self::all();
		return ! empty( $all['client_id'] ) && ! empty( $all['refresh_secret'] );
	}

	/** Wipe connection state (used by "Reset connection"). */
	public static function disconnect() {
		self::update( array(
			'client_id'      => '',
			'refresh_secret' => '',
			'client_name'    => '',
			'connected_at'   => 0,
			'last_sync'      => 0,
			'events_total'   => 0,
		) );
	}

	/** Record that a sync just happened and bump the lifetime event counter. */
	public static function note_sync() {
		$stored = get_option( self::OPTION, array() );
		if ( ! is_array( $stored ) ) {
			$stored = array();
		}
		$stored['last_sync']    = time();
		$stored['events_total'] = isset( $stored['events_total'] ) ? (int) $stored['events_total'] + 1 : 1;
		update_option( self::OPTION, $stored, false );
	}
}
