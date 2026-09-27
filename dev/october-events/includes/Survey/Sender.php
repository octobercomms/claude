<?php
declare(strict_types=1);

namespace OE\Survey;

use OE\Settings;
use OE\Ticketing\Orders;
use OE\Mail\Transactional;

defined('ABSPATH') || exit;

/**
 * Sends the survey invite: automatically the day after the event (via the daily
 * cron, once per event), and on demand from the builder's "Send now" button.
 *
 * The trigger is "set it up once, it goes out for every enabled event": turn a
 * survey on for an event and the day-after send is automatic, no per-event
 * scheduling.
 *
 * @see docs/october-events/POST-EVENT-SURVEY-SPEC.md §8
 */
final class Sender {

    /**
     * Daily scan: for every enabled, ready, not-yet-sent survey whose event
     * ended `send_days_after` days ago, email the attendees once.
     */
    public static function run_due(): void {
        $events = get_posts([
            'post_type'      => Config::post_type(),
            'post_status'    => 'publish',
            'posts_per_page' => 100,
            'fields'         => 'ids',
            'no_found_rows'  => true,
            'meta_query'     => [
                ['key' => '_oe_survey_enabled', 'value' => '1'],
                [
                    'relation' => 'OR',
                    ['key' => '_oe_survey_sent_at', 'compare' => 'NOT EXISTS'],
                    ['key' => '_oe_survey_sent_at', 'value' => '', 'compare' => '='],
                ],
            ],
        ]);
        $today = (int) current_time('timestamp');
        foreach ($events as $event_id) {
            $event_id = (int) $event_id;
            if (! Config::is_ready($event_id) || Config::sent_at($event_id) !== '') {
                continue;
            }
            $end = Config::end_ts($event_id);
            if ($end <= 0) {
                continue; // no date — can't time the send
            }
            $due = $end + Config::send_days_after($event_id) * DAY_IN_SECONDS;
            // Fire once the due day has arrived (and not before the event ends).
            if ($today < $due || $today < $end) {
                continue;
            }
            self::send_event($event_id);
        }
    }

    /**
     * Send (or resend, when $force) the invite to every attendee we hold an
     * address for. Stamps sent_at so the daily scan never double-sends.
     *
     * @return int number of invites sent
     */
    public static function send_event(int $event_id, bool $force = false): int {
        if (! Config::is_ready($event_id)) {
            return 0;
        }
        if (! $force && Config::sent_at($event_id) !== '') {
            return 0;
        }
        // Stamp first so a slow send or an overlapping cron tick can't double-fire.
        Config::mark_sent($event_id);

        // High limit so a large event isn't silently truncated at the default cap
        // (sent_at is stamped once, so a truncated batch would never be retried).
        $attendees = Orders::attendees_for_list($event_id, 100000);
        $event     = get_the_title($event_id);
        $sent      = 0;
        $seen      = [];
        foreach ($attendees as $a) {
            $email = (string) ($a->email ?? '');
            $token = (string) ($a->token ?? '');
            if ($token === '' || ! is_email($email) || isset($seen[$email])) {
                continue;
            }
            $seen[$email] = true;
            $html = self::invite_html($event, self::link($token));
            $ok = Transactional::send(
                'survey_invite',
                ['email' => $email, 'name' => (string) ($a->attendee ?? '')],
                ['event_name' => $event],
                '',
                $html
            );
            if ($ok) {
                $sent++;
            }
        }
        \OE\AuditLog::record('survey_invites_sent', $event_id, 'survey', (string) $sent);
        return $sent;
    }

    /** The tokenised survey link for an attendee. */
    public static function link(string $token): string {
        return home_url('/survey/' . rawurlencode($token));
    }

    /** Branded invite body (wrapped in the brand shell by Transactional::send). */
    private static function invite_html(string $event, string $url): string {
        $brand = (string) Settings::get('brand_name', 'October Events');
        $accent = sanitize_hex_color((string) Settings::get('theme_accent', '')) ?: '#E7CD41';
        $ink    = sanitize_hex_color((string) Settings::get('theme_accent_on', '')) ?: '#1a1a1a';

        $intro = sprintf(
            /* translators: %s: event name */
            __('Thanks for coming to %s. Could you spare under a minute to tell us how it went? It shapes what we do next time.', 'october-events'),
            $event
        );
        $button = '<a href="' . esc_url($url) . '" style="display:inline-block;background:' . esc_attr($accent)
            . ';color:' . esc_attr($ink) . ';text-decoration:none;font-weight:700;padding:14px 26px;border-radius:8px;font-size:16px">'
            . esc_html__('Start the survey', 'october-events') . '</a>';

        return '<p style="font-size:16px;line-height:1.5">' . esc_html($intro) . '</p>'
            . '<p style="margin:24px 0">' . $button . '</p>'
            . '<p style="font-size:13px;color:#777">' . esc_html__('Four quick questions. Your answers are anonymous.', 'october-events') . '</p>';
    }
}
