<?php
declare(strict_types=1);

namespace OE\AI;

use OE\Ticketing\Schema as TicketSchema;

defined('ABSPATH') || exit;

/**
 * Verification for the PUBLIC customer support chat.
 *
 * The public assistant can read order/ticket data, so before a visitor may chat
 * we have to prove they own the email they claim. We do this with a one-time
 * code emailed to that address (no password, no enumeration leak):
 *
 *   1. request_code(email) — if any orders exist for that email, email a 6-digit
 *      code. The response is identical whether or not orders exist, so it never
 *      reveals who is a customer.
 *   2. verify_code(email, code) — on a match, mint a short-lived signed token
 *      scoped to that exact email.
 *   3. verify_token(token) — every chat turn re-checks the token and yields the
 *      email; all assistant tools are then constrained to that email's orders.
 *
 * Everything is rate-limited per IP and per email. Codes are stored hashed.
 */
final class SupportAuth {

    private const CODE_TTL      = 900;   // 15 minutes to use a code
    private const TOKEN_TTL     = 3600;  // 1 hour chat session
    private const MAX_ATTEMPTS  = 5;     // wrong-code attempts before a code dies
    private const RL_WINDOW     = 900;   // rate-limit window
    private const RL_MAX_CODES  = 5;     // code requests per IP per window

    /**
     * Issue a one-time code to the email IF it has orders. The return value is
     * deliberately the same either way (no customer-enumeration).
     *
     * @return array{ok:bool,message:string,retry_after?:int}
     */
    public static function request_code(string $email): array {
        $email = sanitize_email($email);
        $generic = [
            'ok'      => true,
            'message' => __('If that email has an order with us, we’ve sent it a 6-digit code. It expires in 15 minutes.', 'october-events'),
        ];
        if (! is_email($email)) {
            return ['ok' => false, 'message' => __('That doesn’t look like a valid email address.', 'october-events')];
        }

        // Per-IP throttle so the endpoint can't be used to spam inboxes.
        $ip_key = 'oe_support_rl_' . md5(self::client_ip());
        $hits   = (int) get_transient($ip_key);
        if ($hits >= self::RL_MAX_CODES) {
            return ['ok' => false, 'message' => __('Too many requests — please wait a few minutes and try again.', 'october-events'), 'retry_after' => self::RL_WINDOW];
        }
        set_transient($ip_key, $hits + 1, self::RL_WINDOW);

        if (! self::email_has_orders($email)) {
            return $generic; // Same response — don't disclose non-customers.
        }

        $code = (string) wp_rand(100000, 999999);
        set_transient(self::code_key($email), [
            'hash'     => wp_hash($code),
            'attempts' => 0,
        ], self::CODE_TTL);

        $brand = (string) \OE\Settings::get('brand_name', 'October Events');
        $subject = sprintf(__('%s — your support verification code', 'october-events'), $brand);
        $body = sprintf(
            __("Your verification code is: %s\n\nEnter it in the support chat to access your orders. It expires in 15 minutes.\n\nIf you didn't request this, you can ignore this email.", 'october-events'),
            $code
        );
        wp_mail($email, $subject, $body);

        return $generic;
    }

    /**
     * Verify a code; on success return a signed session token scoped to the email.
     *
     * @return array{ok:bool,token?:string,message?:string}
     */
    public static function verify_code(string $email, string $code): array {
        $email = sanitize_email($email);
        $code  = preg_replace('/\D/', '', $code) ?? '';
        if (! is_email($email) || strlen($code) !== 6) {
            return ['ok' => false, 'message' => __('Enter the 6-digit code we emailed you.', 'october-events')];
        }

        $key  = self::code_key($email);
        $data = get_transient($key);
        if (! is_array($data) || empty($data['hash'])) {
            return ['ok' => false, 'message' => __('That code has expired — request a new one.', 'october-events')];
        }
        if ((int) ($data['attempts'] ?? 0) >= self::MAX_ATTEMPTS) {
            delete_transient($key);
            return ['ok' => false, 'message' => __('Too many wrong attempts — request a new code.', 'october-events')];
        }
        if (! hash_equals((string) $data['hash'], wp_hash($code))) {
            $data['attempts'] = (int) ($data['attempts'] ?? 0) + 1;
            set_transient($key, $data, self::CODE_TTL);
            return ['ok' => false, 'message' => __('That code didn’t match. Try again.', 'october-events')];
        }

        delete_transient($key);
        return ['ok' => true, 'token' => self::issue_token($email)];
    }

    /**
     * Validate a session token and return the email it is scoped to, or null.
     */
    public static function verify_token(string $token): ?string {
        $parts = explode('.', $token, 2);
        if (count($parts) !== 2) {
            return null;
        }
        [$payload_b64, $sig] = $parts;
        $payload = base64_decode(strtr($payload_b64, '-_', '+/'), true);
        if ($payload === false) {
            return null;
        }
        if (! hash_equals(self::sign($payload_b64), $sig)) {
            return null;
        }
        $decoded = json_decode($payload, true);
        if (! is_array($decoded)) {
            return null;
        }
        $email   = sanitize_email((string) ($decoded['email'] ?? ''));
        $expires = (int) ($decoded['exp'] ?? 0);
        if (! is_email($email) || $expires < time()) {
            return null;
        }
        return $email;
    }

    /* ------------------------------------------------------------------ *
     * Internals
     * ------------------------------------------------------------------ */

    private static function issue_token(string $email): string {
        $payload = (string) wp_json_encode(['email' => $email, 'exp' => time() + self::TOKEN_TTL]);
        $b64     = rtrim(strtr(base64_encode($payload), '+/', '-_'), '=');
        return $b64 . '.' . self::sign($b64);
    }

    private static function sign(string $data): string {
        return hash_hmac('sha256', 'oe-support|' . $data, wp_salt('auth'));
    }

    private static function code_key(string $email): string {
        return 'oe_support_code_' . md5(strtolower($email));
    }

    private static function email_has_orders(string $email): bool {
        global $wpdb;
        $t = TicketSchema::orders();
        return (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$t} WHERE email = %s",
            $email
        )) > 0;
    }

    private static function client_ip(): string {
        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
        return $ip !== '' ? $ip : 'unknown';
    }
}
