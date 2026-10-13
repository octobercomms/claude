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
        error_log($line . PHP_EOL, 3, self::path());
    }

    /** Absolute path of the debug log file. */
    public static function path(): string {
        return WP_CONTENT_DIR . '/oe-debug.log';
    }

    /** Whether debug logging is currently on (WP_DEBUG). */
    public static function enabled(): bool {
        return defined('WP_DEBUG') && WP_DEBUG;
    }

    /** Size of the log file in bytes (0 if none). */
    public static function size(): int {
        $p = self::path();
        return is_readable($p) ? (int) filesize($p) : 0;
    }

    /**
     * The last $lines lines of the log, newest last (file order). Reads only
     * the tail of the file so a large log never loads whole.
     *
     * @return array<int,string>
     */
    public static function tail(int $lines = 300): array {
        $p = self::path();
        if (! is_readable($p)) {
            return [];
        }
        $lines = max(1, min(2000, $lines));
        $fh = @fopen($p, 'rb');
        if (! $fh) {
            return [];
        }
        // Read backwards in chunks until we have enough newlines.
        $buffer = '';
        $chunk  = 4096;
        $pos    = fstat($fh)['size'] ?? 0;
        $found  = 0;
        while ($pos > 0 && $found <= $lines) {
            $read = (int) min($chunk, $pos);
            $pos -= $read;
            fseek($fh, $pos);
            $data   = (string) fread($fh, $read);
            $buffer = $data . $buffer;
            $found  = substr_count($buffer, "\n");
        }
        fclose($fh);
        $all = explode("\n", rtrim($buffer, "\n"));
        return array_slice($all, -$lines);
    }

    /** Empty the log file. Returns true on success. */
    public static function clear(): bool {
        $p = self::path();
        if (! file_exists($p)) {
            return true;
        }
        return (bool) @file_put_contents($p, '');
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
