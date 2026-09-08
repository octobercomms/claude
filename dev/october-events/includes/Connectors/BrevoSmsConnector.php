<?php
declare(strict_types=1);

namespace OE\Connectors;

use OE\Settings;
use OE\Logger;

defined('ABSPATH') || exit;

/**
 * SMS via Brevo (formerly Sendinblue) transactional SMS —
 * POST https://api.brevo.com/v3/transactionalSMS/send.
 *
 * Off until an API key + a sender are set. This is the easiest path when the
 * site already sends SMS through Brevo (an approved sender ID means no fresh
 * carrier registration). Auth is the `api-key` header.
 */
final class BrevoSmsConnector {

    private const ENDPOINT = 'https://api.brevo.com/v3/transactionalSMS/send';

    public static function is_ready(): bool {
        return (string) Settings::get('brevo_api_key', '') !== ''
            && (string) Settings::get('brevo_sms_sender', '') !== '';
    }

    /** Send one transactional SMS via Brevo. Returns true on a 2xx. */
    public static function send(string $to, string $content): bool {
        if (! self::is_ready()) {
            Logger::log('SMS skipped — Brevo not configured');
            return false;
        }
        $number = self::to_e164($to);
        if ($number === '') {
            Logger::log('SMS skipped — unparseable number', ['to' => $to]);
            return false;
        }
        // Brevo sender limits: a numeric sender may be up to 15 digits; an
        // alphanumeric sender ID is capped at 11 characters.
        $sender_raw = (string) Settings::get('brevo_sms_sender', '');
        if (preg_match('/^\+?\d+$/', $sender_raw)) {
            $sender = substr(preg_replace('/\D/', '', $sender_raw), 0, 15);
        } else {
            $sender = substr($sender_raw, 0, 11);
        }

        $response = wp_remote_post(self::ENDPOINT, [
            'timeout' => 20,
            'headers' => [
                'api-key'      => (string) Settings::get('brevo_api_key', ''),
                'Content-Type' => 'application/json',
                'Accept'       => 'application/json',
            ],
            'body' => (string) wp_json_encode([
                'sender'    => $sender,
                'recipient' => $number,
                'content'   => $content,
                'type'      => 'transactional',
            ]),
        ]);

        if (is_wp_error($response)) {
            Logger::log('Brevo SMS error', ['error' => $response->get_error_message()]);
            return false;
        }
        $code = (int) wp_remote_retrieve_response_code($response);
        if ($code < 200 || $code >= 300) {
            Logger::log('Brevo SMS non-2xx', ['code' => $code, 'body' => wp_remote_retrieve_body($response)]);
            return false;
        }
        return true;
    }

    /** Best-effort E.164 normalisation (assumes US +1 for bare 10-digit numbers). */
    private static function to_e164(string $raw): string {
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
