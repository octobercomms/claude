<?php
declare(strict_types=1);

namespace OE\Frontend;

use OE\PostTypes;
use OE\Settings;
use OE\Ticketing\TicketTypes;

defined('ABSPATH') || exit;

/**
 * Public event checkout — `[oe_event_checkout event_id="123"]`.
 *
 * Renders the ticket-type chooser, quantity, promo field, buyer details and the
 * payment options. Hydrated by assets/js/checkout.js against the oe/v1 ticket
 * endpoints. Stripe (card) is the primary gateway; PayPal is offered alongside
 * it when configured (Settings → Tickets).
 */
final class Checkout {

    private static ?Checkout $instance = null;

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function init(): void {
        add_shortcode('oe_event_checkout', [$this, 'render']);
        add_action('wp_enqueue_scripts', [$this, 'register_assets']);
    }

    public function register_assets(): void {
        wp_register_style('oe-checkout', OE_URL . 'assets/css/checkout.css', [], OE_VERSION);
        wp_register_script('oe-checkout', OE_URL . 'assets/js/checkout.js', ['jquery'], OE_VERSION, true);
    }

    public function render(array $atts = []): string {
        if (! \OE\Features::enabled('tickets')) {
            return '';
        }
        $atts = shortcode_atts(['event_id' => get_the_ID()], $atts, 'oe_event_checkout');
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
                'admits'      => (int) $t['qty_per_purchase'],
                'max'         => TicketTypes::max_per_order($t),
                'membersOnly' => TicketTypes::is_members_only($t),
                'state'       => $avail['state'],
                'opens'       => $avail['opens'],
            ];
        }
        if (! $types) {
            return '<p>' . esc_html__('Tickets are not on sale for this event yet.', 'october-events') . '</p>';
        }

        wp_enqueue_style('oe-checkout');
        wp_enqueue_script('oe-checkout');
        wp_enqueue_script('oe-stripe-js', 'https://js.stripe.com/v3/', [], null, true);

        $currency  = strtoupper((string) Settings::get('currency', 'usd'));
        $paypal_on = \OE\Connectors\PayPalConnector::is_ready();
        if ($paypal_on) {
            // PayPal JS SDK for the smart buttons (capture intent), in this currency.
            $sdk = add_query_arg([
                'client-id'  => rawurlencode(\OE\Connectors\PayPalConnector::client_id()),
                'currency'   => rawurlencode($currency),
                'intent'     => 'capture',
                'components' => 'buttons',
            ], 'https://www.paypal.com/sdk/js');
            wp_enqueue_script('oe-paypal-js', $sdk, [], null, true);
        }

        wp_localize_script('oe-checkout', 'octCheckout', [
            'restUrl'           => esc_url_raw(rest_url('oe/v1')),
            'nonce'             => wp_create_nonce('wp_rest'),
            'stripePublishable' => (string) Settings::get('stripe_publishable_key', ''),
            'paypalEnabled'     => $paypal_on,
            'eventId'           => $event_id,
            'currency'          => $currency,
            'currencySymbol'    => $currency === 'GBP' ? '£' : ($currency === 'EUR' ? '€' : '$'),
            'termsUrl'          => (string) Settings::get('checkout_terms_url', ''),
            // Membership: when enabled, the checkout checks the buyer's email and
            // unlocks member-only rates for members; non-members trying to pick one
            // are offered the join link (a Stripe Payment Link).
            'membershipEnabled' => (bool) Settings::get('membership_enabled', false),
            'membershipJoinUrl' => (string) Settings::get('membership_join_url', ''),
            'membershipJoinLabel' => (string) (Settings::get('membership_join_label', '') ?: __('Join to unlock this rate', 'october-events')),
            // One-click join: when a recurring join price is configured, the offer
            // becomes a checkbox that joins + buys with the same card. Amount is for
            // display only (Stripe bills the real price).
            'membershipJoinInline' => (bool) Settings::get('membership_enabled', false) && trim((string) Settings::get('membership_join_price_id', '')) !== '',
            'membershipJoinAmount' => (int) Settings::get('membership_join_amount', 0),
            'membershipInfoUrl'    => (string) Settings::get('membership_info_url', ''),
            'types'             => $types,
        ]);

        ob_start();
        require OE_DIR . 'frontend/templates/checkout.php';
        return (string) ob_get_clean();
    }
}
