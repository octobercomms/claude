<?php
declare(strict_types=1);

namespace OE\Connectors;

use OE\Settings;

defined('ABSPATH') || exit;

/**
 * SMS provider façade. The site can send SMS through:
 *   - Brevo (transactional SMS — easiest when an approved Brevo sender exists),
 *   - Quo/OpenPhone (sends from your Quo number; replies land in Quo + Slack),
 *   - AWS End User Messaging (cheapest, one-way — replies go nowhere).
 * Everything that sends SMS goes through here so switching provider is a single
 * Settings choice.
 */
final class Sms {

    /** The chosen provider: 'brevo', 'quo', or 'aws' (default). */
    public static function provider(): string {
        $p = (string) Settings::get('sms_provider', 'aws');
        return in_array($p, ['brevo', 'quo', 'aws'], true) ? $p : 'aws';
    }

    public static function is_ready(): bool {
        switch (self::provider()) {
            case 'brevo':
                return BrevoSmsConnector::is_ready();
            case 'quo':
                return QuoConnector::is_ready();
            default:
                return SmsConnector::is_ready();
        }
    }

    /** Send one SMS via the configured provider. Returns true on success. */
    public static function send(string $to, string $content): bool {
        switch (self::provider()) {
            case 'brevo':
                return BrevoSmsConnector::send($to, $content);
            case 'quo':
                return QuoConnector::send($to, $content);
            default:
                return SmsConnector::send($to, $content);
        }
    }
}
