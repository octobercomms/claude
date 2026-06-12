<?php
declare(strict_types=1);

namespace OE\Ticketing;

defined('ABSPATH') || exit;

/**
 * Ticket types + availability, stored as JSON meta on the adopted `events` CPT.
 *
 * Each type: key, label, description, price, sale_price, qty_per_purchase
 * ("admits N" group tickets), capacity, active, sale_from, sale_until.
 * Plus event-wide sale close, check-in venues and a check-in PIN.
 */
final class TicketTypes {

    public const META_TYPES      = '_oe_ticket_types';
    public const META_SALE_UNTIL = '_oe_tickets_sale_until';
    public const META_VENUES     = '_oe_checkin_venues';
    public const META_PIN        = '_oe_checkin_pin';

    /** @return array<int,array<string,mixed>> */
    public static function types(int $event_id): array {
        $raw = get_post_meta($event_id, self::META_TYPES, true);
        $decoded = is_string($raw) ? json_decode($raw, true) : $raw;
        return is_array($decoded) ? array_values($decoded) : [];
    }

    public static function set_types(int $event_id, array $types): void {
        $clean = [];
        foreach ($types as $t) {
            $label = sanitize_text_field((string) ($t['label'] ?? ''));
            if ($label === '') {
                continue;
            }
            $key = sanitize_title((string) ($t['key'] ?? '')) ?: sanitize_title($label);
            $clean[] = [
                'key'              => $key,
                'label'            => $label,
                'description'      => sanitize_textarea_field((string) ($t['description'] ?? '')),
                'price'            => round((float) ($t['price'] ?? 0), 2),
                'sale_price'       => ($t['sale_price'] ?? '') === '' ? null : round((float) $t['sale_price'], 2),
                'qty_per_purchase' => min(20, max(1, (int) ($t['qty_per_purchase'] ?? 1))),
                'capacity'         => ($t['capacity'] ?? '') === '' ? null : max(0, (int) $t['capacity']),
                'active'           => ! empty($t['active']),
                'sale_from'        => sanitize_text_field((string) ($t['sale_from'] ?? '')),
                'sale_until'       => sanitize_text_field((string) ($t['sale_until'] ?? '')),
            ];
        }
        update_post_meta($event_id, self::META_TYPES, wp_json_encode($clean));
    }

    public static function type(int $event_id, string $key): ?array {
        foreach (self::types($event_id) as $t) {
            if ($t['key'] === $key) {
                return $t;
            }
        }
        return null;
    }

    /** Effective (sale) price for a type array. */
    public static function effective_price(array $type): float {
        $sale = $type['sale_price'] ?? null;
        if ($sale !== null && $sale < (float) $type['price']) {
            return (float) $sale;
        }
        return (float) $type['price'];
    }

    /**
     * Admissions sold for a type (paid orders, active tickets).
     */
    public static function sold_count(int $event_id, string $key): int {
        global $wpdb;
        $o = Schema::orders();
        $t = Schema::tickets();
        return (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$t} t INNER JOIN {$o} o ON t.order_id = o.id
             WHERE o.event_id = %d AND o.ticket_type_key = %s AND o.status = 'paid' AND t.status = 'active'",
            $event_id,
            $key
        ));
    }

    /**
     * Availability state for a type: available | coming_soon | sale_ended |
     * sold_out | unavailable. Returns [state, extra].
     *
     * @return array{state:string,opens:string}
     */
    public static function availability(int $event_id, array $type): array {
        if (empty($type['active'])) {
            return ['state' => 'unavailable', 'opens' => ''];
        }
        $now = current_time('timestamp');
        if (! empty($type['sale_from']) && strtotime((string) $type['sale_from']) > $now) {
            return ['state' => 'coming_soon', 'opens' => (string) $type['sale_from']];
        }
        if (! empty($type['sale_until']) && strtotime((string) $type['sale_until']) < $now) {
            return ['state' => 'sale_ended', 'opens' => ''];
        }
        $event_close = (string) get_post_meta($event_id, self::META_SALE_UNTIL, true);
        if ($event_close !== '' && strtotime($event_close) < $now) {
            return ['state' => 'sale_ended', 'opens' => ''];
        }
        $capacity = $type['capacity'] ?? null;
        if ($capacity !== null && self::sold_count($event_id, $type['key']) >= (int) $capacity) {
            return ['state' => 'sold_out', 'opens' => ''];
        }
        return ['state' => 'available', 'opens' => ''];
    }

    /** @return array<int,array{name:string}> */
    public static function venues(int $event_id): array {
        $raw = get_post_meta($event_id, self::META_VENUES, true);
        $decoded = is_string($raw) ? json_decode($raw, true) : $raw;
        return is_array($decoded) ? array_values($decoded) : [];
    }

    public static function pin(int $event_id): string {
        return (string) get_post_meta($event_id, self::META_PIN, true);
    }
}
