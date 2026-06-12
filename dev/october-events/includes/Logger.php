<?php
declare(strict_types=1);

namespace OE;

defined('ABSPATH') || exit;

/**
 * Debug logger — writes to wp-content/oe-debug.log when WP_DEBUG is on.
 *
 * ADF-07: context is scrubbed before writing — values under sensitive keys are
 * redacted and long strings (e.g. raw API response bodies) are truncated — so
 * secrets/PII don't accumulate in a file under the web root.
 */
final class Logger {

    /** Substrings that mark a context key as sensitive (case-insensitive). */
    private const SENSITIVE = ['secret', 'token', 'api_key', 'api-key', 'apikey', 'authorization', 'password', 'client_secret', 'pin', 'card'];

    public static function log(string $message, $context = null): void {
        if (! (defined('WP_DEBUG') && WP_DEBUG)) {
            return;
        }
        $line = sprintf('[%s] %s', gmdate('Y-m-d H:i:s'), $message);
        if ($context !== null) {
            $line .= ' ' . wp_json_encode(self::scrub($context));
        }
        error_log($line . PHP_EOL, 3, WP_CONTENT_DIR . '/oe-debug.log');
    }

    /**
     * Recursively redact sensitive keys and truncate long strings.
     *
     * @param mixed $data
     * @return mixed
     */
    private static function scrub($data) {
        if (is_array($data)) {
            $out = [];
            foreach ($data as $k => $v) {
                $key = is_string($k) ? strtolower($k) : '';
                $is_sensitive = false;
                foreach (self::SENSITIVE as $needle) {
                    if ($key !== '' && strpos($key, $needle) !== false) {
                        $is_sensitive = true;
                        break;
                    }
                }
                $out[$k] = $is_sensitive ? '[redacted]' : self::scrub($v);
            }
            return $out;
        }
        if (is_string($data) && strlen($data) > 500) {
            return substr($data, 0, 500) . '…[truncated]';
        }
        return $data;
    }
}
