<?php
declare(strict_types=1);

namespace OctoberTickets;

defined('ABSPATH') || exit;

/**
 * Database table management.
 */
class DB {

    const VERSION_OPTION = 'oct_tickets_db_version';
    const DB_VERSION     = '1.0.0';

    public static function create_tables(): void {
        global $wpdb;

        $charset_collate = $wpdb->get_charset_collate();
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';

        // Orders table
        $sql_orders = "CREATE TABLE {$wpdb->prefix}oct_orders (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            event_id bigint(20) unsigned NOT NULL,
            email varchar(255) NOT NULL,
            name varchar(255) DEFAULT '',
            ticket_type_key varchar(100) NOT NULL,
            ticket_type_label varchar(255) NOT NULL,
            qty tinyint(3) unsigned NOT NULL DEFAULT 1,
            unit_price decimal(10,2) NOT NULL,
            promo_code varchar(50) DEFAULT NULL,
            discount_amount decimal(10,2) DEFAULT 0.00,
            total decimal(10,2) NOT NULL,
            currency varchar(3) DEFAULT 'USD',
            payment_method enum('stripe','paypal') NOT NULL,
            payment_id varchar(255) DEFAULT NULL,
            status enum('pending','paid','cancelled','refunded') DEFAULT 'pending',
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY (id),
            KEY event_id (event_id),
            KEY email (email),
            KEY status (status),
            KEY payment_id (payment_id)
        ) $charset_collate;";

        // Tickets table
        $sql_tickets = "CREATE TABLE {$wpdb->prefix}oct_tickets (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            order_id bigint(20) unsigned NOT NULL,
            event_id bigint(20) unsigned NOT NULL,
            ticket_type_label varchar(255) NOT NULL,
            attendee_name varchar(255) DEFAULT '',
            token varchar(64) NOT NULL,
            ticket_number tinyint(3) unsigned DEFAULT 1,
            total_in_order tinyint(3) unsigned DEFAULT 1,
            status enum('active','cancelled') DEFAULT 'active',
            created_at datetime NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY token (token),
            KEY order_id (order_id),
            KEY event_id (event_id)
        ) $charset_collate;";

        // Check-ins table
        $sql_checkins = "CREATE TABLE {$wpdb->prefix}oct_checkins (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            ticket_id bigint(20) unsigned NOT NULL,
            event_id bigint(20) unsigned NOT NULL,
            venue_name varchar(255) DEFAULT '',
            scanned_at datetime NOT NULL,
            PRIMARY KEY (id),
            KEY ticket_id (ticket_id),
            KEY event_id (event_id)
        ) $charset_collate;";

        // Promo codes table
        $sql_promos = "CREATE TABLE {$wpdb->prefix}oct_promo_codes (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            code varchar(50) NOT NULL,
            event_id bigint(20) unsigned DEFAULT NULL,
            discount_type enum('percent','fixed') DEFAULT 'percent',
            discount_value decimal(10,2) NOT NULL,
            max_uses int(10) unsigned DEFAULT NULL,
            used_count int(10) unsigned DEFAULT 0,
            expires_at datetime DEFAULT NULL,
            active tinyint(1) DEFAULT 1,
            created_at datetime NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY code (code),
            KEY event_id (event_id)
        ) $charset_collate;";

        dbDelta($sql_orders);
        dbDelta($sql_tickets);
        dbDelta($sql_checkins);
        dbDelta($sql_promos);
    }

    public static function set_version(): void {
        update_option(self::VERSION_OPTION, self::DB_VERSION);
    }

    public static function needs_upgrade(): bool {
        return get_option(self::VERSION_OPTION, '0') !== self::DB_VERSION;
    }

    // -------------------------------------------------------------------------
    // Orders
    // -------------------------------------------------------------------------

    public static function insert_order(array $data): int {
        global $wpdb;

        $now = current_time('mysql');
        $wpdb->insert(
            $wpdb->prefix . 'oct_orders',
            array_merge($data, [
                'created_at' => $now,
                'updated_at' => $now,
            ])
        );

        return (int) $wpdb->insert_id;
    }

    public static function get_order(int $id): ?object {
        global $wpdb;
        $row = $wpdb->get_row(
            $wpdb->prepare("SELECT * FROM {$wpdb->prefix}oct_orders WHERE id = %d", $id)
        );
        return $row ?: null;
    }

    public static function update_order_status(int $id, string $status, string $payment_id = ''): void {
        global $wpdb;
        $data = [
            'status'     => $status,
            'updated_at' => current_time('mysql'),
        ];
        if ($payment_id !== '') {
            $data['payment_id'] = $payment_id;
        }
        $wpdb->update(
            $wpdb->prefix . 'oct_orders',
            $data,
            ['id' => $id]
        );
    }

    public static function get_orders(array $args = []): array {
        global $wpdb;

        $where  = '1=1';
        $params = [];

        if (!empty($args['event_id'])) {
            $where   .= ' AND event_id = %d';
            $params[] = (int) $args['event_id'];
        }

        if (!empty($args['status'])) {
            $where   .= ' AND status = %s';
            $params[] = $args['status'];
        }

        if (!empty($args['email'])) {
            $where   .= ' AND email LIKE %s';
            $params[] = '%' . $wpdb->esc_like($args['email']) . '%';
        }

        $limit  = isset($args['limit']) ? (int) $args['limit'] : 50;
        $offset = isset($args['offset']) ? (int) $args['offset'] : 0;

        $sql = "SELECT * FROM {$wpdb->prefix}oct_orders WHERE $where ORDER BY id DESC LIMIT %d OFFSET %d";
        $params[] = $limit;
        $params[] = $offset;

        return (array) $wpdb->get_results(
            empty($params) ? $sql : $wpdb->prepare($sql, $params)
        );
    }

    public static function count_orders(array $args = []): int {
        global $wpdb;

        $where  = '1=1';
        $params = [];

        if (!empty($args['event_id'])) {
            $where   .= ' AND event_id = %d';
            $params[] = (int) $args['event_id'];
        }

        if (!empty($args['status'])) {
            $where   .= ' AND status = %s';
            $params[] = $args['status'];
        }

        if (!empty($args['email'])) {
            $where   .= ' AND email LIKE %s';
            $params[] = '%' . $wpdb->esc_like($args['email']) . '%';
        }

        $sql = "SELECT COUNT(*) FROM {$wpdb->prefix}oct_orders WHERE $where";

        return (int) $wpdb->get_var(
            empty($params) ? $sql : $wpdb->prepare($sql, $params)
        );
    }

    // -------------------------------------------------------------------------
    // Tickets
    // -------------------------------------------------------------------------

    public static function insert_ticket(array $data): int {
        global $wpdb;

        $wpdb->insert(
            $wpdb->prefix . 'oct_tickets',
            array_merge($data, [
                'created_at' => current_time('mysql'),
            ])
        );

        return (int) $wpdb->insert_id;
    }

    public static function get_ticket_by_token(string $token): ?object {
        global $wpdb;
        $row = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT * FROM {$wpdb->prefix}oct_tickets WHERE token = %s",
                $token
            )
        );
        return $row ?: null;
    }

    public static function get_ticket(int $id): ?object {
        global $wpdb;
        $row = $wpdb->get_row(
            $wpdb->prepare("SELECT * FROM {$wpdb->prefix}oct_tickets WHERE id = %d", $id)
        );
        return $row ?: null;
    }

    public static function get_tickets_by_order(int $order_id): array {
        global $wpdb;
        return (array) $wpdb->get_results(
            $wpdb->prepare(
                "SELECT * FROM {$wpdb->prefix}oct_tickets WHERE order_id = %d ORDER BY ticket_number ASC",
                $order_id
            )
        );
    }

    public static function cancel_tickets_by_order(int $order_id): void {
        global $wpdb;
        $wpdb->update(
            $wpdb->prefix . 'oct_tickets',
            ['status' => 'cancelled'],
            ['order_id' => $order_id]
        );
    }

    // -------------------------------------------------------------------------
    // Check-ins
    // -------------------------------------------------------------------------

    public static function insert_checkin(array $data): int {
        global $wpdb;
        $wpdb->insert(
            $wpdb->prefix . 'oct_checkins',
            array_merge($data, [
                'scanned_at' => current_time('mysql'),
            ])
        );
        return (int) $wpdb->insert_id;
    }

    public static function get_checkins_by_ticket(int $ticket_id): array {
        global $wpdb;
        return (array) $wpdb->get_results(
            $wpdb->prepare(
                "SELECT * FROM {$wpdb->prefix}oct_checkins WHERE ticket_id = %d",
                $ticket_id
            )
        );
    }

    public static function get_checkin_stats(int $event_id): array {
        global $wpdb;
        return (array) $wpdb->get_results(
            $wpdb->prepare(
                "SELECT venue_name, COUNT(*) AS count
                 FROM {$wpdb->prefix}oct_checkins
                 WHERE event_id = %d
                 GROUP BY venue_name
                 ORDER BY count DESC",
                $event_id
            )
        );
    }

    public static function get_unique_checkin_count(int $event_id): int {
        global $wpdb;
        return (int) $wpdb->get_var(
            $wpdb->prepare(
                "SELECT COUNT(DISTINCT ticket_id) FROM {$wpdb->prefix}oct_checkins WHERE event_id = %d",
                $event_id
            )
        );
    }

    public static function get_checkins(array $args = []): array {
        global $wpdb;

        $where  = '1=1';
        $params = [];

        if (!empty($args['event_id'])) {
            $where   .= ' AND c.event_id = %d';
            $params[] = (int) $args['event_id'];
        }

        $limit  = isset($args['limit']) ? (int) $args['limit'] : 100;
        $offset = isset($args['offset']) ? (int) $args['offset'] : 0;

        $sql = "SELECT c.*, t.attendee_name, t.ticket_type_label, t.ticket_number, t.total_in_order
                FROM {$wpdb->prefix}oct_checkins c
                LEFT JOIN {$wpdb->prefix}oct_tickets t ON c.ticket_id = t.id
                WHERE $where
                ORDER BY c.scanned_at DESC
                LIMIT %d OFFSET %d";
        $params[] = $limit;
        $params[] = $offset;

        return (array) $wpdb->get_results(
            empty($params) ? $sql : $wpdb->prepare($sql, $params)
        );
    }

    // -------------------------------------------------------------------------
    // Promo Codes
    // -------------------------------------------------------------------------

    public static function get_promo_by_code(string $code): ?object {
        global $wpdb;
        $row = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT * FROM {$wpdb->prefix}oct_promo_codes WHERE code = %s",
                strtoupper($code)
            )
        );
        return $row ?: null;
    }

    public static function increment_promo_usage(int $promo_id): void {
        global $wpdb;
        $wpdb->query(
            $wpdb->prepare(
                "UPDATE {$wpdb->prefix}oct_promo_codes SET used_count = used_count + 1 WHERE id = %d",
                $promo_id
            )
        );
    }

    public static function get_all_promos(array $args = []): array {
        global $wpdb;

        $limit  = isset($args['limit']) ? (int) $args['limit'] : 100;
        $offset = isset($args['offset']) ? (int) $args['offset'] : 0;

        return (array) $wpdb->get_results(
            $wpdb->prepare(
                "SELECT * FROM {$wpdb->prefix}oct_promo_codes ORDER BY id DESC LIMIT %d OFFSET %d",
                $limit,
                $offset
            )
        );
    }

    public static function insert_promo(array $data): int {
        global $wpdb;
        $wpdb->insert(
            $wpdb->prefix . 'oct_promo_codes',
            array_merge($data, [
                'code'       => strtoupper($data['code']),
                'created_at' => current_time('mysql'),
            ])
        );
        return (int) $wpdb->insert_id;
    }

    public static function update_promo(int $id, array $data): void {
        global $wpdb;
        $wpdb->update(
            $wpdb->prefix . 'oct_promo_codes',
            $data,
            ['id' => $id]
        );
    }

    public static function delete_promo(int $id): void {
        global $wpdb;
        $wpdb->delete($wpdb->prefix . 'oct_promo_codes', ['id' => $id]);
    }

    // -------------------------------------------------------------------------
    // Drop tables (uninstall)
    // -------------------------------------------------------------------------

    public static function drop_tables(): void {
        global $wpdb;
        $wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}oct_checkins");
        $wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}oct_tickets");
        $wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}oct_orders");
        $wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}oct_promo_codes");
    }
}
