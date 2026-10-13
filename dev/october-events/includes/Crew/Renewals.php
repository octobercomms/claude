<?php
declare(strict_types=1);

namespace OE\Crew;

defined('ABSPATH') || exit;

/**
 * The renewal loop (CREW-MODULE §3, ADMIN-BUILD R5) — where the admin
 * disappears. Runs once a day off the plugin's daily cron:
 *
 *  1. Active planning roles whose term ends in ~60 days get a renewal prompt.
 *  2. Those at ~30 days that have not replied get a second nudge.
 *  3. Roles whose term has ended with no reply are offboarded and reopened.
 *
 * Every send/transition is recorded on the row (renewal_sent / renewal_stage),
 * so a prompt is sent once per stage and the job is safe to run daily.
 */
final class Renewals {

    public static function run(): void {
        if (! class_exists('\\OE\\Crew\\Schema')) {
            return;
        }
        $enabled = (bool) \OE\Settings::get('crew_renewal_enabled', true);
        $first   = max(0, (int) \OE\Settings::get('crew_renewal_days_first', 60));
        $second  = max(0, (int) \OE\Settings::get('crew_renewal_days_second', 30));
        // Keep the two stages ordered (first is the earlier/larger window).
        if ($second > $first) {
            [$first, $second] = [$second, $first];
        }
        $now = current_time('timestamp');

        foreach (Crew::all(['tier' => Crew::TIER_PLANNING]) as $row) {
            if (! $row->term_end) {
                continue;
            }
            $end  = strtotime((string) $row->term_end);
            if (! $end) {
                continue;
            }
            $days = (int) floor(($end - $now) / DAY_IN_SECONDS);
            $status = (string) $row->status;

            // Term ended and still not renewed -> offboard + reopen. This runs
            // even when reminders are disabled: a lapsed term must lose access.
            if ($days < 0 && in_array($status, [Crew::STATUS_ACTIVE, Crew::STATUS_RENEWING], true)) {
                Lifecycle::offboard((int) $row->id);
                continue;
            }

            if (! $enabled) {
                continue;
            }

            // First reminder: active, within the first window but before the second.
            if ($status === Crew::STATUS_ACTIVE && $first > 0 && $days <= $first && $days > $second) {
                Lifecycle::send_renewal((int) $row->id, (string) $first);
                continue;
            }

            // Second reminder: within the second window, either never prompted or
            // only the first reminder was sent.
            if ($second > 0 && $days <= $second && $days >= 0) {
                if ($status === Crew::STATUS_ACTIVE) {
                    Lifecycle::send_renewal((int) $row->id, (string) $second);
                } elseif ($status === Crew::STATUS_RENEWING && (string) $row->renewal_stage === (string) $first) {
                    Lifecycle::send_renewal((int) $row->id, (string) $second);
                }
            }
        }
    }
}
