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

    /** Reason the last parse_webhook() rejected a payload (for diagnostics). */
    public static string $last_webhook_error = '';

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
     * Find a Stripe customer by email (first match) or create one. Used by the
     * ticket checkout's "join the membership with the same card" flow, where the
     * buyer isn't a WP account — we key the customer off their email so a repeat
     * buyer/member reuses the same Stripe customer.
     */
    public static function ensure_customer_by_email(string $email, string $name = ''): string {
        $email = trim(strtolower($email));
        if ($email === '' || ! is_email($email) || ! self::is_ready()) {
            return '';
        }
        $found = self::request('GET', '/customers', ['email' => $email, 'limit' => 1]);
        $id    = (string) ($found['data'][0]['id'] ?? '');
        if ($id !== '') {
            return $id;
        }
        $created = self::request('POST', '/customers', array_filter([
            'email' => $email,
            'name'  => $name,
        ]));
        return (string) ($created['id'] ?? '');
    }

    /**
     * Create a membership subscription for a customer on a given recurring price,
     * billing the supplied (already-saved) payment method off-session — the buyer
     * has just authenticated it for their ticket, so the first month is charged
     * immediately without a second card prompt.
     *
     * @return array{id:string,status:string,error:string}
     */
    public static function create_membership_subscription(string $customer_id, string $price_id, string $payment_method_id = '', array $metadata = []): array {
        if ($customer_id === '' || $price_id === '' || ! self::is_ready()) {
            return ['id' => '', 'status' => '', 'error' => 'missing_customer_or_price'];
        }
        $params = [
            'customer'         => $customer_id,
            'items'            => [['price' => $price_id]],
            'off_session'      => 'true',
            'expand'           => ['latest_invoice.payment_intent'],
        ];
        if ($payment_method_id !== '') {
            $params['default_payment_method'] = $payment_method_id;
        }
        foreach ($metadata as $k => $v) {
            $params["metadata[{$k}]"] = (string) $v;
        }
        $sub = self::request('POST', '/subscriptions', $params);
        $err = is_array($sub['error'] ?? null) ? $sub['error'] : [];
        return [
            'id'     => (string) ($sub['id'] ?? ''),
            'status' => (string) ($sub['status'] ?? ''),
            'error'  => (string) ($err['message'] ?? ''),
        ];
    }

    /**
     * Create a subscription whose first invoice must be paid on-session — used
     * when the membership is the ONLY charge (e.g. a free ticket + join): there's
     * no ticket payment to ride, so we return the first invoice's PaymentIntent
     * client_secret for the buyer to confirm with their card. The card is saved to
     * the customer for future renewals.
     *
     * @return array{id:string,client_secret:string,status:string,error:string}
     */
    public static function create_incomplete_subscription(string $customer_id, string $price_id, array $metadata = []): array {
        if ($customer_id === '' || $price_id === '' || ! self::is_ready()) {
            return ['id' => '', 'client_secret' => '', 'status' => '', 'error' => 'missing_customer_or_price'];
        }
        $params = [
            'customer'         => $customer_id,
            'items'            => [['price' => $price_id]],
            'payment_behavior' => 'default_incomplete',
            'payment_settings' => ['save_default_payment_method' => 'on_subscription'],
            'expand'           => ['latest_invoice.payment_intent'],
        ];
        foreach ($metadata as $k => $v) {
            $params["metadata[{$k}]"] = (string) $v;
        }
        $sub = self::request('POST', '/subscriptions', $params);
        $err = is_array($sub['error'] ?? null) ? $sub['error'] : [];
        $pi  = is_array($sub['latest_invoice']['payment_intent'] ?? null) ? $sub['latest_invoice']['payment_intent'] : [];
        return [
            'id'            => (string) ($sub['id'] ?? ''),
            'client_secret' => (string) ($pi['client_secret'] ?? ''),
            'status'        => (string) ($sub['status'] ?? ''),
            'error'         => (string) ($err['message'] ?? ''),
        ];
    }

    /** Fetch a subscription (to confirm it went active after the buyer paid). */
    public static function retrieve_subscription(string $id): array {
        if ($id === '' || ! self::is_ready()) {
            return [];
        }
        return self::request('GET', '/subscriptions/' . rawurlencode($id));
    }

    /**
     * Create a PaymentIntent for a listing payment. Returns
     * ['id' => pi_x, 'client_secret' => ...] for client-side confirmation.
     *
     * @return array{id:string,client_secret:string}
     */
    public static function create_payment_intent(int $amount, string $currency, string $customer_id = '', array $metadata = [], array $options = []): array {
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
        // Extra top-level PI params (e.g. setup_future_usage=off_session to save
        // the card to the customer so a membership subscription can bill it).
        foreach ($options as $k => $v) {
            $params[$k] = $v;
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
     * Failed charges in the last $days, with the decline reason + card details —
     * for the Failed payments dashboard. Pages through Stripe (the charges list
     * can't filter by status server-side) up to a bounded number of pages.
     *
     * @return array<int,array{id:string,created:int,amount:float,currency:string,email:string,brand:string,last4:string,code:string,message:string}>
     */
    public static function failed_charges(int $days = 90, int $max = 300): array {
        if (! self::is_ready()) {
            return [];
        }
        $days  = max(1, min(365, $days));
        $max   = max(1, min(1000, $max));
        $since = time() - $days * DAY_IN_SECONDS;
        $out   = [];
        $after = '';
        $pages = 0;
        do {
            $params = ['limit' => 100, 'created' => ['gte' => $since]];
            if ($after !== '') {
                $params['starting_after'] = $after;
            }
            $res  = self::request('GET', '/charges', $params);
            $data = is_array($res['data'] ?? null) ? $res['data'] : [];
            if (! $data) {
                break;
            }
            foreach ($data as $ch) {
                $after = (string) ($ch['id'] ?? $after); // cursor advances over every charge
                if (($ch['status'] ?? '') !== 'failed') {
                    continue;
                }
                $outcome = is_array($ch['outcome'] ?? null) ? $ch['outcome'] : [];
                $card    = is_array($ch['payment_method_details']['card'] ?? null) ? $ch['payment_method_details']['card'] : [];
                $out[] = [
                    'id'       => (string) ($ch['id'] ?? ''),
                    'created'  => (int) ($ch['created'] ?? 0),
                    'amount'   => isset($ch['amount']) ? $ch['amount'] / 100 : 0.0,
                    'currency' => strtoupper((string) ($ch['currency'] ?? '')),
                    'email'    => (string) ($ch['billing_details']['email'] ?? ($ch['receipt_email'] ?? '')),
                    'brand'    => (string) ($card['brand'] ?? ''),
                    'last4'    => (string) ($card['last4'] ?? ''),
                    // The issuer's decline reason is the most useful bucket; fall
                    // back to the charge-level failure code.
                    'code'     => (string) ($outcome['reason'] ?? ($ch['failure_code'] ?? 'unknown')),
                    'message'  => (string) ($ch['failure_message'] ?? ($outcome['seller_message'] ?? '')),
                ];
                if (count($out) >= $max) {
                    return $out;
                }
            }
            $pages++;
        } while (! empty($res['has_more']) && $pages < 10);
        return $out;
    }

    /**
     * Total Stripe revenue for the current calendar year — the sum of every
     * succeeded charge on the account (not just tickets sold through this plugin),
     * with refunds, in the account's currency. Paged from the charges API and
     * cached for an hour, since the dashboard KPI calls this on every load. Use
     * `bust_year_revenue()` to force a refresh.
     *
     * @return array{gross:float,refunded:float,net:float,currency:string,count:int,partial:bool}
     */
    public static function year_revenue(): array {
        $empty = ['gross' => 0.0, 'refunded' => 0.0, 'net' => 0.0, 'currency' => '', 'count' => 0, 'partial' => false];
        if (! self::is_ready()) {
            return $empty;
        }
        $cache = get_transient('oe_stripe_year_revenue');
        if (is_array($cache)) {
            return $cache;
        }
        $since  = strtotime(gmdate('Y') . '-01-01T00:00:00+00:00');
        $gross  = 0;
        $refund = 0;
        $count  = 0;
        $currency = '';
        $after  = '';
        $pages  = 0;
        $partial = false;
        do {
            $params = ['limit' => 100, 'created' => ['gte' => $since]];
            if ($after !== '') {
                $params['starting_after'] = $after;
            }
            $res  = self::request('GET', '/charges', $params);
            $data = is_array($res['data'] ?? null) ? $res['data'] : [];
            if (! $data) {
                break;
            }
            foreach ($data as $ch) {
                $after = (string) ($ch['id'] ?? $after); // cursor advances over every charge
                if (($ch['status'] ?? '') !== 'succeeded' || empty($ch['paid'])) {
                    continue;
                }
                $gross   += (int) ($ch['amount'] ?? 0);
                $refund  += (int) ($ch['amount_refunded'] ?? 0);
                $currency = $currency !== '' ? $currency : (string) ($ch['currency'] ?? '');
                $count++;
            }
            $pages++;
            if ($pages >= 100) { // ~10k charges safety cap
                $partial = ! empty($res['has_more']);
                break;
            }
        } while (! empty($res['has_more']));

        $out = [
            'gross'    => round($gross / 100, 2),
            'refunded' => round($refund / 100, 2),
            'net'      => round(($gross - $refund) / 100, 2),
            'currency' => strtoupper($currency),
            'count'    => $count,
            'partial'  => $partial,
        ];
        set_transient('oe_stripe_year_revenue', $out, HOUR_IN_SECONDS);
        return $out;
    }

    /** Drop the cached year-revenue total so the next read recomputes. */
    public static function bust_year_revenue(): void {
        delete_transient('oe_stripe_year_revenue');
    }

    /**
     * Whether an email is an ACTIVE member — i.e. it has a live Stripe
     * subscription on one of the configured membership prices (Settings →
     * Membership). Read-only; cached briefly per email since checkout may check
     * it repeatedly. "trialing" counts as active; past_due/canceled do not.
     *
     * @return array{active:bool,price_id:string,customer:string,status:string}
     */
    public static function member_status(string $email): array {
        $none  = ['active' => false, 'price_id' => '', 'customer' => '', 'status' => ''];
        $email = trim(strtolower($email));
        if ($email === '' || ! is_email($email) || ! self::is_ready()) {
            return $none;
        }
        $price_ids = array_values(array_filter(array_map('strval', (array) Settings::get('membership_price_ids', []))));
        if (! $price_ids) {
            return $none;
        }
        $key    = 'oe_member_' . md5($email);
        $cached = get_transient($key);
        if (is_array($cached)) {
            return $cached;
        }
        $result = $none;
        $custs  = self::request('GET', '/customers', ['email' => $email, 'limit' => 20]);
        foreach ((array) ($custs['data'] ?? []) as $cust) {
            $cid = (string) ($cust['id'] ?? '');
            if ($cid === '') {
                continue;
            }
            // Active subscriptions for this customer; a line matches if EITHER its
            // price id OR its product id is in the configured list — so a pasted
            // product id (prod_…) counts every price under it (monthly + yearly),
            // and a specific price id (price_…) matches just that one.
            $subs = self::request('GET', '/subscriptions', ['customer' => $cid, 'status' => 'active', 'limit' => 100]);
            foreach ((array) ($subs['data'] ?? []) as $sub) {
                foreach ((array) ($sub['items']['data'] ?? []) as $item) {
                    $pid  = (string) ($item['price']['id'] ?? '');
                    $prod = is_string($item['price']['product'] ?? null) ? (string) $item['price']['product'] : '';
                    if (($pid !== '' && in_array($pid, $price_ids, true))
                        || ($prod !== '' && in_array($prod, $price_ids, true))) {
                        $result = ['active' => true, 'price_id' => ($pid !== '' ? $pid : $prod), 'customer' => $cid, 'status' => (string) ($sub['status'] ?? 'active')];
                        break 3;
                    }
                }
            }
        }
        set_transient($key, $result, 5 * MINUTE_IN_SECONDS);
        return $result;
    }

    /** Drop the cached membership status for an email (e.g. right after they join). */
    public static function bust_member_status(string $email): void {
        $email = trim(strtolower($email));
        if ($email !== '') {
            delete_transient('oe_member_' . md5($email));
        }
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
     * Refund a PaymentIntent — the whole charge, or a partial $amount_cents for
     * a per-ticket refund. $reason maps to a Stripe enum (requested_by_customer,
     * duplicate, fraudulent). Returns the refund id, or '' on failure.
     */
    public static function refund(string $payment_intent_id, int $amount_cents = 0, string $reason = ''): string {
        $params = ['payment_intent' => $payment_intent_id];
        if ($amount_cents > 0) {
            $params['amount'] = $amount_cents;
        }
        if (in_array($reason, ['requested_by_customer', 'duplicate', 'fraudulent'], true)) {
            $params['reason'] = $reason;
        }
        $refund = self::request('POST', '/refunds', $params);
        return (string) ($refund['id'] ?? '');
    }

    /**
     * Verify and parse an incoming webhook payload (§4 webhooks).
     *
     * @return array|null Decoded event, or null when the signature is invalid.
     */
    public static function parse_webhook(string $payload, string $sig_header): ?array {
        self::$last_webhook_error = '';
        $secret = (string) Settings::get('stripe_webhook_secret', '');
        if ($secret === '') {
            // ADF-02: never trust an unsigned webhook in production — a forged
            // payment_intent.succeeded could mint free tickets / mark bookings paid.
            // Opt-in escape hatch for local development only.
            if (defined('OE_ALLOW_UNSIGNED_WEBHOOK') && OE_ALLOW_UNSIGNED_WEBHOOK) {
                Logger::log('Stripe webhook accepted UNSIGNED (OE_ALLOW_UNSIGNED_WEBHOOK enabled)');
                return json_decode($payload, true) ?: null;
            }
            self::$last_webhook_error = 'no_signing_secret_configured';
            Logger::log('Stripe webhook rejected — no signing secret configured');
            return null;
        }

        if (self::use_sdk() && class_exists('\\Stripe\\Webhook')) {
            try {
                $event = \Stripe\Webhook::constructEvent($payload, $sig_header, $secret);
                return json_decode((string) $event, true);
            } catch (\Throwable $e) {
                self::$last_webhook_error = 'sdk: ' . $e->getMessage();
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
                // The low-level client expects the full API path *including* the
                // version segment; our paths are version-relative (e.g.
                // "/payment_intents") to match the REST fallback's API_BASE, so
                // prepend "/v1" here. Without it Stripe rejects the call with
                // "Unrecognized request URL (POST: /payment_intents)".
                $resp   = $client->request(strtolower($method), '/v1' . $path, $params, $opts);
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
            self::$last_webhook_error = $sig_header === '' ? 'no_signature_header' : 'malformed_signature_header';
            return false;
        }
        if (abs(time() - $timestamp) > $tolerance) {
            self::$last_webhook_error = 'timestamp_out_of_tolerance (server-vs-stripe skew ' . (time() - $timestamp) . 's)';
            return false;
        }
        $expected = hash_hmac('sha256', $timestamp . '.' . $payload, $secret);
        foreach ($signatures as $sig) {
            if (hash_equals($expected, $sig)) {
                return true;
            }
        }
        self::$last_webhook_error = 'signature_mismatch (body ' . strlen($payload) . ' bytes)';
        return false;
    }
}
