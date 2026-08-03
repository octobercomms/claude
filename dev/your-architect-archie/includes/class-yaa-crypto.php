<?php
/**
 * Secret-at-rest encryption for the Claude key + Stripe secret.
 *
 * AES-256-CBC with a random IV, authenticated with HMAC-SHA256 (encrypt-then-MAC).
 * The key is derived from the site's WordPress salts, so nothing extra is stored.
 * Values are tagged with a version prefix, so pre-encryption plaintext is detected
 * and passed through unchanged (lazy, safe migration). Mirrors HGD_Crypto.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Crypto {

	const PREFIX = 'yaac1$';

	public static function available() {
		return function_exists( 'openssl_encrypt' ) && function_exists( 'openssl_decrypt' );
	}

	public static function is_encrypted( $value ) {
		return is_string( $value ) && 0 === strpos( $value, self::PREFIX );
	}

	private static function key( $purpose ) {
		$material = ( defined( 'AUTH_KEY' ) ? AUTH_KEY : '' ) . ( defined( 'SECURE_AUTH_SALT' ) ? SECURE_AUTH_SALT : '' ) . $purpose;
		return hash( 'sha256', 'yaa|' . $purpose . '|' . $material, true );
	}

	public static function encrypt( $plaintext ) {
		if ( '' === (string) $plaintext || ! self::available() ) {
			return (string) $plaintext;
		}
		$iv  = openssl_random_pseudo_bytes( 16 );
		$ct  = openssl_encrypt( (string) $plaintext, 'aes-256-cbc', self::key( 'enc' ), OPENSSL_RAW_DATA, $iv );
		$mac = hash_hmac( 'sha256', $iv . $ct, self::key( 'mac' ), true );
		return self::PREFIX . base64_encode( $iv . $mac . $ct );
	}

	public static function decrypt( $value ) {
		if ( ! self::is_encrypted( $value ) ) {
			return (string) $value; // plaintext (pre-encryption) — pass through.
		}
		if ( ! self::available() ) {
			return '';
		}
		$raw = base64_decode( substr( $value, strlen( self::PREFIX ) ), true );
		if ( false === $raw || strlen( $raw ) < 48 ) {
			return '';
		}
		$iv   = substr( $raw, 0, 16 );
		$mac  = substr( $raw, 16, 32 );
		$ct   = substr( $raw, 48 );
		$calc = hash_hmac( 'sha256', $iv . $ct, self::key( 'mac' ), true );
		if ( ! hash_equals( $calc, $mac ) ) {
			return '';
		}
		$pt = openssl_decrypt( $ct, 'aes-256-cbc', self::key( 'enc' ), OPENSSL_RAW_DATA, $iv );
		return false === $pt ? '' : $pt;
	}
}
