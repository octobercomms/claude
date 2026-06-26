<?php
declare(strict_types=1);

namespace OE\Connectors;

use OE\Settings;
use OE\Logger;

defined('ABSPATH') || exit;

/**
 * PayPal payments + refunds (Orders v2 REST API).
 *
 * A second gateway alongside Stripe. Buyers approve a PayPal order client-side
 * (PayPal JS SDK); the server then *captures* it and verifies — against PayPal's
 * own API, never the request body — that money was actually taken and how much,
 * before issuing tickets. This mirrors the Stripe trust model (ADF-01).
 *
 * Credentials: a client ID (used in the SDK URL, so not secret) and a client
 * secret (stored encrypted like other secrets, or pinned via OE_PAYPAL_SECRET).
 * The environment toggle picks sandbox vs live.
 */
final class PayPalConnector {

    private const TOKEN_TRANSIENT = 'oe_paypal_token';

    public static function is_ready(): bool {
        return (bool) Settings::get('paypal_enabled', false)
            && self::client_id() !== ''
            && Settings::has_secret('paypal_client_secret');
    }

    public static function env(): string {
        return Settings::get('paypal_env', 'sandbox') === 'live' ? 'live' : 'sandbox';
    }

    public static function client_id(): string {
        return (string) Settings::get('paypal_client_id', '');
    }

    private static function api_base(): string {
        return self::env() === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    }

    /** OAuth2 client-credentials access token (cached just inside its lifetime). */
    private static function token(): string {
        $cached = get_transient(self::TOKEN_TRANSIENT . '_' . self::env());
        if (is_string($cached) && $cached !== '') {
            return $cached;
        }
        $secret = (string) Settings::get('paypal_client_secret', '');
        if (self::client_id() === '' || $secret === '') {
            return '';
        }
        $resp = wp_remote_post(self::api_base() . '/v1/oauth2/token', [
            'timeout' => 30,
            'headers' => [
                'Authorization' => 'Basic ' . base64_encode(self::client_id() . ':' . $secret),
                'Content-Type'  => 'application/x-www-form-urlencoded',
            ],
            'body'    => 'grant_type=client_credentials',
        ]);
        if (is_wp_error($resp)) {
            Logger::log('PayPal token error', ['error' => $resp->get_error_message()]);
            return '';
        }
        $body  = json_decode((string) wp_remote_retrieve_body($resp), true);
        $token = is_array($body) ? (string) ($body['access_token'] ?? '') : '';
        $ttl   = is_array($body) ? (int) ($body['expires_in'] ?? 0) : 0;
        if ($token !== '') {
            // Cache a minute short of expiry so we never present a stale token.
            set_transient(self::TOKEN_TRANSIENT . '_' . self::env(), $token, max(60, $ttl - 60));
        }
        return $token;
    }

    /**
     * Create a CAPTURE-intent order for the given amount. Returns the PayPal
     * order id (empty on failure). `custom_id` is a short reference echoed back.
     */
    public static function create_order(int $cents, string $currency, string $custom_id = ''): string {
        $payload = [
            'intent'         => 'CAPTURE',
            'purchase_units' => [[
                'amount' => [
                    'currency_code' => strtoupper($currency),
                    'value'         => number_format($cents / 100, 2, '.', ''),
                ],
            ]],
        ];
        if ($custom_id !== '') {
            $payload['purchase_units'][0]['custom_id'] = substr($custom_id, 0, 127);
        }
        $res = self::request('POST', '/v2/checkout/orders', $payload);
        return (string) ($res['id'] ?? '');
    }

    /**
     * Capture an approved order. Idempotent-friendly: if PayPal reports the order
     * was already captured, we fall back to reading the order so a double submit
     * still returns the real capture details.
     *
     * @return array{status:string,amount_cents:int,currency:string,capture_id:string}
     */
    public static function capture_order(string $order_id): array {
        if ($order_id === '') {
            return ['status' => '', 'amount_cents' => 0, 'currency' => '', 'capture_id' => ''];
        }
        $res = self::request('POST', '/v2/checkout/orders/' . rawurlencode($order_id) . '/capture', []);
        if (($res['status'] ?? '') === '' || isset($res['error'])) {
            // Already captured (or transient) — read the order and use its capture.
            $res = self::request('GET', '/v2/checkout/orders/' . rawurlencode($order_id), []);
        }
        return self::capture_details($res);
    }

    /** Refund a capture in full. Returns the refund id (empty on failure). */
    public static function refund(string $capture_id): string {
        if ($capture_id === '') {
            return '';
        }
        $res = self::request('POST', '/v2/payments/captures/' . rawurlencode($capture_id) . '/refund', []);
        return (string) ($res['id'] ?? '');
    }

    /** Pull the completed-capture amount/currency/id out of an order response. */
    private static function capture_details(array $order): array {
        $unit    = $order['purchase_units'][0] ?? [];
        $capture = $unit['payments']['captures'][0] ?? [];
        $amount  = $capture['amount'] ?? [];
        $value   = (float) ($amount['value'] ?? 0);
        return [
            'status'       => (string) ($capture['status'] ?? $order['status'] ?? ''),
            'amount_cents' => (int) round($value * 100),
            'currency'     => (string) ($amount['currency_code'] ?? ''),
            'capture_id'   => (string) ($capture['id'] ?? ''),
        ];
    }

    /** @return array<string,mixed> decoded JSON response ([] on transport error) */
    private static function request(string $method, string $path, array $params): array {
        $token = self::token();
        if ($token === '') {
            return [];
        }
        $args = [
            'method'  => $method,
            'timeout' => 30,
            'headers' => [
                'Authorization' => 'Bearer ' . $token,
                'Content-Type'  => 'application/json',
            ],
        ];
        if ($method !== 'GET') {
            $args['body'] = $params ? (wp_json_encode($params) ?: '{}') : '{}';
        }
        $resp = wp_remote_request(self::api_base() . $path, $args);
        if (is_wp_error($resp)) {
            Logger::log('PayPal REST error', ['path' => $path, 'error' => $resp->get_error_message()]);
            return [];
        }
        $decoded = json_decode((string) wp_remote_retrieve_body($resp), true);
        if (! is_array($decoded)) {
            return [];
        }
        if (isset($decoded['error']) || isset($decoded['details']) && wp_remote_retrieve_response_code($resp) >= 400) {
            Logger::log('PayPal API error', ['path' => $path, 'body' => $decoded]);
        }
        return $decoded;
    }
}
