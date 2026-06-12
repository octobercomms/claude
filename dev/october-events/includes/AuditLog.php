<?php
declare(strict_types=1);

namespace OE;

defined('ABSPATH') || exit;

/**
 * Lightweight audit trail (§3.2 references "Audit log entry created").
 *
 * Entries are appended to a custom table `{$wpdb->prefix}oe_audit_log`
 * (prefixed `oe_` per §10). Used for approvals, refunds, auto-approve events
 * and connector activity.
 */
final class AuditLog {

    public static function table(): string {
        global $wpdb;
        return $wpdb->prefix . 'oe_audit_log';
    }

    /**
     * Create the table on activation.
     */
    public static function install(): void {
        global $wpdb;
        $table   = self::table();
        $charset = $wpdb->get_charset_collate();

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta("CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            created_at DATETIME NOT NULL,
            object_id BIGINT UNSIGNED NULL,
            object_type VARCHAR(40) NULL,
            actor_id BIGINT UNSIGNED NULL,
            action VARCHAR(60) NOT NULL,
            detail TEXT NULL,
            PRIMARY KEY  (id),
            KEY object_id (object_id),
            KEY action (action)
        ) {$charset};");
    }

    public static function record(string $action, int $object_id = 0, string $object_type = '', string $detail = ''): void {
        global $wpdb;
        $wpdb->insert(self::table(), [
            'created_at'  => current_time('mysql', true),
            'object_id'   => $object_id ?: null,
            'object_type' => $object_type ?: null,
            'actor_id'    => get_current_user_id() ?: null,
            'action'      => $action,
            'detail'      => $detail,
        ]);
        Logger::log("audit: {$action}", ['object' => $object_id, 'detail' => $detail]);
    }

    /**
     * Recent entries for an object, newest first.
     *
     * @return array<int,object>
     */
    public static function for_object(int $object_id, int $limit = 50): array {
        global $wpdb;
        return $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM " . self::table() . " WHERE object_id = %d ORDER BY id DESC LIMIT %d",
            $object_id,
            $limit
        )) ?: [];
    }
}
