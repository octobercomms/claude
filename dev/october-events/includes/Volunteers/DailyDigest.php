<?php
declare(strict_types=1);

namespace OE\Volunteers;

use OE\Settings;
use OE\AuditLog;
use OE\VolunteerSignups;
use OE\Volunteers;
use OE\Mail\Transactional;

defined('ABSPATH') || exit;

/**
 * Daily volunteer roster email (§ops).
 *
 * Each morning, one email to the coordinators listing every volunteer shift
 * happening TODAY, with each assigned volunteer's name, email and phone, so a
 * no-show can be chased. Fires from the hourly cron and self-gates to send once
 * per day, at or after the configured hour (site local time). Days with no
 * shifts send nothing.
 */
final class DailyDigest {

    /** Once-per-day lock option prefix (autoload = no). */
    private const LOCK_PREFIX = 'oe_vol_digest_sent_';

    /** Wire the admin preview / send-now actions (called from Plugin::init). */
    public static function register(): void {
        add_action('admin_post_oe_vol_digest_preview', [self::class, 'handle_preview']);
        add_action('admin_post_oe_vol_digest_send', [self::class, 'handle_send_now']);
    }

    /** Admin: render today's roster in the browser, styled like the email. */
    public static function handle_preview(): void {
        if (! current_user_can('manage_options') || ! check_admin_referer('oe_vol_digest')) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        $date = wp_date('Y-m-d');
        $rows = VolunteerSignups::due_between($date . ' 00:00:00', $date . ' 23:59:59');
        $inner = $rows
            ? self::build_html($rows, $date)
            : '<h2 style="font-size:20px;color:#1a1a1a">' . esc_html__('Today’s volunteer roster', 'october-events') . '</h2>'
                . '<p style="color:#666">' . esc_html__('No volunteer shifts are scheduled for today, so no roster would send. Shifts appear here from the start time set on each shift.', 'october-events') . '</p>';
        // phpcs:ignore WordPress.Security.EscapeOutput -- built from esc_html/esc_url above and wrapped chrome
        echo Transactional::wrap_body($inner);
        exit;
    }

    /** Admin: send the roster to the configured recipients right now (a test). */
    public static function handle_send_now(): void {
        if (! current_user_can('manage_options') || ! check_admin_referer('oe_vol_digest')) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        $date = wp_date('Y-m-d');
        $rows = VolunteerSignups::due_between($date . ' 00:00:00', $date . ' 23:59:59');
        $sent = $rows ? self::send($rows, $date) : 0;
        wp_safe_redirect(add_query_arg(
            ['page' => 'oe-settings', 'oe_vol_digest_sent' => $sent],
            admin_url('admin.php')
        ) . '#volunteer-digest');
        exit;
    }

    /**
     * Called every hour by {@see \OE\Cron::run_hourly}. Sends the roster once,
     * on the first tick at or after the configured hour, on days that have
     * shifts. Returns the number of recipients emailed (0 when nothing sent).
     */
    public static function run_due(): int {
        if (! (bool) Settings::get('volunteer_digest_enabled', false)) {
            return 0;
        }
        // Site-local hour/date. Use wp_date() with no timestamp — passing
        // current_time('timestamp') (already offset) would apply the site offset
        // a second time, firing at the wrong hour (and wrong day for +offset zones).
        $hour = (int) wp_date('G');
        $send_hour = max(0, min(23, (int) Settings::get('volunteer_digest_hour', 6)));
        if ($hour < $send_hour) {
            return 0; // too early today
        }

        $date  = wp_date('Y-m-d');
        $rows  = VolunteerSignups::due_between($date . ' 00:00:00', $date . ' 23:59:59');
        if (! $rows) {
            return 0; // no shifts today — don't claim the lock, don't email
        }

        // Claim the day's lock atomically: the first caller wins, any concurrent
        // or later tick today gets false and stops. Prevents a double-send.
        if (! add_option(self::LOCK_PREFIX . $date, current_time('mysql'), '', 'no')) {
            return 0;
        }
        self::prune_locks($date); // keep wp_options tidy — drop earlier days' locks

        $sent = self::send($rows, $date);
        if ($sent === 0) {
            // Nothing actually went out (no valid recipient, or every send failed)
            // — release today's lock so a later tick can retry it.
            delete_option(self::LOCK_PREFIX . $date);
        }
        return $sent;
    }

    /**
     * Delete stale day-locks so wp_options doesn't grow by one row per send-day
     * forever. Keeps only today's. Runs at most once a day (behind the lock).
     */
    private static function prune_locks(string $keep_date): void {
        global $wpdb;
        $wpdb->query($wpdb->prepare(
            "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s AND option_name <> %s",
            $wpdb->esc_like(self::LOCK_PREFIX) . '%',
            self::LOCK_PREFIX . $keep_date
        ));
    }

    /**
     * Build and send the roster for the given signups. Public so an admin
     * "send now / preview" action can reuse it.
     *
     * @param array<int,object> $rows
     */
    public static function send(array $rows, string $date): int {
        $recipients = self::recipients();
        if (! $recipients) {
            return 0;
        }
        $html    = self::build_html($rows, $date);
        $subject = sprintf(
            /* translators: %s: date, e.g. Saturday 3 October */
            __('Volunteer roster — %s', 'october-events'),
            wp_date('l j F', (int) strtotime($date . ' 12:00:00'))
        );

        $sent = 0;
        foreach ($recipients as $email) {
            if (Transactional::send('volunteer_digest', ['email' => $email], [], $subject, $html)) {
                $sent++;
            }
        }
        AuditLog::record('volunteer_digest_sent', 0, 'volunteer', (string) $sent);
        return $sent;
    }

    /**
     * The coordinator addresses. Configured list first; the site admin address
     * as a fallback so the feature is never silently sending to nobody.
     *
     * @return string[]
     */
    private static function recipients(): array {
        $raw = (string) Settings::get('volunteer_digest_emails', '');
        $out = [];
        foreach (preg_split('/[\r\n,]+/', $raw) ?: [] as $part) {
            $email = sanitize_email(trim($part));
            if ($email !== '' && is_email($email)) {
                $out[strtolower($email)] = $email;
            }
        }
        if (! $out) {
            $admin = sanitize_email((string) get_option('admin_email'));
            if ($admin !== '' && is_email($admin)) {
                $out[strtolower($admin)] = $admin;
            }
        }
        return array_values($out);
    }

    /**
     * Render the roster HTML: one block per opportunity, a sub-heading per shift,
     * and a table of volunteers (name, email, phone) under each. Ends with a
     * button to the Volunteers dashboard.
     *
     * @param array<int,object> $rows
     */
    public static function build_html(array $rows, string $date): string {
        $dark   = '#1a1a1a';
        $muted  = '#666';
        $border = '#e2e2e2';

        // Group rows by opportunity, then by shift.
        $ops = [];
        foreach ($rows as $r) {
            $oid = (int) $r->opportunity_id;
            $sid = (string) $r->shift_id;
            if (! isset($ops[$oid])) {
                $ops[$oid] = [
                    'title'    => get_the_title($oid) ?: __('Volunteer opportunity', 'october-events'),
                    'role'     => (string) get_post_meta($oid, '_oe_role', true),
                    'location' => Volunteers::location($oid),
                    'shifts'   => [],
                ];
            }
            if (! isset($ops[$oid]['shifts'][$sid])) {
                $shift = Volunteers::shift($oid, $sid);
                $ops[$oid]['shifts'][$sid] = [
                    'when'   => self::shift_when(is_array($shift) ? $shift : [], (string) $r->shift_start),
                    'sort'   => (string) $r->shift_start,
                    'people' => [],
                ];
            }
            $ops[$oid]['shifts'][$sid]['people'][] = $r;
        }

        // Sort opportunities by their earliest shift, shifts by start, people by name.
        foreach ($ops as &$op) {
            uasort($op['shifts'], static fn($a, $b): int => strcmp((string) $a['sort'], (string) $b['sort']));
            foreach ($op['shifts'] as &$sh) {
                usort($sh['people'], static fn($a, $b): int => strcasecmp((string) $a->name, (string) $b->name));
            }
            unset($sh);
        }
        unset($op);
        uasort($ops, static function ($a, $b): int {
            $sa = $a['shifts'] ? reset($a['shifts'])['sort'] : '';
            $sb = $b['shifts'] ? reset($b['shifts'])['sort'] : '';
            return strcmp((string) $sa, (string) $sb);
        });

        $people_total = count($rows);
        $when_label   = wp_date('l j F Y', (int) strtotime($date . ' 12:00:00'));

        // Pluralise each count independently — a single _n() keyed on the people
        // count would mis-pluralise the opportunity count (e.g. "1 opportunities").
        $ops_count  = count($ops);
        $people_txt = sprintf(_n('%d volunteer', '%d volunteers', $people_total, 'october-events'), $people_total);
        $ops_txt    = sprintf(_n('%d opportunity', '%d opportunities', $ops_count, 'october-events'), $ops_count);

        $out  = '<h2 style="margin:0 0 4px;font-size:20px;color:' . $dark . '">' . esc_html__('Today’s volunteer roster', 'october-events') . '</h2>';
        $out .= '<p style="margin:0 0 18px;color:' . $muted . ';font-size:14px">' . esc_html($when_label) . ' · '
            /* translators: 1: e.g. "3 volunteers", 2: e.g. "2 opportunities" */
            . esc_html(sprintf(__('%1$s across %2$s', 'october-events'), $people_txt, $ops_txt)) . '</p>';

        foreach ($ops as $op) {
            $meta = array_filter([$op['role'], $op['location']]);
            $out .= '<div style="margin:0 0 22px">';
            $out .= '<div style="font-size:16px;font-weight:bold;color:' . $dark . '">' . esc_html((string) $op['title']) . '</div>';
            if ($meta) {
                $out .= '<div style="color:' . $muted . ';font-size:13px;margin-bottom:8px">' . esc_html(implode(' · ', $meta)) . '</div>';
            }
            foreach ($op['shifts'] as $sh) {
                $out .= '<div style="font-weight:bold;font-size:14px;color:' . $dark . ';margin:10px 0 4px">' . esc_html((string) $sh['when']) . '</div>';
                $out .= '<table cellpadding="6" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;font-size:13px">';
                $out .= '<tr style="color:' . $muted . ';text-align:left">'
                    . '<th style="border-bottom:1px solid ' . $border . ';padding:6px 8px">' . esc_html__('Name', 'october-events') . '</th>'
                    . '<th style="border-bottom:1px solid ' . $border . ';padding:6px 8px">' . esc_html__('Email', 'october-events') . '</th>'
                    . '<th style="border-bottom:1px solid ' . $border . ';padding:6px 8px">' . esc_html__('Phone / SMS', 'october-events') . '</th>'
                    . '<th style="border-bottom:1px solid ' . $border . ';padding:6px 8px">' . esc_html__('Status', 'october-events') . '</th></tr>';
                foreach ($sh['people'] as $p) {
                    $phone = trim((string) $p->phone);
                    $phone_cell = $phone !== ''
                        ? '<a href="tel:' . esc_attr(preg_replace('/[^0-9+]/', '', $phone)) . '" style="color:' . $dark . ';text-decoration:none">' . esc_html($phone) . '</a>'
                            . ((int) $p->sms_opt_in === 1 ? ' <span style="color:' . $muted . ';font-size:11px">' . esc_html__('(SMS ok)', 'october-events') . '</span>' : '')
                        : '<span style="color:#aaa">' . esc_html__('none', 'october-events') . '</span>';
                    $status = (int) $p->checked_in === 1
                        ? esc_html__('checked in', 'october-events')
                        : ((string) $p->status === VolunteerSignups::STATUS_CONFIRMED
                            ? esc_html__('confirmed', 'october-events')
                            : esc_html__('signed up', 'october-events'));
                    $out .= '<tr>'
                        . '<td style="border-bottom:1px solid ' . $border . ';padding:6px 8px;color:' . $dark . '">' . esc_html((string) $p->name) . '</td>'
                        . '<td style="border-bottom:1px solid ' . $border . ';padding:6px 8px"><a href="mailto:' . esc_attr((string) $p->email) . '" style="color:' . $dark . ';text-decoration:none">' . esc_html((string) $p->email) . '</a></td>'
                        . '<td style="border-bottom:1px solid ' . $border . ';padding:6px 8px">' . $phone_cell . '</td>'
                        . '<td style="border-bottom:1px solid ' . $border . ';padding:6px 8px;color:' . $muted . '">' . $status . '</td>'
                        . '</tr>';
                }
                $out .= '</table>';
            }
            $out .= '</div>';
        }

        $dash = admin_url('admin.php?page=oe-volunteers');
        $out .= '<p style="margin:24px 0 0">'
            . '<a href="' . esc_url($dash) . '" style="display:inline-block;background:' . $dark . ';color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:14px">'
            . esc_html__('Open the Volunteers dashboard', 'october-events') . '</a></p>';
        $out .= '<p style="margin:10px 0 0;color:' . $muted . ';font-size:12px">' . esc_html__('Shifts appear here from the time set on each shift. A volunteer with no phone number gave none at signup.', 'october-events') . '</p>';

        return $out;
    }

    /**
     * A human "when" line for a shift: its own label if set, else a formatted
     * start–end from the shift, else the signup's stored start.
     *
     * @param array<string,mixed> $shift
     */
    private static function shift_when(array $shift, string $fallback_start): string {
        $label = trim((string) ($shift['label'] ?? ''));
        if ($label !== '') {
            return $label;
        }
        $start = trim((string) ($shift['start'] ?? $fallback_start));
        $end   = trim((string) ($shift['end'] ?? ''));
        $sts   = $start !== '' ? strtotime($start) : 0;
        if (! $sts) {
            return __('Shift', 'october-events');
        }
        $out = date('D j M, g:i A', $sts);
        $ets = $end !== '' ? strtotime($end) : 0;
        if ($ets && $ets > $sts) {
            $out .= ' – ' . date('g:i A', $ets);
        }
        return $out;
    }
}
