<?php
declare(strict_types=1);

namespace OE\Ticketing;

use OE\Settings;
use OE\AuditLog;
use OE\Planning\Events;

defined('ABSPATH') || exit;

/**
 * Pre-event reminder for ticket-holders — emails everyone with an active ticket
 * a short "see you soon" a configurable number of hours before the event starts
 * (default 24). Reduces no-shows.
 *
 * Run hourly from {@see \OE\Cron}. Each event is reminded once: a post-meta flag
 * makes the scan idempotent, so a late-running or duplicated cron never
 * double-emails. Only events that actually have attendees are considered.
 */
final class AttendeeReminders {

    private const SENT_META = '_oe_attendee_reminded';

    /** Hours before start to send (Settings → Tickets, default 24). */
    public static function lead_hours(): int {
        $h = (int) Settings::get('attendee_reminder_hours', 24);
        return $h > 0 ? min($h, 168) : 24; // clamp to a week
    }

    public static function enabled(): bool {
        return (bool) Settings::get('attendee_reminder_enabled', true);
    }

    /** Hourly scan: remind attendees of events about to start. */
    public static function run_due(): void {
        if (! self::enabled()) {
            return;
        }
        $now    = time();
        $window = $now + self::lead_hours() * HOUR_IN_SECONDS;

        foreach (self::event_ids_with_attendees() as $event_id) {
            if (get_post_meta($event_id, self::SENT_META, true)) {
                continue; // already reminded
            }
            $start = Ics::start_ts($event_id);
            // Due when the start is in the future but within the lead window.
            if (! $start || $start <= $now || $start > $window) {
                continue;
            }
            self::remind_event($event_id);
        }
    }

    /** Email every active ticket-holder for one event; mark it reminded. */
    public static function remind_event(int $event_id): int {
        $attendees = Orders::attendees_for_event($event_id);
        if (! $attendees) {
            return 0;
        }
        $when  = (string) Events::get($event_id, 'start_datetime', '');
        $where = (string) Events::get($event_id, 'location', '');
        $name  = (string) Events::get($event_id, 'name', '') ?: get_the_title($event_id);
        $url   = (string) get_permalink($event_id);
        $ics   = Ics::tempfile($event_id);

        $sent = 0;
        foreach ($attendees as $a) {
            $ok = \OE\Mail\Transactional::send('event_reminder', [
                'email' => (string) $a->email,
                'name'  => (string) $a->name,
            ], [
                'event_name' => $name,
                'when'       => $when,
                'location'   => $where,
                'event_url'  => $url,
            ], '', '', $ics !== '' ? [$ics] : []);
            if ($ok) {
                $sent++;
            }
        }
        if ($ics !== '') {
            Ics::cleanup($ics);
        }
        update_post_meta($event_id, self::SENT_META, time());
        AuditLog::record('event_reminder_sent', $event_id, 'event', (string) $sent);
        return $sent;
    }

    /** @return array<int,int> distinct event ids that have paid, active tickets */
    private static function event_ids_with_attendees(): array {
        global $wpdb;
        $o = Schema::orders();
        $t = Schema::tickets();
        $ids = $wpdb->get_col(
            "SELECT DISTINCT o.event_id
             FROM {$o} o INNER JOIN {$t} ti ON ti.order_id = o.id AND ti.status = 'active'
             WHERE o.status = 'paid' AND o.event_id > 0"
        ) ?: [];
        return array_map('intval', $ids);
    }
}
