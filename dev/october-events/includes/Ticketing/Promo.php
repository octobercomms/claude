<?php
declare(strict_types=1);

namespace OE\Ticketing;

defined('ABSPATH') || exit;

/**
 * Ticket promo / discount codes (percent or fixed, event-scoped, expiry,
 * max-uses). Backed by the oe_promo_codes table.
 */
final class Promo {

    public static function get_by_code(string $code): ?object {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . Schema::promos() . " WHERE code = %s",
            strtoupper(trim($code))
        ));
        return $row ?: null;
    }

    /** @return array<int,object> */
    public static function all(): array {
        global $wpdb;
        return $wpdb->get_results("SELECT * FROM " . Schema::promos() . " ORDER BY id DESC") ?: [];
    }

    /**
     * Validate a code for an event + subtotal. Returns a result array or WP_Error.
     *
     * @return array{discount_type:string,discount_value:float,discount_amount:float,new_total:float,promo_id:int}|\WP_Error
     */
    public static function validate(string $code, int $event_id, float $subtotal) {
        $promo = self::get_by_code($code);
        if (! $promo) {
            return new \WP_Error('oe_promo_invalid', __('That code is not valid.', 'october-events'));
        }
        if (! $promo->active) {
            return new \WP_Error('oe_promo_inactive', __('That code is no longer active.', 'october-events'));
        }
        if ($promo->event_id !== null && (int) $promo->event_id !== $event_id) {
            return new \WP_Error('oe_promo_event', __('That code does not apply to this event.', 'october-events'));
        }
        if ($promo->expires_at !== null && strtotime((string) $promo->expires_at) < current_time('timestamp', true)) {
            return new \WP_Error('oe_promo_expired', __('That code has expired.', 'october-events'));
        }
        if ($promo->max_uses !== null && (int) $promo->used_count >= (int) $promo->max_uses) {
            return new \WP_Error('oe_promo_used', __('That code has reached its usage limit.', 'october-events'));
        }

        $discount = self::calculate_discount($promo, $subtotal);
        return [
            'discount_type'   => $promo->discount_type,
            'discount_value'  => (float) $promo->discount_value,
            'discount_amount' => $discount,
            'new_total'       => max(0, round($subtotal - $discount, 2)),
            'promo_id'        => (int) $promo->id,
        ];
    }

    public static function calculate_discount(object $promo, float $subtotal): float {
        if ($promo->discount_type === 'fixed') {
            return min((float) $promo->discount_value, $subtotal);
        }
        $pct = max(0, min(100, (float) $promo->discount_value));
        return round($subtotal * $pct / 100, 2);
    }

    public static function increment_usage(int $promo_id): void {
        global $wpdb;
        $wpdb->query($wpdb->prepare(
            "UPDATE " . Schema::promos() . " SET used_count = used_count + 1 WHERE id = %d",
            $promo_id
        ));
    }

    public static function save(array $data, int $id = 0): int {
        global $wpdb;
        $row = [
            'code'           => strtoupper(sanitize_text_field((string) ($data['code'] ?? ''))),
            'event_id'       => ($data['event_id'] ?? '') === '' ? null : (int) $data['event_id'],
            'discount_type'  => in_array(($data['discount_type'] ?? ''), ['percent', 'fixed'], true) ? $data['discount_type'] : 'percent',
            'discount_value' => round((float) ($data['discount_value'] ?? 0), 2),
            'max_uses'       => ($data['max_uses'] ?? '') === '' ? null : (int) $data['max_uses'],
            'expires_at'     => ($data['expires_at'] ?? '') === '' ? null : (string) $data['expires_at'],
            'active'         => empty($data['active']) ? 0 : 1,
        ];
        if ($id) {
            $wpdb->update(Schema::promos(), $row, ['id' => $id]);
            return $id;
        }
        $row['used_count'] = 0;
        $row['created_at'] = current_time('mysql', true);
        $wpdb->insert(Schema::promos(), $row);
        return (int) $wpdb->insert_id;
    }

    public static function delete(int $id): void {
        global $wpdb;
        $wpdb->delete(Schema::promos(), ['id' => $id]);
    }
}
