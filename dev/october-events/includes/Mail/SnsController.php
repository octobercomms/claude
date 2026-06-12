<?php
declare(strict_types=1);

namespace OE\Mail;

defined('ABSPATH') || exit;

/**
 * Amazon SNS endpoint for SES bounce / complaint / delivery notifications.
 *
 * SES is configured to publish events to an SNS topic that POSTs to
 * `…/wp-json/oe/v1/ses-sns`. Permanent bounces and complaints are added to the
 * {@see Suppression} list (and the {@see Contacts} record marked unsubscribed),
 * which keeps bounce/complaint rates low so AWS doesn't throttle sending.
 *
 * The endpoint is public (SNS can't authenticate), so every message's signature
 * is verified against the AWS signing certificate before it is trusted.
 */
final class SnsController {

    private const NS = 'oe/v1';

    public static function init(): void {
        add_action('rest_api_init', [self::class, 'register_routes']);
    }

    public static function register_routes(): void {
        register_rest_route(self::NS, '/ses-sns', [
            'methods'             => 'POST',
            'callback'            => [self::class, 'handle'],
            'permission_callback' => '__return_true',
        ]);
    }

    public static function handle(\WP_REST_Request $req): \WP_REST_Response {
        $msg = json_decode($req->get_body(), true);
        if (! is_array($msg) || empty($msg['Type'])) {
            return new \WP_REST_Response(['error' => 'bad_request'], 400);
        }
        if (! self::verify($msg)) {
            \OE\Logger::log('SNS message failed signature verification');
            return new \WP_REST_Response(['error' => 'invalid_signature'], 403);
        }

        $type = (string) $msg['Type'];
        if ($type === 'SubscriptionConfirmation') {
            $url = (string) ($msg['SubscribeURL'] ?? '');
            if (self::is_sns_url($url)) {
                wp_remote_get($url, ['timeout' => 15]);
            }
            return new \WP_REST_Response(['ok' => true], 200);
        }
        if ($type === 'Notification') {
            $note = json_decode((string) ($msg['Message'] ?? ''), true);
            if (is_array($note)) {
                self::process_note($note);
            }
            return new \WP_REST_Response(['ok' => true], 200);
        }
        return new \WP_REST_Response(['ok' => true], 200);
    }

    /** @param array<string,mixed> $note */
    private static function process_note(array $note): void {
        $type = (string) ($note['notificationType'] ?? $note['eventType'] ?? '');

        if ($type === 'Bounce' && ($note['bounce']['bounceType'] ?? '') === 'Permanent') {
            foreach (($note['bounce']['bouncedRecipients'] ?? []) as $r) {
                self::suppress((string) ($r['emailAddress'] ?? ''), 'bounce');
            }
        } elseif ($type === 'Complaint') {
            foreach (($note['complaint']['complainedRecipients'] ?? []) as $r) {
                self::suppress((string) ($r['emailAddress'] ?? ''), 'complaint');
            }
        }
    }

    private static function suppress(string $email, string $reason): void {
        if (! is_email($email)) {
            return;
        }
        Suppression::add($email, $reason);
        Contacts::unsubscribe($email);
        \OE\Logger::log('SES ' . $reason . ' suppressed: ' . $email);
    }

    /* ------------------------------------------------------------------ *
     * SNS signature verification
     * ------------------------------------------------------------------ */

    /** @param array<string,mixed> $msg */
    private static function verify(array $msg): bool {
        if (empty($msg['Signature']) || empty($msg['SigningCertURL'])) {
            return false;
        }
        $cert_url = (string) $msg['SigningCertURL'];
        if (! self::is_sns_url($cert_url)) {
            return false;
        }
        $string = self::string_to_sign($msg);
        if ($string === '') {
            return false;
        }
        $cert = self::fetch_cert($cert_url);
        if ($cert === '') {
            return false;
        }
        $pubkey = openssl_pkey_get_public($cert);
        if ($pubkey === false) {
            return false;
        }
        $algo = ((string) ($msg['SignatureVersion'] ?? '1') === '2') ? OPENSSL_ALGO_SHA256 : OPENSSL_ALGO_SHA1;
        $ok = openssl_verify($string, base64_decode((string) $msg['Signature']), $pubkey, $algo) === 1;
        return $ok;
    }

    /** @param array<string,mixed> $msg */
    private static function string_to_sign(array $msg): string {
        $type = (string) ($msg['Type'] ?? '');
        if ($type === 'Notification') {
            $keys = ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'];
        } elseif ($type === 'SubscriptionConfirmation' || $type === 'UnsubscribeConfirmation') {
            $keys = ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
        } else {
            return '';
        }
        $out = '';
        foreach ($keys as $k) {
            if ($k === 'Subject' && ! isset($msg[$k])) {
                continue; // Subject is optional
            }
            if (! isset($msg[$k])) {
                continue;
            }
            $out .= $k . "\n" . $msg[$k] . "\n";
        }
        return $out;
    }

    private static function fetch_cert(string $url): string {
        $cache_key = 'oe_sns_cert_' . md5($url);
        $cached = get_transient($cache_key);
        if (is_string($cached) && $cached !== '') {
            return $cached;
        }
        $res = wp_remote_get($url, ['timeout' => 15]);
        if (is_wp_error($res) || (int) wp_remote_retrieve_response_code($res) !== 200) {
            return '';
        }
        $cert = (string) wp_remote_retrieve_body($res);
        if (strpos($cert, 'BEGIN CERTIFICATE') !== false) {
            set_transient($cache_key, $cert, DAY_IN_SECONDS);
            return $cert;
        }
        return '';
    }

    /** Only trust SigningCertURL / SubscribeURL on the AWS SNS domain over https. */
    private static function is_sns_url(string $url): bool {
        $parts = wp_parse_url($url);
        if (empty($parts['scheme']) || $parts['scheme'] !== 'https' || empty($parts['host'])) {
            return false;
        }
        return (bool) preg_match('/^sns\.[a-z0-9-]+\.amazonaws\.com$/', (string) $parts['host']);
    }
}
