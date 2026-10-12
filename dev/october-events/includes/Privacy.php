<?php
declare(strict_types=1);

namespace OE;

use OE\Mail\Contacts;
use OE\Ticketing\Schema;

defined('ABSPATH') || exit;

/**
 * GDPR / privacy integration (BUILD-PLAN M6).
 *
 * Registers the plugin's own data with WordPress core's personal-data tooling
 * (Tools → Export/Erase Personal Data), so a data-subject request run through
 * the standard WP flow covers the records the plugin holds: ticket orders and
 * tickets, waitlist entries, abandoned carts, and the marketing contact.
 *
 * Core drives the request and sends the confirmation emails; this class only
 * supplies the exporter and eraser callbacks keyed on the subject's email.
 * Survey responses are deliberately excluded: they store an HMAC of the ticket
 * token, not the email, so they are not reverse-joinable to a person (see
 * Survey\Schema) and hold no PII to export or erase.
 */
final class Privacy {

    public static function init(): void {
        add_filter('wp_privacy_personal_data_exporters', [self::class, 'register_exporters']);
        add_filter('wp_privacy_personal_data_erasers', [self::class, 'register_erasers']);
    }

    /** @param array<string,mixed> $exporters */
    public static function register_exporters(array $exporters): array {
        $exporters['october-events'] = [
            'exporter_friendly_name' => __('October Events', 'october-events'),
            'callback'               => [self::class, 'export'],
        ];
        return $exporters;
    }

    /** @param array<string,mixed> $erasers */
    public static function register_erasers(array $erasers): array {
        $erasers['october-events'] = [
            'eraser_friendly_name' => __('October Events', 'october-events'),
            'callback'             => [self::class, 'erase'],
        ];
        return $erasers;
    }

    /* ------------------------------------------------------------------ *
     * Export
     * ------------------------------------------------------------------ */

    /**
     * @return array{data:array<int,array<string,mixed>>,done:bool}
     */
    public static function export(string $email, int $page = 1): array {
        global $wpdb;
        $email = trim(strtolower($email));
        $items = [];
        if (! is_email($email)) {
            return ['data' => $items, 'done' => true];
        }

        // Orders (one group item per order).
        $orders = $wpdb->get_results($wpdb->prepare(
            'SELECT id, event_id, name, ticket_type_label, qty, total, currency, status, created_at
             FROM ' . Schema::orders() . ' WHERE email = %s ORDER BY id ASC',
            $email
        )) ?: [];
        foreach ($orders as $o) {
            $items[] = [
                'group_id'    => 'oe_orders',
                'group_label' => __('October Events — orders', 'october-events'),
                'item_id'     => 'oe-order-' . (int) $o->id,
                'data'        => [
                    ['name' => __('Order', 'october-events'),    'value' => '#' . (int) $o->id],
                    ['name' => __('Name', 'october-events'),     'value' => (string) $o->name],
                    ['name' => __('Ticket', 'october-events'),   'value' => (string) $o->ticket_type_label],
                    ['name' => __('Quantity', 'october-events'), 'value' => (int) $o->qty],
                    ['name' => __('Total', 'october-events'),    'value' => strtoupper((string) $o->currency) . ' ' . number_format((float) $o->total, 2)],
                    ['name' => __('Status', 'october-events'),   'value' => (string) $o->status],
                    ['name' => __('Date', 'october-events'),     'value' => (string) $o->created_at],
                ],
            ];
        }

        // Tickets (attendee rows carrying the subject's email).
        $tickets = $wpdb->get_results($wpdb->prepare(
            'SELECT id, event_id, ticket_type_label, attendee_name, created_at
             FROM ' . Schema::tickets() . ' WHERE attendee_email = %s ORDER BY id ASC',
            $email
        )) ?: [];
        foreach ($tickets as $t) {
            $items[] = [
                'group_id'    => 'oe_tickets',
                'group_label' => __('October Events — tickets', 'october-events'),
                'item_id'     => 'oe-ticket-' . (int) $t->id,
                'data'        => [
                    ['name' => __('Attendee', 'october-events'), 'value' => (string) $t->attendee_name],
                    ['name' => __('Ticket', 'october-events'),   'value' => (string) $t->ticket_type_label],
                    ['name' => __('Date', 'october-events'),     'value' => (string) $t->created_at],
                ],
            ];
        }

        // Waitlist.
        $wl = $wpdb->get_results($wpdb->prepare(
            'SELECT id, event_id, ticket_type_label, name, status, created_at
             FROM ' . Schema::waitlist() . ' WHERE email = %s ORDER BY id ASC',
            $email
        )) ?: [];
        foreach ($wl as $w) {
            $items[] = [
                'group_id'    => 'oe_waitlist',
                'group_label' => __('October Events — waitlist', 'october-events'),
                'item_id'     => 'oe-waitlist-' . (int) $w->id,
                'data'        => [
                    ['name' => __('Name', 'october-events'),   'value' => (string) $w->name],
                    ['name' => __('Ticket', 'october-events'), 'value' => (string) $w->ticket_type_label],
                    ['name' => __('Status', 'october-events'), 'value' => (string) $w->status],
                    ['name' => __('Date', 'october-events'),   'value' => (string) $w->created_at],
                ],
            ];
        }

        // Marketing contact.
        $c = Contacts::get($email);
        if ($c) {
            $items[] = [
                'group_id'    => 'oe_contact',
                'group_label' => __('October Events — contact', 'october-events'),
                'item_id'     => 'oe-contact-' . (int) ($c->id ?? 0),
                'data'        => array_values(array_filter([
                    ['name' => __('Name', 'october-events'),    'value' => (string) ($c->name ?? '')],
                    ['name' => __('Phone', 'october-events'),   'value' => (string) ($c->phone ?? '')],
                    ['name' => __('Company', 'october-events'), 'value' => (string) ($c->company ?? '')],
                    ['name' => __('Status', 'october-events'),  'value' => (string) ($c->status ?? '')],
                ], static fn($row) => $row['value'] !== '')),
            ];
        }

        // One page returns everything (the volumes per subject are small).
        return ['data' => $items, 'done' => true];
    }

    /* ------------------------------------------------------------------ *
     * Erase
     * ------------------------------------------------------------------ */

    /**
     * Anonymise rather than hard-delete the transactional records (orders and
     * tickets are financial/attendance records a site keeps for its own
     * accounting), and remove the marketing contact outright. Returns core's
     * eraser response shape.
     *
     * @return array{items_removed:bool,items_retained:bool,messages:array<int,string>,done:bool}
     */
    public static function erase(string $email, int $page = 1): array {
        global $wpdb;
        $email    = trim(strtolower($email));
        $removed  = false;
        $retained = false;
        $messages = [];
        if (! is_email($email)) {
            return ['items_removed' => false, 'items_retained' => false, 'messages' => [], 'done' => true];
        }

        $anon = 'deleted@example.com';

        // Orders: scrub the identity, keep the financial record.
        $n = $wpdb->query($wpdb->prepare(
            'UPDATE ' . Schema::orders() . " SET email = %s, name = '' WHERE email = %s",
            $anon,
            $email
        ));
        if ($n) {
            $retained = true;
            $messages[] = __('Ticket orders were anonymised (the financial record is kept).', 'october-events');
        }

        // Tickets: scrub attendee identity, keep the attendance record.
        $wpdb->query($wpdb->prepare(
            'UPDATE ' . Schema::tickets() . " SET attendee_email = %s, attendee_name = '' WHERE attendee_email = %s",
            $anon,
            $email
        ));

        // Waitlist + abandoned carts: remove outright (no record to keep).
        $w = $wpdb->query($wpdb->prepare('DELETE FROM ' . Schema::waitlist() . ' WHERE email = %s', $email));
        $a = $wpdb->query($wpdb->prepare('DELETE FROM ' . Schema::abandoned() . ' WHERE email = %s', $email));
        if ($w || $a) {
            $removed = true;
        }

        // Marketing contact: remove outright.
        $c = $wpdb->query($wpdb->prepare('DELETE FROM ' . Contacts::table() . ' WHERE email = %s', $email));
        if ($c) {
            $removed = true;
        }

        return [
            'items_removed'  => $removed,
            'items_retained' => $retained,
            'messages'       => $messages,
            'done'           => true,
        ];
    }
}
