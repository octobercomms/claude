<?php
declare(strict_types=1);

namespace OE\Connectors;

use OE\Settings;

defined('ABSPATH') || exit;

/**
 * SMS provider façade. The site can send SMS through AWS End User Messaging
 * (cheap, one-way — replies go nowhere) or Quo/OpenPhone (sends from your Quo
 * number, replies land in your Quo inbox + Slack). Everything that sends SMS
 * goes through here so switching provider is a single Settings choice.
 */
final class Sms {

    /** The chosen provider: 'quo' or 'aws' (default). */
    public static function provider(): string {
        return (string) Settings::get('sms_provider', 'aws') === 'quo' ? 'quo' : 'aws';
    }

    public static function is_ready(): bool {
        return self::provider() === 'quo'
            ? QuoConnector::is_ready()
            : SmsConnector::is_ready();
    }

    /** Send one SMS via the configured provider. Returns true on success. */
    public static function send(string $to, string $content): bool {
        return self::provider() === 'quo'
            ? QuoConnector::send($to, $content)
            : SmsConnector::send($to, $content);
    }
}
