<?php
declare(strict_types=1);

namespace OE\GuidedTours;

use OE\AuditLog;

defined('ABSPATH') || exit;

/**
 * Guided-tour reservations. One relational table keyed to a Location post and a
 * slot uid. Reserving is serialized per location with a MySQL advisory lock (the
 * same technique the ticketing engine uses) so a 30-spot slot can't oversell in
 * a stampede. When a slot is full the reservation joins the waitlist instead.
 */
final class Reservations {

    public const STATUS_RESERVED  = 'reserved';
    public const STATUS_WAITLIST  = 'waitlist';
    public const STATUS_CONFIRMED = 'confirmed';
    public const STATUS_RELEASED  = 'released';
    public const STATUS_CANCELLED = 'cancelled';

    public static function table(): string {
        global $wpdb;
        return $wpdb->prefix . 'oe_gt_reservations';
    }

    /** Statuses that occupy a seat. */
    private static function held(): array {
        return [self::STATUS_RESERVED, self::STATUS_CONFIRMED];
    }

    /** How many seats are taken on a slot (reserved + confirmed). */
    public static function count_held(int $location_id, string $slot_uid): int {
        global $wpdb;
        $in = "'" . implode("','", self::held()) . "'";
        return (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM " . self::table() . " WHERE location_id = %d AND slot_uid = %s AND status IN ({$in})",
            $location_id, $slot_uid
        ));
    }

    public static function waitlist_count(int $location_id, string $slot_uid): int {
        global $wpdb;
        return (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM " . self::table() . " WHERE location_id = %d AND slot_uid = %s AND status = %s",
            $location_id, $slot_uid, self::STATUS_WAITLIST
        ));
    }

    /** True if this email already holds (or waits for) a slot at this building. */
    public static function has_active_for_location(string $email, int $location_id): bool {
        global $wpdb;
        $in = "'" . implode("','", array_merge(self::held(), [self::STATUS_WAITLIST])) . "'";
        return (bool) $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM " . self::table() . " WHERE location_id = %d AND email = %s AND status IN ({$in}) LIMIT 1",
            $location_id, strtolower($email)
        ));
    }

    /**
     * Reserve a slot for a verified ticket holder. Returns
     *   ['status' => 'reserved'|'waitlist', 'spots_left' => int]
     * or a WP_Error. One reservation per person per building.
     *
     * @return array{status:string,spots_left:int}|\WP_Error
     */
    public static function reserve(int $location_id, string $slot_uid, string $tour_key, string $email, string $name) {
        global $wpdb;
        $email = strtolower(trim($email));
        if (! is_email($email)) {
            return new \WP_Error('oe_gt_email', __('Please use a valid email address.', 'october-events'));
        }
        $slot = Slots::get($location_id, $slot_uid);
        if (! $slot || ! $slot['active']) {
            return new \WP_Error('oe_gt_slot', __('That time is no longer available.', 'october-events'));
        }

        $lock = self::lock($location_id);
        try {
            if (self::has_active_for_location($email, $location_id)) {
                return new \WP_Error('oe_gt_dupe', __('You already have a spot at this building. Only one per person.', 'october-events'));
            }
            $held   = self::count_held($location_id, $slot_uid);
            $full   = $held >= $slot['capacity'];
            $status = $full ? self::STATUS_WAITLIST : self::STATUS_RESERVED;

            $wpdb->insert(self::table(), [
                'location_id' => $location_id,
                'slot_uid'    => $slot_uid,
                'tour_key'    => $tour_key,
                'email'       => $email,
                'name'        => sanitize_text_field($name),
                'status'      => $status,
                'token'       => wp_generate_password(20, false),
                'slot_start'  => Slots::start_ts($location_id, $slot_uid) ? gmdate('Y-m-d H:i:s', Slots::start_ts($location_id, $slot_uid)) : null,
                'created_at'  => current_time('mysql', true),
            ]);
            $id = (int) $wpdb->insert_id;
        } finally {
            self::unlock($lock);
        }

        AuditLog::record($full ? 'gt_waitlist' : 'gt_reserved', $id, 'guided_tour', $email);
        Mailer::reserved($location_id, $slot_uid, $email, $name, $full);
        $left = max(0, $slot['capacity'] - self::count_held($location_id, $slot_uid));
        return ['status' => $status, 'spots_left' => $left];
    }

    /** @return array<int,object> reservations for a location, newest first. */
    public static function for_location(int $location_id): array {
        global $wpdb;
        return $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM " . self::table() . " WHERE location_id = %d ORDER BY slot_uid ASC, id ASC",
            $location_id
        )) ?: [];
    }

    public static function by_token(string $token): ?object {
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::table() . ' WHERE token = %s', $token)) ?: null;
    }

    /** Mark a reservation confirmed (from the 48h reconfirm email). */
    public static function confirm_by_token(string $token): bool {
        $row = self::by_token($token);
        if (! $row || $row->status !== self::STATUS_RESERVED) {
            return false;
        }
        global $wpdb;
        $wpdb->update(self::table(), ['status' => self::STATUS_CONFIRMED, 'confirmed_at' => current_time('mysql', true)], ['id' => (int) $row->id]);
        return true;
    }

    /** Release a reservation and promote the head of that slot's waitlist. */
    public static function release_by_token(string $token): bool {
        $row = self::by_token($token);
        if (! $row || ! in_array($row->status, self::held(), true)) {
            return false;
        }
        self::release_row((int) $row->id, (int) $row->location_id, (string) $row->slot_uid);
        return true;
    }

    /** Free a seat and offer it to the next person waiting on that slot. */
    public static function release_row(int $id, int $location_id, string $slot_uid): void {
        global $wpdb;
        $wpdb->update(self::table(), ['status' => self::STATUS_RELEASED], ['id' => $id]);
        AuditLog::record('gt_released', $id, 'guided_tour', '');
        self::promote_waitlist($location_id, $slot_uid);
    }

    /** Promote the oldest waitlister on a slot if a seat is now free. */
    public static function promote_waitlist(int $location_id, string $slot_uid): void {
        $slot = Slots::get($location_id, $slot_uid);
        if (! $slot) {
            return;
        }
        if (self::count_held($location_id, $slot_uid) >= $slot['capacity']) {
            return;
        }
        global $wpdb;
        $next = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . self::table() . " WHERE location_id = %d AND slot_uid = %s AND status = %s ORDER BY id ASC LIMIT 1",
            $location_id, $slot_uid, self::STATUS_WAITLIST
        ));
        if (! $next) {
            return;
        }
        $wpdb->update(self::table(), ['status' => self::STATUS_RESERVED], ['id' => (int) $next->id]);
        Mailer::promoted($location_id, $slot_uid, (string) $next->email, (string) $next->name);
    }

    /* ---- advisory lock (per location) ---- */

    private static function lock(int $location_id): string {
        global $wpdb;
        $key = 'oegt_' . $wpdb->prefix . $location_id;
        $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, %d)', $key, 8));
        return $key;
    }

    private static function unlock(string $key): void {
        global $wpdb;
        $wpdb->query($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $key));
    }
}
