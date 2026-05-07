<?php
declare(strict_types=1);

namespace OctoberTickets;

defined('ABSPATH') || exit;

/**
 * Plugin settings page and option management.
 */
class Settings {

    private static ?Settings $instance = null;
    const OPTION_KEY = 'oct_tickets_settings';

    private array $options = [];

    private function __construct() {
        $this->options = (array) get_option(self::OPTION_KEY, []);
    }

    public static function get_instance(): self {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function init(): void {
        add_action('admin_menu', [$this, 'add_menu_page']);
        add_action('admin_init', [$this, 'register_settings']);
    }

    public function get(string $key, string $default = ''): string {
        return isset($this->options[$key]) ? (string) $this->options[$key] : $default;
    }

    public function get_currency_symbol(): string {
        $map = [
            'USD' => '$',
            'GBP' => '£',
            'EUR' => '€',
            'AUD' => 'A$',
            'CAD' => 'C$',
        ];
        $currency = strtoupper($this->get('currency', 'USD'));
        return $map[$currency] ?? '$';
    }

    public function add_menu_page(): void {
        add_options_page(
            __('Event Tickets Settings', 'october-event-tickets'),
            __('Event Tickets', 'october-event-tickets'),
            'manage_options',
            'oct-tickets-settings',
            [$this, 'render_settings_page']
        );
    }

    public function register_settings(): void {
        register_setting(
            'oct_tickets_settings_group',
            self::OPTION_KEY,
            [
                'sanitize_callback' => [$this, 'sanitize_settings'],
                'default'           => [],
            ]
        );

        // Stripe section
        add_settings_section(
            'oct_stripe',
            __('Stripe', 'october-event-tickets'),
            null,
            'oct-tickets-settings'
        );

        $stripe_fields = [
            'stripe_publishable_key' => __('Publishable Key', 'october-event-tickets'),
            'stripe_secret_key'      => __('Secret Key', 'october-event-tickets'),
            'stripe_webhook_secret'  => __('Webhook Secret', 'october-event-tickets'),
        ];

        foreach ($stripe_fields as $key => $label) {
            add_settings_field(
                $key,
                $label,
                [$this, 'render_text_field'],
                'oct-tickets-settings',
                'oct_stripe',
                ['key' => $key, 'type' => 'password']
            );
        }

        // PayPal section
        add_settings_section(
            'oct_paypal',
            __('PayPal', 'october-event-tickets'),
            null,
            'oct-tickets-settings'
        );

        add_settings_field(
            'paypal_client_id',
            __('Client ID', 'october-event-tickets'),
            [$this, 'render_text_field'],
            'oct-tickets-settings',
            'oct_paypal',
            ['key' => 'paypal_client_id', 'type' => 'password']
        );

        add_settings_field(
            'paypal_client_secret',
            __('Client Secret', 'october-event-tickets'),
            [$this, 'render_text_field'],
            'oct-tickets-settings',
            'oct_paypal',
            ['key' => 'paypal_client_secret', 'type' => 'password']
        );

        add_settings_field(
            'paypal_mode',
            __('Mode', 'october-event-tickets'),
            [$this, 'render_select_field'],
            'oct-tickets-settings',
            'oct_paypal',
            [
                'key'     => 'paypal_mode',
                'options' => [
                    'sandbox' => __('Sandbox', 'october-event-tickets'),
                    'live'    => __('Live', 'october-event-tickets'),
                ],
            ]
        );

        // Brevo section
        add_settings_section(
            'oct_brevo',
            __('Brevo (Email)', 'october-event-tickets'),
            null,
            'oct-tickets-settings'
        );

        $brevo_fields = [
            'brevo_api_key' => [__('API Key', 'october-event-tickets'), 'password'],
            'from_name'     => [__('From Name', 'october-event-tickets'), 'text'],
            'from_email'    => [__('From Email', 'october-event-tickets'), 'email'],
        ];

        foreach ($brevo_fields as $key => [$label, $type]) {
            add_settings_field(
                $key,
                $label,
                [$this, 'render_text_field'],
                'oct-tickets-settings',
                'oct_brevo',
                ['key' => $key, 'type' => $type]
            );
        }

        // Daily Report section
        add_settings_section(
            'oct_report',
            __('Daily Sales Report', 'october-event-tickets'),
            function() {
                echo '<p>' . esc_html__('Sent once per day only if a ticket sale occurred that day. Leave blank to disable.', 'october-event-tickets') . '</p>';
            },
            'oct-tickets-settings'
        );

        add_settings_field(
            'report_email',
            __('Report Email Address', 'october-event-tickets'),
            [$this, 'render_text_field'],
            'oct-tickets-settings',
            'oct_report',
            ['key' => 'report_email', 'type' => 'email']
        );

        // Currency section
        add_settings_section(
            'oct_currency',
            __('Currency', 'october-event-tickets'),
            null,
            'oct-tickets-settings'
        );

        add_settings_field(
            'currency',
            __('Currency', 'october-event-tickets'),
            [$this, 'render_select_field'],
            'oct-tickets-settings',
            'oct_currency',
            [
                'key'     => 'currency',
                'options' => [
                    'USD' => 'USD — US Dollar ($)',
                    'GBP' => 'GBP — British Pound (£)',
                    'EUR' => 'EUR — Euro (€)',
                    'AUD' => 'AUD — Australian Dollar (A$)',
                    'CAD' => 'CAD — Canadian Dollar (C$)',
                ],
            ]
        );
    }

    public function sanitize_settings(array $input): array {
        $clean = [];

        $text_keys = [
            'stripe_publishable_key',
            'stripe_secret_key',
            'stripe_webhook_secret',
            'paypal_client_id',
            'paypal_client_secret',
            'brevo_api_key',
            'from_name',
        ];

        foreach ($text_keys as $key) {
            $clean[$key] = sanitize_text_field($input[$key] ?? '');
        }

        $clean['from_email']    = sanitize_email($input['from_email'] ?? '');
        $clean['report_email']  = sanitize_email($input['report_email'] ?? '');
        $clean['paypal_mode']   = in_array($input['paypal_mode'] ?? '', ['sandbox', 'live'], true)
            ? $input['paypal_mode']
            : 'sandbox';
        $clean['currency']      = in_array($input['currency'] ?? '', ['USD', 'GBP', 'EUR', 'AUD', 'CAD'], true)
            ? $input['currency']
            : 'USD';

        return $clean;
    }

    public function render_text_field(array $args): void {
        $key   = $args['key'];
        $type  = $args['type'] ?? 'text';
        $value = esc_attr($this->get($key));
        $name  = esc_attr(self::OPTION_KEY . '[' . $key . ']');

        echo '<input type="' . esc_attr($type) . '" name="' . $name . '" value="' . $value . '" class="regular-text" />';
    }

    public function render_select_field(array $args): void {
        $key     = $args['key'];
        $options = $args['options'] ?? [];
        $current = $this->get($key);
        $name    = esc_attr(self::OPTION_KEY . '[' . $key . ']');

        echo '<select name="' . $name . '">';
        foreach ($options as $val => $label) {
            $selected = selected($current, $val, false);
            echo '<option value="' . esc_attr($val) . '" ' . $selected . '>' . esc_html($label) . '</option>';
        }
        echo '</select>';
    }

    public function render_settings_page(): void {
        if (!current_user_can('manage_options')) {
            return;
        }

        ?>
        <div class="wrap">
            <h1><?php echo esc_html(get_admin_page_title()); ?></h1>
            <form action="options.php" method="post">
                <?php
                settings_fields('oct_tickets_settings_group');
                do_settings_sections('oct-tickets-settings');
                submit_button(__('Save Settings', 'october-event-tickets'));
                ?>
            </form>

            <hr>
            <h2><?php esc_html_e('Stripe Webhook', 'october-event-tickets'); ?></h2>
            <p><?php esc_html_e('Configure this URL in your Stripe dashboard as a webhook endpoint:', 'october-event-tickets'); ?></p>
            <code><?php echo esc_url(rest_url('oct-tickets/v1/stripe-webhook')); ?></code>
            <p><?php esc_html_e('Listen for: payment_intent.succeeded', 'october-event-tickets'); ?></p>

            <hr>
            <h2><?php esc_html_e('Shortcode', 'october-event-tickets'); ?></h2>
            <p><?php esc_html_e('Add the checkout form to any page:', 'october-event-tickets'); ?></p>
            <code>[oct_checkout]</code>
            <p><?php esc_html_e('Or specify an event ID:', 'october-event-tickets'); ?></p>
            <code>[oct_checkout event_id="123"]</code>

            <hr>
            <h2><?php esc_html_e('Check-in App', 'october-event-tickets'); ?></h2>
            <p><?php esc_html_e('Access the mobile check-in app at:', 'october-event-tickets'); ?></p>
            <code><?php echo esc_url(home_url('/oct-checkin/')); ?></code>
        </div>
        <?php
    }
}
