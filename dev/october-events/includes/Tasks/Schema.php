<?php
declare(strict_types=1);

namespace OE\Tasks;

defined('ABSPATH') || exit;

/**
 * Tasks storage. A shared task list for the whole team (festival ops), grouped
 * by department — replacing the single-user Notion task board. Org-wide, so it
 * lives on the hub site and is surfaced in the platform.
 */
final class Schema {

    public static function table(): string {
        global $wpdb;
        return $wpdb->prefix . 'oe_tasks';
    }

    public static function install(): void {
        global $wpdb;
        $table   = self::table();
        $charset = $wpdb->get_charset_collate();
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta("CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            title VARCHAR(255) NOT NULL,
            department VARCHAR(60) NOT NULL DEFAULT 'Uncategorized',
            status VARCHAR(20) NOT NULL DEFAULT 'todo',
            due_date DATE NULL,
            assignee VARCHAR(190) NULL,
            notes TEXT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY department (department),
            KEY status (status),
            KEY due_date (due_date)
        ) {$charset};");
    }
}
