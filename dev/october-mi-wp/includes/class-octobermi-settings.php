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
		'claude_api_key',
	);

	public static function defaults() {
		return array(
			// --- Connection state (set during pairing) ----------------------
			'client_id'       => '',
			'refresh_secret'  => '',
			'client_name'     => '',
			'connected_at'    => 0,

			// --- Modules & mode ---------------------------------------------
			// enabled_modules: machine ids of switched-on capabilities.
			// connect_enabled: has the platform connection been unlocked?
			// key_source: 'client' (own key) | 'platform' (managed via pairing).
			'enabled_modules' => array( 'blog' ),
			'connect_enabled' => false,
			'key_source'      => 'client',
			'claude_api_key'  => '',

			// Safety rail: estimated monthly USD cap for own-key generation
			// (0 = unlimited). Managed keys are capped platform-side.
			'monthly_cost_cap' => 0,

			// --- Self-updater (GitHub repo) ---------------------------------
			'github_token'    => '',

			// --- Activity ---------------------------------------------------
			'last_sync'       => 0,
			'events_total'    => 0,
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

	/** Has the operator unlocked the platform connection UI? */
	public static function connect_enabled() {
		return (bool) self::get( 'connect_enabled', false );
	}

	/** Machine ids of the modules switched on. */
	public static function enabled_modules() {
		$v = self::get( 'enabled_modules', array() );
		return is_array( $v ) ? $v : array();
	}

	/** Is a specific module switched on? */
	public static function is_module_enabled( $id ) {
		return in_array( $id, self::enabled_modules(), true );
	}

	/**
	 * Are we using an October-managed key? Only true when the operator chose the
	 * platform key source AND the site is actually paired — otherwise model
	 * calls fall back to the local key.
	 */
	public static function is_managed_key() {
		return 'platform' === self::get( 'key_source', 'client' ) && self::is_connected();
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
