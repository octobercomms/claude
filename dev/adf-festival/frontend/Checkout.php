<?php
declare(strict_types=1);

namespace ADF\Frontend;

use ADF\PostTypes;
use ADF\Settings;
use ADF\Ticketing\TicketTypes;

defined('ABSPATH') || exit;

/**
 * Public event checkout — `[adf_event_checkout event_id="123"]`.
 *
 * Renders the ticket-type chooser, quantity, promo field, buyer details and a
 * Stripe card element. Hydrated by assets/js/checkout.js against the adf/v1
 * ticket endpoints. Stripe is the only gateway (per the festival's decision).
 */
final class Checkout {

    private static ?Checkout $instance = null;

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function init(): void {
        add_shortcode('adf_event_checkout', [$this, 'render']);
        add_action('wp_enqueue_scripts', [$this, 'register_assets']);
    }

    public function register_assets(): void {
        wp_register_script('adf-checkout', ADF_URL . 'assets/js/checkout.js', [], ADF_VERSION, true);
    }

    public function render(array $atts = []): string {
        $atts = shortcode_atts(['event_id' => get_the_ID()], $atts, 'adf_event_checkout');
        $event_id = (int) $atts['event_id'];
        if (! $event_id || get_post_type($event_id) !== PostTypes::slug('event')) {
            return '';
        }

        $types = [];
        foreach (TicketTypes::types($event_id) as $t) {
            $avail = TicketTypes::availability($event_id, $t);
            $types[] = [
                'key'        => $t['key'],
                'label'      => $t['label'],
                'desc'       => $t['description'],
                'price'      => (float) $t['price'],
                'sale_price' => $t['sale_price'],
                'effective'  => TicketTypes::effective_price($t),
                'admits'     => (int) $t['qty_per_purchase'],
                'state'      => $avail['state'],
                'opens'      => $avail['opens'],
            ];
        }
        if (! $types) {
            return '<p>' . esc_html__('Tickets are not on sale for this event yet.', 'adf-festival') . '</p>';
        }

        wp_enqueue_style('adf-dashboard');
        wp_enqueue_script('adf-checkout');
        wp_enqueue_script('adf-stripe-js', 'https://js.stripe.com/v3/', [], null, true);

        $currency = strtoupper((string) Settings::get('currency', 'usd'));
        wp_localize_script('adf-checkout', 'ADF_CHECKOUT', [
            'restUrl'   => esc_url_raw(rest_url('adf/v1')),
            'nonce'     => wp_create_nonce('wp_rest'),
            'stripeKey' => (string) Settings::get('stripe_publishable_key', ''),
            'eventId'   => $event_id,
            'currency'  => $currency,
            'symbol'    => $currency === 'GBP' ? '£' : ($currency === 'EUR' ? '€' : '$'),
            'types'     => $types,
        ]);

        ob_start();
        require ADF_DIR . 'frontend/templates/checkout.php';
        return (string) ob_get_clean();
    }
}
