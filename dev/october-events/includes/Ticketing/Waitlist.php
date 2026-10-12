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
        \OE\Mail\Transactional::send('waitlist_spot', ['email' => (string) $row->email, 'name' => (string) $row->name], [
            'event_name'   => $event_name,
            'ticket_type'  => (string) $row->ticket_type_label,
            'checkout_url' => $checkout,
        ]);
        // Opt-in SMS alongside the email, when they gave a number and ticked it.
        if ((int) ($row->sms_opt_in ?? 0) === 1 && (string) ($row->phone ?? '') !== '') {
            $sms = sprintf(
                /* translators: 1: event name, 2: checkout URL */
                __('A spot has opened for %1$s. Tickets are first-come — book here: %2$s', 'october-events'),
                $event_name,
                $checkout
            );
            \OE\Mail\Transactional::send_sms((string) $row->phone, $sms);
        }
        AuditLog::record('waitlist_promoted', $id, 'waitlist', (string) $row->email);
        return true;
    }

    /**
     * Notify everyone still waiting for an event that a spot opened — first come,
     * first served. Each is emailed a checkout link and marked notified (so a
     * later opening won't email them twice). Returns how many were notified.
     */
    public static function notify_all_for_event(int $event_id): int {
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
