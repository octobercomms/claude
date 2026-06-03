<?php
/**
 * Secret-at-rest encryption.
 *
 * Encrypts sensitive settings (API keys, the Stripe secret, the GitHub token,
 * Google OAuth secrets) before they are written to wp_options, so a database
 * dump or a leaked backup doesn't expose live credentials in plaintext.
 *
 * Scheme: AES-256-CBC with a random IV, authenticated with HMAC-SHA256
 * (encrypt-then-MAC). The key is derived from the site's WordPress salts, so
 * no extra secret needs storing — but it also means that regenerating the
 * salts (changing the keys in wp-config.php) makes existing ciphertext
 * unreadable; in that case the affected keys simply read back blank and are
 * re-entered in Settings.
 *
 * Values are tagged with a version prefix so plaintext (pre-encryption) values
 * are detected and passed through unchanged — the migration is lazy and safe.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGD_Crypto {

	/** Marks an encrypted, base64-encoded payload. */
	const PREFIX = 'hgdc1$';

	/** Is openssl available for real encryption? */
	public static function available() {
		return function_exists( 'openssl_encrypt' ) && function_exists( 'openssl_decrypt' );
	}

	/** Already an encrypted payload? */
	public static function is_encrypted( $value ) {
		return is_string( $value ) && 0 === strpos( $value, self::PREFIX );
	}

	/** 32-byte key derived from the WP salts, separated by purpose. */
	private static function key( $purpose ) {
		$salt = function_exists( 'wp_salt' ) ? wp_salt( 'secure_auth' ) : ( defined( 'AUTH_KEY' ) ? AUTH_KEY : __FILE__ );
		return hash( 'sha256', 'hgd-crypto|' . $purpose . '|' . $salt, true );
	}

	/**
	 * Encrypt a string. Returns a prefixed, base64 payload, or the original
	 * value unchanged when it's empty or openssl is unavailable (graceful
	 * degradation — never blocks saving a setting).
	 */
	public static function encrypt( $plain ) {
		$plain = (string) $plain;
		if ( '' === $plain || self::is_encrypted( $plain ) || ! self::available() ) {
			return $plain;
		}
		$iv     = openssl_random_pseudo_bytes( 16 );
		$cipher = openssl_encrypt( $plain, 'aes-256-cbc', self::key( 'enc' ), OPENSSL_RAW_DATA, $iv );
		if ( false === $cipher ) {
			return $plain;
		}
		$mac = hash_hmac( 'sha256', $iv . $cipher, self::key( 'mac' ), true );
		return self::PREFIX . base64_encode( $iv . $mac . $cipher );
	}

	/**
	 * Decrypt a payload produced by encrypt(). A value that isn't in our
	 * encrypted format is returned unchanged (legacy plaintext passthrough).
	 * A tampered or undecryptable payload returns '' (fail safe).
	 */
	public static function decrypt( $value ) {
		if ( ! self::is_encrypted( $value ) ) {
			return $value; // legacy plaintext, or already clear
		}
		if ( ! self::available() ) {
			return '';
		}
		$raw = base64_decode( substr( $value, strlen( self::PREFIX ) ), true );
		if ( false === $raw || strlen( $raw ) < 48 ) {
			return '';
		}
		$iv     = substr( $raw, 0, 16 );
		$mac    = substr( $raw, 16, 32 );
		$cipher = substr( $raw, 48 );

		$calc = hash_hmac( 'sha256', $iv . $cipher, self::key( 'mac' ), true );
		if ( ! hash_equals( $calc, $mac ) ) {
			return ''; // integrity check failed
		}
		$plain = openssl_decrypt( $cipher, 'aes-256-cbc', self::key( 'enc' ), OPENSSL_RAW_DATA, $iv );
		return false === $plain ? '' : $plain;
	}
}
