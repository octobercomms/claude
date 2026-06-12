<?php
declare(strict_types=1);

namespace OE\Connectors;

use OE\Settings;
use OE\Logger;

defined('ABSPATH') || exit;

/**
 * Brevo transactional email + contact-list management (§5).
 *
 * All festival email goes through Brevo — there is no wp_mail fallback. The API
 * key is read from the wp-config.php constant. Implemented against Brevo's REST
 * API via wp_remote_* (no heavyweight SDK dependency required).
 */
final class BrevoConnector {

    private const API_BASE = 'https://api.brevo.com/v3';

    /** Logical trigger => template option key (§5 trigger table). */
    public const TRIGGERS = [
        'account_welcome',
        'submission_received',
        'submission_approved',
        'submission_rejected_free',
        'submission_rejected_refund',
        'payment_confirmed',
        'ticket_delivery',
        'volunteer_confirmed',
        'volunteer_declined',
        'volunteer_reminder',
        'monthly_digest',
    ];

    public static function is_ready(): bool {
        return Settings::has_secret('brevo_api_key');
    }

    /**
     * Send a transactional email by trigger name. Resolves the configured Brevo
     * template id and merges params; if no template id is mapped it falls back
     * to a plain subject/HTML body so nothing is silently dropped.
     *
     * @param array{email:string,name?:string} $to
     */
    public static function send(string $trigger, array $to, array $params = [], string $subject = '', string $html = ''): bool {
        if (! self::is_ready()) {
            Logger::log('Brevo send skipped — no API key', compact('trigger'));
            return false;
        }

        $templates  = (array) Settings::get('brevo_templates', []);
        $template_id = (int) ($templates[$trigger] ?? 0);

        $body = [
            'to' => [array_filter([
                'email' => $to['email'] ?? '',
                'name'  => $to['name'] ?? null,
            ])],
        ];

        if ($template_id > 0) {
            $body['templateId'] = $template_id;
            $body['params']     = $params;
        } else {
            $body['subject']     = $subject ?: ucwords(str_replace('_', ' ', $trigger));
            $body['htmlContent'] = $html ?: self::params_to_html($params);
            $body['sender']      = ['name' => get_bloginfo('name'), 'email' => get_option('admin_email')];
        }

        $resp = self::request('POST', '/smtp/email', $body);
        return $resp !== null;
    }

    /**
     * Add (or update) a contact and optionally subscribe to lists.
     *
     * @param int[] $list_ids
     */
    public static function upsert_contact(string $email, array $attributes = [], array $list_ids = []): bool {
        $body = [
            'email'         => $email,
            'attributes'    => $attributes,
            'updateEnabled' => true,
        ];
        if ($list_ids) {
            $body['listIds'] = array_map('intval', $list_ids);
        }
        return self::request('POST', '/contacts', $body) !== null;
    }

    /**
     * Send a campaign-style payload to a list (used by the monthly digest §5).
     */
    public static function send_to_list(string $trigger, int $list_id, array $params): bool {
        $templates   = (array) Settings::get('brevo_templates', []);
        $template_id = (int) ($templates[$trigger] ?? 0);
        if ($template_id <= 0 || $list_id <= 0) {
            Logger::log('Brevo list send skipped — missing template or list', compact('trigger', 'list_id'));
            return false;
        }
        $resp = self::request('POST', '/emailCampaigns', [
            'name'       => 'ADF ' . $trigger . ' ' . gmdate('Y-m-d'),
            'templateId' => $template_id,
            'recipients' => ['listIds' => [$list_id]],
            'params'     => $params,
            'scheduledAt' => gmdate('c', time() + 300),
        ]);
        return $resp !== null;
    }

    /**
     * Send a transactional SMS via Brevo (§volunteer reminders).
     *
     * Requires SMS credits and an approved alphanumeric sender configured in
     * settings (`sms_sender`). The recipient number should be E.164 (+1…);
     * a best-effort normalisation is applied for bare US numbers.
     */
    public static function send_sms(string $to, string $content): bool {
        if (! self::is_ready()) {
            Logger::log('Brevo SMS skipped — no API key');
            return false;
        }
        $number = self::normalise_msisdn($to);
        if ($number === '') {
            Logger::log('Brevo SMS skipped — unparseable number', ['to' => $to]);
            return false;
        }
        $sender = (string) Settings::get('sms_sender', 'ADF');
        $resp = self::request('POST', '/transactionalSMS/sms', [
            'type'      => 'transactional',
            'sender'    => $sender,
            'recipient' => $number,
            'content'   => $content,
        ]);
        return $resp !== null;
    }

    /**
     * Best-effort E.164 normalisation. Leaves already-prefixed numbers alone;
     * assumes US (+1) for 10-digit bare numbers.
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

    /* ------------------------------------------------------------------- */

    private static function request(string $method, string $path, array $body): ?array {
        $response = wp_remote_request(self::API_BASE . $path, [
            'method'  => $method,
            'timeout' => 30,
            'headers' => [
                'api-key'      => (string) Settings::get('brevo_api_key', ''),
                'Content-Type' => 'application/json',
                'Accept'       => 'application/json',
            ],
            'body' => wp_json_encode($body),
        ]);

        if (is_wp_error($response)) {
            Logger::log('Brevo error', ['path' => $path, 'error' => $response->get_error_message()]);
            return null;
        }
        $code = wp_remote_retrieve_response_code($response);
        if ($code < 200 || $code >= 300) {
            Logger::log('Brevo non-2xx', ['path' => $path, 'code' => $code, 'body' => wp_remote_retrieve_body($response)]);
            return null;
        }
        return json_decode((string) wp_remote_retrieve_body($response), true) ?: [];
    }

    private static function params_to_html(array $params): string {
        $rows = '';
        foreach ($params as $k => $v) {
            if (is_scalar($v)) {
                $rows .= '<p><strong>' . esc_html((string) $k) . ':</strong> ' . esc_html((string) $v) . '</p>';
            }
        }
        return $rows ?: '<p>' . esc_html__('See your account dashboard for details.', 'october-events') . '</p>';
    }
}
