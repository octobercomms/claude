<?php
declare(strict_types=1);

namespace OE\Ticketing;

use OE\PostTypes;
use OE\AuditLog;

defined('ABSPATH') || exit;

/**
 * Door check-in logic for the scanning PWA.
 *
 * Access is PIN-gated (per event), not WP-login gated, so door staff can use it
 * on their own phones. Every scan is logged; a repeat scan at the same venue is
 * flagged "already" but still recorded (advisory, matching the proven model).
 */
final class CheckIn {

    /**
     * A built-in, always-available test event so staff can verify the scanner
     * any time without real tickets. It is virtual — never written to the DB and
     * never public/indexed: scanning the test QR just returns a green "valid".
     * The id is a high sentinel that won't collide with a real event post.
     */
    public const TEST_EVENT_ID = 9999999;
    public const TEST_PIN      = '0000';
    public const TEST_TOKEN    = 'OE-TEST-TICKET';

    /** Events that have ticket types (for the PWA event picker). */
    public static function events(): array {
        $events = get_posts([
            'post_type'      => PostTypes::slug('event'),
            'post_status'    => 'publish',
            'posts_per_page' => 200,
            'orderby'        => 'title',
            'order'          => 'ASC',
        ]);
        // Test event always first, so there's a standing scanner check.
        $out = [['id' => self::TEST_EVENT_ID, 'title' => '🧪 ' . __('Test (scanner check)', 'october-events')]];
        foreach ($events as $ev) {
            if (TicketTypes::types($ev->ID)) {
                $out[] = ['id' => $ev->ID, 'title' => get_the_title($ev)];
            }
        }
        return $out;
    }

    public static function pin_ok(int $event_id, string $pin): bool {
        if ($event_id === self::TEST_EVENT_ID) {
            return trim($pin) === self::TEST_PIN;
        }
        $stored = TicketTypes::pin($event_id);
        return $stored !== '' && hash_equals($stored, trim($pin));
    }

    /** @return string[] */
    public static function venues(int $event_id): array {
        if ($event_id === self::TEST_EVENT_ID) {
            return ['Test door'];
        }
        return array_values(array_filter(array_map(
            static fn($v) => (string) ($v['name'] ?? ''),
            TicketTypes::venues($event_id)
        )));
    }

    /**
     * Validate + record a scan.
     *
     * @return array{status:string,attendee?:string,type?:string,count?:int}
     */
    public static function scan(string $token, int $event_id, string $venue, ?string $scanned_at = null): array {
        // Built-in test event: validate the test QR, record nothing.
        if ($event_id === self::TEST_EVENT_ID) {
            return $token === self::TEST_TOKEN
                ? ['status' => 'valid', 'attendee' => __('Test Attendee', 'october-events'), 'type' => __('Test ticket', 'october-events'), 'count' => 1]
                : ['status' => 'invalid'];
        }
        $ticket = Orders::ticket_by_token($token);
        if (! $ticket || $ticket->status !== 'active') {
            return ['status' => 'invalid'];
        }
        if ((int) $ticket->event_id !== $event_id) {
            return ['status' => 'wrong_event'];
        }

        global $wpdb;
        $venue = sanitize_text_field($venue);
        $already = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM " . Schema::checkins() . " WHERE ticket_id = %d AND venue_name = %s",
            $ticket->id,
            $venue
        )) > 0;

        $wpdb->insert(Schema::checkins(), [
            'ticket_id'  => (int) $ticket->id,
            'event_id'   => $event_id,
            'venue_name' => $venue,
            // Offline scans carry the time they actually happened (synced later).
            'scanned_at' => $scanned_at ?: current_time('mysql', true),
        ]);
        AuditLog::record('ticket_checked_in', (int) $ticket->id, 'ticket', $venue);

        $count = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM " . Schema::checkins() . " WHERE ticket_id = %d",
            $ticket->id
        ));

        return [
            'status'   => $already ? 'already' : 'valid',
            'attendee' => (string) $ticket->attendee_name,
            'type'     => (string) $ticket->ticket_type_label,
            'count'    => $count,
        ];
    }

    /**
     * Offline manifest for the scanner: every valid token for an event plus the
     * tokens already checked in. The PWA caches this on PIN entry so it can keep
     * validating (and flagging repeats) when the venue Wi-Fi drops. Small by
     * design — a few KB even at ~1,000 tickets.
     *
     * @return array{tickets:array<int,array{token:string,attendee:string,type:string}>,checked_in:array<int,array{token_hash:string,venue:string}>,generated:string}
     */
    public static function manifest(int $event_id): array {
        if ($event_id === self::TEST_EVENT_ID) {
            return [
                'tickets'    => [[
                    'token_hash' => self::token_hash(self::TEST_TOKEN),
                    'attendee'   => __('Test Attendee', 'october-events'),
                    'type'       => __('Test ticket', 'october-events'),
                ]],
                'checked_in' => [],
                'generated'  => current_time('mysql', true),
            ];
        }
        global $wpdb;
        $t = Schema::tickets();
        $c = Schema::checkins();
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT token, attendee_name, ticket_type_label FROM {$t} WHERE event_id = %d AND status = 'active'",
            $event_id
        )) ?: [];
        // Tokens are the admission credential, so the manifest ships only their
        // SHA-256 hash — the scanner hashes the scanned QR and matches locally.
        // A leaked manifest can no longer forge/clone tickets.
        $tickets = array_map(static fn($r) => [
            'token_hash' => self::token_hash((string) $r->token),
            'attendee'   => (string) $r->attendee_name,
            'type'       => (string) $r->ticket_type_label,
        ], $rows);
        // Tokens already scanned, paired with the door — so an offline device flags
        // a repeat only at the *same* door (a new door is a fresh valid check-in,
        // matching the online behaviour). Token is shipped hashed, never raw.
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT DISTINCT t.token AS token, c.venue_name AS venue FROM {$c} c INNER JOIN {$t} t ON t.id = c.ticket_id WHERE c.event_id = %d",
            $event_id
        )) ?: [];
        $checked = array_map(static fn($r) => [
            'token_hash' => self::token_hash((string) $r->token),
            'venue'      => (string) $r->venue,
        ], $rows);
        return [
            'tickets'    => $tickets,
            'checked_in' => $checked,
            'generated'  => current_time('mysql', true),
        ];
    }

    /** SHA-256 of a ticket token, hex — matches the scanner's crypto.subtle hash. */
    public static function token_hash(string $token): string {
        return hash('sha256', $token);
    }

    /**
     * Paginated check-in log (most recent first), optionally for one event.
     * Joined with the ticket for attendee/type/number context.
     *
     * @return array<int,object>
     */
    public static function log(int $event_id = 0, int $limit = 50, int $offset = 0): array {
        global $wpdb;
        $c = Schema::checkins();
        $t = Schema::tickets();
        $cols = "c.id, c.event_id, c.venue_name, c.scanned_at, c.ticket_id,
                 t.attendee_name, t.ticket_type_label, t.ticket_number, t.total_in_order";
        $sql = "SELECT {$cols} FROM {$c} c LEFT JOIN {$t} t ON t.id = c.ticket_id ";
        $limit  = max(1, min(200, $limit));
        $offset = max(0, $offset);
        if ($event_id > 0) {
            return $wpdb->get_results($wpdb->prepare(
                $sql . "WHERE c.event_id = %d ORDER BY c.id DESC LIMIT %d OFFSET %d",
                $event_id, $limit, $offset
            )) ?: [];
        }
        return $wpdb->get_results($wpdb->prepare(
            $sql . "ORDER BY c.id DESC LIMIT %d OFFSET %d",
            $limit, $offset
        )) ?: [];
    }

    /** Total number of recorded scans (optionally for one event). */
    public static function log_total(int $event_id = 0): int {
        global $wpdb;
        $c = Schema::checkins();
        if ($event_id > 0) {
            return (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$c} WHERE event_id = %d", $event_id));
        }
        return (int) $wpdb->get_var("SELECT COUNT(*) FROM {$c}");
    }

    /**
     * Paginated check-in log collapsed to one row per ticket + door: a second
     * scan of the same ticket at the same door isn't a new line, it bumps a
     * "rescans" count. Scanning at a *different* door is a separate row. Ordered
     * by most recent scan first.
     *
     * @return array<int,object> {event_id, venue_name, ticket_id, scans, rescans,
     *                            first_at, last_at, attendee_name, ticket_type_label,
     *                            ticket_number, total_in_order}
     */
    public static function log_grouped(int $event_id = 0, int $limit = 50, int $offset = 0): array {
        global $wpdb;
        $c = Schema::checkins();
        $t = Schema::tickets();
        $limit  = max(1, min(200, $limit));
        $offset = max(0, $offset);
        // MAX() on the per-ticket columns keeps ONLY_FULL_GROUP_BY happy — they're
        // constant for a ticket_id, so any aggregate returns the right value.
        $cols = "c.event_id, c.venue_name, c.ticket_id,
                 COUNT(*) AS scans, (COUNT(*) - 1) AS rescans,
                 MIN(c.scanned_at) AS first_at, MAX(c.scanned_at) AS last_at,
                 MAX(t.attendee_name) AS attendee_name, MAX(t.ticket_type_label) AS ticket_type_label,
                 MAX(t.ticket_number) AS ticket_number, MAX(t.total_in_order) AS total_in_order";
        $sql = "SELECT {$cols} FROM {$c} c LEFT JOIN {$t} t ON t.id = c.ticket_id ";
        $group = "GROUP BY c.event_id, c.venue_name, c.ticket_id ORDER BY last_at DESC LIMIT %d OFFSET %d";
        if ($event_id > 0) {
            return $wpdb->get_results($wpdb->prepare(
                $sql . "WHERE c.event_id = %d " . $group,
                $event_id, $limit, $offset
            )) ?: [];
        }
        return $wpdb->get_results($wpdb->prepare($sql . $group, $limit, $offset)) ?: [];
    }

    /** Number of collapsed (ticket × door) log rows — for pagination. */
    public static function log_groups_total(int $event_id = 0): int {
        global $wpdb;
        $c = Schema::checkins();
        $inner = "SELECT 1 FROM {$c} c ";
        $grp = "GROUP BY c.event_id, c.venue_name, c.ticket_id";
        if ($event_id > 0) {
            return (int) $wpdb->get_var($wpdb->prepare(
                "SELECT COUNT(*) FROM ({$inner} WHERE c.event_id = %d {$grp}) x",
                $event_id
            ));
        }
        return (int) $wpdb->get_var("SELECT COUNT(*) FROM ({$inner} {$grp}) x");
    }

    /**
     * Scan counts per event + door, for the "events split out by doors" chart.
     * Most-scanned door first within each event.
     *
     * @return array<int,object> {event_id, venue, scans}
     */
    public static function scans_by_event_venue(int $event_id = 0): array {
        global $wpdb;
        $c = Schema::checkins();
        if ($event_id > 0) {
            return $wpdb->get_results($wpdb->prepare(
                "SELECT event_id, venue_name AS venue, COUNT(*) AS scans FROM {$c}
                 WHERE event_id = %d GROUP BY event_id, venue_name ORDER BY scans DESC",
                $event_id
            )) ?: [];
        }
        return $wpdb->get_results(
            "SELECT event_id, venue_name AS venue, COUNT(*) AS scans FROM {$c}
             GROUP BY event_id, venue_name ORDER BY event_id ASC, scans DESC"
        ) ?: [];
    }

    /**
     * Scans bucketed by hour of the local day (0–23, zero-filled), for the
     * "time of day" chart. scanned_at is stored UTC, so the per-hour counts are
     * shifted by the site's current UTC offset (good for an event's date range;
     * a DST boundary mid-series is the only edge it doesn't track perfectly).
     *
     * @return array<int,int> hour (0–23) => scan count
     */
    public static function scans_by_hour(int $event_id = 0): array {
        global $wpdb;
        $c = Schema::checkins();
        if ($event_id > 0) {
            $rows = $wpdb->get_results($wpdb->prepare(
                "SELECT HOUR(scanned_at) AS h, COUNT(*) AS scans FROM {$c} WHERE event_id = %d GROUP BY HOUR(scanned_at)",
                $event_id
            )) ?: [];
        } else {
            $rows = $wpdb->get_results("SELECT HOUR(scanned_at) AS h, COUNT(*) AS scans FROM {$c} GROUP BY HOUR(scanned_at)") ?: [];
        }
        $offset = (int) round(wp_timezone()->getOffset(new \DateTimeImmutable('now')) / HOUR_IN_SECONDS);
        $buckets = array_fill(0, 24, 0);
        foreach ($rows as $r) {
            $local = (((int) $r->h + $offset) % 24 + 24) % 24;
            $buckets[$local] += (int) $r->scans;
        }
        return $buckets;
    }

    /**
     * @return array{unique:int,venues:array<int,array{venue:string,count:int}>}
     */
    public static function stats(int $event_id): array {
        if ($event_id === self::TEST_EVENT_ID) {
            return ['unique' => 0, 'venues' => []];
        }
        global $wpdb;
        $c = Schema::checkins();
        $unique = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(DISTINCT ticket_id) FROM {$c} WHERE event_id = %d",
            $event_id
        ));
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT venue_name AS venue, COUNT(*) AS count FROM {$c} WHERE event_id = %d GROUP BY venue_name",
            $event_id
        )) ?: [];
        return ['unique' => $unique, 'venues' => array_map(static fn($r) => ['venue' => $r->venue, 'count' => (int) $r->count], $rows)];
    }
}
