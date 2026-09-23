<?php
declare(strict_types=1);

namespace OE\GuidedTours;

use OE\Ticketing\Schema;

// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table names are code constants, values are always bound.

defined('ABSPATH') || exit;

/**
 * Guided-tour release schedule: a tour (city + year) can be set to open for
 * booking at a future date. Before then the booking page shows a countdown and
 * every booking action is refused; when the date passes an hourly job opens it
 * and emails everyone holding a ticket for that tour's event, once.
 *
 * Config is a per-tour-key option (not the settings blob), each row:
 *   city, year, event_id, release_at (UTC unix), booking_url, notified_at,
 *   notified_cursor. A tour with no row here is simply always open.
 */
final class Releases {

    private const OPTION = 'oe_gt_releases';
    private const BATCH  = 400; // announcement emails per hourly run

    /** @return array<string,array<string,mixed>> tour_key => row */
    public static function all(): array {
        $v = get_option(self::OPTION);
        return is_array($v) ? $v : [];
    }

    /** @return array<string,mixed>|null */
    public static function get(string $tour_key): ?array {
        $all = self::all();
        return isset($all[$tour_key]) && is_array($all[$tour_key]) ? $all[$tour_key] : null;
    }

    /** The configured release moment (UTC unix), or 0 when this tour has no schedule. */
    public static function release_ts(string $tour_key): int {
        $row = self::get($tour_key);
        return $row ? (int) ($row['release_at'] ?? 0) : 0;
    }

    /**
     * Is booking open for this tour? Open when there is no schedule, or the
     * release moment has arrived. A future release moment is the only thing that
     * closes it — so existing tours with no row keep working exactly as before.
     */
    public static function is_released(string $tour_key): bool {
        $ts = self::release_ts($tour_key);
        return $ts <= 0 || time() >= $ts;
    }

    /** The ticket event whose buyers this tour's booking + announcement belong to. */
    public static function event_for(string $tour_key): int {
        $row = self::get($tour_key);
        return $row ? (int) ($row['event_id'] ?? 0) : 0;
    }

    /**
     * Create or update a tour's release row. Changing the release moment clears
     * the "sent" markers so a rescheduled tour announces again at the new time.
     */
    public static function save(string $tour_key, array $data): void {
        $all = self::all();
        $prev = isset($all[$tour_key]) && is_array($all[$tour_key]) ? $all[$tour_key] : [];
        $release_at = (int) ($data['release_at'] ?? 0);
        $rescheduled = (int) ($prev['release_at'] ?? 0) !== $release_at;
        $all[$tour_key] = [
            'city'            => (string) ($data['city'] ?? ($prev['city'] ?? '')),
            'year'            => (string) ($data['year'] ?? ($prev['year'] ?? '')),
            'event_id'        => (int) ($data['event_id'] ?? ($prev['event_id'] ?? 0)),
            'release_at'      => $release_at,
            'booking_url'     => (string) ($data['booking_url'] ?? ($prev['booking_url'] ?? '')),
            'notified_at'     => $rescheduled ? 0 : (int) ($prev['notified_at'] ?? 0),
            'notified_cursor' => $rescheduled ? '' : (string) ($prev['notified_cursor'] ?? ''),
        ];
        update_option(self::OPTION, $all, false);
    }

    public static function delete(string $tour_key): void {
        $all = self::all();
        if (isset($all[$tour_key])) {
            unset($all[$tour_key]);
            update_option(self::OPTION, $all, false);
        }
    }

    /**
     * Hourly: for each tour whose release moment has passed but whose
     * announcement hasn't finished sending, email the next batch of ticket
     * holders. Resumes across runs via a per-tour offset cursor, and only marks a
     * tour done once every holder has been emailed — so a large list spreads over
     * a few runs and nobody is emailed twice.
     */
    public static function run_due(): void {
        foreach (self::all() as $tour_key => $row) {
            if (! is_array($row)) {
                continue;
            }
            $release_at = (int) ($row['release_at'] ?? 0);
            if ($release_at <= 0 || time() < $release_at || (int) ($row['notified_at'] ?? 0) > 0) {
                continue; // not scheduled, not due yet, or already finished
            }
            $event_id = (int) ($row['event_id'] ?? 0);
            if ($event_id <= 0) {
                continue; // no audience to scope to — never blast every buyer
            }
            $cursor  = (string) ($row['notified_cursor'] ?? '');
            $buyers  = self::buyers($event_id, self::BATCH, $cursor);
            $label   = get_the_title($event_id) ?: __('the guided tours', 'october-events');
            $booking = (string) ($row['booking_url'] ?? '');
            foreach ($buyers as $b) {
                Mailer::release_announcement($b['email'], $b['name'], $label, $booking);
            }
            if ($buyers) {
                // Advance the keyset cursor to the last email sent, so the next
                // run resumes strictly after it. Unlike an OFFSET, this neither
                // skips nor re-sends when the paid-order set shifts between runs.
                $row['notified_cursor'] = (string) end($buyers)['email'];
            }
            if (count($buyers) < self::BATCH) {
                $row['notified_at'] = time(); // last batch — this tour is done
            }
            $all = self::all();
            $all[$tour_key] = $row;
            update_option(self::OPTION, $all, false);
        }
    }

    /**
     * Distinct ticket-buyer emails (with a display name) for an event's paid
     * orders, paged for the announcement. Grouped by email so a repeat buyer is
     * emailed once; ordered by email and paged with a keyset cursor (email >
     * $after) rather than an OFFSET, so inserts/removals in the paid-order set
     * between hourly runs never skip or double-send a holder.
     *
     * @return array<int,array{email:string,name:string}>
     */
    public static function buyers(int $event_id, int $limit, string $after = ''): array {
        global $wpdb;
        if ($event_id <= 0) {
            return [];
        }
        $orders = Schema::orders();
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT email, MAX(name) AS name FROM {$orders}
             WHERE event_id = %d AND status = 'paid' AND email <> '' AND email > %s
             GROUP BY email ORDER BY email ASC LIMIT %d",
            $event_id, $after, max(1, $limit)
        )) ?: [];
        $out = [];
        foreach ($rows as $r) {
            $out[] = ['email' => (string) $r->email, 'name' => (string) $r->name];
        }
        return $out;
    }

    /** How many holders would receive the announcement (for the admin readout). */
    public static function audience_count(int $event_id): int {
        global $wpdb;
        if ($event_id <= 0) {
            return 0;
        }
        $orders = Schema::orders();
        return (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(DISTINCT email) FROM {$orders} WHERE event_id = %d AND status = 'paid' AND email <> ''",
            $event_id
        ));
    }
}
