<?php
declare(strict_types=1);

namespace OE\Hosts;

use OE\Settings;
use OE\PostTypes;
use OE\Volunteers;
use OE\Planning\Events;
use OE\Ticketing\Ics;
use OE\Mail\Transactional;
use OE\AuditLog;

defined('ABSPATH') || exit;

/**
 * Host communications — the info pack and reminders we send to the people
 * hosting an event or a tour. The copy differs by kind: a tour host gets the
 * "prepare your home / what happens on the day" pack; an event host gets the
 * "opening times / recruit your own volunteers" pack. The same PDF (per-post, or
 * the master for that kind) is attached to each send. Every send is logged in
 * Check & Log Email.
 *
 * @see docs/october-events/HOST-COMMS-SPEC.md
 */
final class HostMailer {

    /** Post meta: the occasions already sent, so reminders go once. */
    public const META_SENT = '_oe_host_sent';
    /** Post meta: a per-post PDF (attachment id) overriding the master pack. */
    public const META_PDF  = '_oe_host_pdf';

    public const OCCASIONS = ['info', 'r2w', 'r2d'];

    /* ------------------------------------------------------------------ *
     * Kind: is this an event or a tour?
     * ------------------------------------------------------------------ */

    /** 'event', 'tour', or '' when the post isn't a host-bearing type. */
    public static function kind(int $post_id): string {
        $pt = get_post_type($post_id);
        if ($pt === '') {
            return '';
        }
        if ($pt === PostTypes::slug('event')) {
            return 'event';
        }
        if ($pt === Volunteers::location_post_type()) {
            return 'tour';
        }
        return '';
    }

    /** Post types that carry host contacts (for metabox + reminder scan). */
    public static function host_post_types(): array {
        $types = [PostTypes::slug('event')];
        $tour  = Volunteers::location_post_type();
        if ($tour !== '' && ! in_array($tour, $types, true)) {
            $types[] = $tour;
        }
        return array_values(array_filter($types, 'post_type_exists'));
    }

    /* ------------------------------------------------------------------ *
     * Date — events and tours resolve it differently
     * ------------------------------------------------------------------ */

    /** Start as a unix timestamp (0 when none set). */
    public static function start_ts(int $post_id): int {
        if (self::kind($post_id) === 'tour') {
            $field = (string) Settings::get('location_date_field', '');
            $raw   = $field !== '' ? (string) get_post_meta($post_id, $field, true) : '';
            if ($raw === '') {
                return 0;
            }
            if (ctype_digit(trim($raw))) {
                $n = (int) trim($raw);
                return ($n >= 946684800 && $n <= 4102444800) ? $n : 0;
            }
            return (int) (strtotime($raw) ?: 0);
        }
        return Ics::start_ts($post_id);
    }

    /** A human date line for the email ("Saturday 3 October 2026 …"). */
    public static function date_label(int $post_id): string {
        if (self::kind($post_id) === 'tour') {
            $ts = self::start_ts($post_id);
            return $ts ? wp_date('l j F Y', $ts) : '';
        }
        return Ics::when_label($post_id);
    }

    /* ------------------------------------------------------------------ *
     * PDF pack
     * ------------------------------------------------------------------ */

    /** The PDF to attach: the per-post override, else the master for this kind. */
    public static function pdf_path(int $post_id, string $kind = ''): string {
        $kind = $kind !== '' ? $kind : self::kind($post_id);
        $id   = (int) get_post_meta($post_id, self::META_PDF, true);
        if ($id <= 0) {
            $id = (int) Settings::get($kind === 'tour' ? 'host_pack_tour_pdf' : 'host_pack_event_pdf', 0);
        }
        if ($id <= 0) {
            return '';
        }
        $path = get_attached_file($id);
        return (is_string($path) && is_readable($path)) ? $path : '';
    }

    /* ------------------------------------------------------------------ *
     * Sending
     * ------------------------------------------------------------------ */

    /**
     * Send one occasion's pack to every mailable host contact on the post.
     * Returns the number of emails sent. Marks the occasion sent on success.
     */
    public static function send(int $post_id, string $occasion = 'info'): int {
        $kind = self::kind($post_id);
        if ($kind === '' || ! in_array($occasion, self::OCCASIONS, true)) {
            return 0;
        }
        $contacts = Contacts::mailable($post_id);
        if (! $contacts) {
            return 0;
        }
        $pdf   = self::pdf_path($post_id, $kind);
        $attach = $pdf !== '' ? [$pdf] : [];

        $sent = 0;
        $subject = self::subject($post_id, $kind, $occasion); // same for every contact
        foreach ($contacts as $c) {
            $html = self::body($post_id, $kind, $occasion, $c);
            $ok = Transactional::send('host_pack', [
                'email' => $c['email'],
                'name'  => $c['name'],
            ], [], $subject, $html, $attach, true);
            if ($ok) {
                $sent++;
            }
        }
        if ($sent > 0) {
            self::mark_sent($post_id, $occasion);
            AuditLog::record('host_pack_sent', $post_id, $kind, $occasion . ':' . $sent);
        }
        return $sent;
    }

    /** Record that an occasion has been sent for this post. */
    public static function mark_sent(int $post_id, string $occasion): void {
        $done = (array) get_post_meta($post_id, self::META_SENT, true);
        $done[$occasion] = current_time('mysql');
        update_post_meta($post_id, self::META_SENT, $done);
    }

    /** Whether an occasion has already been sent for this post. */
    public static function was_sent(int $post_id, string $occasion): bool {
        $done = (array) get_post_meta($post_id, self::META_SENT, true);
        return ! empty($done[$occasion]);
    }

    /* ------------------------------------------------------------------ *
     * Reminders — scan on the hourly cron, once each
     * ------------------------------------------------------------------ */

    /**
     * Send the 2-week and 2-day reminders to host contacts whose event/tour is
     * coming up. Once per (post, occasion), only for posts that have contacts and
     * a date, and only once the info pack has gone out (reminders chase a pack the
     * host has already received).
     */
    public static function run_due_reminders(): void {
        if (! (bool) Settings::get('host_reminders_enabled', true)) {
            return;
        }
        $now = time();
        $two_weeks = 14 * DAY_IN_SECONDS;
        $two_days  = 2 * DAY_IN_SECONDS;
        $q = new \WP_Query([
            'post_type'      => self::host_post_types(),
            'post_status'    => ['publish', 'private'],
            'posts_per_page' => 500,
            'fields'         => 'ids',
            'meta_query'     => [[
                'key'     => Contacts::META,
                'compare' => 'EXISTS',
            ]],
            'no_found_rows'  => true,
        ]);
        foreach ($q->posts as $pid) {
            $pid = (int) $pid;
            if (! self::was_sent($pid, 'info')) {
                continue; // reminders only chase a pack already sent
            }
            $start = self::start_ts($pid);
            if ($start <= 0 || $start <= $now) {
                continue; // no date, or already happened
            }
            $until = $start - $now;
            // Each reminder fires once, in its own window: the 2-day reminder
            // inside the final two days, the 2-week reminder only outside that.
            // This stops both going out in one pass (e.g. when the info pack was
            // sent late) and stops a "two weeks to go" note being sent days out.
            if ($until <= $two_days) {
                if (! self::was_sent($pid, 'r2d')) {
                    self::send($pid, 'r2d');
                }
            } elseif ($until <= $two_weeks) {
                if (! self::was_sent($pid, 'r2w')) {
                    self::send($pid, 'r2w');
                }
            }
        }
    }

    /* ------------------------------------------------------------------ *
     * Copy
     * ------------------------------------------------------------------ */

    private static function title(int $post_id): string {
        return get_the_title($post_id) ?: '';
    }

    private static function staff_contact(): array {
        $name  = (string) Settings::get('host_staff_contact_name', '');
        $email = (string) (Settings::get('host_staff_contact_email', '') ?: get_option('admin_email'));
        return ['name' => $name, 'email' => $email];
    }

    public static function subject(int $post_id, string $kind, string $occasion): string {
        $title = self::title($post_id);
        if ($occasion === 'r2d') {
            return sprintf(__('Two days to go — %s', 'october-events'), $title);
        }
        if ($occasion === 'r2w') {
            return sprintf(__('Two weeks to go — %s', 'october-events'), $title);
        }
        return $kind === 'tour'
            ? sprintf(__('Your host pack for %s', 'october-events'), $title)
            : sprintf(__('Hosting %s — your info pack', 'october-events'), $title);
    }

    /**
     * The email body. Short covering note (the attached PDF holds the detail),
     * tailored to kind and occasion, addressed to the contact by name. (The role
     * is stored for future per-role targeting; the copy is the same for all.)
     *
     * @param array{name:string,email:string,phone:string,role:string,role_label:string} $contact
     */
    public static function body(int $post_id, string $kind, string $occasion, array $contact): string {
        $dark  = '#1a1a1a';
        $muted = '#666';
        $title = self::title($post_id);
        $date  = self::date_label($post_id);
        $loc   = $kind === 'event' ? (string) Events::get($post_id, 'location', '') : '';
        $staff = self::staff_contact();
        $has_pdf = self::pdf_path($post_id, $kind) !== '';

        $hi = $contact['name'] !== ''
            ? sprintf(__('Hi %s,', 'october-events'), esc_html($contact['name']))
            : __('Hi,', 'october-events');

        $out = '<p>' . $hi . '</p>';

        // Opening line by occasion.
        if ($occasion === 'r2d') {
            $out .= '<p>' . sprintf(esc_html__('%s is just two days away. A final reminder with everything you need is below, and the full pack is attached again so it is to hand.', 'october-events'), '<strong>' . esc_html($title) . '</strong>') . '</p>';
        } elseif ($occasion === 'r2w') {
            $out .= '<p>' . sprintf(esc_html__('%s is two weeks away. A quick reminder of what to expect, with the pack attached again.', 'october-events'), '<strong>' . esc_html($title) . '</strong>') . '</p>';
        } elseif ($kind === 'tour') {
            $out .= '<p>' . sprintf(esc_html__('Thank you for opening your home for %s. Here is everything you need as a host. The attached pack answers the questions we are asked most, so please keep it to hand.', 'october-events'), '<strong>' . esc_html($title) . '</strong>') . '</p>';
        } else {
            $out .= '<p>' . sprintf(esc_html__('Thank you for hosting %s. Here is everything you need, with the full pack attached.', 'october-events'), '<strong>' . esc_html($title) . '</strong>') . '</p>';
        }

        // Key facts block.
        $rows = [];
        if ($date !== '') { $rows[__('When', 'october-events')] = $date; }
        if ($loc !== '')  { $rows[__('Where', 'october-events')] = $loc; }
        if ($staff['name'] !== '' || $staff['email'] !== '') {
            $rows[__('Your contact', 'october-events')] = trim($staff['name'] . ($staff['email'] !== '' ? ' · ' . $staff['email'] : ''));
        }
        if ($rows) {
            $out .= '<table cellpadding="0" cellspacing="0" style="margin:14px 0;font-size:14px">';
            foreach ($rows as $k => $v) {
                $out .= '<tr><td style="padding:3px 14px 3px 0;color:' . $muted . '">' . esc_html((string) $k) . '</td><td style="padding:3px 0;color:' . $dark . '">' . esc_html((string) $v) . '</td></tr>';
            }
            $out .= '</table>';
        }

        // What we handle, by kind.
        if ($kind === 'tour') {
            $out .= '<p style="color:' . $dark . '">' . esc_html__('On the day: we provide the signage, and we organise and brief the volunteers who turn up to welcome guests and scan tickets. You do not need to arrange any of that.', 'october-events') . '</p>';
            $out .= '<p style="color:' . $dark . '">' . esc_html__('Before the day: the attached pack covers how to prepare your home and what to expect. If anything is unclear, reply to this email.', 'october-events') . '</p>';
        } else {
            $out .= '<p style="color:' . $dark . '">' . esc_html__('Please make sure the venue is open and ready for the times in the pack. If you are recruiting your own volunteers, the pack explains how, and we can brief them before the day.', 'october-events') . '</p>';
        }

        if (! $has_pdf) {
            // No PDF configured yet — say so plainly rather than referencing a
            // missing attachment.
            $out .= '<p style="color:' . $muted . ';font-size:13px">' . esc_html__('(The full PDF pack will follow.)', 'october-events') . '</p>';
        }

        $url = get_permalink($post_id);
        if ($url) {
            $out .= '<p style="margin-top:16px"><a href="' . esc_url($url) . '" style="color:' . $dark . '">' . esc_html__('View the listing', 'october-events') . '</a></p>';
        }
        return $out;
    }

    /** The email as it will look, for the admin preview. */
    public static function preview_html(int $post_id, string $occasion = 'info'): string {
        $kind = self::kind($post_id);
        if ($kind === '') {
            return '';
        }
        $sample = ['name' => __('Sample Host', 'october-events'), 'email' => '', 'phone' => '', 'role' => 'homeowner', 'role_label' => ''];
        $inner  = self::body($post_id, $kind, $occasion, $sample);
        return Transactional::wrap_body($inner);
    }
}
