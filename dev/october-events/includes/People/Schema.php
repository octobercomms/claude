<?php
declare(strict_types=1);

namespace OE\People;

defined('ABSPATH') || exit;

/**
 * Unified people table (BUILD-PLAN M5 — CRM unification).
 *
 * One row per person on this install, keyed on email, merging the identity and
 * rollups from the records the plugin already holds: ticket orders/attendance,
 * volunteer signups, the recruitment pool, and the marketing contact. It is a
 * materialised record (rebuilt on demand and by the daily cron); the per-person
 * profile joins the source tables live for detail, so the rollups being at most
 * a day stale never hides a record.
 *
 * Per-install by design: each tenant (festival, tours) is a separate WordPress
 * install with its own database, so people are never merged across tenants.
 */
final class Schema {

    public static function table(): string {
        global $wpdb;
        return $wpdb->prefix . 'oe_people';
    }

    public static function install(): void {
        global $wpdb;
        $table   = self::table();
        $charset = $wpdb->get_charset_collate();
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta("CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            email VARCHAR(190) NOT NULL,
            name VARCHAR(190) NOT NULL DEFAULT '',
            phone VARCHAR(40) NOT NULL DEFAULT '',
            orders INT UNSIGNED NOT NULL DEFAULT 0,
            tickets INT UNSIGNED NOT NULL DEFAULT 0,
            revenue DECIMAL(10,2) NOT NULL DEFAULT 0,
            volunteer INT UNSIGNED NOT NULL DEFAULT 0,
            pool TINYINT(1) NOT NULL DEFAULT 0,
            subscribed TINYINT(1) NOT NULL DEFAULT 0,
            first_seen DATETIME NULL,
            last_seen DATETIME NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY email (email),
            KEY last_seen (last_seen)
        ) {$charset};");
    }
}
