<?php
declare(strict_types=1);

namespace OE\People;

use OE\Mail\Contacts;
use OE\Ticketing\Schema as TicketSchema;
use OE\Volunteers\Pool\Schema as PoolSchema;

defined('ABSPATH') || exit;

/**
 * Builds and reads the unified people table (BUILD-PLAN M5).
 *
 * rebuild() recomputes every person from grouped aggregates over the source
 * tables (idempotent — safe to run repeatedly), keyed on lower-cased email.
 * The per-person profile() joins the sources live for the detail lists, so the
 * stored rollups are a fast index, not the source of truth.
 */
final class Repository {

    /**
     * Recompute the whole table from the data the plugin owns. Returns the
     * number of people. One grouped query per source, merged in PHP, bulk-upsert.
     */
    public static function rebuild(): int {
        global $wpdb;
        $people = []; // email => row

        $touch = static function (array &$people, string $email, array $vals): void {
            $email = strtolower(trim($email));
            if ($email === '' || ! is_email($email)) {
                return;
            }
            if (! isset($people[$email])) {
                $people[$email] = [
                    'email' => $email, 'name' => '', 'phone' => '',
                    'orders' => 0, 'tickets' => 0, 'revenue' => 0.0,
                    'volunteer' => 0, 'pool' => 0, 'subscribed' => 0,
                    'first_seen' => null, 'last_seen' => null,
                ];
            }
            $p = &$people[$email];
            foreach (['orders', 'tickets', 'volunteer'] as $k) {
                if (isset($vals[$k])) { $p[$k] += (int) $vals[$k]; }
            }
            if (isset($vals['revenue'])) { $p['revenue'] += (float) $vals['revenue']; }
            foreach (['pool', 'subscribed'] as $k) {
                if (! empty($vals[$k])) { $p[$k] = 1; }
            }
            if (! empty($vals['name']) && $p['name'] === '') { $p['name'] = (string) $vals['name']; }
            if (! empty($vals['phone']) && $p['phone'] === '') { $p['phone'] = (string) $vals['phone']; }
            foreach (['first_seen' => 'min', 'last_seen' => 'max'] as $k => $mode) {
                $v = $vals[$k] ?? null;
                if (! $v) { continue; }
                if ($p[$k] === null || ($mode === 'min' ? $v < $p[$k] : $v > $p[$k])) { $p[$k] = $v; }
            }
            unset($p);
        };

        // Paid ticket orders.
        $o = TicketSchema::orders();
        if (self::has_table($o)) {
            $rows = $wpdb->get_results("SELECT email, MAX(name) name, COUNT(*) orders, COALESCE(SUM(qty),0) tickets, COALESCE(SUM(total),0) revenue, MIN(created_at) first_seen, MAX(created_at) last_seen FROM {$o} WHERE status='paid' AND email<>'' GROUP BY email") ?: [];
            foreach ($rows as $r) {
                $touch($people, (string) $r->email, [
                    'name' => $r->name, 'orders' => $r->orders, 'tickets' => $r->tickets,
                    'revenue' => $r->revenue, 'first_seen' => $r->first_seen, 'last_seen' => $r->last_seen,
                ]);
            }
        }

        // Volunteer signups.
        $vs = $wpdb->prefix . 'oe_volunteer_signups';
        if (self::has_table($vs)) {
            $rows = $wpdb->get_results("SELECT email, MAX(name) name, MAX(phone) phone, COUNT(*) volunteer, MIN(created_at) first_seen, MAX(created_at) last_seen FROM {$vs} WHERE email<>'' GROUP BY email") ?: [];
            foreach ($rows as $r) {
                $touch($people, (string) $r->email, [
                    'name' => $r->name, 'phone' => $r->phone, 'volunteer' => $r->volunteer,
                    'first_seen' => $r->first_seen, 'last_seen' => $r->last_seen,
                ]);
            }
        }

        // Recruitment pool.
        $pool = PoolSchema::table();
        if (self::has_table($pool)) {
            $rows = $wpdb->get_results("SELECT email, MAX(name) name, MAX(phone) phone, MIN(created_at) first_seen, MAX(created_at) last_seen FROM {$pool} WHERE email<>'' GROUP BY email") ?: [];
            foreach ($rows as $r) {
                $touch($people, (string) $r->email, [
                    'name' => $r->name, 'phone' => $r->phone, 'pool' => 1,
                    'first_seen' => $r->first_seen, 'last_seen' => $r->last_seen,
                ]);
            }
        }

        // Marketing contacts (identity + subscribed flag).
        $c = Contacts::table();
        if (self::has_table($c)) {
            $rows = $wpdb->get_results("SELECT email, name, phone, status, created_at FROM {$c} WHERE email<>''") ?: [];
            foreach ($rows as $r) {
                $touch($people, (string) $r->email, [
                    'name' => $r->name, 'phone' => $r->phone,
                    'subscribed' => ((string) $r->status === Contacts::STATUS_SUBSCRIBED) ? 1 : 0,
                    'first_seen' => $r->created_at,
                ]);
            }
        }

        // Upsert.
        $t   = self::table();
        $now = current_time('mysql');
        $seen = [];
        foreach ($people as $email => $p) {
            $seen[] = $email;
            $data = [
                'name' => (string) $p['name'], 'phone' => (string) $p['phone'],
                'orders' => (int) $p['orders'], 'tickets' => (int) $p['tickets'],
                'revenue' => number_format((float) $p['revenue'], 2, '.', ''),
                'volunteer' => (int) $p['volunteer'], 'pool' => (int) $p['pool'],
                'subscribed' => (int) $p['subscribed'],
                'first_seen' => $p['first_seen'], 'last_seen' => $p['last_seen'],
                'updated_at' => $now,
            ];
            $id = (int) $wpdb->get_var($wpdb->prepare("SELECT id FROM {$t} WHERE email=%s", $email));
            if ($id) {
                $wpdb->update($t, $data, ['id' => $id]);
            } else {
                $data['email'] = $email;
                $data['created_at'] = $now;
                $wpdb->insert($t, $data);
            }
        }
        // Drop people no longer present in any source.
        if ($seen) {
            $place = implode(',', array_fill(0, count($seen), '%s'));
            $wpdb->query($wpdb->prepare("DELETE FROM {$t} WHERE email NOT IN ({$place})", $seen));
        } else {
            $wpdb->query("TRUNCATE TABLE {$t}");
        }
        return count($people);
    }

    public static function table(): string {
        return Schema::table();
    }

    /** @return array<int,object> people, searchable, newest activity first */
    public static function search(string $term = '', int $limit = 50, int $offset = 0): array {
        global $wpdb;
        $t = self::table();
        $limit = max(1, min(200, $limit));
        $offset = max(0, $offset);
        if ($term !== '') {
            $like = '%' . $wpdb->esc_like($term) . '%';
            return $wpdb->get_results($wpdb->prepare("SELECT * FROM {$t} WHERE email LIKE %s OR name LIKE %s ORDER BY last_seen DESC LIMIT %d OFFSET %d", $like, $like, $limit, $offset)) ?: [];
        }
        return $wpdb->get_results($wpdb->prepare("SELECT * FROM {$t} ORDER BY last_seen DESC LIMIT %d OFFSET %d", $limit, $offset)) ?: [];
    }

    public static function count(): int {
        global $wpdb;
        return (int) $wpdb->get_var('SELECT COUNT(*) FROM ' . self::table());
    }

    public static function get(int $id): ?object {
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::table() . ' WHERE id=%d', $id)) ?: null;
    }

    /** The CRM person id for an email, or 0 — used to deep-link into the record. */
    public static function id_by_email(string $email): int {
        global $wpdb;
        $email = strtolower(trim($email));
        if ($email === '') {
            return 0;
        }
        return (int) $wpdb->get_var($wpdb->prepare('SELECT id FROM ' . self::table() . ' WHERE email=%s LIMIT 1', $email));
    }

    /**
     * Live detail for one person: their orders and volunteer signups, joined
     * fresh from the source tables by email (never stale).
     *
     * @return array{orders:array<int,object>,volunteer:array<int,object>}
     */
    public static function profile(string $email): array {
        global $wpdb;
        $email = strtolower(trim($email));
        $orders = [];
        $vol = [];
        $o = TicketSchema::orders();
        if (self::has_table($o)) {
            $orders = $wpdb->get_results($wpdb->prepare("SELECT id, event_id, ticket_type_label, qty, total, currency, status, created_at FROM {$o} WHERE email=%s ORDER BY id DESC LIMIT 100", $email)) ?: [];
        }
        $vs = $wpdb->prefix . 'oe_volunteer_signups';
        if (self::has_table($vs)) {
            $vol = $wpdb->get_results($wpdb->prepare("SELECT id, opportunity_id, shift_id, status, created_at FROM {$vs} WHERE email=%s ORDER BY id DESC LIMIT 100", $email)) ?: [];
        }
        return ['orders' => $orders, 'volunteer' => $vol];
    }

    private static function has_table(string $t): bool {
        global $wpdb;
        return (string) $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $t)) === $t;
    }
}
