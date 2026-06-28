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
        $end = self::ts((string) Events::get($event_id, 'end_datetime', ''));
        if (! $end || $end <= $start) {
            $end = $start + 2 * HOUR_IN_SECONDS; // sensible default duration
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
            'DTSTART:' . gmdate('Ymd\THis\Z', $start),
            'DTEND:' . gmdate('Ymd\THis\Z', $end),
            'SUMMARY:' . self::esc($name),
        ];
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
        $fmt = 'F j, Y g:i A';
        $out = wp_date($fmt, $s);
        $e   = self::ts((string) Events::get($event_id, 'end_datetime', ''));
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
        $end = self::ts((string) Events::get($event_id, 'end_datetime', ''));
        if (! $end || $end <= $start) {
            $end = $start + 2 * HOUR_IN_SECONDS;
        }
        $name = (string) Events::get($event_id, 'name', '') ?: get_the_title($event_id);
        $args = [
            'action' => 'TEMPLATE',
            'text'   => $name,
            'dates'  => gmdate('Ymd\THis\Z', $start) . '/' . gmdate('Ymd\THis\Z', $end),
        ];
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
