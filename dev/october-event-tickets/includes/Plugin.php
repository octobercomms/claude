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

        Waitlist::get_instance()->init();
        EventReminder::get_instance()->init();

        // Auto-upgrade DB on version change
        if (DB::needs_upgrade()) {
            DB::upgrade();
        }

        // Ensure cron jobs are scheduled for existing installs
        DailyReport::schedule();
        EventReminder::schedule();

        // Rewrite rules & query vars
        add_action('init', [$this, 'register_rewrite_rules']);
        add_action('init', function() {
            if (get_option('oct_tickets_flushed_version', '') !== OCT_TICKETS_VERSION) {
                $this->register_rewrite_rules();
                flush_rewrite_rules(false);
                update_option('oct_tickets_flushed_version', OCT_TICKETS_VERSION);
            }
        }, 20);
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

    private function page_has_checkout_shortcode(\WP_Post $post): bool {
        // Standard post content
        if (has_shortcode($post->post_content, 'event_checkout') ||
            has_shortcode($post->post_content, 'oct_checkout')) {
            return true;
        }
        // Elementor stores shortcodes in _elementor_data meta
        $elementor_data = get_post_meta($post->ID, '_elementor_data', true);
        if ($elementor_data && (
            strpos($elementor_data, 'event_checkout') !== false ||
            strpos($elementor_data, 'oct_checkout') !== false
        )) {
            return true;
        }
        return false;
    }

    public function enqueue_frontend_assets(): void {
        // Fast path: enqueue in <head> when we can detect the shortcode on this page.
        // Falls back to enqueue_checkout_assets() called from the shortcode handler
        // itself for cases where the shortcode lives inside a Jet/Elementor template
        // (a separate post that this check won't see).
        if (!is_singular()) {
            return;
        }

        global $post;
        if ($post && $this->page_has_checkout_shortcode($post)) {
            $this->enqueue_checkout_assets();
        }
    }

    /**
     * Registers and enqueues all checkout assets + localized data.
     * Safe to call multiple times — WordPress deduplicates enqueues.
     * wp_localize_script is only called once (guarded by script-enqueued check).
     */
    public function enqueue_checkout_assets(): void {
        $settings = Settings::get_instance();
        $currency = strtoupper($settings->get('currency', 'USD'));

        wp_enqueue_style(
            'oct-checkout',
            OCT_TICKETS_URL . 'assets/css/checkout.css',
            [],
            OCT_TICKETS_VERSION
        );

        wp_enqueue_script(
            'stripe-js',
            'https://js.stripe.com/v3/',
            [],
            null,
            true
        );

        $paypal_client_id = $settings->get('paypal_client_id');
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

        $already_enqueued = wp_script_is('oct-checkout', 'enqueued') || wp_script_is('oct-checkout', 'done');

        wp_enqueue_script(
            'oct-checkout',
            OCT_TICKETS_URL . 'assets/js/checkout.js',
            ['jquery', 'stripe-js'],
            OCT_TICKETS_VERSION,
            true
        );

        // Localize only once — calling wp_localize_script a second time appends
        // a duplicate inline script block which would clobber the data object.
        if (!$already_enqueued) {
            wp_localize_script('oct-checkout', 'octCheckout', [
                'ajaxUrl'           => admin_url('admin-ajax.php'),
                'nonce'             => wp_create_nonce('oct_checkout_nonce'),
                'stripePublishable' => $settings->get('stripe_publishable_key'),
                'currency'          => $currency,
                'currencySymbol'    => $settings->get_currency_symbol(),
                'taxRate'           => floatval($settings->get('tax_rate', '0')),
                'taxLabel'          => $settings->get('tax_label', 'VAT'),
                'termsUrl'          => $settings->get('terms_url'),
            ]);
        }
    }
}
