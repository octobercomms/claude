<?php
declare(strict_types=1);

namespace OE\Mail;

defined('ABSPATH') || exit;

/**
 * Do-not-send list — hard bounces, complaints and unsubscribes. Honoured on
 * every outgoing email. (Bounce/complaint ingestion from SES → SNS lands in a
 * later phase; the table + checks exist now so unsubscribes can populate it.)
 */
final class Suppression {

    public static function table(): string {
        global $wpdb;
        return $wpdb->prefix . 'oe_suppression';
    }

    public static function install(): void {
        global $wpdb;
        $table   = self::table();
        $charset = $wpdb->get_charset_collate();
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta("CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            email VARCHAR(190) NOT NULL,
            reason VARCHAR(40) NOT NULL DEFAULT 'unsubscribe',
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY email (email)
        ) {$charset};");
    }

    public static function is_suppressed(string $email): bool {
        $email = strtolower(trim($email));
        if ($email === '') {
            return false;
        }
        global $wpdb;
        return (bool) $wpdb->get_var($wpdb->prepare(
            'SELECT 1 FROM ' . self::table() . ' WHERE email = %s LIMIT 1',
            $email
        ));
    }

    public static function add(string $email, string $reason = 'unsubscribe'): void {
        $email = strtolower(trim($email));
        if (! is_email($email)) {
            return;
        }
        global $wpdb;
        // Insert-ignore on the unique email key.
        $wpdb->query($wpdb->prepare(
            'INSERT IGNORE INTO ' . self::table() . ' (email, reason, created_at) VALUES (%s, %s, %s)',
            $email,
            sanitize_key($reason) ?: 'unsubscribe',
            current_time('mysql', true)
        ));
    }

    public static function remove(string $email): void {
        global $wpdb;
        $wpdb->delete(self::table(), ['email' => strtolower(trim($email))]);
    }

    public static function count(): int {
        global $wpdb;
        return (int) $wpdb->get_var('SELECT COUNT(*) FROM ' . self::table());
    }
}
