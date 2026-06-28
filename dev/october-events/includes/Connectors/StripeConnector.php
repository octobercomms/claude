<?php
declare(strict_types=1);

namespace OE\Connectors;

use OE\Settings;
use OE\Logger;

defined('ABSPATH') || exit;

/**
 * Stripe payments + refunds (§4).
 *
 * Prefers the official Stripe PHP SDK (installed via Composer). If the SDK is
 * not yet present it falls back to direct REST calls against api.stripe.com so
 * the plugin remains functional before `composer install` has run. Either path
 * uses the secret key from the wp-config.php constant — never the database.
 */
final class StripeConnector {

    private const API_BASE = 'https://api.stripe.com/v1';

    public static function is_ready(): bool {
        return Settings::has_secret('stripe_secret_key');
    }

    private static function secret(): string {
        return (string) Settings::get('stripe_secret_key', '');
    }

    private static function use_sdk(): bool {
        return class_exists('\\Stripe\\StripeClient');
    }

    /**
     * Ensure a Stripe customer exists for an account, returning its id.
     */
    public static function ensure_customer(int $account_id, string $email, string $name): string {
        $existing = (string) get_post_meta($account_id, '_oe_stripe_customer_id', true);
        if ($existing !== '') {
            return $existing;
        }

        $customer = self::request('POST', '/customers', [
            'email'              => $email,
            'name'               => $name,
            'metadata[account]'  => (string) $account_id,
        ]);
        $id = (string) ($customer['id'] ?? '');
        if ($id !== '') {
            update_post_meta($account_id, '_oe_stripe_customer_id', $id);
        }
        return $id;
    }

    /**
     * Create a PaymentIntent for a listing payment. Returns
     * ['id' => pi_x, 'client_secret' => ...] for client-side confirmation.
     *
     * @return array{id:string,client_secret:string}
     */
    public static function create_payment_intent(int $amount, string $currency, string $customer_id = '', array $metadata = []): array {
        $params = [
            'amount'                      => $amount,
            'currency'                    => $currency,
            'automatic_payment_methods[enabled]' => 'true',
        ];
        if ($customer_id !== '') {
            $params['customer'] = $customer_id;
        }
        foreach ($metadata as $k => $v) {
            $params["metadata[{$k}]"] = (string) $v;
        }

        $intent = self::request('POST', '/payment_intents', $params);
        $err    = is_array($intent['error'] ?? null) ? $intent['error'] : [];
        return [
            'id'            => (string) ($intent['id'] ?? ''),
            'client_secret' => (string) ($intent['client_secret'] ?? ''),
            // The Stripe failure reason, surfaced so callers can show the buyer
            // something actionable instead of a generic error.
            'error'         => (string) ($err['message'] ?? ''),
            'error_type'    => (string) ($err['type'] ?? ''),
        ];
    }

    public static function retrieve_payment_intent(string $intent_id): array {
        return self::request('GET', '/payment_intents/' . rawurlencode($intent_id));
    }

    /**
     * Recent failed charges (for the assistant's "failed payments" answers).
     *
     * @return array<int,array<string,mixed>>
     */
    public static function recent_failed(int $limit = 20): array {
        if (! self::is_ready()) {
            return [];
        }
        $limit = max(1, min(100, $limit));
        $res = self::request('GET', '/charges?limit=' . $limit);
        $out = [];
        foreach (($res['data'] ?? []) as $ch) {
            if (($ch['status'] ?? '') !== 'failed') {
                continue;
            }
            $out[] = [
                'id'              => $ch['id'] ?? '',
                'amount'          => isset($ch['amount']) ? $ch['amount'] / 100 : 0,
                'currency'        => strtoupper((string) ($ch['currency'] ?? '')),
                'email'           => $ch['billing_details']['email'] ?? ($ch['receipt_email'] ?? ''),
                'failure_message' => $ch['failure_message'] ?? '',
                'created'         => isset($ch['created']) ? gmdate('Y-m-d H:i', (int) $ch['created']) : '',
            ];
        }
        return $out;
    }

    /**
     * Full refund of a PaymentIntent (§4 — full refund only). Returns the
     * refund id, or '' on failure.
     */
    public static function refund(string $payment_intent_id): string {
        $refund = self::request('POST', '/refunds', [
            'payment_intent' => $payment_intent_id,
        ]);
        return (string) ($refund['id'] ?? '');
    }

    /**
     * Verify and parse an incoming webhook payload (§4 webhooks).
     *
     * @return array|null Decoded event, or null when the signature is invalid.
     */
    public static function parse_webhook(string $payload, string $sig_header): ?array {
        $secret = (string) Settings::get('stripe_webhook_secret', '');
        if ($secret === '') {
            // ADF-02: never trust an unsigned webhook in production — a forged
            // payment_intent.succeeded could mint free tickets / mark bookings paid.
            // Opt-in escape hatch for local development only.
            if (defined('OE_ALLOW_UNSIGNED_WEBHOOK') && OE_ALLOW_UNSIGNED_WEBHOOK) {
                Logger::log('Stripe webhook accepted UNSIGNED (OE_ALLOW_UNSIGNED_WEBHOOK enabled)');
                return json_decode($payload, true) ?: null;
            }
            Logger::log('Stripe webhook rejected — no signing secret configured');
            return null;
        }

        if (self::use_sdk() && class_exists('\\Stripe\\Webhook')) {
            try {
                $event = \Stripe\Webhook::constructEvent($payload, $sig_header, $secret);
                return json_decode((string) $event, true);
            } catch (\Throwable $e) {
                Logger::log('Stripe webhook signature failed', ['error' => $e->getMessage()]);
                return null;
            }
        }

        return self::verify_signature($payload, $sig_header, $secret)
            ? (json_decode($payload, true) ?: null)
            : null;
    }

    /* ----------------------------------------------------------------------
     * Internal transport
     * ------------------------------------------------------------------- */

    /**
     * Unified request helper. Uses the SDK's raw request when available,
     * otherwise wp_remote_*.
     */
    private static function request(string $method, string $path, array $params = []): array {
        if (! self::is_ready()) {
            Logger::log('Stripe call attempted without secret key', compact('path'));
            return [];
        }

        // SDK path — use the low-level client so we do not have to mirror every
        // resource method, keeping behaviour identical to the REST fallback.
        if (self::use_sdk()) {
            try {
                $client = new \Stripe\StripeClient(self::secret());
                $opts   = ['api_key' => self::secret()];
                $resp   = $client->request(strtolower($method), $path, $params, $opts);
                return $resp->toArray();
            } catch (\Throwable $e) {
                Logger::log('Stripe SDK error', ['path' => $path, 'error' => $e->getMessage()]);
                // Preserve the Stripe error (type + message) like the REST path,
                // so callers can surface an actionable reason to the buyer.
                $type = 'api_error';
                if (method_exists($e, 'getError') && ($se = $e->getError())) {
                    $type = (string) ($se->type ?? $type);
                }
                return ['error' => ['message' => $e->getMessage(), 'type' => $type]];
            }
        }

        $url  = self::API_BASE . $path;
        $args = [
            'method'  => $method,
            'timeout' => 30,
            'headers' => [
                'Authorization' => 'Bearer ' . self::secret(),
                'Content-Type'  => 'application/x-www-form-urlencoded',
            ],
        ];
        if ($method !== 'GET' && $params) {
            $args['body'] = http_build_query($params);
        } elseif ($method === 'GET' && $params) {
            $url = add_query_arg($params, $url);
        }

        $response = wp_remote_request($url, $args);
        if (is_wp_error($response)) {
            Logger::log('Stripe REST error', ['path' => $path, 'error' => $response->get_error_message()]);
            return [];
        }
        $decoded = json_decode((string) wp_remote_retrieve_body($response), true);
        if (! is_array($decoded)) {
            return [];
        }
        if (isset($decoded['error'])) {
            Logger::log('Stripe API error', ['path' => $path, 'error' => $decoded['error']]);
        }
        return $decoded;
    }

    /**
     * Manual Stripe-Signature verification for the no-SDK fallback.
     */
    private static function verify_signature(string $payload, string $sig_header, string $secret, int $tolerance = 300): bool {
        $parts = [];
        foreach (explode(',', $sig_header) as $pair) {
            [$k, $v] = array_pad(explode('=', $pair, 2), 2, '');
            $parts[$k][] = $v;
        }
        $timestamp = (int) ($parts['t'][0] ?? 0);
        $signatures = $parts['v1'] ?? [];
        if ($timestamp === 0 || ! $signatures) {
            return false;
        }
        if (abs(time() - $timestamp) > $tolerance) {
            return false;
        }
        $expected = hash_hmac('sha256', $timestamp . '.' . $payload, $secret);
        foreach ($signatures as $sig) {
            if (hash_equals($expected, $sig)) {
                return true;
            }
        }
        return false;
    }
}
