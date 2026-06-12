<?php
declare(strict_types=1);

namespace OE;

use OE\Connectors\BrevoConnector;

defined('ABSPATH') || exit;

/**
 * Volunteer reminder engine — email + SMS, to reduce no-shows.
 *
 * Channels: email always (Brevo), SMS via Brevo transactional SMS when enabled
 * and the volunteer opted in with a phone number.
 *
 * Cadence (all enabled by default per the festival's request):
 *   - on_signup : immediate confirmation
 *   - week      : ~1 week before the shift
 *   - 48h       : ~48 hours before
 *   - morning   : morning of, ~3 hours before start
 *
 * A scan (run hourly from {@see Cron}) walks upcoming shifts and fires any
 * offset that has become due and not already sent. Sent offsets are recorded
 * per signup so reminders never duplicate.
 */
final class Reminders {

    /** Offset key => seconds before shift start. */
    public const OFFSETS = [
        'week'    => 604800, // 7 days
        '48h'     => 172800, // 48 hours
        'morning' => 10800,  // 3 hours
    ];

    /**
     * Fire the immediate confirmation when someone signs up.
     */
    public static function on_signup(int $signup_id): void {
        $s = VolunteerSignups::get($signup_id);
        if (! $s) {
            return;
        }
        self::dispatch($s, 'on_signup');
        self::mark_sent($s, 'on_signup');
    }

    /**
     * Hourly scan: send any offset reminders that have come due.
     */
    public static function run_due(): void {
        $now    = current_time('timestamp', true);
        $from   = gmdate('Y-m-d H:i:s', $now);
        $to     = gmdate('Y-m-d H:i:s', $now + self::OFFSETS['week'] + HOUR_IN_SECONDS);
        $enabled = (array) Settings::get('reminder_offsets', array_keys(self::OFFSETS));

        foreach (VolunteerSignups::due_between($from, $to) as $s) {
            $start_ts = strtotime((string) $s->shift_start . ' UTC');
            if (! $start_ts || $start_ts <= $now) {
                continue;
            }
            $already = self::already_sent($s);

            foreach (self::OFFSETS as $key => $seconds) {
                if (! in_array($key, $enabled, true) || in_array($key, $already, true)) {
                    continue;
                }
                // Due once we are within the offset window of the start.
                if ($start_ts - $now <= $seconds) {
                    self::dispatch($s, $key);
                    self::mark_sent($s, $key);
                }
            }
        }
    }

    /* ------------------------------------------------------------------ */

    private static function dispatch(object $signup, string $context): void {
        $params = Volunteers::email_params($signup);
        $params['context'] = $context;

        // Email (always).
        $subject = $context === 'on_signup'
            ? __('You are signed up to volunteer', 'october-events')
            : __('Reminder: your volunteer shift is coming up', 'october-events');
        BrevoConnector::send('volunteer_reminder', [
            'email' => $signup->email,
            'name'  => $signup->name,
        ], $params, $subject);

        // SMS (opt-in + enabled).
        if (! empty($signup->sms_opt_in) && (bool) Settings::get('sms_enabled', false) && ! empty($signup->phone)) {
            BrevoConnector::send_sms(
                (string) $signup->phone,
                Volunteers::sms_body($signup, $context)
            );
        }

        AuditLog::record('volunteer_reminder_sent', (int) $signup->opportunity_id, 'volunteer', $context);
    }

    /**
     * @return string[]
     */
    private static function already_sent(object $signup): array {
        return array_filter(array_map('trim', explode(',', (string) ($signup->reminders_sent ?? ''))));
    }

    private static function mark_sent(object $signup, string $key): void {
        $sent = self::already_sent($signup);
        if (! in_array($key, $sent, true)) {
            $sent[] = $key;
        }
        VolunteerSignups::update((int) $signup->id, ['reminders_sent' => implode(',', $sent)]);
    }
}
