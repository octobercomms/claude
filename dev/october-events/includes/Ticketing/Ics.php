<?php
declare(strict_types=1);

namespace OE\Ticketing;

use OE\Planning\Events;

defined('ABSPATH') || exit;

/**
 * Builds an iCalendar (.ics) invite for a ticketed event, so the confirmation
 * email carries an "add to calendar" file that every calendar app understands.
 *
 * Times come from the planning layer (`start_datetime` / `end_datetime`, with
 * the JetEngine field-map fallback), interpreted in the site timezone and
 * emitted as UTC. If an event has no parseable start, no invite is produced —
 * the email still sends, just without the attachment.
 */
final class Ics {

    /** Build the .ics text for an event, or '' if it has no usable date. */
    public static function for_event(int $event_id): string {
        $start = self::ts((string) Events::get($event_id, 'start_datetime', ''));
        if (! $start) {
            return '';
        }
        $endRaw = self::ts((string) Events::get($event_id, 'end_datetime', ''));
        $rrule  = '';
        $model  = self::daily_model($event_id, $start, $endRaw);
        if ($model && $model['start']) {
            // Date-only with daily hours: a timed occurrence, repeated per day for
            // a multi-day tour (RRULE), so calendars show 10am–4pm on each day and
            // never one continuous overnight block.
            $es      = $model['start'];
            $ee      = $model['end'] ?: ($es + 2 * HOUR_IN_SECONDS);
            $dtstart = 'DTSTART:' . gmdate('Ymd\THis\Z', $es);
            $dtend   = 'DTEND:' . gmdate('Ymd\THis\Z', $ee);
            if ($model['days'] > 1) {
                $rrule = 'RRULE:FREQ=DAILY;COUNT=' . $model['days'];
            }
        } elseif (self::is_all_day($start, $endRaw)) {
            // Date-only, no hours → an all-day entry rather than a midnight → +2h slot.
            $lastDay = ($endRaw && $endRaw > $start) ? $endRaw : $start;
            $dtstart = 'DTSTART;VALUE=DATE:' . wp_date('Ymd', $start);
            $dtend   = 'DTEND;VALUE=DATE:' . wp_date('Ymd', $lastDay + DAY_IN_SECONDS);
        } else {
            $end     = (! $endRaw || $endRaw <= $start) ? $start + 2 * HOUR_IN_SECONDS : $endRaw;
            $dtstart = 'DTSTART:' . gmdate('Ymd\THis\Z', $start);
            $dtend   = 'DTEND:' . gmdate('Ymd\THis\Z', $end);
        }
        $name     = (string) Events::get($event_id, 'name', '') ?: get_the_title($event_id);
        $location = (string) Events::get($event_id, 'location', '');
        $desc     = (string) Events::get($event_id, 'description', '');
        $url      = (string) get_permalink($event_id);
        $host     = (string) wp_parse_url(home_url(), PHP_URL_HOST);
        $uid      = 'oe-event-' . $event_id . '@' . $host;

        $lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//October Events//Ticketing//EN',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            'BEGIN:VEVENT',
            'UID:' . $uid,
            'DTSTAMP:' . gmdate('Ymd\THis\Z'),
            $dtstart,
            $dtend,
            'SUMMARY:' . self::esc($name),
        ];
        if ($rrule !== '') {
            $lines[] = $rrule;
        }
        if ($location !== '') {
            $lines[] = 'LOCATION:' . self::esc($location);
        }
        if ($desc !== '') {
            $lines[] = 'DESCRIPTION:' . self::esc(wp_strip_all_tags($desc));
        }
        if ($url !== '') {
            $lines[] = 'URL:' . self::esc($url);
        }
        $lines[] = 'END:VEVENT';
        $lines[] = 'END:VCALENDAR';

        // iCalendar requires CRLF line endings.
        return implode("\r\n", $lines) . "\r\n";
    }

    /**
     * Write the invite to a uniquely-named temp file with a friendly basename
     * (used as the email attachment filename), or '' if there's no date. The
     * caller is responsible for deleting it after sending — see self::cleanup().
     */
    public static function tempfile(int $event_id): string {
        $ics = self::for_event($event_id);
        if ($ics === '') {
            return '';
        }
        $name = (string) Events::get($event_id, 'name', '') ?: get_the_title($event_id);
        $base = sanitize_file_name($name !== '' ? $name : 'event');
        if ($base === '') {
            $base = 'event';
        }
        // A unique subdir lets us keep the human-friendly "<Event>.ics" basename.
        $dir = trailingslashit(get_temp_dir()) . 'oe-ics-' . wp_generate_password(8, false);
        if (! wp_mkdir_p($dir)) {
            return '';
        }
        $path = trailingslashit($dir) . $base . '.ics';
        if (false === file_put_contents($path, $ics)) {
            return '';
        }
        return $path;
    }

    /** Remove a temp file produced by self::tempfile() and its parent dir. */
    public static function cleanup(string $path): void {
        if ($path === '' || ! is_file($path)) {
            return;
        }
        $dir = dirname($path);
        @unlink($path);
        if (strpos(basename($dir), 'oe-ics-') === 0) {
            @rmdir($dir);
        }
    }

    /** The event's start as a UTC timestamp (0 if it has no parseable date). */
    public static function start_ts(int $event_id): int {
        return self::ts((string) Events::get($event_id, 'start_datetime', ''));
    }

    /**
     * Human "when" line for an event, e.g. "September 28, 2025 10:00 AM –
     * October 5, 2025 4:00 PM". Falls back to the raw start value if unparseable,
     * '' if there's none.
     */
    public static function when_label(int $event_id): string {
        $raw = (string) Events::get($event_id, 'start_datetime', '');
        $s = self::ts($raw);
        if (! $s) {
            return $raw;
        }
        $e = self::ts((string) Events::get($event_id, 'end_datetime', ''));
        // No time set (midnight) → show the date without a misleading "12:00 AM".
        if (self::is_all_day($s, $e)) {
            $model = self::daily_model($event_id, $s, $e);
            // Date-only, but daily hours are set: "October 3 – 4, 2026 · 10:00 AM – 4:00 PM daily".
            if ($model && $model['start']) {
                $out = ($model['days'] > 1 && $e)
                    ? wp_date('F j', $s) . ' – ' . wp_date('F j, Y', $e)
                    : wp_date('F j, Y', $s);
                $out .= ' · ' . wp_date('g:i A', $model['start']);
                if ($model['end']) {
                    $out .= ' – ' . wp_date('g:i A', $model['end']);
                }
                if ($model['days'] > 1) {
                    $out .= ' ' . __('daily', 'october-events');
                }
                return $out;
            }
            $out = wp_date('F j, Y', $s);
            if ($e && $e > $s && wp_date('Y-m-d', $e) !== wp_date('Y-m-d', $s)) {
                $out .= ' – ' . wp_date('F j, Y', $e);
            }
            return $out;
        }
        $fmt = 'F j, Y g:i A';
        $out = wp_date($fmt, $s);
        if ($e && $e > $s) {
            $out .= ' – ' . wp_date($fmt, $e);
        }
        return $out;
    }

    /**
     * Concise start-date label for an event, e.g. "March 14, 2026" (date only,
     * no time). Used in the ticket email subject. '' if there's no date.
     */
    public static function date_label(int $event_id): string {
        $s = self::start_ts($event_id);
        return $s ? wp_date('F j, Y', $s) : '';
    }

    /**
     * A Google Calendar "add event" template URL — a clickable alternative to
     * the .ics attachment in the ticket email (webmail clients honour it even
     * when they hide attachments). '' if the event has no parseable start.
     */
    public static function gcal_url(int $event_id): string {
        $start = self::ts((string) Events::get($event_id, 'start_datetime', ''));
        if (! $start) {
            return '';
        }
        $end   = self::ts((string) Events::get($event_id, 'end_datetime', ''));
        $recur = '';
        $model = self::daily_model($event_id, $start, $end);
        if ($model && $model['start']) {
            // Date-only with daily hours → a timed entry, repeated per day for a
            // multi-day tour (so it's not one continuous overnight block).
            $gs    = $model['start'];
            $ge    = $model['end'] ?: ($gs + 2 * HOUR_IN_SECONDS);
            $dates = gmdate('Ymd\THis\Z', $gs) . '/' . gmdate('Ymd\THis\Z', $ge);
            if ($model['days'] > 1) {
                $recur = 'RRULE:FREQ=DAILY;COUNT=' . $model['days'];
            }
        } elseif (self::is_all_day($start, $end)) {
            // Date-only, no hours → an all-day entry (YYYYMMDD range, end exclusive).
            $lastDay = ($end && $end > $start) ? $end : $start;
            $dates   = wp_date('Ymd', $start) . '/' . wp_date('Ymd', $lastDay + DAY_IN_SECONDS);
        } else {
            if (! $end || $end <= $start) {
                $end = $start + 2 * HOUR_IN_SECONDS;
            }
            $dates = gmdate('Ymd\THis\Z', $start) . '/' . gmdate('Ymd\THis\Z', $end);
        }
        $name = (string) Events::get($event_id, 'name', '') ?: get_the_title($event_id);
        $args = [
            'action' => 'TEMPLATE',
            'text'   => $name,
            'dates'  => $dates,
        ];
        if ($recur !== '') {
            $args['recur'] = $recur;
        }
        $loc = (string) Events::get($event_id, 'location', '');
        if ($loc !== '') {
            $args['location'] = $loc;
        }
        $desc = wp_strip_all_tags((string) Events::get($event_id, 'description', ''));
        if ($desc !== '') {
            $args['details'] = $desc;
        }
        // add_query_arg URL-encodes the values for us.
        return add_query_arg($args, 'https://calendar.google.com/calendar/render');
    }

    /**
     * True when an event carries no real time-of-day and should be treated as
     * all-day: the start falls on local midnight and the end (if any) does too.
     * This is how a date-only value (no time entered) reaches us — as midnight —
     * so we render the date without "12:00 AM" and emit an all-day invite rather
     * than a misleading midnight → +2h slot. A genuinely timed event whose end is
     * a real clock time (e.g. 2:00 AM) is left as a timed event.
     */
    private static function is_all_day(int $start, int $end): bool {
        if (! $start || wp_date('H:i:s', $start) !== '00:00:00') {
            return false;
        }
        if ($end && $end > $start && wp_date('H:i:s', $end) !== '00:00:00') {
            return false;
        }
        return true;
    }

    /**
     * Daily-hours model for a date-only event that runs set hours each day, e.g.
     * a two-day tour 10am–4pm on both days (which a single continuous start→end
     * datetime cannot represent). Returns null unless the event is date-only AND
     * a daily start time is mapped/set. Otherwise:
     *   ['start' => first-day start epoch, 'end' => first-day end epoch (0 if none),
     *    'days'  => number of calendar days the hours repeat over]
     * The calendar layers turn 'days' > 1 into an RRULE:FREQ=DAILY;COUNT so each
     * day gets its own timed occurrence rather than one long block.
     *
     * @param int $start Parsed start-date epoch. @param int $end Parsed end-date epoch (0 if none).
     * @return array{start:int,end:int,days:int}|null
     */
    private static function daily_model(int $event_id, int $start, int $end): ?array {
        if (! self::is_all_day($start, $end)) {
            return null;
        }
        $sSecs = self::time_to_seconds((string) Events::get($event_id, 'start_time', ''));
        if ($sSecs === null) {
            return null;
        }
        $eSecs   = self::time_to_seconds((string) Events::get($event_id, 'end_time', ''));
        $dayStr  = wp_date('Y-m-d', $start);
        $first_s = self::ts($dayStr . ' ' . self::secs_hhmm($sSecs));
        $first_e = ($eSecs !== null && $eSecs > $sSecs) ? self::ts($dayStr . ' ' . self::secs_hhmm($eSecs)) : 0;
        $days    = ($end && $end > $start) ? self::day_count($start, $end) : 1;
        return ['start' => $first_s, 'end' => $first_e, 'days' => max(1, $days)];
    }

    /** Inclusive number of calendar days (site timezone) from one epoch to another. */
    private static function day_count(int $start, int $end): int {
        try {
            $tz = wp_timezone();
            $a  = (new \DateTime('@' . $start))->setTimezone($tz)->setTime(0, 0);
            $b  = (new \DateTime('@' . $end))->setTimezone($tz)->setTime(0, 0);
            return (int) $a->diff($b)->days + 1;
        } catch (\Exception $e) {
            return 1;
        }
    }

    /** Parse a time-of-day (e.g. "10:00 am", "16:00", or seconds-since-midnight) to seconds, or null. */
    private static function time_to_seconds(string $val): ?int {
        $val = trim($val);
        if ($val === '') {
            return null;
        }
        if (ctype_digit($val)) {
            $n = (int) $val;
            if ($n >= 0 && $n < DAY_IN_SECONDS) {
                return $n; // JetEngine time fields store seconds since midnight
            }
            return ((int) wp_date('G', $n)) * 3600 + ((int) wp_date('i', $n)) * 60; // a full epoch → its local time-of-day
        }
        // Parse the wall-clock time-of-day directly, with no timezone in play
        // (strtotime + gmdate would shift it by the site's UTC offset).
        $p = date_parse($val);
        if (! empty($p['error_count']) || ! is_int($p['hour'] ?? null)) {
            return null;
        }
        return $p['hour'] * 3600 + (int) ($p['minute'] ?: 0) * 60;
    }

    /** Seconds-since-midnight → "HH:MM" (24h) for recombining with a date. */
    private static function secs_hhmm(int $secs): string {
        return sprintf('%02d:%02d', intdiv($secs, 3600), intdiv($secs % 3600, 60));
    }

    /** Parse a local datetime string (site timezone) to a UTC timestamp, 0 if unparseable. */
    private static function ts(string $val): int {
        $val = trim($val);
        if ($val === '') {
            return 0;
        }
        // A bare Unix epoch (some events store start/end as a numeric timestamp,
        // optionally @-prefixed). DateTime/strtotime can't parse those, so handle
        // them first: 13-digit values are JavaScript milliseconds.
        if ($val[0] === '@' && ctype_digit(substr($val, 1))) {
            return (int) substr($val, 1);
        }
        if (ctype_digit($val)) {
            return strlen($val) >= 13 ? (int) ((int) $val / 1000) : (int) $val;
        }
        try {
            $d = new \DateTime($val, wp_timezone());
            return $d->getTimestamp();
        } catch (\Exception $e) {
            $t = strtotime($val);
            return $t ?: 0;
        }
    }

    /** Escape a value for an iCalendar text field. */
    private static function esc(string $s): string {
        $s = str_replace(["\\", "\n", "\r"], ["\\\\", "\\n", ''], $s);
        return str_replace([';', ','], ['\\;', '\\,'], $s);
    }
}
