<?php
declare(strict_types=1);

namespace OctoberTickets;

defined('ABSPATH') || exit;

/**
 * Stripe payment gateway — direct API calls via wp_remote_post/get.
 */
class StripeGateway {

    private static ?StripeGateway $instance = null;
    private const API_BASE = 'https://api.stripe.com/v1';

    private function __construct() {}

    public static function get_instance(): self {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function secret_key(): string {
        return Settings::get_instance()->get('stripe_secret_key');
    }

    private function webhook_secret(): string {
        return Settings::get_instance()->get('stripe_webhook_secret');
    }

    /**
     * Create a PaymentIntent and return the client_secret.
     *
     * @param int    $amount_cents
     * @param string $currency
     * @param array  $metadata
     * @return array{client_secret: string, payment_intent_id: string}|WP_Error
     */
    public function create_payment_intent(int $amount_cents, string $currency, array $metadata = []) {
        $body = [
            'amount'               => $amount_cents,
            'currency'             => strtolower($currency),
            'payment_method_types' => ['card'],
            'metadata'             => $metadata,
        ];

        $response = $this->request('POST', '/payment_intents', $body);

        if (is_wp_error($response)) {
            return $response;
        }

        if (empty($response['client_secret'])) {
            return new \WP_Error('stripe_error', $response['error']['message'] ?? __('Unknown Stripe error', 'october-event-tickets'));
        }

        return [
            'client_secret'      => $response['client_secret'],
            'payment_intent_id'  => $response['id'],
        ];
    }

    /**
     * Retrieve a PaymentIntent and return its status.
     */
    public function get_payment_intent(string $payment_intent_id) {
        return $this->request('GET', '/payment_intents/' . rawurlencode($payment_intent_id));
    }

    /**
     * Verify the Stripe webhook signature.
     * Returns true if valid, false otherwise.
     */
    public function verify_webhook_signature(string $payload, string $sig_header): bool {
        $secret = $this->webhook_secret();
        if (!$secret) {
            return false;
        }

        // Parse the signature header
        $parts     = explode(',', $sig_header);
        $timestamp = null;
        $signatures = [];

        foreach ($parts as $part) {
            [$key, $value] = explode('=', $part, 2);
            if ($key === 't') {
                $timestamp = (int) $value;
            } elseif ($key === 'v1') {
                $signatures[] = $value;
            }
        }

        if (!$timestamp || empty($signatures)) {
            return false;
        }

        // Replay attack protection — 5 minutes tolerance
        if (abs(time() - $timestamp) > 300) {
            return false;
        }

        $signed_payload = $timestamp . '.' . $payload;
        $expected = hash_hmac('sha256', $signed_payload, $secret);

        foreach ($signatures as $sig) {
            if (hash_equals($expected, $sig)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Issue a refund for a PaymentIntent.
     */
    public function refund_payment_intent(string $payment_intent_id, ?int $amount_cents = null) {
        $body = ['payment_intent' => $payment_intent_id];
        if ($amount_cents !== null) {
            $body['amount'] = $amount_cents;
        }
        return $this->request('POST', '/refunds', $body);
    }

    // -------------------------------------------------------------------------
    // Internal HTTP helper
    // -------------------------------------------------------------------------

    private function request(string $method, string $endpoint, array $body = []) {
        $args = [
            'method'  => strtoupper($method),
            'headers' => [
                'Authorization' => 'Bearer ' . $this->secret_key(),
                'Content-Type'  => 'application/x-www-form-urlencoded',
            ],
            'timeout' => 20,
        ];

        $url = self::API_BASE . $endpoint;

        if ($method === 'GET' && !empty($body)) {
            $url = add_query_arg($body, $url);
        } elseif (!empty($body)) {
            $args['body'] = $this->build_query($body);
        }

        $response = wp_remote_request($url, $args);

        if (is_wp_error($response)) {
            return $response;
        }

        $code    = wp_remote_retrieve_response_code($response);
        $decoded = json_decode(wp_remote_retrieve_body($response), true) ?? [];

        if ($code >= 400) {
            $message = $decoded['error']['message'] ?? __('Stripe API error', 'october-event-tickets');
            return new \WP_Error('stripe_api_' . $code, $message, $decoded);
        }

        return $decoded;
    }

    /**
     * Recursively build x-www-form-urlencoded string (Stripe style for nested arrays).
     */
    private function build_query(array $data, string $prefix = ''): string {
        $pairs = [];
        foreach ($data as $key => $value) {
            $full_key = $prefix ? $prefix . '[' . $key . ']' : (string) $key;
            if (is_array($value)) {
                $pairs[] = $this->build_query($value, $full_key);
            } else {
                $pairs[] = rawurlencode($full_key) . '=' . rawurlencode((string) $value);
            }
        }
        return implode('&', $pairs);
    }
}
