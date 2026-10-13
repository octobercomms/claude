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

            // Term ended and still not renewed -> offboard + reopen.
            if ($days < 0 && in_array($status, [Crew::STATUS_ACTIVE, Crew::STATUS_RENEWING], true)) {
                Lifecycle::offboard((int) $row->id);
                continue;
            }

            // 60-day prompt: active, within 60 days, not yet prompted.
            if ($status === Crew::STATUS_ACTIVE && $days <= 60 && $days > 30) {
                Lifecycle::send_renewal((int) $row->id, '60');
                continue;
            }

            // 30-day nudge: within 30 days and either never prompted or only the
            // 60-day prompt was sent.
            if ($days <= 30 && $days >= 0) {
                if ($status === Crew::STATUS_ACTIVE) {
                    Lifecycle::send_renewal((int) $row->id, '30');
                } elseif ($status === Crew::STATUS_RENEWING && (string) $row->renewal_stage === '60') {
                    Lifecycle::send_renewal((int) $row->id, '30');
                }
            }
        }
    }
}
