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
    public const META_LOGO       = '_oe_ticket_logo'; // attachment id for the per-event ticket/email logo
    public const META_CAPACITY   = '_oe_event_capacity'; // event-wide ticket capacity (0/empty = unlimited)

    /**
     * Logo shown top-left on the ticket page and confirmation email for an
     * event. Per-event upload first, then the global brand logo, else ''.
     */
    public static function logo_url(int $event_id): string {
        $id = $event_id ? (int) get_post_meta($event_id, self::META_LOGO, true) : 0;
        if ($id) {
            $url = wp_get_attachment_image_url($id, 'medium');
            if ($url) {
                return (string) $url;
            }
        }
        $brand = (string) \OE\Settings::get('theme_logo_light', '');
        return $brand !== '' ? $brand : (string) \OE\Settings::get('theme_logo_dark', '');
    }

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

    /** @var array<int,int> per-request memo for event_sold_count() */
    private static array $sold_cache = [];

    /**
     * Total admissions sold across all ticket types for an event (paid orders,
     * active tickets) — capacity is now event-wide, not per type.
     *
     * Memoized per request: checkout renders call this once per ticket type, and
     * the count is event-wide (identical for all types). Pass $fresh = true for
     * the authoritative read inside the capacity lock (Orders::create), which must
     * not see a stale value.
     */
    public static function event_sold_count(int $event_id, bool $fresh = false): int {
        if (! $fresh && isset(self::$sold_cache[$event_id])) {
            return self::$sold_cache[$event_id];
        }
        global $wpdb;
        $o = Schema::orders();
        $t = Schema::tickets();
        $n = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$t} t INNER JOIN {$o} o ON t.order_id = o.id
             WHERE o.event_id = %d AND o.status = 'paid' AND t.status = 'active'",
            $event_id
        ));
        return self::$sold_cache[$event_id] = $n;
    }

    /**
     * The event's total ticket capacity, or null for unlimited. Reads the
     * event-wide setting; for events saved before capacity moved off the ticket
     * type, it falls back to the sum of the old per-type caps so an existing
     * limit is preserved until the event is re-saved.
     */
    /** @var array<int,int|null> per-request memo for event_capacity() */
    private static array $cap_cache = [];

    public static function event_capacity(int $event_id): ?int {
        if (array_key_exists($event_id, self::$cap_cache)) {
            return self::$cap_cache[$event_id];
        }
        $raw = get_post_meta($event_id, self::META_CAPACITY, true);
        if ($raw !== '' && $raw !== false && $raw !== null) {
            $n = (int) $raw;
            return self::$cap_cache[$event_id] = ($n > 0 ? $n : null); // 0 / blank = unlimited
        }
        // Legacy fallback — sum any per-type caps still stored on the event.
        $sum = 0;
        $had = false;
        foreach (self::types($event_id) as $t) {
            if (($t['capacity'] ?? null) !== null) {
                $sum += (int) $t['capacity'];
                $had  = true;
            }
        }
        return self::$cap_cache[$event_id] = ($had ? $sum : null);
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
        $capacity = self::event_capacity($event_id);
        if ($capacity !== null && self::event_sold_count($event_id) >= $capacity) {
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

    /**
     * The event's check-in PIN. A random 6-digit PIN is generated and stored the
     * first time one is needed, so every event has a working PIN automatically —
     * but it is NEVER derived from the post ID (which is public and guessable). A
     * PIN typed into the meta box overrides it.
     */
    public static function pin(int $event_id): string {
        if ($event_id <= 0) {
            return '';
        }
        $pin = (string) get_post_meta($event_id, self::META_PIN, true);
        if ($pin !== '') {
            return $pin;
        }
        $pin = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        update_post_meta($event_id, self::META_PIN, $pin);
        return $pin;
    }
}
