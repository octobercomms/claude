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
        $subject   = self::subject($event_id, $event);
        $sent      = 0;
        $seen      = [];
        foreach ($attendees as $a) {
            $email = (string) ($a->email ?? '');
            $token = (string) ($a->token ?? '');
            if ($token === '' || ! is_email($email) || isset($seen[$email])) {
                continue;
            }
            $seen[$email] = true;
            $html = self::invite_html($event_id, $event, $token);
            $ok = Transactional::send(
                'survey_invite',
                ['email' => $email, 'name' => (string) ($a->attendee ?? '')],
                ['event_name' => $event],
                $subject,
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

    /** The invite email as it will be sent, wrapped in the brand shell (for preview). */
    public static function preview_html(int $event_id): string {
        $event = get_the_title($event_id) ?: __('Your event', 'october-events');
        return Transactional::wrap_body(self::invite_html($event_id, $event, ''));
    }

    /**
     * Invite subject — short, specific, and it states the time (the top reason
     * people skip is time), plus the offer when there is one. Kept concise so it
     * survives on mobile.
     */
    public static function subject(int $event_id, string $event): string {
        $offer = Config::offer_line($event_id);
        if ($offer !== '') {
            /* translators: 1: event name; 2: offer, e.g. "20% off" */
            return sprintf(__('How was %1$s? (a minute — %2$s inside)', 'october-events'), $event, $offer);
        }
        /* translators: %s: event name */
        return sprintf(__('How was %s? (takes a minute)', 'october-events'), $event);
    }

    /** The thank-you email as it will be sent, wrapped in the brand shell (for preview). */
    public static function preview_thankyou_html(int $event_id): string {
        $event = get_the_title($event_id) ?: __('Your event', 'october-events');
        $code  = Config::incentive_code($event_id) ?: 'SURVEY10XXXX';
        return Transactional::wrap_body(self::thankyou_html($event_id, $event, $code));
    }

    /**
     * Send the thank-you email once someone completes the survey — it repeats the
     * reward code so they have it in their inbox to use later. Only sent when a
     * reward code is set (that's the reason to email; the on-screen thanks covers
     * the rest). Best-effort.
     */
    public static function send_thankyou(int $event_id, string $email, string $name, string $code): bool {
        if (trim($code) === '' || ! is_email($email)) {
            return false;
        }
        $event = get_the_title($event_id);
        return Transactional::send(
            'survey_thanks',
            ['email' => $email, 'name' => $name],
            ['event_name' => $event],
            self::thankyou_subject($event),
            self::thankyou_html($event_id, $event, $code)
        );
    }

    public static function thankyou_subject(string $event): string {
        /* translators: %s: event name */
        return sprintf(__('Your reward for the %s survey', 'october-events'), $event);
    }

    /**
     * Branded thank-you body: reveals the reward code (they earned it) in the
     * same prominent chip design, with what the offer is and where to use it.
     */
    private static function thankyou_html(int $event_id, string $event, string $code): string {
        $accent = sanitize_hex_color((string) Settings::get('theme_accent', '')) ?: '#E7CD41';
        $on     = sanitize_hex_color((string) Settings::get('theme_accent_on', '')) ?: '#1a1a1a';
        $dark   = '#1a1a1a';
        $offer  = Config::offer_line($event_id);
        $redeem = Config::incentive_url($event_id);

        $intro = sprintf(
            /* translators: %s: event name */
            __('Thanks for the feedback on %s. It genuinely shapes what we do next time.', 'october-events'),
            $event
        );

        $html = '<p style="font-size:16px;line-height:1.5;margin:0 0 20px">' . esc_html($intro) . '</p>';
        $html .= '<div style="border:2px solid ' . esc_attr($dark) . ';border-radius:10px;background:#faf7f0;padding:18px;margin:0 0 20px">';
        if ($offer !== '') {
            $html .= '<div style="font-size:14px;color:#555;margin-bottom:4px">' . esc_html__('Your thank-you reward', 'october-events') . '</div>';
            $html .= '<div style="font-size:20px;font-weight:700;color:' . esc_attr($dark) . ';margin-bottom:10px">' . esc_html($offer) . '</div>';
        } else {
            $html .= '<div style="font-size:14px;color:#555;margin-bottom:8px">' . esc_html__('Your thank-you code', 'october-events') . '</div>';
        }
        $html .= '<div style="font-family:ui-monospace,Menlo,monospace;font-size:24px;font-weight:700;letter-spacing:3px;color:' . esc_attr($dark)
            . ';border:2px dashed ' . esc_attr($dark) . ';border-radius:8px;padding:10px 16px;display:inline-block">' . esc_html($code) . '</div>';
        if ($redeem !== '') {
            $html .= '<div style="margin-top:14px"><a href="' . esc_url($redeem) . '" style="display:inline-block;background:' . esc_attr($accent)
                . ';color:' . esc_attr($on) . ';text-decoration:none;font-weight:700;padding:11px 22px;border-radius:8px;font-size:15px">'
                . esc_html__('Use your code', 'october-events') . '</a></div>';
        } else {
            $html .= '<div style="font-size:13px;color:#777;margin-top:10px">' . esc_html__('Use it at checkout next time.', 'october-events') . '</div>';
        }
        $html .= '</div>';

        return $html;
    }

    /**
     * Branded invite body (wrapped in the brand shell by Transactional::send).
     * Sells the survey: states the time, lists the questions, embeds the first
     * rating as one-tap buttons (this alone lifts response markedly), and shows a
     * locked reward — the offer and what it's for, but never the code itself
     * (that's revealed only on completion).
     *
     * @param string $token attendee ticket token; '' for the preview
     */
    private static function invite_html(int $event_id, string $event, string $token): string {
        $accent = sanitize_hex_color((string) Settings::get('theme_accent', '')) ?: '#E7CD41';
        // Text ON the accent button uses accent-on; everything on light panels uses
        // a fixed dark ink (accent-on is often white, which vanishes on cream).
        // Fallback matches the default accent (#E7CD41, light) so an unconfigured
        // site gets legible dark-on-accent, not white-on-yellow.
        $ink    = sanitize_hex_color((string) Settings::get('theme_accent_on', '')) ?: '#1a1a1a';
        $dark   = '#1a1a1a';
        $url    = $token !== '' ? self::link($token) : home_url('/survey/preview');

        // Cap-counting questions, in order, for the "here's what we'll ask" list.
        $questions = Config::questions($event_id);
        $labels = [];
        $first_rating = null;
        foreach ($questions as $q) {
            $type = (string) ($q['type'] ?? '');
            if (in_array($type, Config::OFFCAP_TYPES, true)) {
                continue;
            }
            $labels[] = (string) ($q['label'] ?? '');
            if ($first_rating === null && $type === 'rating') {
                $first_rating = $q;
            }
        }
        $count = count($labels);

        $intro = sprintf(
            /* translators: 1: event name; 2: number of questions */
            _n(
                'Thanks for signing up for %1$s. It takes about a minute — just %2$d quick question — and it shapes what we do next time.',
                'Thanks for signing up for %1$s. It takes about a minute — just %2$d quick questions — and it shapes what we do next time.',
                $count,
                'october-events'
            ),
            $event,
            $count
        );

        $html = '<p style="font-size:16px;line-height:1.5;margin:0 0 16px">' . esc_html($intro) . '</p>';

        // What we'll ask (the whole thing is short — showing it lowers friction).
        if ($labels) {
            $html .= '<p style="font-size:13px;color:#777;margin:0 0 6px">' . esc_html__('What we’ll ask:', 'october-events') . '</p>';
            $html .= '<ol style="font-size:15px;line-height:1.5;margin:0 0 20px;padding-left:20px;color:#333">';
            foreach ($labels as $label) {
                $html .= '<li>' . esc_html($label) . '</li>';
            }
            $html .= '</ol>';
        }

        // Embed the first rating as one-tap buttons that deep-link into the survey
        // with that answer pre-selected — the biggest single lever on response.
        if ($first_rating !== null) {
            $html .= '<p style="font-size:15px;font-weight:600;margin:0 0 8px">' . esc_html((string) $first_rating['label']) . '</p>';
            $html .= '<div style="margin:0 0 8px">';
            for ($i = 1; $i <= 5; $i++) {
                $rate_url = add_query_arg('r', $i, $url);
                $html .= '<a href="' . esc_url($rate_url) . '" style="display:inline-block;width:44px;height:44px;line-height:44px;text-align:center;'
                    . 'margin-right:6px;border:2px solid ' . esc_attr($dark) . ';border-radius:10px;color:' . esc_attr($dark)
                    . ';text-decoration:none;font-weight:700;font-size:17px">' . $i . '</a>';
            }
            $html .= '</div>';
            $html .= '<p style="font-size:12px;color:#999;margin:0 0 20px">' . esc_html__('Poor → Excellent. Tap one to begin.', 'october-events') . '</p>';
        }

        // Locked reward: show the offer + what it's for, never the code. Shown
        // whenever a reward exists — with the amount when we know it, else a
        // generic teaser so a code-only (e.g. cross-site) reward isn't hidden.
        $offer = Config::offer_line($event_id);
        if ($offer !== '' || Config::incentive_code($event_id) !== '') {
            $offer_label = $offer !== '' ? $offer : __('A thank-you reward', 'october-events');
            $html .= '<div style="border:2px solid ' . esc_attr($dark) . ';border-radius:10px;background:#faf7f0;padding:16px;margin:0 0 20px">'
                . '<div style="font-size:14px;color:#555;margin-bottom:6px">🔒 ' . esc_html__('Thank-you reward, unlocked when you finish', 'october-events') . '</div>'
                . '<div style="font-size:20px;font-weight:700;color:' . esc_attr($dark) . '">' . esc_html($offer_label) . '</div>'
                . '<div style="font-family:ui-monospace,Menlo,monospace;font-size:20px;letter-spacing:3px;color:#bbb;border:2px dashed #ccc;border-radius:8px;padding:8px 12px;margin-top:10px;display:inline-block">•••••••</div>'
                . '</div>';
        }

        $html .= '<p style="margin:8px 0 20px">'
            . '<a href="' . esc_url($url) . '" style="display:inline-block;background:' . esc_attr($accent)
            . ';color:' . esc_attr($ink) . ';text-decoration:none;font-weight:700;padding:14px 26px;border-radius:8px;font-size:16px">'
            . esc_html__('Start the survey', 'october-events') . '</a></p>';

        $html .= '<p style="font-size:13px;color:#777;margin:0">' . esc_html__('Your answers are anonymous.', 'october-events') . '</p>';

        return $html;
    }
}
