<?php
declare(strict_types=1);

namespace OE\Volunteers\Pool;

defined('ABSPATH') || exit;

/**
 * Volunteer early-recruitment pool storage (BUILD-PLAN M7, volunteer-pool.md
 * step 2). One row per person who registers interest for the year, before any
 * specific home/event exists. Home-agnostic: it captures contact + zipcode +
 * which recruitment window×roles they can do (a JSON list of window ids), so
 * recruitment and allocation stay separate.
 *
 * Deduped on email (one pool entry per person per cycle); the `token` gives a
 * no-login link for the later "choose your slot" step.
 */
final class Schema {

    public static function table(): string {
        global $wpdb;
        return $wpdb->prefix . 'oe_volunteer_pool';
    }

    public static function install(): void {
        global $wpdb;
        $table   = self::table();
        $charset = $wpdb->get_charset_collate();
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta("CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            name VARCHAR(190) NOT NULL DEFAULT '',
            email VARCHAR(190) NOT NULL,
            phone VARCHAR(40) NOT NULL DEFAULT '',
            zip VARCHAR(20) NOT NULL DEFAULT '',
            windows LONGTEXT NULL,
            travel VARCHAR(40) NOT NULL DEFAULT '',
            notes TEXT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'registered',
            signup_id BIGINT UNSIGNED NULL,
            token VARCHAR(40) NOT NULL DEFAULT '',
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY email (email),
            KEY status (status)
        ) {$charset};");
    }
}
