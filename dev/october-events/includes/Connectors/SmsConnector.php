<?php
declare(strict_types=1);

namespace OE\Connectors;

use OE\Settings;
use OE\Logger;

defined('ABSPATH') || exit;

/**
 * SMS via AWS End User Messaging (Amazon Pinpoint SMS Voice v2 — SendTextMessage).
 *
 * Signed with SigV4 over wp_remote_post (no AWS SDK). Off until configured: when
 * the keys/origination identity aren't set, {@see send()} is a no-op, so the
 * site runs fine before AWS exists and "switches on" from Settings once you add
 * the credentials + a registered origination number (US needs 10DLC).
 */
final class SmsConnector {

    private const SERVICE = 'sms-voice';
    private const TARGET  = 'PinpointSMSVoiceV2.SendTextMessage';

    public static function is_ready(): bool {
        return (bool) Settings::get('sms_enabled', false)
            && (string) Settings::get('aws_access_key_id', '') !== ''
            && (string) Settings::get('aws_secret_access_key', '') !== ''
            && (string) Settings::get('sms_origination', '') !== '';
    }

    public static function region(): string {
        return (string) (Settings::get('sms_region', '') ?: 'us-east-1');
    }

    /** Send a transactional SMS. Returns true on a 2xx from AWS. */
    public static function send(string $to, string $content): bool {
        if (! self::is_ready()) {
            Logger::log('SMS skipped — AWS End User Messaging not configured');
            return false;
        }
        $number = self::normalise_msisdn($to);
        if ($number === '') {
            Logger::log('SMS skipped — unparseable number', ['to' => $to]);
            return false;
        }

        $region = self::region();
        $host    = self::SERVICE . '.' . $region . '.amazonaws.com';
        $payload = wp_json_encode([
            'DestinationPhoneNumber' => $number,
            'OriginationIdentity'    => (string) Settings::get('sms_origination', ''),
            'MessageBody'            => $content,
            'MessageType'            => 'TRANSACTIONAL',
        ]);

        $headers = self::sign_v4($region, $host, (string) $payload);
        $response = wp_remote_post('https://' . $host . '/', [
            'timeout' => 20,
            'headers' => $headers,
            'body'    => $payload,
        ]);

        if (is_wp_error($response)) {
            Logger::log('SMS error', ['error' => $response->get_error_message()]);
            return false;
        }
        $code = (int) wp_remote_retrieve_response_code($response);
        if ($code < 200 || $code >= 300) {
            Logger::log('SMS non-2xx', ['code' => $code, 'body' => wp_remote_retrieve_body($response)]);
            return false;
        }
        return true;
    }

    /**
     * AWS Signature Version 4 for an x-amz-json-1.0 POST.
     *
     * @return array<string,string> request headers including Authorization
     */
    private static function sign_v4(string $region, string $host, string $payload): array {
        $access = (string) Settings::get('aws_access_key_id', '');
        $secret = (string) Settings::get('aws_secret_access_key', '');
        $amz_date  = gmdate('Ymd\THis\Z');
        $date_only = gmdate('Ymd');
        $content_type = 'application/x-amz-json-1.0';
        $payload_hash = hash('sha256', $payload);

        // Canonical request.
        $canonical_headers = "content-type:{$content_type}\n"
            . "host:{$host}\n"
            . "x-amz-date:{$amz_date}\n"
            . "x-amz-target:" . self::TARGET . "\n";
        $signed_headers = 'content-type;host;x-amz-date;x-amz-target';
        $canonical_request = "POST\n/\n\n{$canonical_headers}\n{$signed_headers}\n{$payload_hash}";

        // String to sign.
        $scope = "{$date_only}/{$region}/" . self::SERVICE . "/aws4_request";
        $string_to_sign = "AWS4-HMAC-SHA256\n{$amz_date}\n{$scope}\n" . hash('sha256', $canonical_request);

        // Signing key + signature.
        $k_date    = hash_hmac('sha256', $date_only, 'AWS4' . $secret, true);
        $k_region  = hash_hmac('sha256', $region, $k_date, true);
        $k_service = hash_hmac('sha256', self::SERVICE, $k_region, true);
        $k_signing = hash_hmac('sha256', 'aws4_request', $k_service, true);
        $signature = hash_hmac('sha256', $string_to_sign, $k_signing);

        $authorization = "AWS4-HMAC-SHA256 Credential={$access}/{$scope}, "
            . "SignedHeaders={$signed_headers}, Signature={$signature}";

        return [
            'Content-Type'  => $content_type,
            'X-Amz-Date'    => $amz_date,
            'X-Amz-Target'  => self::TARGET,
            'Authorization' => $authorization,
        ];
    }

    /**
     * Best-effort E.164 normalisation (assumes US +1 for bare 10-digit numbers).
     */
    private static function normalise_msisdn(string $raw): string {
        $raw = trim($raw);
        if ($raw === '') {
            return '';
        }
        if (strpos($raw, '+') === 0) {
            return '+' . preg_replace('/\D/', '', substr($raw, 1));
        }
        $digits = preg_replace('/\D/', '', $raw);
        if (strlen($digits) === 10) {
            return '+1' . $digits;
        }
        if (strlen($digits) === 11 && $digits[0] === '1') {
            return '+' . $digits;
        }
        return $digits ? '+' . $digits : '';
    }
}
