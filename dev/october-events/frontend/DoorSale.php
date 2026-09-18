<?php
declare(strict_types=1);

namespace OE\Frontend;

defined('ABSPATH') || exit;

/**
 * Fast door-sale checkout — the walk-up buyer's page at `/door?e=<event>&v=<venue>`.
 *
 * A staff member on the check-in app taps "Sell", which shows a large QR on the
 * tablet. The customer scans it and lands here: a stripped, single-event page
 * that lists the on-sale ticket types, takes a quantity, an optional promo and an
 * email, then hands off to a hosted Stripe Checkout Session (Apple Pay / Google
 * Pay native). The ticket is emailed by the payment webhook, so the buyer can use
 * it at the next stop. The venue rides along as a "door" tag on the order.
 */
final class DoorSale {

    private static ?DoorSale $instance = null;

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function register_assets(): void {
        wp_register_style('oe-door', OE_URL . 'assets/css/door.css', [], OE_VERSION);
        wp_register_script('oe-door', OE_URL . 'assets/js/door.js', [], OE_VERSION, true);
    }

    /** The event being sold, from the ?e= query param. 0 when missing/invalid. */
    private function event_id(): int {
        return isset($_GET['e']) ? absint(wp_unslash($_GET['e'])) : 0;
    }

    /** The venue/door tag, from ?v= (free text, trimmed). */
    private function venue(): string {
        return isset($_GET['v']) ? substr(sanitize_text_field(wp_unslash($_GET['v'])), 0, 190) : '';
    }

    /**
     * Ticket types on open sale at the door: active, in stock and not members-only.
     * @return array<int,array{key:string,label:string,price:float,desc:string}>
     */
    private function sellable_types(int $event_id): array {
        $out = [];
        foreach (\OE\Ticketing\TicketTypes::types($event_id) as $t) {
            if (empty($t['active']) || \OE\Ticketing\TicketTypes::is_members_only($t)) {
                continue;
            }
            if (\OE\Ticketing\TicketTypes::availability($event_id, $t)['state'] !== 'available') {
                continue;
            }
            $out[] = [
                'key'   => (string) $t['key'],
                'label' => (string) $t['label'],
                'price' => \OE\Ticketing\TicketTypes::effective_price($t),
                'desc'  => (string) ($t['description'] ?? ''),
                'max'   => \OE\Ticketing\TicketTypes::max_per_order($t),
            ];
        }
        return $out;
    }

    public function render(): string {
        wp_enqueue_style('oe-door');
        wp_enqueue_script('oe-door');

        $event_id = $this->event_id();
        $venue    = $this->venue();
        $title    = $event_id ? (string) get_the_title($event_id) : '';
        $types    = $event_id ? $this->sellable_types($event_id) : [];
        $currency = strtoupper((string) \OE\Settings::get('currency', 'usd'));

        // The page to return to after Stripe (this same door page, minus any stale
        // result markers so a refresh starts clean). remove_query_arg() with no URL
        // operates on the current request URI.
        $path   = remove_query_arg(['oe_paid', 'oe_cancelled', 'session_id']);
        $return = home_url($path);

        wp_localize_script('oe-door', 'OE_DOOR', [
            'restUrl'   => esc_url_raw(rest_url('oe/v1')),
            'eventId'   => $event_id,
            'venue'     => $venue,
            'returnUrl' => esc_url_raw($return),
            'currency'  => $currency,
            'symbol'    => $currency === 'GBP' ? '£' : ($currency === 'EUR' ? '€' : '$'),
            'ready'     => \OE\Connectors\StripeConnector::is_ready(),
        ]);

        ob_start();
        $tpl_event_id = $event_id;
        $tpl_title    = $title;
        $tpl_venue    = $venue;
        $tpl_types    = $types;
        require OE_DIR . 'frontend/templates/door.php';
        return (string) ob_get_clean();
    }
}
