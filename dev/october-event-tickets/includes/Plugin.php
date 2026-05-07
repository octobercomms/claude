<?php
declare(strict_types=1);

namespace OctoberTickets;

defined('ABSPATH') || exit;

/**
 * Main plugin singleton — registers all hooks.
 */
final class Plugin {

    private static ?Plugin $instance = null;

    private function __construct() {}

    public static function get_instance(): self {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function init(): void {
        // Load text domain
        load_plugin_textdomain('october-event-tickets', false, dirname(OCT_TICKETS_BASENAME) . '/languages');

        // Core modules
        Settings::get_instance()->init();
        EventMetaBox::get_instance()->init();
        Checkout::get_instance()->init();
        CheckInApi::get_instance()->init();
        PromoCodes::get_instance()->init();
        AdminScreens::get_instance()->init();
        TicketGenerator::get_instance()->init();
        DailyReport::get_instance()->init();

        // Rewrite rules & query vars
        add_action('init', [$this, 'register_rewrite_rules']);
        add_filter('query_vars', [$this, 'add_query_vars']);
        add_action('template_redirect', [$this, 'handle_template_redirect']);

        // Enqueue assets
        add_action('wp_enqueue_scripts', [$this, 'enqueue_frontend_assets']);
    }

    public function register_rewrite_rules(): void {
        // Individual ticket print
        add_rewrite_rule(
            '^oct-ticket/([a-f0-9]{64})/?$',
            'index.php?oct_ticket_token=$matches[1]',
            'top'
        );

        // Order print (all tickets)
        add_rewrite_rule(
            '^oct-ticket/order/([0-9]+)/?$',
            'index.php?oct_order_id=$matches[1]',
            'top'
        );

        // Check-in PWA
        add_rewrite_rule(
            '^checkin/?$',
            'index.php?oct_checkin_app=1',
            'top'
        );
    }

    public function add_query_vars(array $vars): array {
        $vars[] = 'oct_ticket_token';
        $vars[] = 'oct_order_id';
        $vars[] = 'oct_checkin_app';
        return $vars;
    }

    public function handle_template_redirect(): void {
        $token    = get_query_var('oct_ticket_token', '');
        $order_id = get_query_var('oct_order_id', '');
        $checkin  = get_query_var('oct_checkin_app', '');

        if ($token !== '') {
            TicketGenerator::get_instance()->render_ticket_print((string) $token);
            exit;
        }

        if ($order_id !== '') {
            TicketGenerator::get_instance()->render_order_print((int) $order_id);
            exit;
        }

        if ($checkin !== '') {
            $this->render_checkin_app();
            exit;
        }
    }

    private function render_checkin_app(): void {
        // Serve the check-in PWA template
        $template = OCT_TICKETS_DIR . 'templates/checkin-app.php';
        if (file_exists($template)) {
            include $template;
        }
    }

    public function enqueue_frontend_assets(): void {
        // Only enqueue checkout assets when the shortcode might be on the page
        // We use a global flag set by the shortcode
        if (!is_singular()) {
            return;
        }

        global $post;
        if ($post && has_shortcode($post->post_content, 'oct_checkout')) {
            $settings = Settings::get_instance();

            wp_enqueue_style(
                'oct-checkout',
                OCT_TICKETS_URL . 'assets/css/checkout.css',
                [],
                OCT_TICKETS_VERSION
            );

            // Stripe.js
            wp_enqueue_script(
                'stripe-js',
                'https://js.stripe.com/v3/',
                [],
                null,
                true
            );

            // PayPal SDK — built dynamically in checkout.js init
            $paypal_client_id = $settings->get('paypal_client_id');
            $currency         = strtoupper($settings->get('currency', 'USD'));
            if ($paypal_client_id) {
                wp_enqueue_script(
                    'paypal-sdk',
                    'https://www.paypal.com/sdk/js?client-id=' . esc_attr($paypal_client_id)
                        . '&components=buttons&enable-funding=paylater&currency=' . esc_attr($currency),
                    [],
                    null,
                    true
                );
            }

            wp_enqueue_script(
                'oct-checkout',
                OCT_TICKETS_URL . 'assets/js/checkout.js',
                ['jquery', 'stripe-js'],
                OCT_TICKETS_VERSION,
                true
            );

            wp_localize_script('oct-checkout', 'octCheckout', [
                'ajaxUrl'           => admin_url('admin-ajax.php'),
                'nonce'             => wp_create_nonce('oct_checkout_nonce'),
                'stripePublishable' => $settings->get('stripe_publishable_key'),
                'currency'          => $currency,
                'currencySymbol'    => $settings->get_currency_symbol(),
            ]);
        }
    }
}
