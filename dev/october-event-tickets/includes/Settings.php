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
        add_action('admin_enqueue_scripts', [$this, 'enqueue_settings_assets']);
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
            __('Report Recipients', 'october-event-tickets'),
            function() {
                $value = esc_attr(Settings::get_instance()->get('report_email'));
                $name  = esc_attr(Settings::OPTION_KEY . '[report_email]');
                echo '<input type="text" name="' . $name . '" value="' . $value . '" class="regular-text" />';
                echo '<p class="description">' . esc_html__('Comma-separated email addresses. Leave blank to disable.', 'october-event-tickets') . '</p>';
            },
            'oct-tickets-settings',
            'oct_report'
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

        // Check-in App section
        add_settings_section(
            'oct_checkin_app',
            __('Check-in App', 'october-event-tickets'),
            null,
            'oct-tickets-settings'
        );

        add_settings_field(
            'checkin_logo_url',
            __('Logo Image', 'october-event-tickets'),
            [$this, 'render_logo_field'],
            'oct-tickets-settings',
            'oct_checkin_app'
        );

        // Terms & Conditions section
        add_settings_section(
            'oct_terms',
            __('Terms &amp; Conditions', 'october-event-tickets'),
            function() {
                echo '<p>' . esc_html__('When set, buyers must tick a T&Cs checkbox at checkout before purchasing.', 'october-event-tickets') . '</p>';
            },
            'oct-tickets-settings'
        );

        add_settings_field(
            'terms_url',
            __('T&Cs Page URL', 'october-event-tickets'),
            [$this, 'render_text_field'],
            'oct-tickets-settings',
            'oct_terms',
            ['key' => 'terms_url', 'type' => 'url']
        );

        // Tax / VAT section
        add_settings_section(
            'oct_tax',
            __('Tax / VAT', 'october-event-tickets'),
            function() {
                echo '<p>' . esc_html__('Leave rate at 0 to disable tax display entirely.', 'october-event-tickets') . '</p>';
            },
            'oct-tickets-settings'
        );

        add_settings_field(
            'tax_rate',
            __('Tax Rate (%)', 'october-event-tickets'),
            function() {
                $value = esc_attr(Settings::get_instance()->get('tax_rate', '0'));
                $name  = esc_attr(Settings::OPTION_KEY . '[tax_rate]');
                echo '<input type="number" name="' . $name . '" value="' . $value . '" min="0" max="100" step="0.01" style="width:80px;" /> %';
                echo '<p class="description">' . esc_html__('e.g. 20 for 20% VAT. Applied to subtotal after any discount.', 'october-event-tickets') . '</p>';
            },
            'oct-tickets-settings',
            'oct_tax'
        );

        add_settings_field(
            'tax_label',
            __('Tax Label', 'october-event-tickets'),
            function() {
                $value = esc_attr(Settings::get_instance()->get('tax_label', 'VAT'));
                $name  = esc_attr(Settings::OPTION_KEY . '[tax_label]');
                echo '<input type="text" name="' . $name . '" value="' . $value . '" class="regular-text" placeholder="VAT" />';
            },
            'oct-tickets-settings',
            'oct_tax'
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

        $clean['from_email']   = sanitize_email($input['from_email'] ?? '');

        // Comma-separated list of email addresses
        $raw_emails = $input['report_email'] ?? '';
        $emails     = array_filter(array_map('trim', explode(',', $raw_emails)));
        $clean['report_email'] = implode(',', array_map('sanitize_email', $emails));
        $clean['paypal_mode']   = in_array($input['paypal_mode'] ?? '', ['sandbox', 'live'], true)
            ? $input['paypal_mode']
            : 'sandbox';
        $clean['currency']      = in_array($input['currency'] ?? '', ['USD', 'GBP', 'EUR', 'AUD', 'CAD'], true)
            ? $input['currency']
            : 'USD';
        $clean['checkin_logo_url'] = esc_url_raw($input['checkin_logo_url'] ?? '');
        $clean['terms_url']        = esc_url_raw($input['terms_url'] ?? '');
        $tax_rate = floatval($input['tax_rate'] ?? 0);
        $clean['tax_rate']         = (string) max(0, min(100, $tax_rate));
        $clean['tax_label']        = sanitize_text_field($input['tax_label'] ?? 'VAT');

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

    public function render_logo_field(): void {
        $url  = esc_attr($this->get('checkin_logo_url'));
        $name = esc_attr(self::OPTION_KEY . '[checkin_logo_url]');
        echo '<div style="display:flex;align-items:center;gap:12px;">';
        echo '<input type="url" id="oct_checkin_logo_url" name="' . $name . '" value="' . $url . '" class="regular-text" placeholder="https://" />';
        echo '<button type="button" class="button" id="oct_logo_upload_btn">' . esc_html__('Choose Image', 'october-event-tickets') . '</button>';
        echo '</div>';
        if ($url) {
            echo '<div style="margin-top:8px;"><img src="' . esc_url($url) . '" style="max-height:60px;border-radius:4px;border:1px solid #ddd;" /></div>';
        }
        echo '<p class="description">' . esc_html__('Logo shown in the check-in app header. Recommended height: 40px.', 'october-event-tickets') . '</p>';
    }

    public function enqueue_settings_assets(string $hook): void {
        if ($hook !== 'settings_page_oct-tickets-settings') {
            return;
        }
        wp_enqueue_media();
        wp_add_inline_script('jquery-core', "
            jQuery(function($) {
                $('#oct_logo_upload_btn').on('click', function(e) {
                    e.preventDefault();
                    var frame = wp.media({ title: 'Choose Logo', button: { text: 'Use this image' }, multiple: false });
                    frame.on('select', function() {
                        var att = frame.state().get('selection').first().toJSON();
                        $('#oct_checkin_logo_url').val(att.url);
                    });
                    frame.open();
                });
            });
        ");
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
            <code>[event_checkout]</code>
            <p><?php esc_html_e('Or specify an event ID:', 'october-event-tickets'); ?></p>
            <code>[event_checkout event_id="123"]</code>

            <hr>
            <h2><?php esc_html_e('Check-in App', 'october-event-tickets'); ?></h2>
            <p><?php esc_html_e('Access the mobile check-in app at:', 'october-event-tickets'); ?></p>
            <code><?php echo esc_url(home_url('/checkin/')); ?></code>
        </div>
        <?php
    }
}
