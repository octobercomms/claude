<?php
declare(strict_types=1);

namespace ADF;

defined('ABSPATH') || exit;

/**
 * Authenticated encryption for secrets stored in the database (ADF-05).
 *
 * Uses libsodium (bundled in PHP 7.2+). Values are stored as `enc:<base64>`
 * where the payload is nonce || ciphertext. Decrypt() passes through any value
 * that is not `enc:`-prefixed, so existing plaintext rows keep working and the
 * change is backward-compatible.
 *
 * The key is derived from a dedicated `ADF_ENCRYPTION_KEY` constant if defined,
 * otherwise from WordPress's auth salts. (Rotating those salts invalidates
 * stored secrets — they simply need re-entering, which is acceptable.)
 */
final class Crypto {

    private const PREFIX = 'enc:';

    public static function available(): bool {
        return function_exists('sodium_crypto_secretbox');
    }

    public static function is_encrypted(string $value): bool {
        return strpos($value, self::PREFIX) === 0;
    }

    public static function encrypt(string $plain): string {
        if ($plain === '' || ! self::available()) {
            return $plain;
        }
        $nonce  = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $cipher = sodium_crypto_secretbox($plain, $nonce, self::key());
        $out    = self::PREFIX . base64_encode($nonce . $cipher);
        sodium_memzero($plain);
        return $out;
    }

    public static function decrypt(string $value): string {
        if (! self::is_encrypted($value) || ! self::available()) {
            return $value;
        }
        $raw = base64_decode(substr($value, strlen(self::PREFIX)), true);
        if ($raw === false || strlen($raw) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES) {
            return '';
        }
        $nonce  = substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $cipher = substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $plain  = sodium_crypto_secretbox_open($cipher, $nonce, self::key());
        return $plain === false ? '' : $plain;
    }

    private static function key(): string {
        if (defined('ADF_ENCRYPTION_KEY') && ADF_ENCRYPTION_KEY) {
            return hash('sha256', (string) ADF_ENCRYPTION_KEY, true);
        }
        $salt = (defined('AUTH_KEY') ? AUTH_KEY : '') . (defined('SECURE_AUTH_SALT') ? SECURE_AUTH_SALT : '');
        return hash('sha256', 'adf-festival|' . $salt, true); // 32 raw bytes
    }
}
