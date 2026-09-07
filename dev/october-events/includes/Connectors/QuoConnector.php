<?php
declare(strict_types=1);

namespace OE\Connectors;

use OE\Settings;
use OE\Logger;

defined('ABSPATH') || exit;

/**
 * SMS via Quo (formerly OpenPhone) — POST https://api.quo.com/v1/messages.
 *
 * Unlike the AWS path, this sends FROM your existing Quo workspace number, so
 * replies land in your Quo inbox (and any Slack you have connected to it) — the
 * two-way conversation you already use. Off until an API key + a Quo "from"
 * number are set. US A2P still requires the number to be 10DLC-registered in
 * Quo's Trust Center.
 */
final class QuoConnector {

    private const ENDPOINT = 'https://api.quo.com/v1/messages';

    public static function is_ready(): bool {
        return (string) Settings::get('quo_api_key', '') !== ''
            && (string) Settings::get('quo_from_number', '') !== '';
    }

    /** Send one SMS via Quo. Returns true on a 2xx. */
    public static function send(string $to, string $content): bool {
        if (! self::is_ready()) {
            Logger::log('SMS skipped — Quo not configured');
            return false;
        }
        $number = self::to_e164($to);
        if ($number === '') {
            Logger::log('SMS skipped — unparseable number', ['to' => $to]);
            return false;
        }
        $from = self::to_e164((string) Settings::get('quo_from_number', ''));
        if ($from === '') {
            Logger::log('SMS skipped — Quo from-number invalid');
            return false;
        }

        $response = wp_remote_post(self::ENDPOINT, [
            'timeout' => 20,
            'headers' => [
                'Authorization' => (string) Settings::get('quo_api_key', ''),
                'Content-Type'  => 'application/json',
            ],
            'body' => (string) wp_json_encode([
                'from'    => $from,
                'to'      => [$number],
                'content' => $content,
            ]),
        ]);

        if (is_wp_error($response)) {
            Logger::log('Quo SMS error', ['error' => $response->get_error_message()]);
            return false;
        }
        $code = (int) wp_remote_retrieve_response_code($response);
        if ($code < 200 || $code >= 300) {
            Logger::log('Quo SMS non-2xx', ['code' => $code, 'body' => wp_remote_retrieve_body($response)]);
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
