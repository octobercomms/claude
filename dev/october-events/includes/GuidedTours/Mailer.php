<?php
declare(strict_types=1);

namespace OE\GuidedTours;

use OE\Mail\Transactional;

defined('ABSPATH') || exit;

/**
 * Guided-tour emails: booking confirmation, waitlist notice, waitlist promotion,
 * and the 48-hour reconfirm-or-release. Bodies are simple HTML wrapped in the
 * plugin's brand chrome by Transactional::send().
 */
final class Mailer {

    /** Confirmation on reserve (or a waitlist notice when the slot was full). */
    public static function reserved(int $location_id, string $slot_uid, string $email, string $name, bool $waitlisted): void {
        $when = self::when($location_id, $slot_uid);
        $bld  = self::building($location_id);
        if ($waitlisted) {
            $subject = __('You’re on the waitlist', 'october-events');
            $html    = self::p(sprintf(__('Thanks %s. %s on %s is full, so you’re on the waitlist. If a spot frees up we’ll email you straight away.', 'october-events'),
                self::name($name), esc_html($bld), esc_html($when)));
        } else {
            $subject = __('Your guided tour spot is booked', 'october-events');
            $html    = self::p(sprintf(__('You’re booked for %s on %s. Please arrive a few minutes early.', 'october-events'),
                '<strong>' . esc_html($bld) . '</strong>', '<strong>' . esc_html($when) . '</strong>'))
                . self::p(__('We’ll email you 48 hours before to confirm. If you can’t make it, please release your spot so someone on the waitlist can take it.', 'october-events'));
        }
        Transactional::send('gt_reserved', ['email' => $email, 'name' => $name], [], $subject, $html);
    }

    /** A waitlisted person has been promoted into a real spot. */
    public static function promoted(int $location_id, string $slot_uid, string $email, string $name): void {
        $when    = self::when($location_id, $slot_uid);
        $bld     = self::building($location_id);
        $subject = __('A spot opened up — you’re in', 'october-events');
        $html    = self::p(sprintf(__('Good news %s, a spot opened for %s on %s and it’s yours. See you there.', 'october-events'),
            self::name($name), '<strong>' . esc_html($bld) . '</strong>', '<strong>' . esc_html($when) . '</strong>'));
        Transactional::send('gt_promoted', ['email' => $email, 'name' => $name], [], $subject, $html);
    }

    /** 48-hour reconfirm-or-release, with one-click links. */
    public static function reconfirm(object $row): void {
        $location_id = (int) $row->location_id;
        $when    = self::when($location_id, (string) $row->slot_uid);
        $bld     = self::building($location_id);
        $confirm = add_query_arg(['oe_gt' => 'confirm', 'token' => (string) $row->token], home_url('/'));
        $release = add_query_arg(['oe_gt' => 'release', 'token' => (string) $row->token], home_url('/'));
        $subject = __('Please confirm your guided tour spot', 'october-events');
        $html    = self::p(sprintf(__('Your guided tour of %s is on %s. Can you still make it?', 'october-events'),
                '<strong>' . esc_html($bld) . '</strong>', '<strong>' . esc_html($when) . '</strong>'))
            . '<p style="margin:18px 0">'
            . '<a href="' . esc_url($confirm) . '" style="background:#111;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:8px;display:inline-block;margin-right:8px">' . esc_html__('Yes, I’m coming', 'october-events') . '</a>'
            . '<a href="' . esc_url($release) . '" style="color:#b23b2a;text-decoration:underline;font-weight:600;padding:11px 4px;display:inline-block">' . esc_html__('Release my spot', 'october-events') . '</a>'
            . '</p>'
            . self::p(__('If we don’t hear from you, we may release your spot to the waitlist.', 'october-events'));
        Transactional::send('gt_reconfirm', ['email' => (string) $row->email, 'name' => (string) $row->name], [], $subject, $html);
    }

    private static function building(int $location_id): string {
        return get_the_title($location_id) ?: __('the building', 'october-events');
    }

    private static function when(int $location_id, string $slot_uid): string {
        $ts = Slots::start_ts($location_id, $slot_uid);
        return $ts ? wp_date('l F j, g:i A', $ts) : '';
    }

    private static function name(string $name): string {
        $name = trim($name);
        return $name !== '' ? esc_html($name) : esc_html__('there', 'october-events');
    }

    private static function p(string $inner): string {
        return '<p style="margin:0 0 12px;font-size:15px;line-height:1.5">' . $inner . '</p>';
    }
}
