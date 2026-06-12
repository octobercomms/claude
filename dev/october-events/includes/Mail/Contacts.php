<?php
declare(strict_types=1);

namespace OE\Mail;

defined('ABSPATH') || exit;

/**
 * Native contacts — the unified person record the messaging stack sends to,
 * derived from data the plugin already owns (accounts, ticket buyers,
 * volunteers, listing submitters). De-duped on email. This is what removes the
 * manual Brevo contact import (see docs/october-events/EMAIL-PLATFORM.md).
 *
 * Captured forward (every signup/order/account upserts here) and back-fillable
 * on demand from the existing tables.
 */
final class Contacts {

    public const STATUS_SUBSCRIBED   = 'subscribed';
    public const STATUS_UNSUBSCRIBED = 'unsubscribed';

    public static function table(): string {
        global $wpdb;
        return $wpdb->prefix . 'oe_contacts';
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
            sms_opt_in TINYINT(1) NOT NULL DEFAULT 0,
            source VARCHAR(40) NOT NULL DEFAULT '',
            status VARCHAR(20) NOT NULL DEFAULT 'subscribed',
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY email (email),
            KEY status (status),
            KEY source (source)
        ) {$charset};");
    }

    public static function get(string $email): ?object {
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare(
            'SELECT * FROM ' . self::table() . ' WHERE email = %s',
            strtolower(trim($email))
        )) ?: null;
    }

    /**
     * Insert or merge a contact. Existing non-empty fields are preserved (we
     * only fill blanks), and an unsubscribed contact is never silently
     * re-subscribed. Returns the contact id (0 on invalid email).
     *
     * @param array<string,mixed> $data name, phone, sms_opt_in, source
     */
    public static function capture(string $email, array $data = []): int {
        $email = strtolower(trim($email));
        if (! is_email($email)) {
            return 0;
        }
        global $wpdb;
        $now    = current_time('mysql', true);
        $name   = sanitize_text_field((string) ($data['name'] ?? ''));
        $phone  = sanitize_text_field((string) ($data['phone'] ?? ''));
        $sms    = ! empty($data['sms_opt_in']) ? 1 : 0;
        $source = sanitize_key((string) ($data['source'] ?? ''));

        $existing = self::get($email);
        if ($existing) {
            $update = ['updated_at' => $now];
            if ($name !== '' && (string) $existing->name === '') { $update['name'] = $name; }
            if ($phone !== '' && (string) $existing->phone === '') { $update['phone'] = $phone; }
            if ($sms) { $update['sms_opt_in'] = 1; }
            $wpdb->update(self::table(), $update, ['id' => (int) $existing->id]);
            return (int) $existing->id;
        }

        $status = Suppression::is_suppressed($email) ? self::STATUS_UNSUBSCRIBED : self::STATUS_SUBSCRIBED;
        $wpdb->insert(self::table(), [
            'email'      => $email,
            'name'       => $name,
            'phone'      => $phone,
            'sms_opt_in' => $sms,
            'source'     => $source ?: 'manual',
            'status'     => $status,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        return (int) $wpdb->insert_id;
    }

    public static function unsubscribe(string $email): void {
        global $wpdb;
        $wpdb->update(
            self::table(),
            ['status' => self::STATUS_UNSUBSCRIBED, 'updated_at' => current_time('mysql', true)],
            ['email' => strtolower(trim($email))]
        );
        Suppression::add($email, 'unsubscribe');
    }

    /**
     * @return array<int,object>
     */
    public static function search(string $term = '', int $limit = 50, int $offset = 0): array {
        global $wpdb;
        $limit  = max(1, min(200, $limit));
        $offset = max(0, $offset);
        $t = self::table();
        if ($term !== '') {
            $like = '%' . $wpdb->esc_like($term) . '%';
            return $wpdb->get_results($wpdb->prepare(
                "SELECT * FROM {$t} WHERE email LIKE %s OR name LIKE %s ORDER BY updated_at DESC LIMIT %d OFFSET %d",
                $like, $like, $limit, $offset
            )) ?: [];
        }
        return $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM {$t} ORDER BY updated_at DESC LIMIT %d OFFSET %d",
            $limit, $offset
        )) ?: [];
    }

    /** @return array{total:int,subscribed:int,unsubscribed:int,sms:int} */
    public static function counts(): array {
        global $wpdb;
        $t = self::table();
        return [
            'total'        => (int) $wpdb->get_var("SELECT COUNT(*) FROM {$t}"),
            'subscribed'   => (int) $wpdb->get_var("SELECT COUNT(*) FROM {$t} WHERE status='subscribed'"),
            'unsubscribed' => (int) $wpdb->get_var("SELECT COUNT(*) FROM {$t} WHERE status='unsubscribed'"),
            'sms'          => (int) $wpdb->get_var("SELECT COUNT(*) FROM {$t} WHERE sms_opt_in=1"),
        ];
    }

    /**
     * Build/refresh contacts from the data the plugin already holds. Idempotent
     * (capture de-dupes on email). Returns the resulting counts.
     *
     * @return array{total:int,subscribed:int,unsubscribed:int,sms:int}
     */
    public static function backfill(): array {
        global $wpdb;

        // Accounts (oe_account posts carry the email in _oe_email meta).
        $accounts = $wpdb->get_results(
            "SELECT p.ID AS id, pm.meta_value AS email
             FROM {$wpdb->posts} p
             JOIN {$wpdb->postmeta} pm ON pm.post_id = p.ID AND pm.meta_key = '_oe_email'
             WHERE p.post_type = 'oe_account'"
        ) ?: [];
        foreach ($accounts as $a) {
            self::capture((string) $a->email, ['name' => get_the_title((int) $a->id), 'source' => 'account']);
        }

        // Ticket buyers.
        $orders_table = $wpdb->prefix . 'oe_orders';
        if ((string) $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $orders_table)) === $orders_table) {
            $orders = $wpdb->get_results("SELECT DISTINCT email, name FROM {$orders_table} WHERE email <> ''") ?: [];
            foreach ($orders as $o) {
                self::capture((string) $o->email, ['name' => (string) $o->name, 'source' => 'ticket']);
            }
        }

        // Volunteers.
        $vol_table = $wpdb->prefix . 'oe_volunteer_signups';
        if ((string) $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $vol_table)) === $vol_table) {
            $vs = $wpdb->get_results("SELECT DISTINCT email, name, phone, sms_opt_in FROM {$vol_table} WHERE email <> ''") ?: [];
            foreach ($vs as $v) {
                self::capture((string) $v->email, [
                    'name'       => (string) $v->name,
                    'phone'      => (string) $v->phone,
                    'sms_opt_in' => (int) $v->sms_opt_in,
                    'source'     => 'volunteer',
                ]);
            }
        }

        return self::counts();
    }
}
