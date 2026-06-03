<?php
declare(strict_types=1);

namespace ADF\Frontend;

use ADF\Account;
use ADF\PostTypes;
use ADF\Settings;
use ADF\Connectors\StripeConnector;

defined('ABSPATH') || exit;

/**
 * Frontend account dashboard (§2).
 *
 * Rendered via the `[adf_account_dashboard]` shortcode (drop it on a page such
 * as /my-account/). Lightweight: a single container hydrated by vanilla JS
 * against the REST API — no React. Stripe.js is loaded from Stripe's domain for
 * PCI-compliant card capture (the only permitted external script).
 */
final class Dashboard {

    private static ?Dashboard $instance = null;

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function init(): void {
        add_shortcode('adf_account_dashboard', [$this, 'render']);
    }

    public function render(array $atts = []): string {
        if (! is_user_logged_in()) {
            return '<div class="adf-dashboard adf-login-required"><p>'
                . esc_html__('Please log in to access your account.', 'adf-festival')
                . ' <a href="' . esc_url(wp_login_url(get_permalink())) . '">' . esc_html__('Log in', 'adf-festival') . '</a></p></div>';
        }

        wp_enqueue_style('adf-dashboard');
        wp_enqueue_script('adf-dashboard');

        // Stripe.js — required for client-side PaymentIntent confirmation (§4).
        wp_enqueue_script('adf-stripe-js', 'https://js.stripe.com/v3/', [], null, true);

        $account_id = Account::ensure(get_current_user_id());

        wp_localize_script('adf-dashboard', 'ADF_DASH', [
            'restUrl'   => esc_url_raw(rest_url('adf/v1')),
            'nonce'     => wp_create_nonce('wp_rest'),
            'stripeKey' => (string) Settings::get('stripe_publishable_key', ''),
            'types'     => $this->type_meta(),
            'tiers'     => $this->tier_meta(),
            'account'   => [
                'name'  => Account::name($account_id),
                'email' => Account::email($account_id),
            ],
            'i18n'      => [
                'loading'   => __('Loading…', 'adf-festival'),
                'pay'       => __('Pay & submit', 'adf-festival'),
                'submitted' => __('Submitted!', 'adf-festival'),
            ],
        ]);

        ob_start();
        require ADF_DIR . 'frontend/templates/dashboard.php';
        return (string) ob_get_clean();
    }

    /**
     * Listing types + their per-tier prices for the Submit New form.
     */
    private function type_meta(): array {
        $out = [];
        foreach (PostTypes::listing_types() as $type) {
            $out[$type] = [
                'label'  => PostTypes::TYPES[$type]['label'],
                'prices' => [
                    'free'     => 0,
                    'featured' => Settings::price($type, 'featured'),
                    'premium'  => Settings::price($type, 'premium'),
                ],
            ];
        }
        return $out;
    }

    private function tier_meta(): array {
        return [
            'free'     => __('Free', 'adf-festival'),
            'featured' => __('Featured', 'adf-festival'),
            'premium'  => __('Premium', 'adf-festival'),
        ];
    }
}
