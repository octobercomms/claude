<?php
declare(strict_types=1);

namespace OE\GuidedTours;

use OE\Mail\Transactional;

defined('ABSPATH') || exit;

/**
 * Guided-tour emails: booking confirmation, waitlist notice, waitlist promotion,
 * and the 48-hour reconfirm-or-release. Each email's subject + body is produced
 * by a build_* method that both the live send and the admin preview share, so a
 * preview is exactly what recipients get. Bodies are wrapped in the plugin's
 * brand chrome by Transactional.
 */
final class Mailer {

    /** Confirmation on reserve (or a waitlist notice when the slot was full). */
    public static function reserved(int $location_id, string $slot_uid, string $email, string $name, bool $waitlisted, string $token = ''): void {
        $b = self::build_reserved($location_id, $slot_uid, $name, $waitlisted, $token);
        Transactional::send('gt_reserved', ['email' => $email, 'name' => $name], [], $b['subject'], $b['html']);
    }

    /** A waitlisted person has been promoted into a real spot. */
    public static function promoted(int $location_id, string $slot_uid, string $email, string $name): void {
        $b = self::build_promoted($location_id, $slot_uid, $name);
        Transactional::send('gt_promoted', ['email' => $email, 'name' => $name], [], $b['subject'], $b['html']);
    }

    /** 48-hour reconfirm-or-release, with one-click links. */
    public static function reconfirm(object $row): void {
        $b = self::build_reconfirm($row);
        Transactional::send('gt_reconfirm', ['email' => (string) $row->email, 'name' => (string) $row->name], [], $b['subject'], $b['html']);
    }

    /**
     * Render an email with sample data for the admin preview, wrapped in the same
     * brand shell recipients see, with the subject shown above it. $type is one of
     * reserved | waitlist | promoted | reconfirm.
     */
    public static function preview(string $type): string {
        $loc = 0;
        $uid = '';
        $locs = Slots::locations_with_slots();
        if ($locs) {
            $loc   = (int) $locs[0];
            $slots = Slots::all($loc);
            $uid   = $slots ? (string) $slots[0]['uid'] : '';
        }
        $name  = 'Alex Taylor';
        $token = 'preview';

        switch ($type) {
            case 'waitlist':
                $b = self::build_reserved($loc, $uid, $name, true, $token);
                break;
            case 'promoted':
                $b = self::build_promoted($loc, $uid, $name);
                break;
            case 'reconfirm':
                $b = self::build_reconfirm((object) [
                    'location_id' => $loc, 'slot_uid' => $uid, 'token' => $token,
                    'email' => 'alex@example.com', 'name' => $name,
                ]);
                break;
            case 'reserved':
            default:
                $b = self::build_reserved($loc, $uid, $name, false, $token);
                break;
        }

        $bar = '<div style="font:600 13px -apple-system,system-ui,sans-serif;color:#555;padding:12px 16px;background:#f4f2ee;border-bottom:1px solid #e3ddd2">'
            . esc_html__('Subject', 'october-events') . ': ' . esc_html($b['subject']) . '</div>';
        return '<!doctype html><html><head><meta charset="utf-8"><title>' . esc_html($b['subject']) . '</title></head><body style="margin:0">'
            . $bar . Transactional::wrap_body($b['html']) . '</body></html>';
    }

    /* ---- body builders (shared by send + preview) ---- */

    /** @return array{subject:string,html:string} */
    private static function build_reserved(int $location_id, string $slot_uid, string $name, bool $waitlisted, string $token): array {
        $when    = self::when($location_id, $slot_uid);
        $bld     = self::building($location_id);
        $release = $token !== '' ? add_query_arg(['oe_gt' => 'release', 'token' => $token], home_url('/')) : '';
        if ($waitlisted) {
            $subject = __('You’re on the waitlist', 'october-events');
            $html    = self::p(sprintf(__('Thanks %s. %s on %s is full, so you’re on the waitlist. If a spot frees up we’ll email you straight away.', 'october-events'),
                self::name($name), esc_html($bld), esc_html($when)));
            if ($release !== '') {
                $html .= self::p(sprintf(__('Changed your mind? %s.', 'october-events'),
                    '<a href="' . esc_url($release) . '" style="color:#b23b2a;font-weight:600">' . esc_html__('Leave the waitlist', 'october-events') . '</a>'));
            }
        } else {
            $subject = __('Your guided tour spot is booked', 'october-events');
            $html    = self::p(sprintf(__('You’re booked for %s on %s. Please arrive a few minutes early.', 'october-events'),
                '<strong>' . esc_html($bld) . '</strong>', '<strong>' . esc_html($when) . '</strong>'))
                . self::details($location_id);
            if ($release !== '') {
                $html .= self::p(sprintf(__('Can’t make it? Please %s so someone on the waitlist can take it. We’ll also email you 48 hours before to confirm.', 'october-events'),
                    '<a href="' . esc_url($release) . '" style="color:#b23b2a;font-weight:600">' . esc_html__('release your spot', 'october-events') . '</a>'));
            } else {
                $html .= self::p(__('We’ll email you 48 hours before to confirm. If you can’t make it, please release your spot so someone on the waitlist can take it.', 'october-events'));
            }
        }
        return ['subject' => $subject, 'html' => $html];
    }

    /** @return array{subject:string,html:string} */
    private static function build_promoted(int $location_id, string $slot_uid, string $name): array {
        $when = self::when($location_id, $slot_uid);
        $bld  = self::building($location_id);
        return [
            'subject' => __('A spot opened up — you’re in', 'october-events'),
            'html'    => self::p(sprintf(__('Good news %s, a spot opened for %s on %s and it’s yours. See you there.', 'october-events'),
                    self::name($name), '<strong>' . esc_html($bld) . '</strong>', '<strong>' . esc_html($when) . '</strong>'))
                . self::details($location_id),
        ];
    }

    /** @return array{subject:string,html:string} */
    private static function build_reconfirm(object $row): array {
        $location_id = (int) $row->location_id;
        $when    = self::when($location_id, (string) $row->slot_uid);
        $bld     = self::building($location_id);
        $confirm = add_query_arg(['oe_gt' => 'confirm', 'token' => (string) $row->token], home_url('/'));
        $release = add_query_arg(['oe_gt' => 'release', 'token' => (string) $row->token], home_url('/'));
        return [
            'subject' => __('Please confirm your guided tour spot', 'october-events'),
            'html'    => self::p(sprintf(__('Your guided tour of %s is on %s. Can you still make it?', 'october-events'),
                    '<strong>' . esc_html($bld) . '</strong>', '<strong>' . esc_html($when) . '</strong>'))
                . '<p style="margin:18px 0">'
                . '<a href="' . esc_url($confirm) . '" style="background:#111;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:8px;display:inline-block;margin-right:8px">' . esc_html__('Yes, I’m coming', 'october-events') . '</a>'
                . '<a href="' . esc_url($release) . '" style="color:#b23b2a;text-decoration:underline;font-weight:600;padding:11px 4px;display:inline-block">' . esc_html__('Release my spot', 'october-events') . '</a>'
                . '</p>'
                . self::p(__('If we don’t hear from you, we may release your spot to the waitlist.', 'october-events')),
        ];
    }

    /* ---- helpers ---- */

    private static function building(int $location_id): string {
        return $location_id ? (get_the_title($location_id) ?: __('the building', 'october-events')) : __('the building', 'october-events');
    }

    /**
     * Address, Google Maps link and project-page link for a building, read from
     * the Location's own fields. Each part is included only when present, so a
     * building missing a field just omits that line.
     */
    private static function details(int $location_id): string {
        if (! $location_id) {
            return '';
        }
        $out     = '';
        $address = trim((string) get_post_meta($location_id, 'address', true));
        if ($address !== '') {
            $out .= self::p('<strong>' . esc_html__('Address', 'october-events') . ':</strong> ' . esc_html($address));
        }

        $links = [];
        $map = trim((string) get_post_meta($location_id, 'google_maps', true));
        if ($map !== '' && filter_var($map, FILTER_VALIDATE_URL)) {
            $links[] = '<a href="' . esc_url($map) . '" style="color:#111;font-weight:600">' . esc_html__('Open in Google Maps', 'october-events') . '</a>';
        }
        $page = $location_id ? get_permalink($location_id) : '';
        if ($page) {
            $links[] = '<a href="' . esc_url($page) . '" style="color:#111;font-weight:600">' . esc_html__('See the building', 'october-events') . '</a>';
        }
        if ($links) {
            $out .= self::p(implode(' &nbsp;·&nbsp; ', $links));
        }
        return $out;
    }

    private static function when(int $location_id, string $slot_uid): string {
        $ts = $location_id && $slot_uid !== '' ? Slots::start_ts($location_id, $slot_uid) : 0;
        return $ts ? wp_date('l F j, g:i A', $ts) : __('the tour date', 'october-events');
    }

    private static function name(string $name): string {
        $name = trim($name);
        return $name !== '' ? esc_html($name) : esc_html__('there', 'october-events');
    }

    private static function p(string $inner): string {
        return '<p style="margin:0 0 12px;font-size:15px;line-height:1.5">' . $inner . '</p>';
    }
}
