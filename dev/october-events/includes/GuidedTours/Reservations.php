<?php
declare(strict_types=1);

namespace OE\GuidedTours;

use OE\AuditLog;

defined('ABSPATH') || exit;

/**
 * Guided-tour reservations. One relational table keyed to a Location post and a
 * slot uid. Reserving is serialized per location with a MySQL advisory lock (the
 * same technique the ticketing engine uses) so a slot can't oversell in a
 * stampede. When a slot can't fit the party it joins the waitlist instead.
 *
 * A booking can hold more than one seat (`party_size`): a ticket buyer who paid
 * for several people can bring their group to one time. Capacity everywhere is
 * counted in seats, not rows, and a person's seats across the whole tour are
 * capped at the number of admissions their ticket(s) bought.
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

    /** Statuses that still count against a person's ticket allowance (held or waiting). */
    private static function active(): array {
        return [self::STATUS_RESERVED, self::STATUS_CONFIRMED, self::STATUS_WAITLIST];
    }

    /** How many seats are taken on a slot (reserved + confirmed), summing party sizes. */
    public static function count_held(int $location_id, string $slot_uid): int {
        global $wpdb;
        $in = "'" . implode("','", self::held()) . "'";
        return (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COALESCE(SUM(party_size),0) FROM " . self::table() . " WHERE location_id = %d AND slot_uid = %s AND status IN ({$in})",
            $location_id, $slot_uid
        ));
    }

    /**
     * Seats held (reserved + confirmed) for every slot at a building, in one
     * grouped query — so a page rendering many slots does one query, not one per
     * slot. Returns slot_uid => seats.
     *
     * @return array<string,int>
     */
    public static function held_map(int $location_id): array {
        global $wpdb;
        $in   = "'" . implode("','", self::held()) . "'";
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT slot_uid, COALESCE(SUM(party_size),0) AS seats FROM " . self::table()
            . " WHERE location_id = %d AND status IN ({$in}) GROUP BY slot_uid",
            $location_id
        )) ?: [];
        $out = [];
        foreach ($rows as $r) {
            $out[(string) $r->slot_uid] = (int) $r->seats;
        }
        return $out;
    }

    /** How many seats are waiting on a slot, summing party sizes. */
    public static function waitlist_count(int $location_id, string $slot_uid): int {
        global $wpdb;
        return (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COALESCE(SUM(party_size),0) FROM " . self::table() . " WHERE location_id = %d AND slot_uid = %s AND status = %s",
            $location_id, $slot_uid, self::STATUS_WAITLIST
        ));
    }

    /** Seats this email already holds or waits for across the whole tour. */
    public static function party_used(string $email, string $tour_key): int {
        global $wpdb;
        $in = "'" . implode("','", self::active()) . "'";
        return (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COALESCE(SUM(party_size),0) FROM " . self::table() . " WHERE email = %s AND tour_key = %s AND status IN ({$in})",
            strtolower($email), $tour_key
        ));
    }

    /** This email's active bookings for the tour, oldest first (for the booking page). */
    public static function active_for_email(string $email, string $tour_key): array {
        global $wpdb;
        $in = "'" . implode("','", self::active()) . "'";
        return $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM " . self::table() . " WHERE email = %s AND tour_key = %s AND status IN ({$in}) ORDER BY slot_start ASC, id ASC",
            strtolower($email), $tour_key
        )) ?: [];
    }

    /** This email's active booking on one slot, if any (to block a duplicate). */
    public static function active_at_slot(string $email, int $location_id, string $slot_uid, int $exclude_id = 0): ?object {
        global $wpdb;
        $in = "'" . implode("','", self::active()) . "'";
        return $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . self::table() . " WHERE email = %s AND location_id = %d AND slot_uid = %s AND id <> %d AND status IN ({$in}) LIMIT 1",
            strtolower($email), $location_id, $slot_uid, $exclude_id
        )) ?: null;
    }

    /**
     * Reserve a slot for a party of one or more. `$allowance` is the most seats
     * this email may bring to ANY ONE tour (its ticket count) — a ticket is a
     * pass, so the same buyer can book onto every tour, up to that party each time;
     * pass PHP_INT_MAX to bypass the cap for a hand-added admin booking. The whole
     * party is kept together: it is reserved when the slot has room, otherwise the
     * whole party joins the waitlist.
     *
     * @return array{status:string,spots_left:int,remaining:int}|\WP_Error
     */
    public static function reserve(int $location_id, string $slot_uid, string $tour_key, string $email, string $name, int $party_size = 1, int $allowance = PHP_INT_MAX) {
        global $wpdb;
        $email = strtolower(trim($email));
        if (! is_email($email)) {
            return new \WP_Error('oe_gt_email', __('Please use a valid email address.', 'october-events'));
        }
        $party_size = max(1, $party_size);
        $slot = Slots::get($location_id, $slot_uid);
        if (! $slot || ! $slot['active']) {
            return new \WP_Error('oe_gt_slot', __('That time is no longer available.', 'october-events'));
        }

        $lock = self::lock($location_id);
        try {
            if (self::active_at_slot($email, $location_id, $slot_uid)) {
                return new \WP_Error('oe_gt_dupe', __('You’ve already booked this time. Change or cancel that booking below to move it.', 'october-events'));
            }
            // A ticket is a pass: the buyer may join every tour and bring up to
            // their ticket count (party) to each. So the cap is per booking, not a
            // shared pool across tours — only the party at any one slot can't
            // exceed the tickets held. (Booking the same slot twice is blocked
            // above; slot capacity is enforced below.)
            if ($party_size > $allowance && $allowance !== PHP_INT_MAX) {
                return new \WP_Error('oe_gt_allow', sprintf(
                    /* translators: %d: number of tickets/people the buyer holds */
                    _n('Your ticket covers %d person — reduce your party size to book.', 'Your tickets cover %d people — reduce your party size to book.', $allowance, 'october-events'),
                    $allowance
                ));
            }
            $held   = self::count_held($location_id, $slot_uid);
            $full   = ($held + $party_size) > $slot['capacity'];
            $status = $full ? self::STATUS_WAITLIST : self::STATUS_RESERVED;
            $token  = wp_generate_password(20, false);

            $wpdb->insert(self::table(), [
                'location_id' => $location_id,
                'slot_uid'    => $slot_uid,
                'tour_key'    => $tour_key,
                'email'       => $email,
                'name'        => sanitize_text_field($name),
                'party_size'  => $party_size,
                'status'      => $status,
                'token'       => $token,
                'slot_start'  => Slots::start_ts($location_id, $slot_uid) ? gmdate('Y-m-d H:i:s', Slots::start_ts($location_id, $slot_uid)) : null,
                'created_at'  => current_time('mysql', true),
            ]);
            $id = (int) $wpdb->insert_id;
        } finally {
            self::unlock($lock);
        }

        AuditLog::record($full ? 'gt_waitlist' : 'gt_reserved', $id, 'guided_tour', $email);
        Mailer::reserved($location_id, $slot_uid, $email, $name, $full, $token, $party_size);
        $left      = max(0, $slot['capacity'] - self::count_held($location_id, $slot_uid));
        // A ticket is a pass, so the party allowance is available again on the next
        // tour — remaining is the per-booking cap (the group size), not a shrinking
        // pool. This drives the booking page's party stepper.
        $remaining = $allowance;
        return ['status' => $status, 'spots_left' => $left, 'remaining' => $remaining];
    }

    /**
     * Move an existing booking to another slot without giving up the current seat
     * until the new one is secured. The party moves as a whole; if the target
     * can't fit it, nothing changes and an error is returned. Cross-building moves
     * are fine (allowance is tour-wide).
     *
     * @return true|\WP_Error
     */
    public static function change_slot(int $id, string $email, string $tour_key, int $new_location, string $new_slot) {
        global $wpdb;
        $email = strtolower(trim($email));
        $row   = self::owned_active_row($id, $email, $tour_key);
        if (! $row) {
            return new \WP_Error('oe_gt_notfound', __('We couldn’t find that booking.', 'october-events'));
        }
        if ((int) $row->location_id === $new_location && (string) $row->slot_uid === $new_slot) {
            return true;
        }
        $slot = Slots::get($new_location, $new_slot);
        if (! $slot || ! $slot['active']) {
            return new \WP_Error('oe_gt_slot', __('That time is no longer available.', 'october-events'));
        }
        $party    = max(1, (int) $row->party_size);
        $old_loc  = (int) $row->location_id;
        $old_slot = (string) $row->slot_uid;

        $lock = self::lock($new_location);
        try {
            if (self::active_at_slot($email, $new_location, $new_slot, $id)) {
                return new \WP_Error('oe_gt_dupe', __('You’ve already booked that time.', 'october-events'));
            }
            $held = self::count_held($new_location, $new_slot);
            if (($held + $party) > $slot['capacity']) {
                return new \WP_Error('oe_gt_full', __('That time doesn’t have room for your group. Pick another.', 'october-events'));
            }
            $wpdb->update(self::table(), [
                'location_id'    => $new_location,
                'slot_uid'       => $new_slot,
                'status'         => self::STATUS_RESERVED,
                'reconfirm_sent' => 0,
                'confirmed_at'   => null,
                'slot_start'     => Slots::start_ts($new_location, $new_slot) ? gmdate('Y-m-d H:i:s', Slots::start_ts($new_location, $new_slot)) : null,
            ], ['id' => $id]);
        } finally {
            self::unlock($lock);
        }

        AuditLog::record('gt_moved', $id, 'guided_tour', $email);
        // Free the vacated seat(s) to whoever is waiting on the old slot.
        self::promote_waitlist($old_loc, $old_slot);
        Mailer::reserved($new_location, $new_slot, $email, (string) $row->name, false, (string) $row->token, $party);
        return true;
    }

    /** A caller cancelling their own booking from the page (by row + verified email). */
    public static function cancel_for_email(int $id, string $email, string $tour_key): bool {
        $row = self::owned_active_row($id, strtolower(trim($email)), $tour_key);
        if (! $row) {
            return false;
        }
        $was_held = in_array($row->status, self::held(), true);
        global $wpdb;
        $wpdb->update(self::table(), ['status' => self::STATUS_CANCELLED], ['id' => $id]);
        AuditLog::record('gt_self_cancel', $id, 'guided_tour', (string) $row->email);
        if ($was_held) {
            self::promote_waitlist((int) $row->location_id, (string) $row->slot_uid);
        }
        return true;
    }

    /** A row that belongs to this email + tour and is still active, else null. */
    private static function owned_active_row(int $id, string $email, string $tour_key): ?object {
        global $wpdb;
        $in = "'" . implode("','", self::active()) . "'";
        return $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . self::table() . " WHERE id = %d AND email = %s AND tour_key = %s AND status IN ({$in})",
            $id, strtolower($email), $tour_key
        )) ?: null;
    }

    /** @return array<int,object> reservations for a location, newest first. */
    public static function for_location(int $location_id): array {
        global $wpdb;
        return $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM " . self::table() . " WHERE location_id = %d ORDER BY slot_uid ASC, id ASC",
            $location_id
        )) ?: [];
    }

    /**
     * All reservations for the admin screen, optionally scoped to one building,
     * ordered by building then slot time. Includes every status; the screen shows
     * the active ones and can reveal cancelled/released.
     *
     * @return array<int,object>
     */
    public static function all(int $location_id = 0): array {
        global $wpdb;
        $where = $location_id > 0 ? $wpdb->prepare('WHERE location_id = %d', $location_id) : '';
        return $wpdb->get_results(
            'SELECT * FROM ' . self::table() . " {$where} ORDER BY location_id ASC, slot_start ASC, id ASC"
        ) ?: [];
    }

    /**
     * Admin-add a person to a slot (bypasses the ticket gate and the allowance
     * cap). Reuses the normal reserve path, so capacity, the waitlist and the
     * confirmation email all behave exactly as a self-service booking.
     *
     * @return array{status:string,spots_left:int,remaining:int}|\WP_Error
     */
    public static function admin_add(int $location_id, string $slot_uid, string $email, string $name, int $party_size = 1) {
        return self::reserve($location_id, $slot_uid, '', $email, $name, $party_size, PHP_INT_MAX);
    }

    /** Admin-remove: cancel a reservation and offer the freed seats to the waitlist. */
    public static function admin_remove(int $id): void {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::table() . ' WHERE id = %d', $id));
        if (! $row) {
            return;
        }
        $was_held = in_array($row->status, self::held(), true);
        $wpdb->update(self::table(), ['status' => self::STATUS_CANCELLED], ['id' => $id]);
        AuditLog::record('gt_removed', $id, 'guided_tour', (string) $row->email);
        if ($was_held) {
            self::promote_waitlist((int) $row->location_id, (string) $row->slot_uid);
        }
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

    /** Free a seat and offer it to the next people waiting on that slot. */
    public static function release_row(int $id, int $location_id, string $slot_uid): void {
        global $wpdb;
        $wpdb->update(self::table(), ['status' => self::STATUS_RELEASED], ['id' => $id]);
        AuditLog::record('gt_released', $id, 'guided_tour', '');
        self::promote_waitlist($location_id, $slot_uid);
    }

    /**
     * Fill freed seats from the waitlist in strict first-come order: promote each
     * oldest waiting party that fits the room now open, skip any party too big for
     * the space left, and stop once nothing more fits.
     */
    public static function promote_waitlist(int $location_id, string $slot_uid): void {
        $slot = Slots::get($location_id, $slot_uid);
        if (! $slot) {
            return;
        }
        global $wpdb;
        $waiting = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM " . self::table() . " WHERE location_id = %d AND slot_uid = %s AND status = %s ORDER BY id ASC",
            $location_id, $slot_uid, self::STATUS_WAITLIST
        )) ?: [];
        foreach ($waiting as $next) {
            $free = $slot['capacity'] - self::count_held($location_id, $slot_uid);
            if ($free <= 0) {
                break;
            }
            $party = max(1, (int) $next->party_size);
            if ($party > $free) {
                continue; // this group won't fit yet; a smaller one behind it might
            }
            $wpdb->update(self::table(), ['status' => self::STATUS_RESERVED], ['id' => (int) $next->id]);
            Mailer::promoted($location_id, $slot_uid, (string) $next->email, (string) $next->name, $party);
        }
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
