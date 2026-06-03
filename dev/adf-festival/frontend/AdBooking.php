<?php
declare(strict_types=1);

namespace ADF\Frontend;

use ADF\Settings;
use ADF\Ads\Bookings;
use ADF\Ads\Formats;

defined('ABSPATH') || exit;

/**
 * Self-serve ad booking form — `[adf_ad_book]`. Advertiser uploads creatives,
 * picks a package, pays via Stripe; the booking then awaits admin activation.
 */
final class AdBooking {

    private static ?AdBooking $instance = null;

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function init(): void {
        add_shortcode('adf_ad_book', [$this, 'render']);
        add_action('wp_enqueue_scripts', [$this, 'register_assets']);
    }

    public function register_assets(): void {
        wp_register_script('adf-ad-booking', ADF_URL . 'assets/js/ad-booking.js', [], ADF_VERSION, true);
    }

    public function render(array $atts = []): string {
        $packages = Bookings::packages();
        if (! $packages) {
            return current_user_can('manage_options')
                ? '<p>' . esc_html__('Add ad packages in ADF Festival → Settings to enable booking.', 'adf-festival') . '</p>'
                : '';
        }
        if (! Settings::has_secret('stripe_secret_key')) {
            return current_user_can('manage_options') ? '<p>' . esc_html__('Configure Stripe to enable ad booking.', 'adf-festival') . '</p>' : '';
        }

        wp_enqueue_style('adf-dashboard');
        wp_enqueue_script('adf-ad-booking');
        wp_enqueue_script('adf-stripe-js', 'https://js.stripe.com/v3/', [], null, true);

        $currency = strtoupper((string) Settings::get('currency', 'usd'));
        wp_localize_script('adf-ad-booking', 'ADF_ADBOOK', [
            'restUrl'   => esc_url_raw(rest_url('adf/v1')),
            'nonce'     => wp_create_nonce('wp_rest'),
            'stripeKey' => (string) Settings::get('stripe_publishable_key', ''),
            'symbol'    => $currency === 'GBP' ? '£' : ($currency === 'EUR' ? '€' : '$'),
            'packages'  => array_values($packages),
        ]);

        $formats = Formats::ALL;
        ob_start();
        require ADF_DIR . 'frontend/templates/ad-booking.php';
        return (string) ob_get_clean();
    }
}
