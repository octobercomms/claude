<?php
declare(strict_types=1);

namespace OctoberTickets;

defined('ABSPATH') || exit;

/**
 * Promo code validation logic and AJAX handler.
 */
class PromoCodes {

    private static ?PromoCodes $instance = null;

    private function __construct() {}

    public static function get_instance(): self {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function init(): void {
        add_action('wp_ajax_oct_validate_promo',        [$this, 'ajax_validate_promo']);
        add_action('wp_ajax_nopriv_oct_validate_promo', [$this, 'ajax_validate_promo']);
    }

    // -------------------------------------------------------------------------
    // AJAX
    // -------------------------------------------------------------------------

    public function ajax_validate_promo(): void {
        check_ajax_referer('oct_checkout_nonce', 'nonce');

        $code     = strtoupper(sanitize_text_field($_POST['code'] ?? ''));
        $event_id = (int) ($_POST['event_id'] ?? 0);
        $subtotal = round(floatval($_POST['subtotal'] ?? 0), 2);

        if (!$code || !$event_id || $subtotal <= 0) {
            wp_send_json_error(['message' => __('Invalid request.', 'october-event-tickets')]);
        }

        $result = $this->validate($code, $event_id, $subtotal);
        if (is_wp_error($result)) {
            wp_send_json_error(['message' => $result->get_error_message()]);
        }

        wp_send_json_success($result);
    }

    // -------------------------------------------------------------------------
    // Validation
    // -------------------------------------------------------------------------

    /**
     * Validate a promo code against a subtotal.
     *
     * @return array{
     *   valid: bool,
     *   discount_type: string,
     *   discount_value: float,
     *   discount_amount: float,
     *   new_total: float,
     *   promo_id: int
     * }|\WP_Error
     */
    public function validate(string $code, int $event_id, float $subtotal) {
        $promo = DB::get_promo_by_code($code);

        if (!$promo) {
            return new \WP_Error('invalid_code', __('Promo code not found.', 'october-event-tickets'));
        }

        if (!$promo->active) {
            return new \WP_Error('inactive_code', __('This promo code is no longer active.', 'october-event-tickets'));
        }

        // Check event restriction
        if ($promo->event_id !== null && (int) $promo->event_id !== $event_id) {
            return new \WP_Error('wrong_event', __('This promo code is not valid for this event.', 'october-event-tickets'));
        }

        // Check expiry
        if ($promo->expires_at !== null) {
            $now     = current_time('timestamp');
            $expires = strtotime($promo->expires_at);
            if ($expires && $now > $expires) {
                return new \WP_Error('expired_code', __('This promo code has expired.', 'october-event-tickets'));
            }
        }

        // Check max uses
        if ($promo->max_uses !== null && (int) $promo->used_count >= (int) $promo->max_uses) {
            return new \WP_Error('max_uses', __('This promo code has reached its usage limit.', 'october-event-tickets'));
        }

        // Calculate discount
        $discount_amount = $this->calculate_discount(
            $promo->discount_type,
            (float) $promo->discount_value,
            $subtotal
        );

        $new_total = max(0, round($subtotal - $discount_amount, 2));

        return [
            'valid'           => true,
            'discount_type'   => $promo->discount_type,
            'discount_value'  => (float) $promo->discount_value,
            'discount_amount' => round($discount_amount, 2),
            'new_total'       => $new_total,
            'promo_id'        => (int) $promo->id,
        ];
    }

    public function calculate_discount(string $type, float $value, float $subtotal): float {
        if ($type === 'percent') {
            return round($subtotal * ($value / 100), 2);
        }
        // Fixed
        return min($value, $subtotal);
    }
}
