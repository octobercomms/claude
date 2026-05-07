<?php
declare(strict_types=1);

namespace OctoberTickets;

defined('ABSPATH') || exit;

/**
 * PayPal payment gateway — direct REST API calls (no SDK).
 */
class PayPalGateway {

    private static ?PayPalGateway $instance = null;
    private const TRANSIENT_KEY = 'oct_paypal_access_token';

    private function __construct() {}

    public static function get_instance(): self {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function settings(): Settings {
        return Settings::get_instance();
    }

    private function api_base(): string {
        return $this->settings()->get('paypal_mode', 'sandbox') === 'live'
            ? 'https://api-m.paypal.com'
            : 'https://api-m.sandbox.paypal.com';
    }

    private function client_id(): string {
        return $this->settings()->get('paypal_client_id');
    }

    private function client_secret(): string {
        return $this->settings()->get('paypal_client_secret');
    }

    // -------------------------------------------------------------------------
    // OAuth Token
    // -------------------------------------------------------------------------

    private function get_access_token() {
        $cached = get_transient(self::TRANSIENT_KEY . '_' . $this->settings()->get('paypal_mode', 'sandbox'));
        if ($cached) {
            return $cached;
        }

        $response = wp_remote_post($this->api_base() . '/v1/oauth2/token', [
            'headers' => [
                'Authorization' => 'Basic ' . base64_encode($this->client_id() . ':' . $this->client_secret()),
                'Content-Type'  => 'application/x-www-form-urlencoded',
            ],
            'body'    => 'grant_type=client_credentials',
            'timeout' => 20,
        ]);

        if (is_wp_error($response)) {
            return $response;
        }

        $data = json_decode(wp_remote_retrieve_body($response), true) ?? [];
        if (empty($data['access_token'])) {
            return new \WP_Error('paypal_auth', __('Could not obtain PayPal access token', 'october-event-tickets'));
        }

        $expires_in = max(3600, (int) ($data['expires_in'] ?? 3600)) - 60; // 60s buffer
        set_transient(
            self::TRANSIENT_KEY . '_' . $this->settings()->get('paypal_mode', 'sandbox'),
            $data['access_token'],
            min($expires_in, 8 * HOUR_IN_SECONDS)
        );

        return $data['access_token'];
    }

    // -------------------------------------------------------------------------
    // Orders API v2
    // -------------------------------------------------------------------------

    /**
     * Create a PayPal Order and return the PayPal order ID.
     *
     * @param float  $amount       Decimal amount.
     * @param string $currency     ISO 4217 code.
     * @param string $description  Order description.
     * @param array  $custom_data  Optional metadata (stored in purchase_units[0].custom_id).
     */
    public function create_order(float $amount, string $currency, string $description = '', array $custom_data = []) {
        $payload = [
            'intent'         => 'CAPTURE',
            'purchase_units' => [
                [
                    'amount'      => [
                        'currency_code' => strtoupper($currency),
                        'value'         => number_format($amount, 2, '.', ''),
                    ],
                    'description' => $description,
                    'custom_id'   => !empty($custom_data) ? wp_json_encode($custom_data) : '',
                ],
            ],
            'payment_source' => [
                'paypal' => [
                    'experience_context' => [
                        'payment_method_preference' => 'IMMEDIATE_PAYMENT_REQUIRED',
                        'landing_page'              => 'NO_PREFERENCE',
                        'user_action'               => 'PAY_NOW',
                    ],
                ],
            ],
        ];

        $result = $this->request('POST', '/v2/checkout/orders', $payload);
        if (is_wp_error($result)) {
            return $result;
        }

        if (empty($result['id'])) {
            return new \WP_Error('paypal_order', $result['message'] ?? __('Could not create PayPal order', 'october-event-tickets'));
        }

        return $result;
    }

    /**
     * Capture a PayPal Order after buyer approval.
     */
    public function capture_order(string $paypal_order_id) {
        $result = $this->request('POST', '/v2/checkout/orders/' . rawurlencode($paypal_order_id) . '/capture', []);
        if (is_wp_error($result)) {
            return $result;
        }

        return $result;
    }

    /**
     * Get details of a PayPal Order.
     */
    public function get_order(string $paypal_order_id) {
        return $this->request('GET', '/v2/checkout/orders/' . rawurlencode($paypal_order_id));
    }

    /**
     * Check if a captured order status is COMPLETED.
     */
    public function is_capture_complete(array $capture_response): bool {
        return ($capture_response['status'] ?? '') === 'COMPLETED';
    }

    /**
     * Extract the captured amount from a capture response.
     */
    public function get_captured_amount(array $capture_response): float {
        $units = $capture_response['purchase_units'][0] ?? [];
        $captures = $units['payments']['captures'][0] ?? [];
        return (float) ($captures['amount']['value'] ?? 0);
    }

    /**
     * Extract the PayPal capture ID (transaction ID).
     */
    public function get_capture_id(array $capture_response): string {
        $units = $capture_response['purchase_units'][0] ?? [];
        $captures = $units['payments']['captures'][0] ?? [];
        return (string) ($captures['id'] ?? '');
    }

    // -------------------------------------------------------------------------
    // Internal HTTP helper
    // -------------------------------------------------------------------------

    private function request(string $method, string $endpoint, array $body = []) {
        $token = $this->get_access_token();
        if (is_wp_error($token)) {
            return $token;
        }

        $args = [
            'method'  => strtoupper($method),
            'headers' => [
                'Authorization' => 'Bearer ' . $token,
                'Content-Type'  => 'application/json',
                'Prefer'        => 'return=representation',
            ],
            'timeout' => 20,
        ];

        $url = $this->api_base() . $endpoint;

        if ($method === 'GET') {
            if (!empty($body)) {
                $url = add_query_arg($body, $url);
            }
        } else {
            $args['body'] = wp_json_encode($body);
        }

        $response = wp_remote_request($url, $args);

        if (is_wp_error($response)) {
            return $response;
        }

        $code    = wp_remote_retrieve_response_code($response);
        $decoded = json_decode(wp_remote_retrieve_body($response), true) ?? [];

        if ($code >= 400) {
            $message = $decoded['message'] ?? __('PayPal API error', 'october-event-tickets');
            return new \WP_Error('paypal_api_' . $code, $message, $decoded);
        }

        return $decoded;
    }
}
