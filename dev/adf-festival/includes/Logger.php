<?php
declare(strict_types=1);

namespace ADF;

defined('ABSPATH') || exit;

/**
 * Debug logger (§10) — writes to wp-content/adf-debug.log when WP_DEBUG is on.
 */
final class Logger {

    public static function log(string $message, $context = null): void {
        if (! (defined('WP_DEBUG') && WP_DEBUG)) {
            return;
        }
        $line = sprintf('[%s] %s', gmdate('Y-m-d H:i:s'), $message);
        if ($context !== null) {
            $line .= ' ' . wp_json_encode($context);
        }
        $file = WP_CONTENT_DIR . '/adf-debug.log';
        error_log($line . PHP_EOL, 3, $file);
    }
}
