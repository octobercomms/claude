<?php
declare(strict_types=1);

namespace OE\Ticketing;

use OE\AuditLog;

defined('ABSPATH') || exit;

/**
 * Event waitlist — when a ticket type is sold out, would-be buyers leave their
 * name/email here. Staff (or, later, an automatic capacity trigger) "promote"
 * them: that emails them a link to come and buy. Kept deliberately simple and
 * relational, alongside the other ticketing tables.
 */
final class Waitlist {

    /**
     * Add someone to an event's waitlist. De-duplicated on event + type + email
     * while still waiting. Returns the row id (0 on invalid input).
     */
    public static function join(int $event_id, string $type_key, string $email, string $name = '', string $phone = '', bool $sms_opt_in = false): int {
        global $wpdb;
        $email = strtolower(trim($email));
        if ($event_id <= 0 || ! is_email($email)) {
            return 0;
        }
        $t    = Schema::waitlist();
        $type = TicketTypes::type($event_id, $type_key);

        $existing = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM {$t} WHERE event_id = %d AND ticket_type_key = %s AND email = %s AND status = 'waiting'",
            $event_id, $type_key, $email
        ));
        if ($existing) {
            // Let a repeat join add the SMS detail they didn't give the first time.
            if ($sms_opt_in && $phone !== '') {
                $wpdb->update($t, ['phone' => sanitize_text_field($phone), 'sms_opt_in' => 1], ['id' => $existing]);
            }
            return $existing;
        }
        $wpdb->insert($t, [
            'event_id'          => $event_id,
            'ticket_type_key'   => $type_key,
            'ticket_type_label' => (string) ($type['label'] ?? ''),
            'email'             => $email,
            'name'              => sanitize_text_field($name),
            'phone'             => sanitize_text_field($phone),
            'sms_opt_in'        => ($sms_opt_in && $phone !== '') ? 1 : 0,
            'qty'              => 1,
            'status'            => 'waiting',
            'created_at'        => current_time('mysql', true),
        ]);
        $id = (int) $wpdb->insert_id;
        AuditLog::record('waitlist_joined', $id, 'waitlist', $email);
        return $id;
    }

    public static function get(int $id): ?object {
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . Schema::waitlist() . ' WHERE id = %d', $id)) ?: null;
    }

    /** @return array<int,object> entries (oldest first = queue order), optionally one event */
    public static function all(int $event_id = 0): array {
        global $wpdb;
        $t = Schema::waitlist();
        if ($event_id > 0) {
            return $wpdb->get_results($wpdb->prepare("SELECT * FROM {$t} WHERE event_id = %d ORDER BY id ASC", $event_id)) ?: [];
        }
        return $wpdb->get_results("SELECT * FROM {$t} ORDER BY event_id ASC, id ASC") ?: [];
    }

    /** Number still waiting (optionally for one ticket type). */
    public static function count(int $event_id, string $type_key = ''): int {
        global $wpdb;
        $t = Schema::waitlist();
        if ($type_key !== '') {
            return (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$t} WHERE event_id = %d AND ticket_type_key = %s AND status = 'waiting'", $event_id, $type_key));
        }
        return (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$t} WHERE event_id = %d AND status = 'waiting'", $event_id));
    }

    /**
     * Notify a waitlister that a spot opened: email them a checkout link and
     * mark them 'notified'. Returns false if the row is gone.
     */
    public static function promote(int $id): bool {
        $row = self::get($id);
        if (! $row) {
            return false;
        }
        global $wpdb;
        $wpdb->update(Schema::waitlist(), ['status' => 'notified', 'notified_at' => current_time('mysql', true)], ['id' => $id]);
        $event_name = get_the_title((int) $row->event_id) ?: '';
        $checkout   = (string) get_permalink((int) $row->event_id);
        $hours      = self::window_hours();
        \OE\Mail\Transactional::send('waitlist_spot', ['email' => (string) $row->email, 'name' => (string) $row->name], [
            'event_name'   => $event_name,
            'ticket_type'  => (string) $row->ticket_type_label,
            'checkout_url' => $checkout,
            'offer_hours'  => $hours, // >0 = a personalised, time-limited hold
        ]);
        // Opt-in SMS alongside the email, when they gave a number and ticked it.
        if ((int) ($row->sms_opt_in ?? 0) === 1 && (string) ($row->phone ?? '') !== '') {
            $sms = $hours > 0
                ? sprintf(
                    /* translators: 1: event name, 2: hours, 3: checkout URL */
                    __('A spot has opened for %1$s — it\'s held for you for %2$d hours. Book here: %3$s', 'october-events'),
                    $event_name, $hours, $checkout
                )
                : sprintf(
                    /* translators: 1: event name, 2: checkout URL */
                    __('A spot has opened for %1$s. Tickets are first-come — book here: %2$s', 'october-events'),
                    $event_name, $checkout
                );
            \OE\Mail\Transactional::send_sms((string) $row->phone, $sms);
        }
        AuditLog::record('waitlist_promoted', $id, 'waitlist', (string) $row->email);
        return true;
    }

    /** The timed-offer window in hours (Settings → Checkout). 0 = notify-all. */
    public static function window_hours(): int {
        return max(0, (int) \OE\Settings::get('waitlist_offer_window', 0));
    }

    /**
     * A spot opened for an event. In the default mode everyone still waiting is
     * emailed at once (first come, first served). When a timed-offer window is
     * set (Settings → Checkout), only the front of the queue is offered — up to
     * the number of spots actually free — each with a claim deadline; the hourly
     * cron expires unclaimed offers and advances to the next in line.
     */
    public static function notify_all_for_event(int $event_id): int {
        if (self::window_hours() > 0) {
            return self::offer_round($event_id);
        }
        global $wpdb;
        $ids = $wpdb->get_col($wpdb->prepare(
            "SELECT id FROM " . Schema::waitlist() . " WHERE event_id = %d AND status = 'waiting' ORDER BY id ASC",
            $event_id
        )) ?: [];
        $n = 0;
        foreach ($ids as $id) {
            if (self::promote((int) $id)) {
                $n++;
            }
        }
        return $n;
    }

    /**
     * Spots genuinely free to offer right now: event capacity minus what's sold
     * minus the offers still outstanding (so a pending offer reserves its seat).
     * Returns a large number when the event is uncapped.
     */
    public static function available_spots(int $event_id): int {
        $cap = TicketTypes::event_capacity($event_id);
        if ($cap === null) {
            return 1000; // uncapped — never the limiting factor
        }
        global $wpdb;
        $outstanding = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM " . Schema::waitlist() . " WHERE event_id = %d AND status = 'notified'",
            $event_id
        ));
        $sold = TicketTypes::event_sold_count($event_id);
        return max(0, $cap - $sold - $outstanding);
    }

    /**
     * Offer the freed seats to the front of the queue (timed mode). Promotes up
     * to `available_spots` waiters in order; each is marked notified with a
     * deadline. Returns how many were offered this round.
     */
    public static function offer_round(int $event_id): int {
        $free = self::available_spots($event_id);
        if ($free <= 0) {
            return 0;
        }
        global $wpdb;
        $ids = $wpdb->get_col($wpdb->prepare(
            "SELECT id FROM " . Schema::waitlist() . " WHERE event_id = %d AND status = 'waiting' ORDER BY id ASC LIMIT %d",
            $event_id, $free
        )) ?: [];
        $n = 0;
        foreach ($ids as $id) {
            if (self::promote((int) $id)) {
                $n++;
            }
        }
        return $n;
    }

    /**
     * Hourly (timed mode only): mark offers claimed when the person has since
     * bought, expire offers past the window, then advance to the next in line.
     */
    public static function expire_and_advance(): void {
        if (self::window_hours() <= 0) {
            return;
        }
        global $wpdb;
        $t = Schema::waitlist();
        $events = $wpdb->get_col("SELECT DISTINCT event_id FROM {$t} WHERE status = 'notified'") ?: [];
        $cutoff = gmdate('Y-m-d H:i:s', time() - self::window_hours() * HOUR_IN_SECONDS);
        $orders = Schema::orders();
        foreach ($events as $eid) {
            $eid  = (int) $eid;
            $rows = $wpdb->get_results($wpdb->prepare("SELECT id, email, notified_at FROM {$t} WHERE event_id = %d AND status = 'notified'", $eid)) ?: [];
            foreach ($rows as $r) {
                $bought = (int) $wpdb->get_var($wpdb->prepare(
                    "SELECT COUNT(*) FROM {$orders} WHERE event_id = %d AND email = %s AND status = 'paid' AND created_at >= %s",
                    $eid, (string) $r->email, (string) $r->notified_at
                ));
                if ($bought > 0) {
                    $wpdb->update($t, ['status' => 'converted'], ['id' => (int) $r->id]);
                } elseif ((string) $r->notified_at !== '' && (string) $r->notified_at < $cutoff) {
                    $wpdb->update($t, ['status' => 'expired'], ['id' => (int) $r->id]);
                }
            }
            // Refill any seats freed by expiries / conversions this pass.
            self::offer_round($eid);
        }
    }

    /**
     * Offer a freed-up spot to everyone still waiting for a specific ticket type
     * (first come, first served) — used when a sold-out type's capacity is
     * raised. Each is emailed a checkout link and marked notified, so the same
     * person isn't offered twice. Returns how many were notified.
     */
    public static function notify_for_type(int $event_id, string $type_key): int {
        global $wpdb;
        $ids = $wpdb->get_col($wpdb->prepare(
            "SELECT id FROM " . Schema::waitlist() . " WHERE event_id = %d AND ticket_type_key = %s AND status = 'waiting' ORDER BY id ASC",
            $event_id, $type_key
        )) ?: [];
        $n = 0;
        foreach ($ids as $id) {
            if (self::promote((int) $id)) {
                $n++;
            }
        }
        return $n;
    }

    public static function remove(int $id): void {
        global $wpdb;
        $wpdb->delete(Schema::waitlist(), ['id' => $id]);
    }
}
