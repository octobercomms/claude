<?php
declare(strict_types=1);

namespace OE\Ticketing;

defined('ABSPATH') || exit;

/**
 * Ticketing schema — relational tables, mirroring the proven Event Tickets
 * model (orders → tickets, check-ins, promo codes) but with an `oe_` prefix.
 *
 * This replaces the earlier flat `oe_ticket` CPT so an event can sell multiple
 * ticket types, group ("admits N") tickets, and so check-ins/promos/capacity
 * work relationally and cheaply.
 */
final class Schema {

    public static function orders(): string   { global $wpdb; return $wpdb->prefix . 'oe_orders'; }
    public static function tickets(): string  { global $wpdb; return $wpdb->prefix . 'oe_tickets'; }
    public static function checkins(): string { global $wpdb; return $wpdb->prefix . 'oe_checkins'; }
    public static function promos(): string   { global $wpdb; return $wpdb->prefix . 'oe_promo_codes'; }

    public static function install(): void {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';

        $orders = self::orders();
        dbDelta("CREATE TABLE {$orders} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            event_id BIGINT UNSIGNED NOT NULL,
            email VARCHAR(190) NOT NULL,
            name VARCHAR(190) DEFAULT '',
            ticket_type_key VARCHAR(100) NOT NULL,
            ticket_type_label VARCHAR(190) NOT NULL,
            qty SMALLINT UNSIGNED DEFAULT 1,
            unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
            promo_code VARCHAR(50) DEFAULT NULL,
            discount_amount DECIMAL(10,2) DEFAULT 0,
            total DECIMAL(10,2) NOT NULL DEFAULT 0,
            currency VARCHAR(3) DEFAULT 'USD',
            payment_method VARCHAR(20) DEFAULT 'stripe',
            payment_id VARCHAR(190) DEFAULT NULL,
            source VARCHAR(20) NOT NULL DEFAULT 'public',
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            account_id BIGINT UNSIGNED NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY event_id (event_id),
            KEY email (email),
            KEY payment_id (payment_id),
            KEY status (status)
        ) {$charset};");

        $tickets = self::tickets();
        dbDelta("CREATE TABLE {$tickets} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            order_id BIGINT UNSIGNED NOT NULL,
            event_id BIGINT UNSIGNED NOT NULL,
            ticket_type_label VARCHAR(190) NOT NULL,
            attendee_name VARCHAR(190) DEFAULT '',
            token VARCHAR(64) NOT NULL,
            ticket_number SMALLINT UNSIGNED DEFAULT 1,
            total_in_order SMALLINT UNSIGNED DEFAULT 1,
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY token (token),
            KEY order_id (order_id),
            KEY event_id (event_id)
        ) {$charset};");

        $checkins = self::checkins();
        dbDelta("CREATE TABLE {$checkins} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            ticket_id BIGINT UNSIGNED NOT NULL,
            event_id BIGINT UNSIGNED NOT NULL,
            venue_name VARCHAR(190) DEFAULT '',
            scanned_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY ticket_id (ticket_id),
            KEY event_id (event_id)
        ) {$charset};");

        $promos = self::promos();
        dbDelta("CREATE TABLE {$promos} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            code VARCHAR(50) NOT NULL,
            event_id BIGINT UNSIGNED DEFAULT NULL,
            discount_type VARCHAR(10) NOT NULL DEFAULT 'percent',
            discount_value DECIMAL(10,2) NOT NULL DEFAULT 0,
            max_uses INT UNSIGNED DEFAULT NULL,
            used_count INT UNSIGNED DEFAULT 0,
            expires_at DATETIME DEFAULT NULL,
            active TINYINT(1) DEFAULT 1,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY code (code),
            KEY event_id (event_id)
        ) {$charset};");
    }
}
