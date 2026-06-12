<?php
declare(strict_types=1);

namespace OE\Mail;

defined('ABSPATH') || exit;

/**
 * Outgoing email log — every site email October Events sends is recorded here
 * (status, recipient, subject, driver, error). Replaces the "Check & Log Email"
 * plugin: a built-in record + a "send test" for debugging deliverability.
 */
final class EmailLog {

    public static function table(): string {
        global $wpdb;
        return $wpdb->prefix . 'oe_email_log';
    }

    public static function install(): void {
        global $wpdb;
        $table   = self::table();
        $charset = $wpdb->get_charset_collate();
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta("CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            recipients TEXT NULL,
            subject VARCHAR(255) NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'sent',
            driver VARCHAR(20) NOT NULL DEFAULT 'default',
            error TEXT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY status (status),
            KEY created_at (created_at)
        ) {$charset};");
    }

    /**
     * @param array<string,mixed> $data wp_mail-style data (to, subject, …)
     */
    public static function record(array $data, string $status, string $driver = '', string $error = ''): void {
        global $wpdb;
        $to = $data['to'] ?? '';
        if (is_array($to)) {
            $to = implode(', ', $to);
        }
        $wpdb->insert(self::table(), [
            'recipients' => substr((string) $to, 0, 65535),
            'subject'    => substr((string) ($data['subject'] ?? ''), 0, 255),
            'status'     => $status,
            'driver'     => $driver ?: 'default',
            'error'      => substr($error, 0, 65535),
            'created_at' => current_time('mysql', true),
        ]);
        // Keep the log from growing without bound.
        self::prune();
    }

    /** @return array<int,object> */
    public static function recent(int $limit = 50): array {
        global $wpdb;
        $limit = max(1, min(500, $limit));
        return $wpdb->get_results($wpdb->prepare(
            'SELECT * FROM ' . self::table() . ' ORDER BY id DESC LIMIT %d',
            $limit
        )) ?: [];
    }

    /** @return array{sent:int,failed:int,suppressed:int} */
    public static function counts(): array {
        global $wpdb;
        $t = self::table();
        return [
            'sent'       => (int) $wpdb->get_var("SELECT COUNT(*) FROM {$t} WHERE status='sent'"),
            'failed'     => (int) $wpdb->get_var("SELECT COUNT(*) FROM {$t} WHERE status='failed'"),
            'suppressed' => (int) $wpdb->get_var("SELECT COUNT(*) FROM {$t} WHERE status='suppressed'"),
        ];
    }

    /** Trim the log to the most recent ~2000 rows (cheap, runs occasionally). */
    private static function prune(): void {
        global $wpdb;
        if (wp_rand(1, 50) !== 1) {
            return;
        }
        $t = self::table();
        $cutoff = (int) $wpdb->get_var("SELECT id FROM {$t} ORDER BY id DESC LIMIT 1 OFFSET 2000");
        if ($cutoff > 0) {
            $wpdb->query($wpdb->prepare("DELETE FROM {$t} WHERE id < %d", $cutoff));
        }
    }
}
